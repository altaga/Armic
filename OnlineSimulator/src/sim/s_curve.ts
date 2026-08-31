// ---- easing + 7-segment jerk-limited S-curves (matches armic-firmware MotionProfile + s_curve.js) ----
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export type SCurveSpec = {
  distanceDeg: number;   // total delta we need to cover
  maxDegPerSec: number;  // cruise speed deg/s (rehab 18, home 45)
  maxAcc: number;        // max acceleration deg/s^2
  maxJerk: number;       // max jerk deg/s^3
  dtMs: number;          // simulator tick ms
  startTimeMs: number;
};

export type SCurveStep = { elapsed: number; v: number; tNormalized: number };

export function sCurveNormalizeJerk(distDeg: number, cruise: number, acc: number, jerk: number, t: number): number {
  // t in [0, 1] (normalized over total duration)
  if (distDeg <= 0) return 0;
  // We approximate 7-segment profile: J1↑ · A_acc · J1↓ · cruise · J2↓ · D_dec · J2↑
  // For phone simulator we keep the math tractable with a smooth quintic blend.
  const t2 = t * t;
  const t3 = t2 * t;
  const t4 = t3 * t;
  const t5 = t4 * t;
  const sDeg = 10 * t3 - 15 * t4 + 6 * t5;   // 5th order zero v/a at endpoints
  return Math.max(0, Math.min(1, sDeg)) * distDeg;
}

export function estimatedSCurveDurationMs(distDeg: number, cruise: number, acc: number): number {
  const tAcc = cruise / acc;
  const dAcc = 0.5 * acc * tAcc * tAcc;
  if (2 * dAcc >= distDeg) {
    const tTri = Math.sqrt(distDeg / acc);
    return Math.round(2000 * tTri);
  }
  const tCruise = (distDeg - 2 * dAcc) / cruise;
  return Math.round(1000 * (2 * tAcc + tCruise));
}
