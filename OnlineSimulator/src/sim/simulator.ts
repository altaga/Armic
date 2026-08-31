// ---- Cartesian 6-stage pipeline + simulator state (motion from ArmDriverTesting-Portable/webpage) ----
import {
  JointsDeg, HOME, TRANSPORT, safetyGate, poseDeltaDeg, MPU_SILENCE_TIMEOUT_MS,
} from './safety';
import {
  PoseXYZ, fkForward, solveIKAnalytical, yoshikawaDerate,
} from './kinematics';
import { easeInOutCubic, lerp } from './s_curve';
import { HTLState, defaultHTLState } from './htl';
import {
  buildJointTween, sampleJointTween, buildMotionQueueViaHome, JointTween,
  profileKindForRoute, buildProtocolGotoTween,
} from './motion';
import {
  ActiveDemo, TimelineDoneAction, beginAnimatedRoute, applyTimelineDone, tickActiveDemo,
} from './demos';
import { PathPlayback, samplePathPlayback, PENDULUM_SETUP } from './playback';
import { clampSimJoints } from './simKinematics';

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
  quality: number;
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
  routeProgress: number;
  reps: RepEvent[];
  qualitySmoothed: number;
  htl: HTLState;
  /** @deprecated use jointTween */
  legTimeline: { from: JointsDeg; to: JointsDeg; startedAt: number; durationMs: number } | null;
  jointTween: JointTween | null;
  tweenQueue: JointsDeg[];
  onTimelineDone: TimelineDoneAction | null;
  activeDemo: ActiveDemo | null;
  pathPlayback: PathPlayback | null;
  scriptedHoldUntilMs: number;
  payloadKg: number;
  manualPreview: boolean;
};

const BOOT_MS = Date.now();
const since = () => Date.now() - BOOT_MS;

export function createInitialState(): SimulatorState {
  return {
    joints: { ...HOME },
    prevJoints: { ...HOME },
    targetPoseXYZ: fkForward({ ...HOME }),
    tickHz: 50,
    tickMs: 20,
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
    jointTween: null,
    tweenQueue: [],
    onTimelineDone: null,
    activeDemo: null,
    pathPlayback: null,
    scriptedHoldUntilMs: 0,
    payloadKg: 0,
    manualPreview: false,
  };
}

export type RoutePreset =
  | 'home' | 'park'
  | 'bicep-set' | 'lateral-set' | 'elbowflex-set'
  | 'htl' | 'reach-carry' | 'orbital' | 'cobra'
  | 'pendulum' | 'snake' | 'gimme';

const CARTESIAN_STEP_MM = 2;

function startJointTween(
  s: SimulatorState,
  target: JointsDeg,
  opts?: { durationMs?: number; dps?: number; gotoEasing?: import('./s_curve').GotoEasing },
): SimulatorState {
  const resolved = { ...target, gripper: target.gripper ?? s.joints.gripper };
  const tween = opts?.dps != null
    ? buildProtocolGotoTween(s.joints, resolved, opts.dps, opts.gotoEasing)
    : buildJointTween(s.joints, resolved, {
      profileKind: profileKindForRoute(s.currentRoute),
      payloadKg: s.payloadKg,
      manualPreview: s.manualPreview,
      durationMs: opts?.durationMs,
    });
  tween.startedAtMs = since();
  return {
    ...s,
    jointTween: tween,
    legTimeline: null,
    lastMpuMessageAtMs: since(),
  };
}

/** Internal protocol goto or S-curve leg */
export function tweenToJoints(s: SimulatorState, target: JointsDeg, opts?: { durationMs?: number; dps?: number; gotoEasing?: import('./s_curve').GotoEasing }): SimulatorState {
  return startJointTween(s, { ...target, gripper: target.gripper ?? s.joints.gripper }, opts);
}

export function queueTweens(s: SimulatorState, queue: JointsDeg[]): SimulatorState {
  if (queue.length === 0) return s;
  const [first, ...rest] = queue;
  return { ...startJointTween(s, first), tweenQueue: rest };
}

