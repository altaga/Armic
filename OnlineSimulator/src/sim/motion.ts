// Motion planner — home-first, then target (ProtocolRunner::updateSafeHome).
//
// Every user action: direct joint-space S-curve to HOME {90,90,95,90}, then S-curve to target.
// Matches firmware — one efficient leg per phase, no 3-phase tuck/lift detour.
import { JointsDeg, HOME, poseDeltaDeg } from './safety';
import { SCurveProfile, SCurveConfig, lerp, GotoEasing, sampleGotoEasing } from './s_curve';
import { strainScaleForTarget } from './torque';

export type JointKey = 'base' | 'shoulder' | 'elbow' | 'wrist';
export type MotionProfileKind = 'default' | 'exercise' | 'htl';

export type JointTween = {
  mode: 'per-joint' | 'sync' | 'goto';
  start: JointsDeg;
  target: JointsDeg;
  profiles?: Partial<Record<JointKey, SCurveProfile>>;
  syncProfile?: SCurveProfile;
  syncDeltas?: Record<JointKey, number>;
  syncMaxDelta?: number;
  syncTimeScale?: number;
  durationSec: number;
  startedAtMs: number;
  /** ProtocolRunner GOTO_ANGLES easing (default easeInOut) */
  gotoEasing?: GotoEasing;
};

export const EX_S_CURVE: SCurveConfig = { vMax: 52 * 1.15, aMax: 380, jMax: 2800 };
export const HTL_DPS = 40;
export const LEG_MIN_MS = 180;
export const LEG_MAX_MS = 1800;

export function shortestArcDelta(fromDeg: number, toDeg: number): number {
  return ((toDeg - fromDeg) % 360 + 540) % 360 - 180;
}

export function isAtHome(j: JointsDeg, tolerance = 2): boolean {
  return poseDeltaDeg(j, { ...HOME, gripper: j.gripper }) <= tolerance;
}

/** Direct home leg only — firmware joint-space stepToward, no Cartesian tuck detour */
export function safeHomeWaypoints(current: JointsDeg): JointsDeg[] {
  if (isAtHome(current)) return [];
  return [{ ...HOME, gripper: current.gripper }];
}

export function safeReturnToHomeQueue(current: JointsDeg): JointsDeg[] {
  return safeHomeWaypoints(current);
}

/** Home first (if needed), then final target — used by every button / route start */
export function buildMotionQueueViaHome(current: JointsDeg, finalTarget: JointsDeg): JointsDeg[] {
  const gripper = current.gripper;
  const home = { ...HOME, gripper };
  const target = { ...finalTarget, gripper };
  const waypoints: JointsDeg[] = [];
  if (!isAtHome(current)) waypoints.push(home);
  const from = waypoints.length > 0 ? home : current;
  if (poseDeltaDeg(from, target) > 0.5) waypoints.push(target);
  return waypoints;
}

/** @deprecated use buildMotionQueueViaHome */
export const buildTweenQueueViaHome = buildMotionQueueViaHome;

/** ProtocolRunner::beginGoto — max joint delta / dps (matches firmware leg timing) */
export function gotoLegDurationMs(
  from: Pick<JointsDeg, 'base' | 'shoulder' | 'elbow' | 'wrist'>,
  to: Pick<JointsDeg, 'base' | 'shoulder' | 'elbow' | 'wrist'>,
  dps: number,
): number {
  const maxDelta = Math.max(
    Math.abs(to.base - from.base),
    Math.abs(to.shoulder - from.shoulder),
    Math.abs(to.elbow - from.elbow),
    Math.abs(to.wrist - from.wrist),
  );
  const rate = Math.max(8, dps);
  return Math.max(50, Math.round((maxDelta / rate) * 1000));
}

/** easeInOutCubic joint lerp @ fixed deg/s — ProtocolRunner GOTO_ANGLES */
export function buildProtocolGotoTween(
  start: JointsDeg,
  target: JointsDeg,
  dps: number,
  gotoEasing: GotoEasing = 'easeInOut',
): JointTween {
  return {
    mode: 'goto',
    start: { ...start },
    target: { ...target },
    durationSec: gotoLegDurationMs(start, target, dps) / 1000,
    startedAtMs: 0,
    gotoEasing,
  };
}

/** ProtocolRunner::stepToward — rate-limited joint step (orbital + realtime) */
export function stepTowardJoints(
  current: JointsDeg,
  target: Pick<JointsDeg, 'base' | 'shoulder' | 'elbow' | 'wrist'>,
  dtMs: number,
  maxDegPerSec: number,
): { joints: JointsDeg; arrived: boolean } {
  const maxStep = maxDegPerSec * (dtMs / 1000);
  const next: JointsDeg = { ...current };
  for (const k of ['base', 'shoulder', 'elbow', 'wrist'] as JointKey[]) {
    const diff = target[k] - current[k];
    if (Math.abs(diff) <= maxStep) next[k] = target[k];
    else next[k] = current[k] + Math.sign(diff) * maxStep;
  }
  const arrived = poseDeltaDeg(next, { ...target, gripper: current.gripper }) <= 2;
  if (arrived) {
    return {
      joints: { base: target.base, shoulder: target.shoulder, elbow: target.elbow, wrist: target.wrist, gripper: current.gripper },
      arrived: true,
    };
  }
  return { joints: next, arrived: false };
}

