import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Image, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { GLView } from 'expo-gl';
import Slider from './src/components/Slider';
import {
  SimulatorState, createInitialState, tick, setJointsDirect, startRoute, feedMpuHeartbeat,
  RoutePreset, addSimulatedRep, setClawPct, stopSequence, stopRoute,
} from './src/sim/simulator';
import { JOINT_LIMITS, JointsDeg } from './src/sim/safety';
import { buildArmScene, applyJointsToScene, ArmScene, applyWorldOffset } from './src/scene/armScene';
import { IKResult, fkForward } from './src/sim/kinematics';

type CollapseKey =
  | 'claw' | 'torque' | 'warmup' | 'routes' | 'exercises'
  | 'manual' | 'poses' | 'dynamics' | 'sequences' | 'scene';

const ROUTE_PRESETS: { id: RoutePreset; label: string; accent: string; meta: string; accentName?: string }[] = [
  { id: 'home', label: 'Home 95°', accent: '#7ec8e3', meta: 'base 90 · sh 90 · el 95 · wr 90', accentName: 'home' },
  { id: 'park', label: 'Park / Transport', accent: '#e0a85c', meta: 'base 90 · sh 90 · el 180 · wr 180', accentName: 'transport' },
  { id: 'htl', label: 'Heavy Tucked Lift', accent: '#ffaa00', meta: 'HTL-1→2→3→4→5 · 5 waypoints', accentName: 'htl' },
  { id: 'pendulum', label: 'Pendulum Swing', accent: '#ff7a59', meta: 'Extend → dump → inertia swing → brake → home', accentName: 'pend' },
  { id: 'gimme', label: 'Gimme Five', accent: '#ffcc44', meta: 'Coil → strike → retract · 1-shot', accentName: 'gimme' },
  { id: 'bicep-set', label: 'Bicep Curl (6×1)', accent: '#9b7eed', meta: '+X front · wrist 25°↔180° · 6 reps', accentName: 'bicep' },
  { id: 'lateral-set', label: 'Lateral Raise (6×1)', accent: '#b08cff', meta: '90/180/90 ↔ 90/180/180 · 6 reps', accentName: 'lat' },
  { id: 'elbowflex-set', label: 'Elbow Flexion (6×1)', accent: '#c9a8ff', meta: '−X · 0/95/90 ↔ 0/180/180 · rep 6 chain HTL', accentName: 'elbow' },
  { id: 'orbital', label: 'Orbital Scan', accent: '#00bbff', meta: 'Loop · 96 waypoints · Cartesian circle', accentName: 'orb' },
  { id: 'snake', label: 'Snake Dance', accent: '#55ff88', meta: 'Loop · sine phase wave · low shoulder torque', accentName: 'snake' },
  { id: 'cobra', label: 'Cobra Strike', accent: '#ff9f43', meta: 'Loop · coil → strike → retract', accentName: 'cobra' },
];

type RehabRouteCard = {
  id: string;
  label: string;
  accent: string;
  accentName: string;
  meta: string;
  steps: string;
  exercises: RoutePreset[];
};

const REHAB_ROUTE_CARDS: RehabRouteCard[] = [
  {
    id: 'light', label: 'Light Rehab', accent: '#9dffb8', accentName: 'bicep',
    meta: '3 exercises · 3 reps each · 14°/s · tolerance ±8°',
    steps: 'Bicep 3× → Lateral 3× → Elbow Flex 3×',
    exercises: ['bicep-set', 'lateral-set', 'elbowflex-set'],
  },
  {
    id: 'medium', label: 'Medium Rehab', accent: '#ffe08a', accentName: 'lat',
    meta: '3 exercises · 5 reps each · 18°/s · tolerance ±5°',
    steps: 'Bicep 5× → Lateral 5× → Elbow Flex 5×',
    exercises: ['bicep-set', 'lateral-set', 'elbowflex-set'],
  },
  {
    id: 'heavy', label: 'Heavy Rehab', accent: '#ff9a9a', accentName: 'elbow',
    meta: '3 exercises · 6 reps each · 22°/s · tolerance ±3°',
    steps: 'Bicep 6× → Lateral 6× → Elbow Flex 6×',
    exercises: ['bicep-set', 'lateral-set', 'elbowflex-set'],
  },
];

const EXERCISE_DEMOS: { id: RoutePreset; title: string; body: string; meta: string; accentName: string }[] = [
  { id: 'bicep-set', title: 'Bicep Curl', accentName: 'bicep',
    body: 'Shoulder 120° and elbow 170° locked. Only the wrist curls tip-down ↔ tip-up — isolated tip flip without moving the elbow hinge.',
    meta: '+X front · wrist 180° ↔ 25° · 6 reps · sh/el fixed' },
  { id: 'lateral-set', title: 'Lateral Raise', accentName: 'lat',
    body: 'Two photo L-poses only: tip out ↔ tip down. Shoulder 90° and elbow 180° locked — same inverted-L column; only wrist tip direction changes.',
    meta: '90/180/90 ↔ 90/180/180 · 6 reps · +X front' },
  { id: 'elbowflex-set', title: 'Elbow Flexion', accentName: 'elbow',
    body: 'Only exercise on the −X (left) side — shoulder locked at 0°. Elbow and wrist flex together: EF-EXT (0/95/90) ↔ EF-PEAK (0/180/180). Reps 1–5 loop; rep 6 chains HTL-4→HTL-5.',
    meta: 'EF-EXT → EF-PEAK ×5 · rep 6: EXT→PEAK→EXT→PEAK→HTL-4→HTL-5' },
];

const WARMUP_POSES: { label: string; meta: string; accentName: string; joints: JointsDeg }[] = [
  { label: 'Dumbbell Up', meta: 'base 90 · sh 90 · el 95 · wr 90', accentName: 'dbup',
    joints: { base: 90, shoulder: 90, elbow: 95, wrist: 90, gripper: 100 } },
  { label: 'Dumbbell Down', meta: 'base 90 · sh 137 · el 180 · wr 135', accentName: 'dbdown',
    joints: { base: 90, shoulder: 137, elbow: 180, wrist: 135, gripper: 50 } },
];

const NAMED_POSES: { label: string; meta: string; accentName: string; joints: JointsDeg }[] = [
  { label: 'C Pose', meta: 'base ~90 · sh ~55 · el ~155 · wr ~150', accentName: 'cpose',
    joints: { base: 90, shoulder: 55, elbow: 155, wrist: 150, gripper: 100 } },
  { label: 'Transport', meta: 'base 90 · sh 90 · el 180 · wr 180 · tip ↓', accentName: 'transport',
    joints: { base: 90, shoulder: 90, elbow: 180, wrist: 180, gripper: 100 } },
];

