// ---- armic safety invariants (port of armic-firmware safety.c gate order) ----
// 5 layers. Layer 0 (E-STOP) handled by UI button. Layer 1 (Watchdog MPU-silence
// 1500 ms) handled by simulator.ts tick loop. Layers 2-4 live here.

export type JointsDeg = {
  base: number;     // 0-180 electrical, band [10, 170]
  shoulder: number; // 0-180 electrical, band [0, 135]
  elbow: number;    // 90-180 anti-hyperextend, home offset 95
  wrist: number;    // 45-135 safe
  gripper: number;  // 0 closed - 90 open
};

// Match armic-webui RESTRICTIONS (visual sim + named poses; firmware rehab clamps are separate)
export const JOINT_LIMITS: Record<keyof JointsDeg, [number, number]> = {
  base: [0, 180],
  shoulder: [0, 180],
  elbow: [90, 180],
  wrist: [0, 180],
  gripper: [0, 90],
};

export const HOME: JointsDeg = { base: 90, shoulder: 90, elbow: 95, wrist: 90, gripper: 30 };
export const PARK: JointsDeg = { base: 90, shoulder: 120, elbow: 110, wrist: 90, gripper: 40 };
/** Carry / transport pose — home first, then this target */
export const TRANSPORT: JointsDeg = { base: 90, shoulder: 90, elbow: 180, wrist: 180, gripper: 100 };
/** arm-simulator.html testPoseBtn — locked C joints */
export const C_POSE: JointsDeg = { base: 90, shoulder: 55, elbow: 155, wrist: 150, gripper: 100 };

export const FLOOR_GUARD_MM = 15;                 // tip Z minimum above table plane
export const MAX_POSE_DELTA_DEG_PER_TICK = 30;    // 30 deg / 10ms = 3000 deg/s ceiling
export const MPU_SILENCE_TIMEOUT_MS = 1500;
export const SERVO_LOAD_EST_N = 2.0;

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export function clampBand(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function jointLimitsBand(j: JointsDeg): JointsDeg {
  const out: JointsDeg = { ...j };
  (Object.keys(JOINT_LIMITS) as (keyof JointsDeg)[]).forEach((k) => {
    const [lo, hi] = JOINT_LIMITS[k];
    out[k] = clampBand(out[k], lo, hi);
  });
  return out;
}

export function poseDeltaDeg(a: JointsDeg, b: JointsDeg): number {
  let d = 0;
  (Object.keys(a) as (keyof JointsDeg)[]).forEach((k) => {
    d = Math.max(d, Math.abs(a[k] - b[k]));
  });
  return d;
}

export type SafetyResult = {
  ok: boolean;
  flag: 'PASS' | 'JOINT_CLAMP' | 'DELTA_CLAMP' | 'FLOOR_CLAMP';
  clamped: JointsDeg;
};

export function safetyGate(
  target: JointsDeg,
  prev: JointsDeg,
  tipZmm: number,
): SafetyResult {
  let clamped = { ...target };
  let flag: SafetyResult['flag'] = 'PASS';

  const band = jointLimitsBand(clamped);
  const isBandDiff = (Object.keys(band) as (keyof JointsDeg)[]).some((k) => band[k] !== clamped[k]);
  clamped = band;
  if (isBandDiff) flag = 'JOINT_CLAMP';

  if (poseDeltaDeg(prev, clamped) > MAX_POSE_DELTA_DEG_PER_TICK) {
    (Object.keys(clamped) as (keyof JointsDeg)[]).forEach((k) => {
      const dir = Math.sign(clamped[k] - prev[k]) || 0;
      clamped[k] = prev[k] + dir * MAX_POSE_DELTA_DEG_PER_TICK;
    });
    flag = 'DELTA_CLAMP';
  }

  if (tipZmm < FLOOR_GUARD_MM) {
    flag = 'FLOOR_CLAMP';
  }
  return { ok: true, flag, clamped };
}
