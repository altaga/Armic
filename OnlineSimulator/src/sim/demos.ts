// Demo + route playback — armic-webui/arm-simulator.html
import { JointsDeg, HOME } from './safety';
import { ikSim } from './simKinematics';
import { easeInOutCubic, lerp } from './s_curve';
import { buildMotionQueueViaHome, stepTowardJoints, isAtHome } from './motion';
import {
  COIL, STRIKE, ORBITAL, ORB_DPS, withGripper, ExerciseKind, buildOrbitalPath, buildHtlSegments,
} from './catalog';
import {
  buildExerciseQueue, buildPostExerciseHome, createPathPlayback,
  HOME_DPS, GOTO_DPS, PEND_DOWN_DPS, PEND_HOLD_MS,
  PENDULUM_SETUP, PENDULUM_DUMP, buildPendulumReturnSegments,
} from './playback';
import type { SimulatorState } from './simulator';

export type ActiveDemo =
  | { kind: 'snake'; t: number }
  | { kind: 'orbital'; path: JointsDeg[]; pathIndex: number }
  | { kind: 'cobra'; phase: 1 | 2 | 3 | 4; phaseStartMs: number }
  | { kind: 'gimme'; phase: 1 | 2 | 3 | 4; phaseStartMs: number };

export type TimelineDoneAction =
  | 'snake-run'
  | 'orbital-run'
  | 'orbital-goto-start'
  | 'cobra-run'
  | 'gimme-run'
  | 'htl-run'
  | 'exercise-bicep-set'
  | 'exercise-lateral-set'
  | 'exercise-elbowflex-set'
  | 'exercise-done-home'
  | 'pendulum-extend'
  | 'pendulum-hold'
  | 'pendulum-down'
  | 'pendulum-return';

type TweenFn = (
  s: SimulatorState,
  target: JointsDeg,
  opts?: { durationMs?: number; dps?: number; gotoEasing?: 'easeInOut' | 'easeIn' | 'easeOut' | 'linear' },
) => SimulatorState;
type QueueFn = (s: SimulatorState, queue: JointsDeg[]) => SimulatorState;

function snakeSetup(gripper: number): JointsDeg {
  return {
    base: 90,
    shoulder: 90,
    elbow: 120 + 30 * Math.sin(-1.2),
    wrist: 90 + 60 * Math.sin(-2.4),
    gripper,
  };
}

function orbitalSetup(gripper: number, payloadKg: number, from: JointsDeg): JointsDeg | null {
  const { cx, cz, radius } = ORBITAL;
  const out = ikSim(cx, 0, cz + radius, 0, payloadKg, from);
  if (out.status === 'OK') return withGripper(out.angles, gripper);
  return null;
}

function lerpPose(a: JointsDeg, b: JointsDeg, p: number): JointsDeg {
  return {
    base: a.base,
    shoulder: lerp(a.shoulder, b.shoulder, p),
    elbow: lerp(a.elbow, b.elbow, p),
    wrist: lerp(a.wrist, b.wrist, p),
    gripper: a.gripper,
  };
}

function startViaHome(
  s: SimulatorState,
  cleared: SimulatorState,
  target: JointsDeg,
  route: string,
  done: TimelineDoneAction,
  queueTween: QueueFn,
  tweenTo: TweenFn,
  nowMs: number,
): SimulatorState {
  const q = buildMotionQueueViaHome(s.joints, target);
  const base = { ...cleared, currentRoute: route, routeProgress: 0 };
  if (q.length === 0) {
    return applyTimelineDone(base, done, nowMs, tweenTo, queueTween);
  }
  return { ...queueTween(base, q), onTimelineDone: done };
}

function paint(s: SimulatorState, a: JointsDeg): JointsDeg {
  return { ...a, gripper: s.joints.gripper };
}

function startPendulumRoute(
  s: SimulatorState,
  cleared: SimulatorState,
  tweenTo: TweenFn,
  nowMs: number,
): SimulatorState {
  const gripper = s.joints.gripper;
  const base = { ...cleared, currentRoute: 'pendulum', routeProgress: 0 };
  if (!isAtHome(s.joints)) {
    return {
      ...tweenTo(base, { ...HOME, gripper }, { dps: HOME_DPS }),
      onTimelineDone: 'pendulum-extend',
    };
  }
  return applyTimelineDone(base, 'pendulum-extend', nowMs, tweenTo, () => base);
}

