// Scripted motion catalogs — armic-webui/arm-simulator.html
import { JointsDeg, HOME } from './safety';
import { ikSim, shoulderForXyZero } from './simKinematics';

export type ArmAngles = Pick<JointsDeg, 'base' | 'shoulder' | 'elbow' | 'wrist'>;

const HTL_WP4_ELBOW = 180;
const HTL_WP4_WRIST = 180;

export const HTL_WAYPOINTS: ArmAngles[] = [
  { base: 90, shoulder: 180, elbow: 90, wrist: 90 },
  { base: 90, shoulder: 127, elbow: 180, wrist: 90 },
  { base: 90, shoulder: 112, elbow: 180, wrist: 180 },
  { base: 90, shoulder: shoulderForXyZero(HTL_WP4_ELBOW, HTL_WP4_WRIST), elbow: HTL_WP4_ELBOW, wrist: HTL_WP4_WRIST },
  { base: 90, shoulder: 90, elbow: 90, wrist: 90 },
];

export const EX_BC: ArmAngles[] = [
  { base: 90, shoulder: 120, elbow: 170, wrist: 180 },
  { base: 90, shoulder: 120, elbow: 170, wrist: 25 },
];

export const EX_LAT: ArmAngles[] = [
  { base: 90, shoulder: 90, elbow: 180, wrist: 90 },
  { base: 90, shoulder: 90, elbow: 180, wrist: 180 },
];

export const EX_LAT_SEQ = [0, 1, 0];
export const EX_REPS = 6;

export const EX_EF: ArmAngles[] = [
  { base: 90, shoulder: 0, elbow: 95, wrist: 90 },
  { base: 90, shoulder: 0, elbow: 180, wrist: 180 },
  { base: 90, shoulder: shoulderForXyZero(HTL_WP4_ELBOW, HTL_WP4_WRIST), elbow: HTL_WP4_ELBOW, wrist: HTL_WP4_WRIST },
  { base: 90, shoulder: 90, elbow: 90, wrist: 90 },
];

export const EX_EL_SEQ = [0, 1, 0];
export const EX_EL_SEQ_LAST = [0, 1, 0, 1, 2, 3];

export const COIL: ArmAngles = { base: 90, shoulder: 52, elbow: 168, wrist: 22 };
export const STRIKE: ArmAngles = { base: 90, shoulder: 138, elbow: 92, wrist: 88 };

export const ORBITAL = { cx: 150, cz: 180, radius: 32 };
export const ORB_SAMPLES = 96;
export const ORB_DPS = 6;

export function buildOrbitalPath(from: JointsDeg, payloadKg: number): JointsDeg[] | null {
  const { cx, cz, radius } = ORBITAL;
  const path: JointsDeg[] = [];
  let prefer: Pick<JointsDeg, 'base' | 'shoulder' | 'elbow' | 'wrist'> = from;
  for (let i = 0; i < ORB_SAMPLES; i++) {
    const t = (2 * Math.PI * i) / ORB_SAMPLES;
    const out = ikSim(cx, radius * Math.sin(t), cz + radius * Math.cos(t), 0, payloadKg, prefer);
    if (out.status !== 'OK') return null;
    const wp = withGripper(out.angles, from.gripper);
    path.push(wp);
    prefer = wp;
  }
  return path;
}

export function withGripper(a: ArmAngles, gripper: number): JointsDeg {
  return { ...a, gripper };
}

export function htlMaxDelta(from: ArmAngles, to: ArmAngles): number {
  return Math.max(
    Math.abs(to.base - from.base),
    Math.abs(to.shoulder - from.shoulder),
    Math.abs(to.elbow - from.elbow),
    Math.abs(to.wrist - from.wrist),
  );
}

export function buildHtlSegments(from: JointsDeg): { from: JointsDeg; to: JointsDeg; durationMs: number }[] {
  const HTL_DPS = 40;
  let prev = { ...from };
  return HTL_WAYPOINTS.map((wp) => {
    const to = withGripper(wp, from.gripper);
    const durationMs = Math.max(50, (htlMaxDelta(prev, to) / HTL_DPS) * 1000);
    const seg = { from: { ...prev }, to, durationMs };
    prev = to;
    return seg;
  });
}

export type ExerciseKind = 'bicep-set' | 'lateral-set' | 'elbowflex-set';

export function exerciseConfig(kind: ExerciseKind) {
  switch (kind) {
    case 'bicep-set':
      return { waypoints: EX_BC, seq: [0, 1, 0], reps: EX_REPS, lastRepSeq: undefined as number[] | undefined };
    case 'lateral-set':
      return { waypoints: EX_LAT, seq: EX_LAT_SEQ, reps: EX_REPS, lastRepSeq: undefined };
    case 'elbowflex-set':
      return { waypoints: EX_EF, seq: EX_EL_SEQ, reps: EX_REPS, lastRepSeq: EX_EL_SEQ_LAST };
  }
}

export function homeJoints(gripper: number): JointsDeg {
  return { ...HOME, gripper };
}