const DYNAMICS_DEMOS: { id: RoutePreset; title: string; body: string; meta: string; accentName: string }[] = [
  { id: 'htl', title: 'Heavy Tucked Lift', accentName: 'htl',
    body: 'Five-waypoint lift in one continuous S-curve — synced joints, no pauses. Safe-homes first, then HTL-1 through HTL-5 (tip over column at HTL-4). Ends at home.',
    meta: 'HTL-1(180,90,90) → HTL-2(127,180,90) → HTL-3(112,180,180) → HTL-4(~30,180,180) → HTL-5(90,90,90)' },
  { id: 'pendulum', title: 'Pendulum Swing', accentName: 'pend',
    body: 'Dynamic torque demo: dip the elbow to build momentum, snap up, then brake into stable home. Uses inertia instead of a slow deadlift — watch shoulder and elbow strain on the scope.',
    meta: 'Extend → hold → dump → inertia swing → brake → home (el 95°)' },
  { id: 'gimme', title: 'Gimme Five', accentName: 'gimme',
    body: 'Single burst: coil → strike → retract → home. Same tuck-and-strike as Cobra Strike, but runs once — not a loop.',
    meta: '1 strike · brief hold · stable home' },
];

const SEQUENCE_DEMOS: { id: RoutePreset; title: string; body: string; meta: string; accentName: string }[] = [
  { id: 'orbital', title: 'Orbital Scan', accentName: 'orb',
    body: 'True Cartesian control: IK traces a slow vertical circle while keeping the hand level (pitch 0). Proves on-device path planning is a smooth O, not a flat joint sweep.',
    meta: 'Loop · 96 waypoints · ~6°/s joint advance' },
  { id: 'snake', title: 'Snake Dance', accentName: 'snake',
    body: 'Procedural joint-space wave: phase-shifted sines on base, shoulder, elbow, and wrist so fluid undulation travels down the links. Pure joint math — no IK.',
    meta: 'Loop · sine phases · low shoulder torque band' },
  { id: 'cobra', title: 'Cobra Strike', accentName: 'cobra',
    body: 'Continuous attack loop: fold deep, strike forward, retract, repeat. The showcase crowd-pleaser that never leaves the workspace.',
    meta: 'Loop · strike every 2.4 s · folded anti-gravity carry between' },
];

const ACCENT_MAP: Record<string, { border: string; title: string }> = {
  home:      { border: '#7ec8e3', title: '#7ec8e3' },
  cpose:     { border: '#5ad4a0', title: '#5ad4a0' },
  transport: { border: '#e0a85c', title: '#e0a85c' },
  htl:       { border: '#ffaa00', title: '#ffaa00' },
  pend:      { border: '#ff7a59', title: '#ff7a59' },
  gimme:     { border: '#ffcc44', title: '#ffcc44' },
  orb:       { border: '#00bbff', title: '#00bbff' },
  snake:     { border: '#55ff88', title: '#55ff88' },
  cobra:     { border: '#ff9f43', title: '#ff9f43' },
  dbup:      { border: '#6ec8b8', title: '#6ec8b8' },
  dbdown:    { border: '#c8a86e', title: '#c8a86e' },
  bicep:     { border: '#9b7eed', title: '#9b7eed' },
  lat:       { border: '#b08cff', title: '#b08cff' },
  elbow:     { border: '#c9a8ff', title: '#c9a8ff' },
};

const ACCENT_HEADER: Record<CollapseKey, string> = {
  claw:      '#00bbff',
  torque:    '#00ffcc',
  warmup:    '#6ec8b8',
  routes:    '#c4b0f0',
  exercises: '#9b7eed',
  manual:    '#e0c060',
  poses:     '#7ec8e3',
  dynamics:  '#ffaa00',
  sequences: '#55aaff',
  scene:     '#9b9ab8',
};

const COLLAPSE_KICKER: Record<CollapseKey, string> = {
  claw:      'Instant gripper — always live',
  torque:    'Real-time forces — synced to firmware',
  warmup:    'Pre-exercise dumbbell holds',
  routes:    'Light · Medium · Heavy',
  exercises: 'Single exercise — default 6 reps',
  manual:    'Per-joint staging — Execute sends to arm',
  poses:     'C pose and transport — checkpoint holds',
  dynamics:  'One-shot physics demos — auto-finish then home',
  sequences: 'Continuous loops — stop manually when done',
  scene:     'Camera framing — does not move the arm',
};

const COLLAPSE_LABEL: Record<CollapseKey, string> = {
  claw:      'Claw Control',
  torque:    'Torque & Load',
  warmup:    'Warm-up',
  routes:    'Rehab Routes',
  exercises: 'Exercises',
  manual:    'Manual Control',
  poses:     'Named Poses',
  dynamics:  'Demo Dynamics',
  sequences: 'Demo Sequences',
  scene:     'Scene Offset',
};

const $accent = '#00d4b8';
const $accentDim = 'rgba(0,212,184,0.12)';
const $warn = '#e8a030';
const $err = '#e8456a';
const $ok = '#2ecc71';
const $bg = '#0a0c0b';
const $panel = 'rgba(14,16,15,0.94)';
const $panelElev = 'rgba(20,22,21,0.98)';
const $line = '#252a28';
const $mut = '#7a8480';
const $text = '#dce8e4';
const $textDim = '#9aa8a2';

