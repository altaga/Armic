// ---- 7-segment jerk-limited S-curves (port of ArmDriverTesting-Portable/webpage/s_curve.js) ----

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function easeInCubic(t: number): number {
  return t * t * t;
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export type GotoEasing = 'easeInOut' | 'easeIn' | 'easeOut' | 'linear';

export function sampleGotoEasing(kind: GotoEasing, u: number): number {
  const t = Math.max(0, Math.min(1, u));
  switch (kind) {
    case 'easeIn': return easeInCubic(t);
    case 'easeOut': return easeOutCubic(t);
    case 'linear': return t;
    default: return easeInOutCubic(t);
  }
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

const SIGN = (x: number) => (x > 0 ? 1 : x < 0 ? -1 : 0);

type PhaseBoundary = { t: number; p: number; v: number; a: number };

export type SCurveConfig = { vMax?: number; aMax?: number; jMax?: number };

export class SCurveProfile {
  sign: number;
  dist: number;
  aMax: number;
  jMax: number;
  vMaxInput: number;
  boundaries: PhaseBoundary[] = [];
  v_peak = 0;
  T_j = 0;
  T_a = 0;
  T_v = 0;
  totalTime = 0;
  private dv_j = 0;
  private d_j = 0;
  private aMaxEff = 0;
  private jMaxEff = 0;

  constructor(distance: number, opts: SCurveConfig = {}) {
    const vMaxInput = opts.vMax ?? 250;
    const aMax = opts.aMax ?? 1500;
    const jMax = opts.jMax ?? 10000;

    this.sign = SIGN(distance);
    this.dist = Math.abs(distance);
    this.aMax = aMax;
    this.jMax = jMax;
    this.vMaxInput = vMaxInput;

    if (this.dist < 1e-9) return;

    let aMaxEff = aMax;
    let jMaxEff = jMax;
    let T_j = aMaxEff / jMaxEff;
    let dv_j = (aMaxEff * aMaxEff) / (2 * jMaxEff);
    let d_j = (aMaxEff * aMaxEff * aMaxEff) / (6 * jMaxEff * jMaxEff);
    const minDist = 12 * d_j;
    if (this.dist < minDist) {
      const k = this.dist / minDist;
      aMaxEff *= k;
      jMaxEff *= k;
      dv_j *= k;
      d_j *= k;
    }
    this.T_j = T_j;
    this.dv_j = dv_j;
    this.d_j = d_j;
    this.aMaxEff = aMaxEff;
    this.jMaxEff = jMaxEff;

    const dAccel = (v: number, ta: number) =>
      3 * d_j + dv_j * ta + 0.5 * aMaxEff * ta * ta + (v - dv_j) * T_j;

    let v_peak = vMaxInput;
    let T_a = Math.max(0, vMaxInput / aMaxEff - T_j);
    let T_v = 0;

    if (T_a > 0) {
      const d_accel_max = dAccel(vMaxInput, T_a);
      if (2 * d_accel_max <= this.dist) {
        T_v = (this.dist - 2 * d_accel_max) / vMaxInput;
        v_peak = vMaxInput;
      } else {
        const disc = aMaxEff * aMaxEff * T_j * T_j + 4 * aMaxEff * this.dist;
        v_peak = (-aMaxEff * T_j + Math.sqrt(disc)) / 2;
        if (v_peak <= aMaxEff * T_j + 1e-9) {
          T_a = 0;
          v_peak = dv_j + (this.dist / 2 - 3 * d_j) / T_j;
        } else {
          T_a = Math.max(0, v_peak / aMaxEff - T_j);
          if (T_a < 1e-9) T_a = 0;
        }
        T_v = 0;
      }
    } else {
      v_peak = dv_j + (this.dist / 2 - 3 * d_j) / T_j;
      T_a = 0;
      T_v = 0;
    }

    this.v_peak = v_peak;
    this.T_a = T_a;
    this.T_v = T_v;
    this.totalTime = 2 * (2 * T_j + T_a) + T_v;

    this._advance(+jMaxEff, T_j);
    this._advance(0, T_a);
    this._advance(-jMaxEff, T_j);
    this._advance(0, T_v);
    this._advance(-jMaxEff, T_j);
    this._advance(0, T_a);
    this._advance(+jMaxEff, T_j);
  }

  private _advance(j: number, dt: number) {
    const last = this.boundaries.length
      ? this.boundaries[this.boundaries.length - 1]
      : { t: 0, p: 0, v: 0, a: 0 };
    const t = last.t + dt;
    const p = last.p + last.v * dt + 0.5 * last.a * dt * dt + (1 / 6) * j * dt * dt * dt;
    const v = last.v + last.a * dt + 0.5 * j * dt * dt;
    const a = last.a + j * dt;
    this.boundaries.push({ t, p, v, a });
  }

  positionAt(t: number): number {
    if (t <= 0) return 0;
    if (t >= this.totalTime) return this.sign * this.dist;
    return this.sign * this._eval(t, 'p');
  }

  private _eval(t: number, want: 'p' | 'v' | 'a'): number {
    const jM = this.jMaxEff;
    const jSigns = [+jM, 0, -jM, 0, -jM, 0, +jM];
    let phase = 0;
    let prev: PhaseBoundary = { t: 0, p: 0, v: 0, a: 0 };
    while (phase < 7 && t > this.boundaries[phase].t) {
      prev = this.boundaries[phase];
      phase++;
    }
    if (phase >= 7) return prev[want];
    const dt = t - prev.t;
    const j = jSigns[phase];
    const p = prev.p + prev.v * dt + 0.5 * prev.a * dt * dt + (1 / 6) * j * dt * dt * dt;
    const v = prev.v + prev.a * dt + 0.5 * j * dt * dt;
    const a = prev.a + j * dt;
    return want === 'p' ? p : want === 'v' ? v : a;
  }
}

export function estimatedSCurveDurationMs(distDeg: number, cruise: number, acc: number): number {
  const profile = new SCurveProfile(distDeg, { vMax: cruise * 5, aMax: acc, jMax: acc * 8 });
  return Math.max(400, Math.round(profile.totalTime * 1000));
}
