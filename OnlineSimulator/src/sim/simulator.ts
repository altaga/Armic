// ---- Cartesian 6-stage pipeline + simulator state singleton (shared UI + render) ----
import {
  JointsDeg, HOME, PARK, safetyGate, poseDeltaDeg, MPU_SILENCE_TIMEOUT_MS,
} from './safety';
import {
  PoseXYZ, fkForward, solveIKAnalytical, yoshikawaDerate,
} from './kinematics';
import { easeInOutCubic, lerp, sCurveNormalizeJerk, estimatedSCurveDurationMs } from './s_curve';
import { HTLState, defaultHTLState, nextPhase, PHASE_MS, HTLPhase } from './htl';

export type CartesianStage =
  | 'S1_START_TARGET'
  | 'S2_FK_SANITY'
  | 'S3_ANALYTICAL_IK'
  | 'S4_IK_SELF_VERIFY'
  | 'S5_STEP_EASE'
  | 'S6_MANIP_DERATE'
  | 'STOP_INVALID'
  | 'RESYNC_UI';

export type RepEvent = {
  id: number;
  kind: 'bicep' | 'lateral' | 'elbowflex';
  quality: number; // 0..1
  romDeg: number;
  atMs: number;
};

export type SimulatorState = {
  joints: JointsDeg;
  prevJoints: JointsDeg;
  targetPoseXYZ: PoseXYZ;
  tickHz: number;
  tickMs: number;
  lastTickAtMs: number;
  lastMpuMessageAtMs: number;
  dryRun: boolean;
  mpuAlive: boolean;
  lastCartesianStage: CartesianStage;
  lastIKBranch: 'A' | 'B' | null;
  lastTorqueRatio: number;
  lastManipDerate: number;
  lastSafetyFlag: string;
  currentRoute: string | null;
  routeProgress: number; // 0..1
  reps: RepEvent[];
  qualitySmoothed: number;
  htl: HTLState;
  legTimeline: { from: JointsDeg; to: JointsDeg; startedAt: number; durationMs: number } | null;
};

const BOOT_MS = Date.now();
const since = () => Date.now() - BOOT_MS;

export function createInitialState(): SimulatorState {
  return {
    joints: { ...HOME },
    prevJoints: { ...HOME },
    targetPoseXYZ: fkForward({ ...HOME }),
    tickHz: 50,       // Expo JS can hit 50Hz comfortably; real MCU does 100 Hz
    tickMs: 20,       // 50 Hz → 20 ms
    lastTickAtMs: since(),
    lastMpuMessageAtMs: since(),
    dryRun: true,
    mpuAlive: true,
    lastCartesianStage: 'S1_START_TARGET',
    lastIKBranch: null,
    lastTorqueRatio: 0.5,
    lastManipDerate: 1.0,
    lastSafetyFlag: 'PASS',
    currentRoute: null,
    routeProgress: 0,
    reps: [],
    qualitySmoothed: 0,
    htl: defaultHTLState(),
    legTimeline: null,
  };
}

export type RoutePreset =
  | 'home' | 'park'
  | 'bicep-set' | 'lateral-set' | 'elbowflex-set'
  | 'htl' | 'reach-carry' | 'orbital' | 'cobra'
  | 'pendulum' | 'snake' | 'gimme';

const CARTESIAN_STEP_MM = 2; // matches armic-firmware Cartesian step size

export function setTargetXYZ(s: SimulatorState, target: PoseXYZ): SimulatorState {
  const next = { ...s, targetPoseXYZ: target };
  return runCartesianPipeline(next);
}

export function setJointsDirect(s: SimulatorState, j: JointsDeg): SimulatorState {
  const fk = fkForward(j);
  const safety = safetyGate(j, s.prevJoints, fk.z);
  return {
    ...s,
    prevJoints: { ...s.joints },
    joints: safety.clamped,
    lastSafetyFlag: safety.flag,
  };
}

export function setClawPct(s: SimulatorState, pct: number): SimulatorState {
  const clampedPct = Math.max(0, Math.min(100, pct));
  const joints: JointsDeg = { ...s.joints, gripper: clampedPct };
  return {
    ...s,
    prevJoints: { ...s.joints },
    joints,
  };
}

export function setDryRun(s: SimulatorState, dryRun: boolean): SimulatorState {
  return { ...s, dryRun };
}