export function defaultSCurveConfig(
  target: Pick<JointsDeg, 'base' | 'shoulder' | 'elbow' | 'wrist'>,
  payloadKg: number,
  manualPreview: boolean,
): SCurveConfig {
  const scale = strainScaleForTarget(target, payloadKg);
  let vMax = 250 * scale;
  let aMax = 1500 * scale;
  let jMax = 10000 * scale;
  if (manualPreview) {
    vMax *= 0.3;
    aMax *= 0.3;
    jMax *= 0.3;
  }
  return { vMax, aMax, jMax };
}

function buildPerJointTween(start: JointsDeg, target: JointsDeg, config: SCurveConfig): JointTween {
  const profiles: Partial<Record<JointKey, SCurveProfile>> = {};
  let longestTime = 0;
  for (const j of ['base', 'shoulder', 'elbow', 'wrist'] as JointKey[]) {
    const delta = shortestArcDelta(start[j], target[j]);
    if (Math.abs(delta) < 1e-6) continue;
    const p = new SCurveProfile(delta, config);
    profiles[j] = p;
    if (p.totalTime > longestTime) longestTime = p.totalTime;
  }
  return {
    mode: 'per-joint',
    start: { ...start },
    target: { ...target },
    profiles,
    durationSec: Math.max(0.05, longestTime),
    startedAtMs: 0,
  };
}

function buildSyncExerciseTween(start: JointsDeg, target: JointsDeg): JointTween {
  const deltas: Record<JointKey, number> = {
    base: target.base - start.base,
    shoulder: target.shoulder - start.shoulder,
    elbow: target.elbow - start.elbow,
    wrist: target.wrist - start.wrist,
  };
  const maxDelta = Math.max(
    Math.abs(deltas.base),
    Math.abs(deltas.shoulder),
    Math.abs(deltas.elbow),
    Math.abs(deltas.wrist),
  );
  const profile = new SCurveProfile(maxDelta, EX_S_CURVE);
  const naturalSec = profile.totalTime;
  const durSec = Math.min(LEG_MAX_MS / 1000, Math.max(LEG_MIN_MS / 1000, naturalSec));
  const timeScale = naturalSec > 1e-9 ? naturalSec / durSec : 1;
  return {
    mode: 'sync',
    start: { ...start },
    target: { ...target },
    syncProfile: profile,
    syncDeltas: deltas,
    syncMaxDelta: maxDelta,
    syncTimeScale: timeScale,
    durationSec: durSec,
    startedAtMs: 0,
  };
}

export function buildJointTween(
  start: JointsDeg,
  target: JointsDeg,
  opts: {
    profileKind?: MotionProfileKind;
    payloadKg?: number;
    manualPreview?: boolean;
    durationMs?: number;
  } = {},
): JointTween {
  const profileKind = opts.profileKind ?? 'default';
  let tween: JointTween;
  if (profileKind === 'exercise') {
    tween = buildSyncExerciseTween(start, target);
  } else {
    const cfg = defaultSCurveConfig(target, opts.payloadKg ?? 0, opts.manualPreview ?? false);
    tween = buildPerJointTween(start, target, cfg);
  }
  if (opts.durationMs != null && opts.durationMs > 0) {
    tween.durationSec = opts.durationMs / 1000;
    if (tween.mode === 'sync' && tween.syncProfile && tween.syncMaxDelta) {
      tween.syncTimeScale = tween.syncProfile.totalTime / tween.durationSec;
    }
  }
  return tween;
}

export function sampleJointTween(tween: JointTween, elapsedSec: number, gripper: number): JointsDeg {
  if (tween.mode === 'goto') {
    const u = tween.durationSec > 1e-9 ? Math.min(1, elapsedSec / tween.durationSec) : 1;
    const p = sampleGotoEasing(tween.gotoEasing ?? 'easeInOut', u);
    return {
      base: lerp(tween.start.base, tween.target.base, p),
      shoulder: lerp(tween.start.shoulder, tween.target.shoulder, p),
      elbow: lerp(tween.start.elbow, tween.target.elbow, p),
      wrist: lerp(tween.start.wrist, tween.target.wrist, p),
      gripper,
    };
  }
  if (tween.mode === 'sync' && tween.syncProfile && tween.syncDeltas && tween.syncMaxDelta) {
    const profileT = elapsedSec * (tween.syncTimeScale ?? 1);
    const progress = tween.syncMaxDelta > 1e-6
      ? tween.syncProfile.positionAt(profileT) / tween.syncMaxDelta
      : 1;
    const p = Math.max(0, Math.min(1, progress));
    return {
      base: tween.start.base + tween.syncDeltas.base * p,
      shoulder: tween.start.shoulder + tween.syncDeltas.shoulder * p,
      elbow: tween.start.elbow + tween.syncDeltas.elbow * p,
      wrist: tween.start.wrist + tween.syncDeltas.wrist * p,
      gripper,
    };
  }
  const cur: JointsDeg = { ...tween.start, gripper };
  for (const j of ['base', 'shoulder', 'elbow', 'wrist'] as JointKey[]) {
    const profile = tween.profiles?.[j];
    if (!profile) continue;
    cur[j] = tween.start[j] + profile.positionAt(elapsedSec);
  }
  return cur;
}

export function profileKindForRoute(route: string | null): MotionProfileKind {
  if (!route) return 'default';
  if (route.endsWith('-set')) return 'exercise';
  if (route === 'htl') return 'htl';
  return 'default';
}