export function beginAnimatedRoute(
  s: SimulatorState,
  route: string,
  queueTween: QueueFn,
  tweenTo: TweenFn,
  nowMs: number,
): SimulatorState {
  const gripper = s.joints.gripper;
  const cleared: SimulatorState = {
    ...s,
    activeDemo: null,
    pathPlayback: null,
    onTimelineDone: null,
    tweenQueue: [],
    scriptedHoldUntilMs: 0,
    jointTween: null,
  };

  switch (route) {
    case 'snake':
      return startViaHome(s, cleared, snakeSetup(gripper), 'snake', 'snake-run', queueTween, tweenTo, nowMs);
    case 'orbital': {
      const setup = orbitalSetup(gripper, s.payloadKg, s.joints);
      const base = { ...cleared, currentRoute: 'orbital', routeProgress: 0 };
      if (!setup) {
        return startViaHome(s, cleared, HOME, 'orbital', 'orbital-run', queueTween, tweenTo, nowMs);
      }
      if (!isAtHome(s.joints)) {
        return {
          ...queueTween(base, [{ ...HOME, gripper }]),
          onTimelineDone: 'orbital-goto-start',
        };
      }
      return {
        ...tweenTo(base, setup, { dps: GOTO_DPS }),
        onTimelineDone: 'orbital-run',
      };
    }
    case 'cobra':
      return startViaHome(s, cleared, withGripper(COIL, gripper), 'cobra', 'cobra-run', queueTween, tweenTo, nowMs);
    case 'gimme':
      return startViaHome(s, cleared, withGripper(COIL, gripper), 'gimme', 'gimme-run', queueTween, tweenTo, nowMs);
    case 'htl':
      return startViaHome(s, cleared, HOME, 'htl', 'htl-run', queueTween, tweenTo, nowMs);
    case 'pendulum':
      return startPendulumRoute(s, cleared, tweenTo, nowMs);
    case 'bicep-set':
      return startViaHome(s, cleared, HOME, route, `exercise-${route}` as TimelineDoneAction, queueTween, tweenTo, nowMs);
    case 'lateral-set':
      return startViaHome(s, cleared, HOME, route, `exercise-${route}` as TimelineDoneAction, queueTween, tweenTo, nowMs);
    case 'elbowflex-set':
      return startViaHome(s, cleared, HOME, route, `exercise-${route}` as TimelineDoneAction, queueTween, tweenTo, nowMs);
    default:
      return cleared;
  }
}

export function applyTimelineDone(
  s: SimulatorState,
  action: TimelineDoneAction,
  nowMs: number,
  tweenTo: TweenFn,
  queueTween: QueueFn,
): SimulatorState {
  const g = s.joints.gripper;
  switch (action) {
    case 'snake-run':
      return { ...s, activeDemo: { kind: 'snake', t: 0 }, onTimelineDone: null };
    case 'orbital-goto-start': {
      const setup = orbitalSetup(g, s.payloadKg, s.joints);
      if (!setup) return { ...s, onTimelineDone: 'orbital-run' };
      return {
        ...tweenTo(s, setup, { dps: GOTO_DPS }),
        onTimelineDone: 'orbital-run',
      };
    }
    case 'orbital-run': {
      const path = buildOrbitalPath(s.joints, s.payloadKg);
      if (!path) return { ...s, currentRoute: null, routeProgress: 0 };
      return {
        ...s,
        activeDemo: { kind: 'orbital', path, pathIndex: 0 },
        onTimelineDone: null,
      };
    }
    case 'cobra-run':
      return { ...s, activeDemo: { kind: 'cobra', phase: 4, phaseStartMs: nowMs }, onTimelineDone: null };
    case 'gimme-run':
      return { ...s, activeDemo: { kind: 'gimme', phase: 4, phaseStartMs: nowMs }, onTimelineDone: null };
    case 'htl-run':
      return {
        ...s,
        pathPlayback: createPathPlayback(buildHtlSegments(s.joints), nowMs),
        onTimelineDone: null,
      };
    case 'exercise-bicep-set':
      return { ...queueTween(s, buildExerciseQueue(g, 'bicep-set')), onTimelineDone: 'exercise-done-home' };
    case 'exercise-lateral-set':
      return { ...queueTween(s, buildExerciseQueue(g, 'lateral-set')), onTimelineDone: 'exercise-done-home' };
    case 'exercise-elbowflex-set':
      return { ...queueTween(s, buildExerciseQueue(g, 'elbowflex-set')), onTimelineDone: null };
    case 'exercise-done-home':
      return queueTween(s, buildPostExerciseHome(s.joints));
    case 'pendulum-extend':
      return {
        ...tweenTo(s, withGripper(PENDULUM_SETUP, g), { dps: GOTO_DPS }),
        onTimelineDone: 'pendulum-hold',
        routeProgress: 0.1,
      };
    case 'pendulum-hold':
      return {
        ...s,
        joints: withGripper(PENDULUM_SETUP, g),
        scriptedHoldUntilMs: nowMs + PEND_HOLD_MS,
        onTimelineDone: 'pendulum-down',
        routeProgress: 0.2,
      };
    case 'pendulum-down':
      return {
        ...tweenTo(s, withGripper(PENDULUM_DUMP, g), { dps: PEND_DOWN_DPS, gotoEasing: 'easeOut' }),
        onTimelineDone: 'pendulum-return',
        routeProgress: 0.35,
      };
    case 'pendulum-return':
      return {
        ...s,
        pathPlayback: createPathPlayback(buildPendulumReturnSegments(s.joints), nowMs),
        onTimelineDone: null,
        routeProgress: 0.5,
      };
    default:
      return s;
  }
}