export function runCartesianPipeline(s: SimulatorState): SimulatorState {
  // Stage S1 already done via targetPoseXYZ.
  const s1: SimulatorState = { ...s, lastCartesianStage: 'S1_START_TARGET' };

  // S2 FK sanity of PREVIOUS pose — must be over floor
  const fkPrev = fkForward(s1.joints);
  if (fkPrev.z < 15) {
    return { ...s1, lastCartesianStage: 'STOP_INVALID' };
  }
  s1.lastCartesianStage = 'S2_FK_SANITY';

  // S3 Analytical IK with dual branch + torque/nn-pick
  const ik = solveIKAnalytical(s1.targetPoseXYZ, s1.joints);
  if (ik.kind === 'OUT_OF_REACH') return { ...s1, lastCartesianStage: 'STOP_INVALID' };
  s1.lastCartesianStage = 'S3_ANALYTICAL_IK';
  s1.lastIKBranch = ik.kind === 'OK' ? ik.branch : null;
  s1.lastTorqueRatio = ik.kind === 'OK' ? ik.torqueRatio : 0;

  // S4 IK self verify (0.5mm)
  if (ik.kind === 'SELF_VERIFY_FAIL') return { ...s1, lastCartesianStage: 'STOP_INVALID' };
  if (ik.kind !== 'OK') return { ...s1, lastCartesianStage: 'STOP_INVALID' };
  s1.lastCartesianStage = 'S4_IK_SELF_VERIFY';

  // S5 2mm step linearize + cubic ease
  const deltaR = Math.hypot(
    ik.joints.base - s1.joints.base,
    ik.joints.shoulder - s1.joints.shoulder,
    ik.joints.elbow - s1.joints.elbow,
  );
  const degSteps = Math.max(1, Math.round(deltaR / CARTESIAN_STEP_MM));
  const tEase = easeInOutCubic(1 / degSteps);
  const eased: JointsDeg = {
    base: lerp(s1.joints.base, ik.joints.base, tEase),
    shoulder: lerp(s1.joints.shoulder, ik.joints.shoulder, tEase),
    elbow: lerp(s1.joints.elbow, ik.joints.elbow, tEase),
    wrist: lerp(s1.joints.wrist, ik.joints.wrist, tEase),
    gripper: s1.joints.gripper,
  };
  s1.lastCartesianStage = 'S5_STEP_EASE';

  // S6 manipulability derate (velocity throttle for display / timeline stretch)
  const derate = yoshikawaDerate(eased);
  s1.lastManipDerate = derate;
  s1.lastCartesianStage = 'S6_MANIP_DERATE';

  // Finally: safety gate → apply tick
  const fkNew = fkForward(eased);
  const safety = safetyGate(eased, s1.prevJoints, fkNew.z);
  return {
    ...s1,
    prevJoints: { ...s1.joints },
    joints: safety.clamped,
    lastSafetyFlag: safety.flag,
    routeProgress: Math.min(1, s1.routeProgress + 0.01),
  };
}

export function tick(s: SimulatorState, nowMs = since()): SimulatorState {
  // Watchdog: MPU silence → 1.5 s, return home safe
  const mpuSilentFor = nowMs - s.lastMpuMessageAtMs;
  let next = { ...s };
  if (mpuSilentFor > MPU_SILENCE_TIMEOUT_MS) {
    next.mpuAlive = false;
    next = setJointsDirect(next, { ...HOME });
    next.lastSafetyFlag = 'WATCHDOG_HALT';
    next.legTimeline = null;
    next.htl.phase = 'IDLE';
  } else {
    next.mpuAlive = true;
  }

  // Active rehab leg timeline playback (trajectory between two poses)
  if (next.legTimeline) {
    const { from, to, startedAt, durationMs } = next.legTimeline;
    let tNorm = (nowMs - startedAt) / durationMs;
    tNorm = Math.max(0, Math.min(1, tNorm));
    const jerkP = sCurveNormalizeJerk(1, 18, 100, 400, tNorm);
    const mixed: JointsDeg = {
      base: lerp(from.base, to.base, jerkP),
      shoulder: lerp(from.shoulder, to.shoulder, jerkP),
      elbow: lerp(from.elbow, to.elbow, jerkP),
      wrist: lerp(from.wrist, to.wrist, jerkP),
      gripper: lerp(from.gripper, to.gripper, jerkP),
    };
    next = setJointsDirect(next, mixed);
    next.routeProgress = jerkP;
    if (tNorm >= 1) next.legTimeline = null;
  }

  // HTL FSM tick
  next.htl = tickHTL(next.htl, nowMs, next);
  // When HTL carries, move target joints to tucked home 95 for carry → apply
  if (next.htl.phase === 'CARRY' || next.htl.phase === 'HOME_95') {
    const tucked: JointsDeg = {
      base: s.htl.homePose.base,
      shoulder: 110,
      elbow: 95,
      wrist: s.htl.homePose.wrist,
      gripper: s.htl.gripperClosed ? 10 : 60,
    };
    const t = easeInOutCubic(Math.min(1, (nowMs - next.htl.startedAtMs) / next.htl.phaseDurationMs || 1));
    const mixed = {
      base: lerp(next.joints.base, tucked.base, t),
      shoulder: lerp(next.joints.shoulder, tucked.shoulder, t),
      elbow: lerp(next.joints.elbow, tucked.elbow, t),
      wrist: lerp(next.joints.wrist, tucked.wrist, t),
      gripper: lerp(next.joints.gripper, tucked.gripper, t),
    };
    next = setJointsDirect(next, mixed);
  }

  next.lastTickAtMs = nowMs;
  return next;
}

