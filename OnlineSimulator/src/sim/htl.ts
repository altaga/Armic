// ---- HTL 4-phase heavy-tucked-lift FSM (armic-firmware ProtocolRunner + htl-reference.md) ----
import { JointsDeg, HOME } from './safety';
import { PoseXYZ } from './kinematics';

export type HTLPhase = 'IDLE' | 'REACH' | 'FOLD_IN' | 'CARRY' | 'HOME_95' | 'RELEASE' | 'E_STOP';

export type HTLState = {
  phase: HTLPhase;
  startedAtMs: number;
  targetPuckXYZ: PoseXYZ;
  homePose: JointsDeg;
  phaseDurationMs: number;
  gripperClosed: boolean;
  phaseProgress: number; // 0..1 within phase
};

export function defaultHTLState(): HTLState {
  return {
    phase: 'IDLE',
    startedAtMs: 0,
    targetPuckXYZ: { x: 120, y: 0, z: 25, tool: 90 },
    homePose: { ...HOME, elbow: 95 },
    phaseDurationMs: 0,
    gripperClosed: false,
    phaseProgress: 0,
  };
}

export const PHASE_ORDER: HTLPhase[] = ['IDLE', 'REACH', 'FOLD_IN', 'CARRY', 'HOME_95', 'RELEASE', 'IDLE'];
export const PHASE_MS: Record<Exclude<HTLPhase, 'E_STOP' | 'IDLE'>, number> = {
  REACH: 2200,
  FOLD_IN: 900,
  CARRY: 2400,
  HOME_95: 1800,
  RELEASE: 500,
};

export function nextPhase(current: Exclude<HTLPhase, 'E_STOP'>): HTLPhase {
  const idx = PHASE_ORDER.indexOf(current);
  return PHASE_ORDER[Math.min(PHASE_ORDER.length - 1, idx + 1)];
}

// Shoulder torque heuristic for the carry tuck phase vs extended reach
export function htlShoulderTorqueFraction(phase: HTLPhase): number {
  switch (phase) {
    case 'REACH': return 1.00;  // extended, worst case
    case 'FOLD_IN': return 0.60;
    case 'CARRY': return 0.33;  // tucked 67% torque save
    case 'HOME_95': return 0.40;
    case 'RELEASE': return 0.50;
    default: return 0.20;
  }
}