export default function App() {
  const glRef = useRef<any>(null);
  const stateRef = useRef<SimulatorState>(createInitialState());
  const sceneRef = useRef<ArmScene | null>(null);
  const [, forceTick] = useState(0);
  const rerender = () => forceTick((t) => (t + 1) % 1_000_000);
  const [ready, setReady] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<CollapseKey, boolean>>({
    claw: true, torque: true, warmup: true,
    routes: true, exercises: true, manual: true,
    poses: true, dynamics: true, sequences: true, scene: true,
  });
  const [manualOverride, setManualOverride] = useState(false);
  const [payloadKg, setPayloadKg] = useState(0);
  const [dumbbellG, setDumbbellG] = useState(17);
  const [dumbbellLoaded, setDumbbellLoaded] = useState(false);
  const [worldOffset, setWorldOffset] = useState({ x: 0, y: -7.5, z: 0 });

  useEffect(() => {
    stateRef.current = feedMpuHeartbeat(stateRef.current);
    let cancelled = false;
    const id = setInterval(() => {
      if (cancelled) return;
      stateRef.current = tick(stateRef.current);
      stateRef.current = feedMpuHeartbeat(stateRef.current);
      if (sceneRef.current) {
        applyJointsToScene(sceneRef.current, stateRef.current.joints);
      }
      rerender();
    }, stateRef.current.tickMs);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    if (sceneRef.current) applyWorldOffset(sceneRef.current, worldOffset);
  }, [worldOffset.x, worldOffset.y, worldOffset.z]);

  const onGLContextCreate = async (gl: any) => {
    try {
      glRef.current = gl;
      const width = gl.drawingBufferWidth || 800;
      const height = gl.drawingBufferHeight || 600;
      const scene = buildArmScene({ gl, width, height });
      applyWorldOffset(scene, worldOffset);
      sceneRef.current = scene;
      const renderer = scene.renderer;
      const renderLoop = () => {
        if (!glRef.current) return;
        scene.camera.updateProjectionMatrix();
        renderer.render(scene.scene, scene.camera);
        gl.endFrameEXP();
        requestAnimationFrame(renderLoop);
      };
      setReady(true);
      requestAnimationFrame(renderLoop);
    } catch (err) {
      console.error('Three.js scene init failed:', err);
    }
  };

  const s = stateRef.current;
  const pose = useMemo(() => {
    try { return fkForward(s.joints); } catch { return { x: 0, y: 0, z: 0 }; }
  }, [s.joints.base, s.joints.shoulder, s.joints.elbow, s.joints.wrist]);

  const setJoint = (k: keyof JointsDeg, vDeg: number) => {
    stateRef.current = setJointsDirect(stateRef.current, { ...s.joints, [k]: vDeg });
    rerender();
  };
  const runRoute = (id: RoutePreset) => {
    stateRef.current = startRoute(stateRef.current, id);
    if (id === 'bicep-set' || id === 'lateral-set' || id === 'elbowflex-set') {
      const kind: 'bicep' | 'lateral' | 'elbowflex' =
        id === 'bicep-set' ? 'bicep' : id === 'lateral-set' ? 'lateral' : 'elbowflex';
      setTimeout(() => { stateRef.current = addSimulatedRep(stateRef.current, kind, 0.82, 122); rerender(); }, 2200);
      setTimeout(() => { stateRef.current = addSimulatedRep(stateRef.current, kind, 0.78, 119); rerender(); }, 3300);
      setTimeout(() => { stateRef.current = addSimulatedRep(stateRef.current, kind, 0.88, 141); rerender(); }, 4500);
    }
    rerender();
  };
  const applyPoseDirect = (j: JointsDeg) => {
    stateRef.current = setJointsDirect(stateRef.current, j);
    rerender();
  };
  const setClaw = (pct: number) => {
    stateRef.current = setClawPct(stateRef.current, pct);
    rerender();
  };

  const jointOrder: (keyof JointsDeg)[] = ['base', 'shoulder', 'elbow', 'wrist'];
  const jointDirs: Record<keyof JointsDeg, 'D' | 'I'> = {
    base: 'D', shoulder: 'I', elbow: 'D', wrist: 'D', gripper: 'D',
  };
  const degToPwm = (k: keyof JointsDeg, deg: number) => {
    const [lo, hi] = k === 'elbow' ? [300, 500] : k === 'gripper' ? [236, 440] : [100, 500];
    return Math.round(lo + (deg / 180) * (hi - lo));
  };

  const pctToClawPwm = (pct: number) => Math.round(236 + pct / 100 * (440 - 236));

  const torqueSh = 0.38 * Math.sin((s.joints.shoulder - 90) * Math.PI / 180) + payloadKg * 0.12;
  const torqueEl = 0.52 * Math.sin((s.joints.elbow - 90) * Math.PI / 180) + payloadKg * 0.15;
  const torqueWr = 0.18 * Math.cos((s.joints.wrist - 90) * Math.PI / 180) + payloadKg * 0.05;
  const wScore = 0.4 + 0.6 * Math.max(0, Math.sin(((s.joints.elbow - 90) / 90) * Math.PI));
  const postureRating = wScore > 0.75 ? 'OPTIMAL' : wScore > 0.5 ? 'STABLE' : wScore > 0.3 ? 'DERATED' : 'STRAIN';
  const ratingColor = wScore > 0.75 ? $ok : wScore > 0.5 ? $accent : wScore > 0.3 ? $warn : $err;

  const routePills = [
    { title: 'HTL-1', sub: 'Reach', done: s.currentRoute && s.routeProgress > 0.05, active: s.currentRoute && s.routeProgress >= 0.05 && s.routeProgress < 0.25 },
    { title: 'HTL-2', sub: 'Fold',  done: s.currentRoute && s.routeProgress > 0.25, active: s.currentRoute && s.routeProgress >= 0.25 && s.routeProgress < 0.5 },
    { title: 'HTL-3', sub: 'Tuck',  done: s.currentRoute && s.routeProgress > 0.5,  active: s.currentRoute && s.routeProgress >= 0.5 && s.routeProgress < 0.75 },
    { title: 'HTL-4', sub: 'Over',  done: s.currentRoute && s.routeProgress > 0.75, active: s.currentRoute && s.routeProgress >= 0.75 && s.routeProgress < 1 },
    { title: 'HOME',  sub: 'Rest',  done: s.currentRoute && s.routeProgress >= 1,   active: false },
  ];

  const renderCollapse = (key: CollapseKey, first = false) => {
    const open = !collapsed[key];
    const color = ACCENT_HEADER[key];
    return (
      <View key={key} style={{ marginBottom: first ? 0 : 0 }}>
        <Pressable onPress={() => setCollapsed((c) => ({ ...c, [key]: !c[key] }))}>
          <Text
            style={[
              styles.h2,
              { color: open ? color : '#7a8480', marginTop: 18, paddingTop: first ? 6 : 6, paddingBottom: 6, paddingLeft: 16 },
            ]}>
            {COLLAPSE_LABEL[key]}
            <Text style={styles.secKicker}>
              {'\n'}{COLLAPSE_KICKER[key]}
            </Text>
            <Text style={{ position: 'absolute', left: 2, top: 14, width: 5, height: 5,
              borderRightWidth: 1.5, borderBottomWidth: 1.5, borderRightColor: color, borderBottomColor: color,
              transform: [{ rotate: open ? '45deg' : '-45deg' }], opacity: 0.7,
            }} />
          </Text>
        </Pressable>
        {open && (
          <View style={[styles.collapseContent, { borderLeftColor: color, borderLeftWidth: 2, paddingLeft: 12, paddingTop: 4, paddingBottom: 4, marginLeft: 6, marginBottom: 14 }]}>
            {renderSectionBody(key)}
          </View>
        )}
      </View>
    );
  };

  const renderDemoCard = (
    opts: { title: string; body: string; meta: string; accentName: string; primary?: string; onPress?: () => void },
  ) => {
    const a = ACCENT_MAP[opts.accentName] || { border: $accent, title: $accent };
    return (
      <View style={[styles.demoCard, { borderLeftColor: a.border }]}>
        <Text style={[styles.demoTitle, { color: a.title }]}>{opts.title}</Text>
        <Text style={styles.demoBody}>{opts.body}</Text>
        <Text style={styles.demoMeta}>{opts.meta}</Text>
        {opts.onPress && (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable onPress={opts.onPress} style={[styles.btnPrimary, { flex: 1 }]}>
              <Text style={styles.btnPrimaryLabel}>{opts.primary || opts.title}</Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  };

  const renderSectionBody = (key: CollapseKey) => {
    switch (key) {
      case 'claw':
        return (
          <View style={styles.clawPanel}>
            <Text style={styles.sectionLead}>Sends PWM to channel 4 immediately. Grab or release the dumbbell before exercises — no Execute step.</Text>
            <Text style={styles.clawChannelLabel}>ch4 · <Text style={{ color: $mut }}>236 closed → 440 open</Text></Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
              {[{ l: 'Close', p: 0 }, { l: 'Mid', p: 50 }, { l: 'Open', p: 100 }].map((b, i) => (
                <Pressable key={b.l} onPress={() => setClaw(b.p)}
                  style={[i === 2 ? styles.btnPrimary : styles.btnDefault, { flex: 1 }]}>
                  <Text style={i === 2 ? styles.btnPrimaryLabel : styles.btnLabel}>{b.l}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>claw %</Text>
              <View style={{ flex: 1 }}>
                <Slider
                  minimumValue={0}
                  maximumValue={100}
                  step={1}
                  value={s.joints.gripper}
                  onValueChange={(v) => setClaw(v)} />
              </View>
              <SliderNumberInput value={s.joints.gripper} min={0} max={100} step={1} onChange={(v) => setClaw(v)} />
              <Text style={[styles.v, { color: $accent }]}>{pctToClawPwm(s.joints.gripper)}</Text>
            </View>
            <Text style={styles.clawHelp}>PWM map: 0%→236 closed · 50%→338 · 100%→440 open</Text>
          </View>
        );
      case 'torque':
        return (
          <View>
            <Text style={styles.sectionLead}>Newton-Euler torques (static + dynamic) using MG90D/S @ 5V limits. Payload slider is for what-if math; “loaded” path weight comes from claw mid/closed plus dumbbell Load.</Text>
            <View style={styles.rowIk}>
              <Text style={styles.rowLabel}>Payload (kg) <Text style={{ color: '#8a8a96' }}>calc only</Text></Text>
              <View style={{ flex: 1 }}>
                <Slider minimumValue={0} maximumValue={0.5} step={0.001} value={payloadKg}
                  onValueChange={(v) => { setPayloadKg(v); rerender(); }} />
              </View>
              <SliderNumberInput value={payloadKg} min={0} max={0.5} step={0.001}
                onChange={(v) => { setPayloadKg(v); rerender(); }} width={56} />
            </View>
            <View style={[styles.rowIk, { marginTop: 8 }]}>
              <Text style={styles.rowLabel}>Dumbbell (g)</Text>
              <TextInput
                value={String(dumbbellG)}
                onChangeText={(t) => setDumbbellG(Math.max(0, Math.min(500, Number(t) || 0)))}
                keyboardType="numeric"
                style={[styles.numIn, { width: 56, textAlign: 'center' }]} />
              <Text style={[styles.v, { width: 160 }]}>
                {dumbbellG} g · <Text style={{ color: dumbbellLoaded ? $ok : $mut }}>{dumbbellLoaded ? 'LOADED' : 'not loaded'}</Text>
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
              <Pressable
                onPress={() => { setPayloadKg(dumbbellG / 1000); setDumbbellLoaded(true); rerender(); }}
                style={[styles.btnPrimary, { flex: 1 }]}>
                <Text style={styles.btnPrimaryLabel}>Load</Text>
              </Pressable>
              <Pressable style={[styles.btnDefault, { flex: 1 }]}>
                <Text style={styles.btnLabel}>Save</Text>
              </Pressable>
            </View>
            <View style={styles.statusBox}>
              <StatusRow label="Shoulder τ" value={`${torqueSh.toFixed(2)} N·m`}
                sub={`(${(Math.min(100, torqueSh / 1.3 * 100)).toFixed(0)}%)`} ok={torqueSh < 0.8} />
              <StatusRow label="Elbow τ" value={`${torqueEl.toFixed(2)} N·m`}
                sub={`(${(Math.min(100, torqueEl / 1.4 * 100)).toFixed(0)}%)`} ok={torqueEl < 0.85} />
              <StatusRow label="Wrist τ" value={`${torqueWr.toFixed(2)} N·m`}
                sub={`(${(Math.min(100, torqueWr / 0.7 * 100)).toFixed(0)}%)`} ok={torqueWr < 0.4} />
              <StatusRow label="Yoshikawa w" value={wScore.toFixed(2)} ok={wScore > 0.5} />
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                <Text style={styles.lbl}>Posture Rating: </Text>
                <Text style={{ color: ratingColor, fontWeight: '700' }}>{postureRating}</Text>
              </View>
            </View>
            <View style={{ marginTop: 10 }}>
              <Text style={styles.scopeLabel}>Telemetry Oscilloscope</Text>
              <View style={{ width: '100%', height: 80, backgroundColor: '#0a0a0a', borderWidth: 1, borderColor: $line, borderRadius: 2, justifyContent: 'center', alignItems: 'center' }}>
                <Text style={{ color: $mut, fontSize: 11 }}>sim · {s.lastTickAtMs}ms</Text>
              </View>
              <View style={styles.scopeLegend}>
                <Text style={{ color: '#00ffcc' }}>● Shoulder</Text>
                <Text style={{ color: '#ffaa00' }}>● Elbow</Text>
                <Text style={{ color: '#ff3366' }}>● Wrist</Text>
                <Text style={{ color: '#55aaff' }}>● Watts</Text>
              </View>
            </View>
          </View>
        );
      case 'warmup':
        return (
          <View>
            <Text style={styles.sectionLead}>Static curl positions for loading the dumbbell. Each command safe-homes first, then moves to the hold — same path logic as Home / Transport.</Text>
            {WARMUP_POSES.map((p) => renderDemoCard({
              title: p.label,
              body: p.label === 'Dumbbell Up'
                ? 'Upright rest with load — identical to Home: joints near 90°, elbow at 95° so gravity does not hunt the soft limit.'
                : 'Curl-down hold: shoulder forward, elbow fully folded, wrist pitched for the load. Use after grabbing the dumbbell with the claw.',
              meta: p.meta, accentName: p.accentName, primary: p.label,
              onPress: () => applyPoseDirect(p.joints),
            }))}
          </View>
        );
      case 'routes':
        return (
          <View>
            <Text style={styles.sectionLead}>Light, Medium, and Heavy sessions using the three programmed exercises — Bicep Curl, Lateral Raise, Elbow Flexion. Run from here when ready.</Text>
            <View style={[styles.routeStatusBar, s.currentRoute ? { ...styles.routeStatusBarActive } : {}]}>
              <Text style={{ color: s.currentRoute ? $accent : $mut }}>
                {s.currentRoute ? `Running: ${s.currentRoute} · ${(s.routeProgress * 100).toFixed(0)}%` : 'No route running.'}
              </Text>
            </View>
            {REHAB_ROUTE_CARDS.map((r) => {
              const a = ACCENT_MAP[r.accentName] || { border: '#9b7eed', title: '#c4b0f0' };
              return (
                <View key={r.id} style={[styles.routeCard, { borderLeftColor: a.border }]}>
                  <Text style={[styles.routeCardTitle, { color: a.title }]}>{r.label}</Text>
                  <Text style={styles.routeCardMeta}>{r.meta}{'\n'}{r.steps}</Text>
                  <Pressable onPress={() => runRoute(r.exercises[0])} style={styles.routeExecuteBtn}>
                    <Text style={styles.routeExecuteLabel}>Execute</Text>
                  </Pressable>
                </View>
              );
            })}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
              <Pressable
                onPress={() => { stateRef.current = stopRoute(stateRef.current); rerender(); }}
                style={[styles.btnDefault, { flex: 1, backgroundColor: '#3a1a1a', borderColor: '#c44' }]}>
                <Text style={{ color: '#ff8888', fontSize: 12, paddingVertical: 8, paddingHorizontal: 12 }}>Stop route</Text>
              </Pressable>
            </View>
          </View>
        );
      case 'exercises':
        return (
          <View>
            <Text style={styles.sectionLead}>Each exercise runs 6 reps on the front (+X) side except Elbow Flexion, which works on the −X (left) side. Reps 1–5 loop the same pair; rep 6 may chain extra waypoints.</Text>
            {EXERCISE_DEMOS.map((e) => renderDemoCard({
              title: e.title, body: e.body, meta: e.meta, accentName: e.accentName, primary: e.title,
              onPress: () => runRoute(e.id),
            }))}
          </View>
        );
      case 'manual':
        return (
          <View>
            <View style={styles.manualPanel}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <Pressable onPress={() => setManualOverride(!manualOverride)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Switch value={manualOverride} onValueChange={setManualOverride} trackColor={{ true: $accentDim, false: '#1a1a1a' }} thumbColor={manualOverride ? $accent : '#777'} />
                  <Text style={{ fontSize: 11, color: $mut }}>Manual override</Text>
                </Pressable>
              </View>
              <Text style={[styles.manualBadge, manualOverride ? styles.manualBadgePreview : styles.manualBadgeLive]}>
                {manualOverride ? 'PREVIEW — sim only' : 'LIVE — arm drives sim'}
              </Text>
              <Text style={[styles.sectionLead, { marginTop: 8, marginBottom: 0 }]}>
                Joints only — drag sliders or type degrees, preview in the sim, then Execute. Claw stays live in the Claw Control section.
              </Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                <Pressable disabled={!manualOverride}
                  onPress={() => { stateRef.current = feedMpuHeartbeat(s); rerender(); }}
                  style={[styles.btnPrimary, { flex: 1, opacity: manualOverride ? 1 : 0.55 }]}>
                  <Text style={styles.btnPrimaryLabel}>Execute on arm</Text>
                </Pressable>
              </View>
            </View>
            <Text style={{ fontSize: 12, color: $mut, marginBottom: 8, marginTop: 12 }}>
              Left column = joint angle (°). Right column = PWM sent to the servo.
            </Text>
            {jointOrder.map((k) => {
              const [lo, hi] = JOINT_LIMITS[k];
              const dir = jointDirs[k];
              const pwm = degToPwm(k, s.joints[k]);
              return (
                <View key={k} style={styles.row}>
                  <Text style={styles.rowLabel}>
                    {k}
                    <Text style={[
                      styles.dirBadge,
                      dir === 'D' ? { backgroundColor: '#003322', color: $ok } : { backgroundColor: '#332200', color: $warn },
                    ]}>{dir}</Text>
                  </Text>
                  <View style={{ flex: 1 }}>
                    <Slider minimumValue={lo} maximumValue={hi} step={0.1} value={s.joints[k]}
                      onValueChange={(v) => setJoint(k, v)} />
                  </View>
                  <SliderNumberInput value={s.joints[k]} min={lo} max={hi} step={0.1}
                    onChange={(v) => setJoint(k, v)} />
                  <Text style={[styles.v]}>{pwm}</Text>
                </View>
              );
            })}
          </View>
        );
      case 'poses':
        return (
          <View>
            <Text style={styles.sectionLead}>Each pose homes first, then moves to the target. Use these as known checkpoints when chaining moves by name.</Text>
            {NAMED_POSES.map((p) => renderDemoCard({
              title: p.label, body:
                p.label === 'C Pose'
                  ? 'Gentle open “C” in the sagittal plane — tip high and slightly forward. Showcase reach without folding into the floor or overloading the shoulder.'
                  : 'Deep tuck for carrying load: upper arm vertical, forearm horizontal, tip straight down. Keeps payload close to the column — same carry pose used mid-way through Heavy Tucked Lift.',
              meta: p.meta, accentName: p.accentName, primary: p.label,
              onPress: () => applyPoseDirect(p.joints),
            }))}
          </View>
        );
      case 'dynamics':
        return (
          <View>
            <Text style={styles.sectionLead}>Finite moves that show torque, inertia, or packed-power strikes. Each runs once and returns to stable home when done.</Text>
            {DYNAMICS_DEMOS.map((d) => renderDemoCard({
              title: d.title, body: d.body, meta: d.meta, accentName: d.accentName, primary: d.title,
              onPress: () => runRoute(d.id),
            }))}
          </View>
        );
      case 'sequences':
        return (
          <View>
            <Text style={styles.sectionLead}>Paths that keep running until you hit Stop Sequences. Good for stress tests and smooth-motion showcases.</Text>
            {SEQUENCE_DEMOS.map((d) => renderDemoCard({
              title: d.title, body: d.body, meta: d.meta, accentName: d.accentName, primary: d.title,
              onPress: () => runRoute(d.id),
            }))}
            <View style={styles.stopSeqBar}>
              <Pressable onPress={() => { stateRef.current = stopSequence(stateRef.current); rerender(); }} style={styles.btnStopSeq}>
                <Text style={{ color: '#ff8888', fontSize: 12 }}>Stop Sequences</Text>
              </Pressable>
            </View>
          </View>
        );
      case 'scene':
        return (
          <View>
            <Text style={styles.sectionLead}>Shift the 3D scene in world space (1 unit = 25 mm). Use when the arm or dumbbell sits off-center in view. Camera only — does not move the arm.</Text>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>
                X<Text style={[styles.dirBadge, { backgroundColor: '#003322', color: $ok }]}>+r</Text>
              </Text>
              <View style={{ flex: 1 }}>
                <Slider minimumValue={-20} maximumValue={20} step={0.5} value={worldOffset.x}
                  onValueChange={(v) => { setWorldOffset({ ...worldOffset, x: v }); }} />
              </View>
              <Text style={[styles.v, { width: 50 }]}>{worldOffset.x >= 0 ? '+' : ''}{worldOffset.x.toFixed(1)}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>
                Y<Text style={[styles.dirBadge, { backgroundColor: '#003322', color: $ok }]}>up</Text>
              </Text>
              <View style={{ flex: 1 }}>
                <Slider minimumValue={-12} maximumValue={4} step={0.5} value={worldOffset.y}
                  onValueChange={(v) => { setWorldOffset({ ...worldOffset, y: v }); }} />
              </View>
              <Text style={[styles.v, { width: 50 }]}>{worldOffset.y >= 0 ? '+' : ''}{worldOffset.y.toFixed(1)}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>
                Z<Text style={[styles.dirBadge, { backgroundColor: '#003322', color: $ok }]}>fwd</Text>
              </Text>
              <View style={{ flex: 1 }}>
                <Slider minimumValue={-20} maximumValue={20} step={0.5} value={worldOffset.z}
                  onValueChange={(v) => { setWorldOffset({ ...worldOffset, z: v }); }} />
              </View>
              <Text style={[styles.v, { width: 50 }]}>{worldOffset.z >= 0 ? '+' : ''}{worldOffset.z.toFixed(1)}</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <Pressable
                onPress={() => setWorldOffset({ x: 0, y: -7.5, z: 0 })}
                style={[styles.btnDefault, { flex: 1 }]}>
                <Text style={styles.btnLabel}>↺ scene</Text>
              </Pressable>
              <Pressable
                onPress={() => setWorldOffset({ x: 0, y: -7.5, z: 0 })}
                style={[styles.btnDefault, { flex: 1 }]}>
                <Text style={styles.btnLabel}>↺ view</Text>
              </Pressable>
            </View>
          </View>
        );
    }
    return null;
  };

  const routeBannerKind: 'arm' | 'patient' | 'celebration' | null =
    !s.currentRoute ? null :
    s.routeProgress >= 1 ? 'celebration' :
    s.routeProgress < 0.2 ? 'arm' : 'patient';
  const bannerText = routeBannerKind === 'celebration' ? 'COMPLETE' :
    routeBannerKind === 'patient' ? 'HOLD' :
    routeBannerKind === 'arm' ? 'MOVE' : '';
  const bannerSub = routeBannerKind === 'celebration' ? `${s.reps.length} reps logged` :
    routeBannerKind === 'patient' ? 'Keep pace with the arm' :
    routeBannerKind === 'arm' ? `${s.lastCartesianStage} · branch ${s.lastIKBranch || '—'}` : '';

  return (
    <View style={styles.root}>
      <View style={styles.layout}>
        {/* ====== SIDEBAR ====== */}
        <View style={styles.sidebar}>
          <View style={styles.appTopbar}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Image source={require('./assets/logostroke.png')} style={styles.brandLogo} resizeMode="contain" />
              <View>
                <Text style={styles.brandName}>ARMIC</Text>
                <Text style={styles.brandTag}>Aether 4DOF · Rehab Controller · Web Sim</Text>
              </View>
            </View>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 14, paddingBottom: 24 }}>
            <View>
                <View style={styles.homeQuickBar}>
                  <Pressable style={styles.homeQuickBtn} onPress={() => runRoute('home')}>
                    <Text style={styles.homeQuickLabel}>Return Home</Text>
                  </Pressable>
                </View>

                <View style={styles.sidebarGroupFirst}>
                  <Text style={styles.sidebarGroupLabel}>Session setup</Text>
                  <Text style={styles.sidebarGroupDesc}>Follow top to bottom before each rehab run.</Text>
                  {renderCollapse('claw', true)}
                  {renderCollapse('torque')}
                  {renderCollapse('warmup')}
                </View>

                <View style={styles.sidebarGroup}>
                  <Text style={styles.sidebarGroupLabel}>Rehab exercises</Text>
                  <Text style={styles.sidebarGroupDesc}>Preset routes (3–6 reps) or run single exercises below.</Text>
                  {renderCollapse('routes')}
                  {renderCollapse('exercises')}
                </View>

                <View style={styles.sidebarGroup}>
                  <Text style={styles.sidebarGroupLabel}>Operator</Text>
                  <Text style={styles.sidebarGroupDesc}>Fine control when you need it.</Text>
                  {renderCollapse('manual')}
                </View>

                <View style={styles.sidebarGroup}>
                  <Text style={styles.sidebarGroupLabel}>Showcase demos</Text>
                  <Text style={styles.sidebarGroupDesc}>Physics and motion highlights — not part of rehab.</Text>
                  {renderCollapse('poses')}
                  {renderCollapse('dynamics')}
                  {renderCollapse('sequences')}
                </View>

                <View style={styles.sidebarGroup}>
                  <Text style={styles.sidebarGroupLabel}>View</Text>
                  <Text style={styles.sidebarGroupDesc}>Camera only — does not move the arm.</Text>
                  {renderCollapse('scene')}
                </View>
            </View>
          </ScrollView>
        </View>

        {/* ====== CANVAS ====== */}
        <View style={styles.canvasWrap}>
          {Platform.OS === 'web' ? (
            <div style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
              <GLView style={styles.canvas} onContextCreate={onGLContextCreate} />
            </div>
          ) : (
            <GLView style={styles.canvas} onContextCreate={onGLContextCreate} />
          )}
          {!ready && (
            <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', zIndex: 5, backgroundColor: '#07090a' }]}>
              <ActivityIndicator color={$accent} />
              <Text style={{ color: $textDim, marginTop: 8 }}>Loading Three.js scene…</Text>
            </View>
          )}

          {/* Legend (bottom-left) */}
          <View pointerEvents="none" style={styles.legend}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={[styles.sw, { backgroundColor: '#b0b8b4' }]} />
              <Text style={{ color: '#b8b8c0', fontSize: 11 }}> links</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
              <View style={[styles.sw, { backgroundColor: $accent }]} />
              <Text style={{ color: '#b8b8c0', fontSize: 11 }}> axes X/Y/Z</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
              <View style={[styles.sw, { backgroundColor: $ok }]} />
              <Text style={{ color: '#b8b8c0', fontSize: 11 }}> tip (TCP)</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
              <View style={[styles.sw, { backgroundColor: $warn }]} />
              <Text style={{ color: '#b8b8c0', fontSize: 11 }}> IK solve</Text>
            </View>
          </View>

          {/* Route progress strip (bottom-center) */}
          {s.currentRoute && (
            <View pointerEvents="auto" style={styles.routeProgress}>
              <View style={styles.routeProgressHead}>
                <View>
                  <Text style={styles.routeProgressTitle}>{s.currentRoute.toUpperCase()}</Text>
                  <Text style={styles.routeProgressStep}>
                    {Math.ceil(s.routeProgress * routePills.length)} / {routePills.length} · {(s.routeProgress * 100).toFixed(0)}%
                  </Text>
                </View>
                <View style={styles.routeProgressHeadRight}>
                  <Pressable onPress={() => runRoute('home')} style={styles.routeProgressStop}>
                    <Text style={{ color: '#ff8a8a', fontSize: 17, fontWeight: '700', lineHeight: 22 }}>×</Text>
                  </Pressable>
                </View>
              </View>
              <View style={styles.routeProgressPills}>
                {routePills.map((p, i) => (
                  <View key={i} style={[
                    styles.routePill,
                    p.active ? { borderColor: 'rgba(155,126,237,0.6)', backgroundColor: 'rgba(155,126,237,0.14)' } : null,
                    p.done ? { borderColor: 'rgba(0,212,184,0.35)', backgroundColor: 'rgba(0,212,184,0.08)' } : null,
                  ]}>
                    <Text style={[styles.routePillTitle,
                      p.active ? { color: '#e8dcff' } : null,
                      p.done ? { color: $accent } : null,
                    ]}>{p.title}</Text>
                    <Text style={styles.routePillSub}>{p.sub}</Text>
                    {p.done ? <Text style={styles.routePillCheck}>✓</Text> : null}
                  </View>
                ))}
              </View>
              {routeBannerKind ? (
                <View style={[
                  styles.routeProgressBanner,
                  routeBannerKind === 'arm' ? { backgroundColor: 'rgba(155,126,237,0.12)', borderColor: 'rgba(155,126,237,0.35)' } : null,
                  routeBannerKind === 'patient' ? { backgroundColor: 'rgba(255,204,0,0.12)', borderColor: 'rgba(255,204,0,0.45)' } : null,
                  routeBannerKind === 'celebration' ? { backgroundColor: 'rgba(0,255,102,0.1)', borderColor: 'rgba(0,255,102,0.35)' } : null,
                ]}>
                  <Text style={[styles.bannerText,
                    routeBannerKind === 'arm' ? { color: '#d8c8ff' } : null,
                    routeBannerKind === 'patient' ? { color: '#ffdd66' } : null,
                    routeBannerKind === 'celebration' ? { color: '#9dffb8' } : null,
                  ]}>{bannerText}</Text>
                  <Text style={[styles.bannerSub,
                    routeBannerKind === 'patient' ? { color: '#ffe08a', fontSize: 14 } : null,
                  ]}>{bannerSub}</Text>
                </View>
              ) : null}
            </View>
          )}
        </View>
      </View>

    </View>
  );
}

function StatusRow({ label, value, sub, ok }: { label: string; value: string; sub?: string; ok?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Text style={styles.lbl}>{label}: </Text>
      <Text style={[styles.v, { color: ok === false ? $warn : $accent, fontWeight: '600' }]}>{value}</Text>
      {sub && <Text style={[styles.v, { color: ok === false ? $warn : $accent, marginLeft: 6 }]}>{sub}</Text>}
    </View>
  );
}

function SliderNumberInput({ value, min, max, step, onChange, width = 56 }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; width?: number }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(String(value));
  useEffect(() => { if (!editing) setText(String(value)); }, [value, editing]);
  return (
    <TextInput
      value={editing ? text : String(value)}
      keyboardType="numeric"
      style={[styles.numIn, { width }]}
      onFocus={() => { setEditing(true); setText(String(value)); }}
      onBlur={() => {
        const n = Number(text);
        if (!Number.isNaN(n)) onChange(Math.max(min, Math.min(max, Math.round(n / step) * step)));
        setEditing(false);
      }}
      onChangeText={setText}
    />
  );
}

const styles = StyleSheet.create({
  root: { width: '100%', height: '100%', backgroundColor: $bg, overflow: 'hidden' },
  layout: { flex: 1, flexDirection: 'row', width: '100%', height: '100%' },

  sidebar: { width: 380, backgroundColor: $panel, borderRightWidth: 1, borderRightColor: $line },
  canvasWrap: { flex: 1, position: 'relative', backgroundColor: '#07090a' },
  canvas: { flex: 1 },

  appTopbar: {
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10,
    backgroundColor: $panelElev, borderBottomWidth: 1, borderBottomColor: $line,
  },
  brandLogo: {
    width: 36, height: 36,
  },
  brandName: { fontSize: 15, fontWeight: '700', color: $text, letterSpacing: 1.4 },
  brandTag: { fontSize: 11, color: $textDim, marginTop: 2, letterSpacing: 0.3 },

  dashboardHeader: {
    backgroundColor: 'rgba(0,0,0,0.2)', borderWidth: 1, borderColor: $line, borderRadius: 8,
    padding: 12, marginBottom: 14, marginTop: 4,
  },
  dashboardSubtitle: { fontSize: 12, color: $textDim, lineHeight: 20, marginBottom: 12 },
  dashboardSectionLabel: {
    fontSize: 10, color: $mut, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, fontWeight: '600',
  },
  statusGrid: { flexDirection: 'column', gap: 5, marginBottom: 10 },
  statusChip: {
    flexDirection: 'row', gap: 8, alignItems: 'center', paddingVertical: 7, paddingHorizontal: 9,
    backgroundColor: 'rgba(0,0,0,0.35)', borderWidth: 1, borderColor: '#1a1a1a', borderRadius: 6,
  },
  sanityDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#444', alignSelf: 'center', marginStart: 0 },
  sanityOk: { backgroundColor: $ok },
  sanityWarn: { backgroundColor: $warn },
  sanityErr: { backgroundColor: $err },
  sanityLbl: { color: $mut, textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 10, fontWeight: '600', width: 62 },
  sanityVal: { color: '#d4d4d8', fontSize: 11, flex: 1 },

  safetySection: { paddingTop: 10, borderTopWidth: 1, borderTopColor: '#1a1a1a' },
  safetyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  safetyBadge: {
    flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 6, paddingHorizontal: 8, borderRadius: 6,
    borderWidth: 1,
  },
  safetyBadgeDry: { backgroundColor: 'rgba(38,74,38,0.85)', borderColor: '#2d5a2d' },
  safetyBadgeLive: { backgroundColor: 'rgba(90,27,27,0.9)', borderColor: '#7a2a2a' },
  safetyHint: { fontSize: 11, color: '#6a6a72', marginTop: 8, lineHeight: 18 },

  controlsDivider: { height: 1, backgroundColor: $line, marginVertical: 4, marginHorizontal: -16 },

  homeQuickBar: { marginBottom: 12, marginTop: 4 },
  homeQuickBtn: {
    width: '100%', paddingVertical: 11, paddingHorizontal: 14, borderRadius: 6,
    backgroundColor: 'rgba(126,200,227,0.12)', borderWidth: 1, borderColor: 'rgba(126,200,227,0.45)', alignItems: 'center',
  },
  homeQuickLabel: { fontSize: 13, fontWeight: '600', color: '#7ec8e3' },

  sidebarGroup: { marginBottom: 4 },
  sidebarGroupFirst: { marginBottom: 4 },
  sidebarGroupLabel: {
    fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1,
    color: $accent, marginTop: 18, paddingTop: 14, borderTopWidth: 1, borderTopColor: $line, marginBottom: 4,
  },
  sidebarGroupDesc: { fontSize: 11, color: $mut, marginBottom: 8, lineHeight: 16 },

  h2: {
    fontSize: 13, fontWeight: '700', color: $mut,
    textTransform: 'uppercase', letterSpacing: 0.07 * 16,
    position: 'relative',
  },
  secKicker: {
    fontSize: 11, fontWeight: '400', textTransform: 'none', letterSpacing: 0.01 * 16,
    color: '#5c5c66', marginTop: 2,
  },

  collapseContent: { display: 'flex' },

  sectionLead: { fontSize: 12, color: '#9a9aa6', marginBottom: 12, lineHeight: 18 },

  clawPanel: {
    padding: 12, borderWidth: 1, borderColor: '#2a3540', borderRadius: 6,
    backgroundColor: '#101418', marginBottom: 4,
  },
  clawChannelLabel: { fontSize: 11, color: '#00bbff', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1, fontWeight: '600' },
  clawHelp: { fontSize: 11, color: '#7a7a88', marginTop: 6, lineHeight: 16 },

  row: { flexDirection: 'row', gap: 6, alignItems: 'center', marginBottom: 5 },
  rowLabel: { width: 90, fontSize: 12, color: '#c0c0c8' },
  rowIk: { flexDirection: 'row', gap: 6, alignItems: 'center' },

  v: {
    fontFamily: Platform.select({ web: 'Consolas, monospace', default: 'monospace' }),
    fontSize: 11, textAlign: 'right', color: '#9a9aa6',
  },
  lbl: { color: $mut, fontSize: 12 },

  numIn: {
    backgroundColor: '#161616', borderWidth: 1, borderColor: $line, color: $accent,
    paddingVertical: 3, paddingHorizontal: 5, fontSize: 11, borderRadius: 2,
  },

  btnDefault: {
    backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: $line, borderRadius: 4,
    paddingVertical: 7, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center',
  },
  btnLabel: { color: $accent, fontSize: 12, fontWeight: '600' },
  btnPrimary: {
    backgroundColor: $accent, borderColor: $accent, borderWidth: 1, borderRadius: 4,
    paddingVertical: 7, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center',
  },
  btnPrimaryLabel: { color: '#001a14', fontSize: 12, fontWeight: '700' },

  demoCard: {
    marginBottom: 12, padding: 12, paddingBottom: 10,
    borderWidth: 1, borderColor: '#2a2a32', borderRadius: 6, borderLeftWidth: 4,
    backgroundColor: 'rgba(255,255,255,0.025)',
  },
  demoTitle: { fontSize: 13, marginBottom: 6, fontWeight: '700' },
  demoBody: { fontSize: 12, color: '#b0b0ba', marginBottom: 10, lineHeight: 18 },
  demoBodyStrong: { color: '#dddde4', fontWeight: '600' },
  demoMeta: {
    fontFamily: Platform.select({ web: 'Consolas, monospace', default: 'monospace' }),
    fontSize: 11, color: '#8a8a98', marginBottom: 10, lineHeight: 16,
    paddingVertical: 5, paddingHorizontal: 8,
    backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 4, borderWidth: 1, borderColor: '#222228',
  },
  stopSeqBar: { marginTop: 6, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#333' },
  btnStopSeq: {
    backgroundColor: '#3a1a1a', borderWidth: 1, borderColor: '#c44',
    width: '100%', paddingVertical: 8, paddingHorizontal: 12, alignItems: 'center', borderRadius: 4,
  },

  manualPanel: { padding: 8, borderWidth: 1, borderColor: '#333', borderRadius: 6, backgroundColor: '#141418', marginBottom: 4 },
  manualBadge: {
    display: 'flex', textAlign: 'center', fontSize: 11, fontWeight: '700',
    paddingVertical: 5, paddingHorizontal: 8, borderRadius: 4, marginTop: 8,
    overflow: 'hidden',
  },
  manualBadgeLive: { backgroundColor: '#1a2a3a', color: '#8ab4d4', borderWidth: 1, borderColor: '#2a4055', textAlign: 'center' },
  manualBadgePreview: { backgroundColor: '#2a2818', color: '#e0c060', borderWidth: 1, borderColor: '#4a4020', textAlign: 'center' },

  routeStatusBar: {
    fontSize: 11, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 5, marginBottom: 10,
    backgroundColor: '#141418', borderWidth: 1, borderColor: $line,
  },
  routeStatusBarActive: {
    color: $accent, borderColor: 'rgba(0,212,184,0.35)', backgroundColor: 'rgba(0,212,184,0.06)',
  },
  routeCard: {
    marginBottom: 10, padding: 10, paddingHorizontal: 12,
    borderWidth: 1, borderColor: '#2a2a32', borderRadius: 6, borderLeftWidth: 4, borderLeftColor: '#9b7eed',
    backgroundColor: 'rgba(155,126,237,0.06)',
  },
  routeCardTitle: { fontSize: 13, fontWeight: '700', marginBottom: 4 },
  routeCardMeta: { fontSize: 11, color: $mut, marginBottom: 6, lineHeight: 16 },
  routeExecuteBtn: {
    width: '100%', marginTop: 2, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 6,
    borderWidth: 1, borderColor: 'rgba(0,212,184,0.35)', backgroundColor: $accentDim,
  },
  routeExecuteLabel: { color: $accent, fontSize: 12, fontWeight: '700', textAlign: 'center' },

  scopeLabel: { fontSize: 11, color: $mut, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1, fontWeight: '600' },
  scopeLegend: {
    fontSize: 10, color: $mut, marginTop: 4, flexDirection: 'row', justifyContent: 'space-between', gap: 4,
  },

  statusBox: {
    backgroundColor: '#0a0a0a', borderWidth: 1, borderColor: $line, padding: 10, borderRadius: 4,
    fontSize: 12, lineHeight: 22, gap: 4,
  },

  dirBadge: { fontSize: 9, paddingHorizontal: 3, paddingVertical: 0, borderRadius: 1, marginLeft: 3 },

  legend: {
    position: 'absolute', bottom: 10, left: 10,
    backgroundColor: 'rgba(10,10,10,0.85)', borderWidth: 1, borderColor: $line,
    padding: 8, paddingHorizontal: 10, borderRadius: 4, minWidth: 160, zIndex: 10,
  },
  sw: { width: 9, height: 9, borderRadius: 1, marginRight: 6 },
  legendHint: { marginTop: 5, color: $mut, fontSize: 10, lineHeight: 14 },

  viewHud: {
    position: 'absolute', top: 10, right: 10, minWidth: 220, maxWidth: 280,
    backgroundColor: 'rgba(10,10,10,0.88)', borderWidth: 1, borderColor: $line,
    borderLeftWidth: 2,
    padding: 12, paddingHorizontal: 14, borderRadius: 6, zIndex: 11,
  },
  exerciseHudKicker: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  exerciseHudDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#444' },
  exerciseHudLive: {
    fontSize: 16, fontWeight: '700', lineHeight: 20, marginBottom: 4, textAlign: 'center',
  },
  exerciseHudPhase: {
    fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1,
    textAlign: 'center', marginVertical: 2, marginBottom: 6, minHeight: 14, color: $mut,
  },
  exerciseHudReps: { marginVertical: 6, marginBottom: 10, alignItems: 'center' },
  repNumber: {
    fontSize: 52, fontWeight: '800', color: $accent, fontVariant: ['tabular-nums'],
    lineHeight: 52, letterSpacing: -2,
  },

  routeProgress: {
    position: 'absolute', left: 0, right: 0, bottom: 14,
    alignItems: 'center', justifyContent: 'center', zIndex: 16,
  },
  routeProgressInner: {
    minWidth: 300, maxWidth: 540, width: '94%',
    padding: 12, paddingHorizontal: 14, paddingBottom: 10,
    backgroundColor: 'rgba(8,12,11,0.94)', borderWidth: 1, borderColor: '#1f3f36',
    borderRadius: 10,
  },
  routeProgressHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 },
  routeProgressHeadRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  routeProgressStop: {
    width: 26, height: 26, padding: 0, borderRadius: 6,
    borderWidth: 1, borderColor: 'rgba(255,90,90,0.35)', backgroundColor: 'rgba(255,70,70,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  routeProgressTitle: { fontSize: 12, fontWeight: '700', color: '#c4b0f0', letterSpacing: 0.3 },
  routeProgressStep: { fontSize: 11, fontWeight: '600', color: $accent },
  routeProgressPills: { flexDirection: 'row', gap: 8, marginBottom: 10, alignItems: 'stretch' },
  routePill: {
    flex: 1, minWidth: 0, paddingVertical: 8, paddingHorizontal: 6,
    borderRadius: 8, borderWidth: 1, borderColor: '#2a2a32',
    backgroundColor: 'rgba(0,0,0,0.3)', alignItems: 'center', position: 'relative',
  },
  routePillTitle: { fontSize: 12, fontWeight: '700', color: '#b8b8c4' },
  routePillSub: { fontSize: 9, color: $mut, marginTop: 2 },
  routePillCheck: { position: 'absolute', top: 4, right: 6, fontSize: 10, color: $ok, fontWeight: '700' },
  routeProgressBanner: {
    display: 'flex', textAlign: 'center', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8,
    borderWidth: 1, borderColor: 'transparent', alignItems: 'center', marginTop: 4,
  },
  bannerText: { fontSize: 18, fontWeight: '800', letterSpacing: 1, lineHeight: 22, textAlign: 'center' },
  bannerSub: { marginTop: 4, fontSize: 12, fontWeight: '600', color: '#d8d8e0', textAlign: 'center' },
});