function tickHTL(h: HTLState, nowMs: number, _s: SimulatorState): HTLState {
  if (h.phase === 'IDLE' || h.phase === 'E_STOP') return h;
  const elapsed = nowMs - h.startedAtMs;
  h.phaseProgress = Math.max(0, Math.min(1, elapsed / Math.max(1, h.phaseDurationMs)));
  if (elapsed > h.phaseDurationMs) {
    const nextP: HTLPhase = nextPhase(h.phase as any);
    if (nextP === 'FOLD_IN') h.gripperClosed = true;
    if (nextP === 'RELEASE') h.gripperClosed = false;
    if (nextP === 'IDLE') {
      return { ...h, phase: 'IDLE', startedAtMs: 0, phaseDurationMs: 0, phaseProgress: 0 };
    }
    return { ...h, phase: nextP, startedAtMs: nowMs, phaseDurationMs: PHASE_MS[nextP as keyof typeof PHASE_MS] || 1200, phaseProgress: 0 };
  }
  return h;
}

export function startRoute(s: SimulatorState, route: RoutePreset): SimulatorState {
  const nowMs = since();
  const s2: SimulatorState = {
    ...s, currentRoute: route, routeProgress: 0, lastMpuMessageAtMs: nowMs, reps: s.reps,
  };

  switch (route) {
    case 'home':
      return {
        ...s2,
        legTimeline: {
          from: s2.joints, to: { ...HOME },
          startedAt: nowMs, durationMs: estimatedSCurveDurationMs(poseDeltaDeg(s2.joints, HOME), 45, 120),
        },
      };
    case 'park':
      return {
        ...s2,
        legTimeline: {
          from: s2.joints, to: PARK,
          startedAt: nowMs, durationMs: estimatedSCurveDurationMs(poseDeltaDeg(s2.joints, PARK), 45, 120),
        },
      };
    case 'htl':
      return {
        ...s2,
        htl: {
          ...s2.htl,
          phase: 'REACH',
          startedAtMs: nowMs,
          phaseDurationMs: PHASE_MS.REACH,
          targetPuckXYZ: { x: 120, y: 0, z: 25, tool: 90 },
          gripperClosed: false,
        },
      };
    case 'reach-carry':
      return {
        ...s2,
        legTimeline: {
          from: s2.joints,
          to: { base: 90, shoulder: 60, elbow: 120, wrist: 90, gripper: 10 },
          startedAt: nowMs,
          durationMs: 4000,
        },
      };
    case 'orbital':
    case 'cobra':
    case 'snake':
    case 'pendulum':
    case 'gimme':
    case 'bicep-set':
    case 'lateral-set':
    case 'elbowflex-set': {
      const toMap: Record<string, JointsDeg> = {
        'orbital': { base: 90, shoulder: 45, elbow: 150, wrist: 90, gripper: 60 },
        'cobra':   { base: 90, shoulder: 30, elbow: 170, wrist: 90, gripper: 60 },
        'snake':   { base: 90, shoulder: 85, elbow: 130, wrist: 120, gripper: 50 },
        'pendulum':{ base: 90, shoulder: 150, elbow: 170, wrist: 90, gripper: 30 },
        'gimme':   { base: 90, shoulder: 60, elbow: 140, wrist: 45, gripper: 0 },
        'bicep-set':   { base: 90, shoulder: 80, elbow: 120, wrist: 90, gripper: 40 },
        'lateral-set': { base: 120, shoulder: 95, elbow: 110, wrist: 90, gripper: 40 },
        'elbowflex-set': { base: 90, shoulder: 115, elbow: 140, wrist: 90, gripper: 40 },
      };
      return {
        ...s2,
        legTimeline: {
          from: s2.joints, to: toMap[route],
          startedAt: nowMs, durationMs: route === 'orbital' ? 9000 : 5200,
        },
      };
    }
    default:
      return s2;
  }
}

export function feedMpuHeartbeat(s: SimulatorState): SimulatorState {
  return { ...s, lastMpuMessageAtMs: since() };
}

export function addSimulatedRep(s: SimulatorState, kind: RepEvent['kind'], quality: number, romDeg: number): SimulatorState {
  const event: RepEvent = { id: s.reps.length + 1, kind, quality, romDeg, atMs: since() };
  const smoothed = 0.7 * s.qualitySmoothed + 0.3 * quality;
  return { ...s, reps: [...s.reps, event], qualitySmoothed: smoothed };
}

export function stopSequence(s: SimulatorState): SimulatorState {
  return {
    ...s,
    currentRoute: null,
    routeProgress: 0,
    legTimeline: null,
    htl: { ...s.htl, phase: 'IDLE', phaseProgress: 0, phaseDurationMs: 0, startedAtMs: 0 },
  };
}

export function stopRoute(s: SimulatorState): SimulatorState {
  return stopSequence(s);
}
