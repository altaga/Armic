// Continuous multi-segment paths (HTL) + exercise queue builders
import { JointsDeg } from './safety';
import {
  buildHtlSegments, exerciseConfig, withGripper, homeJoints, ExerciseKind,
} from './catalog';
import { buildMotionQueueViaHome, gotoLegDurationMs } from './motion';

export { gotoLegDurationMs };

export type PathSegment = { from: JointsDeg; to: JointsDeg; durationMs: number };

export type PathPlayback = {
  segments: PathSegment[];
  timeEnds: number[];
  totalMs: number;
  startedAtMs: number;
};

export function createPathPlayback(segments: PathSegment[], startedAtMs: number): PathPlayback {
  const timeEnds: number[] = [];
  let t = 0;
  for (const seg of segments) {
    t += seg.durationMs;
    timeEnds.push(t);
  }
  return { segments, timeEnds, totalMs: t, startedAtMs };
}

export function samplePathPlayback(pb: PathPlayback, nowMs: number): JointsDeg {
  const elapsed = nowMs - pb.startedAtMs;
  if (elapsed >= pb.totalMs) {
    const last = pb.segments[pb.segments.length - 1];
    return { ...last.to };
  }
  let seg = 0;
  while (seg < pb.segments.length - 1 && elapsed >= pb.timeEnds[seg]) seg++;
  const segT0 = seg === 0 ? 0 : pb.timeEnds[seg - 1];
  const u = (elapsed - segT0) / pb.segments[seg].durationMs;
  const { from: f, to } = pb.segments[seg];
  return {
    base: f.base + (to.base - f.base) * u,
    shoulder: f.shoulder + (to.shoulder - f.shoulder) * u,
    elbow: f.elbow + (to.elbow - f.elbow) * u,
    wrist: f.wrist + (to.wrist - f.wrist) * u,
    gripper: f.gripper,
  };
}

export function buildExerciseQueue(gripper: number, kind: ExerciseKind): JointsDeg[] {
  const { waypoints, seq, reps, lastRepSeq } = exerciseConfig(kind);
  const q: JointsDeg[] = [];
  for (let r = 0; r < reps; r++) {
    const useSeq = r === reps - 1 && lastRepSeq ? lastRepSeq : seq;
    for (const idx of useSeq) q.push(withGripper(waypoints[idx], gripper));
  }
  return q;
}

export function buildHtlAfterHome(from: JointsDeg): PathPlayback {
  return createPathPlayback(buildHtlSegments(from), 0);
}

export function buildPostExerciseHome(from: JointsDeg): JointsDeg[] {
  return buildMotionQueueViaHome(from, homeJoints(from.gripper));
}

// ProtocolRunner.cpp pendulum chain
export const HOME_DPS = 45;
export const GOTO_DPS = 55;
export const PEND_DOWN_DPS = 220;
export const PEND_UP_DPS = 200;
export const PEND_DECEL_DPS = 55;
export const PEND_STOP_DPS = 22;
export const PEND_HOLD_MS = 2000;

export const PENDULUM_SETUP = { base: 90, shoulder: 152, elbow: 100, wrist: 90 } as const;
export const PENDULUM_DUMP = { base: 90, shoulder: 150, elbow: 142, wrist: 92 } as const;
export const PENDULUM_SWING1 = { base: 90, shoulder: 110, elbow: 115, wrist: 90 } as const;
export const PENDULUM_SWING2 = { base: 90, shoulder: 100, elbow: 105, wrist: 90 } as const;
export const PENDULUM_HOME = { base: 90, shoulder: 90, elbow: 95, wrist: 90 } as const;

/** Continuous return after dump — SWING1 → SWING2 → HOME (no stops between brake legs) */
export function buildPendulumReturnSegments(from: JointsDeg): PathSegment[] {
  const legs: { wp: JointsDeg; dps: number }[] = [
    { wp: { ...PENDULUM_SWING1, gripper: from.gripper }, dps: PEND_UP_DPS },
    { wp: { ...PENDULUM_SWING2, gripper: from.gripper }, dps: PEND_DECEL_DPS },
    { wp: { ...PENDULUM_HOME, gripper: from.gripper }, dps: PEND_STOP_DPS },
  ];
  let prev = { ...from };
  return legs.map(({ wp, dps }) => {
    const to = wp;
    const seg: PathSegment = {
      from: { ...prev },
      to,
      durationMs: gotoLegDurationMs(prev, to, dps),
    };
    prev = to;
    return seg;
  });
}