export function tickActiveDemo(
  s: SimulatorState,
  dtMs: number,
  nowMs: number,
): { joints: JointsDeg; next: ActiveDemo | null; routeProgress: number; finishedGimme?: boolean } | null {
  const demo = s.activeDemo;
  if (!demo) return null;
  if (s.scriptedHoldUntilMs > nowMs) {
    return { joints: s.joints, next: demo, routeProgress: s.routeProgress };
  }

  switch (demo.kind) {
    case 'snake': {
      const t = demo.t + 0.028 * (dtMs / 16);
      return {
        joints: paint(s, {
          base: 90 + 20 * Math.sin(t * 0.5),
          shoulder: 90 + 15 * Math.sin(t),
          elbow: 120 + 30 * Math.sin(t - 1.2),
          wrist: 90 + 60 * Math.sin(t - 2.4),
          gripper: s.joints.gripper,
        }),
        next: { kind: 'snake', t },
        routeProgress: (t % (Math.PI * 2)) / (Math.PI * 2),
      };
    }
    case 'orbital': {
      const target = demo.path[demo.pathIndex];
      const stepped = stepTowardJoints(s.joints, target, dtMs, ORB_DPS);
      let pathIndex = demo.pathIndex;
      if (stepped.arrived) {
        pathIndex = (pathIndex + 1) % demo.path.length;
      }
      return {
        joints: paint(s, stepped.joints),
        next: { kind: 'orbital', path: demo.path, pathIndex },
        routeProgress: pathIndex / demo.path.length,
      };
    }
    case 'cobra':
    case 'gimme': {
      const elapsed = nowMs - demo.phaseStartMs;
      const loop = demo.kind === 'cobra';
      let phase = demo.phase;
      let phaseStartMs = demo.phaseStartMs;
      let joints = s.joints;

      if (phase === 1) {
        const u = Math.min(1, elapsed / 240);
        joints = paint(s, lerpPose(withGripper(COIL, s.joints.gripper), withGripper(STRIKE, s.joints.gripper), easeInOutCubic(u)));
        if (u >= 1) { phase = 2; phaseStartMs = nowMs; }
      } else if (phase === 2) {
        joints = paint(s, withGripper(STRIKE, s.joints.gripper));
        if (elapsed >= 180) { phase = 3; phaseStartMs = nowMs; }
      } else if (phase === 3) {
        const u = Math.min(1, elapsed / 240);
        joints = paint(s, lerpPose(withGripper(STRIKE, s.joints.gripper), withGripper(COIL, s.joints.gripper), easeInOutCubic(u)));
        if (u >= 1) {
          joints = paint(s, withGripper(COIL, s.joints.gripper));
          if (!loop) return { joints, next: null, routeProgress: 1, finishedGimme: true };
          phase = 4;
          phaseStartMs = nowMs;
        }
      } else {
        joints = paint(s, withGripper(COIL, s.joints.gripper));
        if (elapsed >= 3000) { phase = 1; phaseStartMs = nowMs; }
      }
      const tag = demo.kind;
      return { joints, next: { kind: tag, phase, phaseStartMs }, routeProgress: phase / 4 };
    }
    default:
      return null;
  }
}

export type { ExerciseKind };