/** Clear in-flight motion and queue home → target (every UI pose / command). */
export function queueMotionViaHome(s: SimulatorState, target: JointsDeg): SimulatorState {
  const gripper = s.joints.gripper;
  const cleared: SimulatorState = {
    ...s,
    jointTween: null,
    tweenQueue: [],
    activeDemo: null,
    pathPlayback: null,
    onTimelineDone: null,
    scriptedHoldUntilMs: 0,
    legTimeline: null,
  };
  return queueTweens(cleared, buildMotionQueueViaHome(cleared.joints, { ...target, gripper }));
}

/** Stop any route/demo, then home → target. */
export function requestMotion(s: SimulatorState, target: JointsDeg): SimulatorState {
  return queueMotionViaHome(stopSequence(s), target);
}

/** @deprecated use requestMotion */
export function tweenToJointsViaHome(s: SimulatorState, target: JointsDeg): SimulatorState {
  return requestMotion(s, target);
}

export function setPayloadKg(s: SimulatorState, kg: number): SimulatorState {
  return { ...s, payloadKg: Math.max(0, kg) };
}

export function setManualPreview(s: SimulatorState, preview: boolean): SimulatorState {
  return { ...s, manualPreview: preview };
}

function finishJointTween(s: SimulatorState, nowMs: number): SimulatorState {
  let next: SimulatorState = { ...s, jointTween: null, routeProgress: 1 };

  if (next.tweenQueue.length > 0) {
    const [head, ...tail] = next.tweenQueue;
    next = startJointTween(next, head);
    next.tweenQueue = tail;
    next.routeProgress = 0;
    return next;
  }

  if (next.scriptedHoldUntilMs > 0 && nowMs < next.scriptedHoldUntilMs) {
    return next;
  }

  if (next.onTimelineDone) {
    const action = next.onTimelineDone;
    next.onTimelineDone = null;
    next = applyTimelineDone(next, action, nowMs, tweenToJoints, queueTweens);
  }

  return next;
}

export function setTargetXYZ(s: SimulatorState, target: PoseXYZ): SimulatorState {
  return runCartesianPipeline({ ...s, targetPoseXYZ: target });
}

export function setJointsDirect(s: SimulatorState, j: JointsDeg, skipDeltaClamp = false): SimulatorState {
  const fk = fkForward(j);
  if (skipDeltaClamp) {
    return {
      ...s,
      prevJoints: { ...s.joints },
      joints: clampSimJoints(j),
      lastSafetyFlag: 'PASS',
    };
  }
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
  return {
    ...s,
    prevJoints: { ...s.joints },
    joints: { ...s.joints, gripper: clampedPct },
  };
}

export function setDryRun(s: SimulatorState, dryRun: boolean): SimulatorState {
  return { ...s, dryRun };
}

export function runCartesianPipeline(s: SimulatorState): SimulatorState {
  const s1: SimulatorState = { ...s, lastCartesianStage: 'S1_START_TARGET' };
  const fkPrev = fkForward(s1.joints);
  if (fkPrev.z < 15) return { ...s1, lastCartesianStage: 'STOP_INVALID' };
  s1.lastCartesianStage = 'S2_FK_SANITY';

  const ik = solveIKAnalytical(s1.targetPoseXYZ, s1.joints);
  if (ik.kind === 'OUT_OF_REACH') return { ...s1, lastCartesianStage: 'STOP_INVALID' };
  s1.lastCartesianStage = 'S3_ANALYTICAL_IK';
  s1.lastIKBranch = ik.kind === 'OK' ? ik.branch : null;
  s1.lastTorqueRatio = ik.kind === 'OK' ? ik.torqueRatio : 0;

  if (ik.kind === 'SELF_VERIFY_FAIL') return { ...s1, lastCartesianStage: 'STOP_INVALID' };
  if (ik.kind !== 'OK') return { ...s1, lastCartesianStage: 'STOP_INVALID' };
  s1.lastCartesianStage = 'S4_IK_SELF_VERIFY';

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
  s1.lastManipDerate = yoshikawaDerate(eased);
  s1.lastCartesianStage = 'S6_MANIP_DERATE';

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
  const mpuSilentFor = nowMs - s.lastMpuMessageAtMs;
  const dtMs = Math.max(1, nowMs - s.lastTickAtMs);
  let next = { ...s };

  if (mpuSilentFor > MPU_SILENCE_TIMEOUT_MS) {
    next.mpuAlive = false;
    next = setJointsDirect(next, { ...HOME });
    next.lastSafetyFlag = 'WATCHDOG_HALT';
    next.jointTween = null;
    next.legTimeline = null;
    next.tweenQueue = [];
    next.activeDemo = null;
    next.pathPlayback = null;
  } else {
    next.mpuAlive = true;
  }

  if (!next.jointTween && next.scriptedHoldUntilMs > nowMs && next.currentRoute === 'pendulum') {
    next = setJointsDirect(next, {
      ...PENDULUM_SETUP,
      gripper: next.joints.gripper,
    }, true);
  }

  if (!next.jointTween && next.scriptedHoldUntilMs > 0 && nowMs >= next.scriptedHoldUntilMs && next.onTimelineDone) {
    const action = next.onTimelineDone;
    next.scriptedHoldUntilMs = 0;
    next.onTimelineDone = null;
    next = applyTimelineDone(next, action, nowMs, tweenToJoints, queueTweens);
  }

  if (next.jointTween) {
    const tween = next.jointTween;
    const elapsed = (nowMs - tween.startedAtMs) / 1000;
    const mixed = sampleJointTween(tween, elapsed, next.joints.gripper);
    next = setJointsDirect(next, mixed);
    next.routeProgress = Math.min(1, elapsed / tween.durationSec);
    if (elapsed >= tween.durationSec) {
      next = finishJointTween(next, nowMs);
    }
  }

  if (next.pathPlayback && !next.jointTween) {
    const pb = next.pathPlayback;
    const joints = samplePathPlayback(pb, nowMs);
    next = setJointsDirect(next, joints, true);
    next.routeProgress = Math.min(1, (nowMs - pb.startedAtMs) / Math.max(1, pb.totalMs));
    if (nowMs - pb.startedAtMs >= pb.totalMs) {
      next.pathPlayback = null;
      next.currentRoute = null;
      next.routeProgress = 1;
    }
  }

  if (next.activeDemo && !next.jointTween && !next.pathPlayback) {
    const demoOut = tickActiveDemo(next, dtMs, nowMs);
    if (demoOut) {
      next = setJointsDirect(next, demoOut.joints, true);
      next.activeDemo = demoOut.next;
      next.routeProgress = demoOut.routeProgress;
      if (demoOut.finishedGimme) {
        next.currentRoute = null;
        next = queueTweens(next, buildMotionQueueViaHome(next.joints, HOME));
      }
    }
  }

  next.lastTickAtMs = nowMs;
  return next;
}

export function startRoute(s: SimulatorState, route: RoutePreset): SimulatorState {
  const nowMs = since();
  const s2: SimulatorState = {
    ...s,
    currentRoute: route,
    routeProgress: 0,
    lastMpuMessageAtMs: nowMs,
    activeDemo: null,
    pathPlayback: null,
    onTimelineDone: null,
    scriptedHoldUntilMs: 0,
    jointTween: null,
    legTimeline: null,
  };

  switch (route) {
    case 'home':
      return queueMotionViaHome(s2, HOME);
    case 'park':
      return queueMotionViaHome(s2, { ...TRANSPORT, gripper: s2.joints.gripper });
    case 'reach-carry':
      return queueMotionViaHome(s2, { base: 90, shoulder: 60, elbow: 120, wrist: 90, gripper: 10 });
    case 'htl':
    case 'orbital':
    case 'cobra':
    case 'snake':
    case 'pendulum':
    case 'gimme':
    case 'bicep-set':
    case 'lateral-set':
    case 'elbowflex-set':
      return beginAnimatedRoute(s2, route, queueTweens, tweenToJoints, nowMs);
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
    jointTween: null,
    tweenQueue: [],
    onTimelineDone: null,
    activeDemo: null,
    pathPlayback: null,
    scriptedHoldUntilMs: 0,
    htl: { ...s.htl, phase: 'IDLE', phaseProgress: 0, phaseDurationMs: 0, startedAtMs: 0 },
  };
}

export function stopRoute(s: SimulatorState): SimulatorState {
  return stopSequence(s);
}
