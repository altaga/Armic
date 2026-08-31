// ============================================================================
// s_curve.js — 7-segment constant-jerk motion profile
//
// Used to drive smooth servo motion: trapezoidal velocity, S-curved
// acceleration ramps, and zero velocity + zero acceleration at the endpoints.
// Designed for joint motion on hobby servos where instant velocity changes
// cause ringing, current spikes, and lost steps.
//
// Phases (for a positive-distance move):
//   1. Jerk-up:    a: 0 → +a_max   (jerk = +j_max)
//   2. Const accel: a = +a_max       (jerk = 0)
//   3. Jerk-down:  a: +a_max → 0   (jerk = -j_max)
//   4. Cruise:     v = v_peak        (jerk = 0, a = 0)
//   5. Jerk-down:  a: 0 → -a_max   (jerk = -j_max)
//   6. Const decel: a = -a_max       (jerk = 0)
//   7. Jerk-up:    a: -a_max → 0   (jerk = +j_max)
//
// For moves too short to reach v_max, the cruise phase is skipped (and the
// constant-accel phase as well when distance is even smaller). The profile
// adapts automatically — only the phases whose duration is non-zero contribute.
//
// Units: caller chooses. Convention here is degrees for position, seconds
// for time, deg/s for velocity, deg/s² for accel, deg/s³ for jerk.
//
// Usage:
//   const profile = new SCurveProfile(distance, { vMax, aMax, jMax });
//   const angle = start + profile.positionAt(t);  // t in [0, profile.totalTime]
//
// Loadable in both Node (for tests) and the browser (window.SCurveProfile).
// ============================================================================

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.SCurveLib = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {

  const SIGN = (x) => (x > 0) - (x < 0);

  class SCurveProfile {
    constructor(distance, opts) {
      opts = opts || {};
      const vMaxInput = opts.vMax != null ? opts.vMax : 250;     // deg/s
      const aMax      = opts.aMax != null ? opts.aMax : 1500;    // deg/s²
      const jMax      = opts.jMax != null ? opts.jMax : 10000;   // deg/s³

      this.sign   = SIGN(distance);
      this.dist   = Math.abs(distance);
      this.aMax   = aMax;
      this.jMax   = jMax;
      this.vMaxInput = vMaxInput;
      this.boundaries = [];   // [end-of-phase-1, ..., end-of-phase-7] each {t,p,v,a}

      if (this.dist < 1e-9) {
        this.v_peak = 0; this.T_j = 0; this.T_a = 0; this.T_v = 0;
        this.totalTime = 0;
        return;
      }

      // aMax and jMax are MAXIMUMS. The S-curve shape they imply has a minimum
      // distance of 12*d_j (the two full S-curved ramps at v_peak = 2*dv_j, with
      // T_a = 0). For shorter distances, scale both constraints down by the
      // same factor k so the profile's natural size matches the requested
      // distance. T_j = aMax/jMax stays the same; v_peak (reached at end of
      // accel half) is scaled down accordingly.
      let aMaxEff = aMax;
      let jMaxEff = jMax;
      let T_j  = aMaxEff / jMaxEff;
      let dv_j = (aMaxEff * aMaxEff) / (2 * jMaxEff);
      let d_j  = (aMaxEff * aMaxEff * aMaxEff) / (6 * jMaxEff * jMaxEff);
      const minDist = 12 * d_j;
      if (this.dist < minDist) {
        const k = this.dist / minDist;
        aMaxEff *= k;
        jMaxEff *= k;
        // T_j unchanged (ratio preserved).
        dv_j *= k;          // since dv_j = aMax*T_j/2 and T_j fixed, aMax scales linearly
        d_j  *= k;          // d_j = aMax*T_j^2/6 scales linearly too
      }
      this.T_j = T_j; this.dv_j = dv_j; this.d_j = d_j;
      this.aMaxEff = aMaxEff;
      this.jMaxEff = jMaxEff;

      // dAccel(v, ta) = distance covered during the positive-accel half
      //   (jerk-up + const-accel + jerk-down) when peak velocity = v and
      //   const-accel duration = ta. Uses the SCALED aMax.
      const dAccel = (v, ta) =>
        3 * d_j + dv_j * ta + 0.5 * aMaxEff * ta * ta + (v - dv_j) * T_j;

      let v_peak = vMaxInput;
      let T_a = Math.max(0, vMaxInput / aMaxEff - T_j);
      let T_v = 0;

      if (T_a > 0) {
        const d_accel_max = dAccel(vMaxInput, T_a);
        if (2 * d_accel_max <= this.dist) {
          // Long enough for full cruise.
          T_v = (this.dist - 2 * d_accel_max) / vMaxInput;
          v_peak = vMaxInput;
        } else {
          // No cruise; v_max unreachable. Solve quadratic for v_peak.
          // dAccel(v) = v²/(2·a_max) + (T_j/2)·v   (closed form when T_a = v/a_max − T_j ≥ 0)
          // dist = 2·dAccel(v_peak) = v_peak²/a_max + T_j·v_peak
          // => v_peak² + a_max·T_j·v_peak − a_max·dist = 0
          // Take the positive root.
          const disc = aMaxEff * aMaxEff * T_j * T_j + 4 * aMaxEff * this.dist;
          v_peak = (-aMaxEff * T_j + Math.sqrt(disc)) / 2;
          if (v_peak <= aMaxEff * T_j + 1e-9) {
            // Below (or right at) the threshold where T_a = v/aMax − T_j ≥ 0;
            // the quadratic gave us a value that's effectively v = aMax·T_j.
            // Fall through to T_a = 0.
            T_a = 0;
            // Triangle-with-S-curved-ramps: 2·dAccel = 6·d_j + 2·(v−dv_j)·T_j = dist
            v_peak = dv_j + (this.dist / 2 - 3 * d_j) / T_j;
            // (v_peak ≤ 2·dv_j by the scaling step; no clamp needed.)
          } else {
            T_a = Math.max(0, v_peak / aMaxEff - T_j);
            if (T_a < 1e-9) T_a = 0;  // floating-point safety
          }
          T_v = 0;
        }
      } else {
        // No const-accel phase (T_a = 0). Triangle-with-S-curved-ramps.
        // 2·dAccel(v_peak) = 6·d_j + 2·(v_peak − dv_j)·T_j = dist
        v_peak = dv_j + (this.dist / 2 - 3 * d_j) / T_j;
        // (v_peak ≤ 2·dv_j by the scaling step; no clamp needed.)
        T_a = 0;
        T_v = 0;
      }

      this.v_peak = v_peak;
      this.T_a = T_a;
      this.T_v = T_v;
      this.totalTime = 2 * (2 * T_j + T_a) + T_v;

      // Walk the phases, accumulating end-of-phase state. Each phase follows
      // p(t) = p0 + v0·t + ½·a0·t² + (1/6)·j·t³. We use the SCALED jMax so
      // the dynamics match the planner's v_peak / T_a / T_j.
      let t = 0, p = 0, v = 0, a = 0;
      // Phase 1: jerk-up (+jMaxEff)
      this._advance(+jMaxEff, T_j);
      // Phase 2: const accel
      this._advance(0,        T_a);
      // Phase 3: jerk-down
      this._advance(-jMaxEff, T_j);
      // Phase 4: cruise (a=0)
      this._advance(0,        T_v);
      // Phase 5: jerk-down (negative)
      this._advance(-jMaxEff, T_j);
      // Phase 6: const decel
      this._advance(0,        T_a);
      // Phase 7: jerk-up (positive, brings a back to 0)
      this._advance(+jMaxEff, T_j);
    }

    _advance(j, dt) {
      // Append the next phase's end-state to this.boundaries.
      const last = this.boundaries.length
        ? this.boundaries[this.boundaries.length - 1]
        : { t: 0, p: 0, v: 0, a: 0 };
      const t = last.t + dt;
      const p = last.p + last.v * dt + 0.5 * last.a * dt * dt + (1/6) * j * dt * dt * dt;
      const v = last.v + last.a * dt + 0.5 * j * dt * dt;
      const a = last.a + j * dt;
      this.boundaries.push({ t, p, v, a });
    }

    positionAt(t) {
      if (t <= 0) return 0;
      if (t >= this.totalTime) return this.sign * this.dist;
      return this.sign * this._eval(t, 'p');
    }

    velocityAt(t) {
      if (t <= 0 || t >= this.totalTime) return 0;
      return this.sign * this._eval(t, 'v');
    }

    accelerationAt(t) {
      if (t <= 0 || t >= this.totalTime) return 0;
      return this.sign * this._eval(t, 'a');
    }

    _eval(t, want) {
      // Find which phase t is in. Each boundary entry is the end-state of
      // phases 1..i, so t falls in phase (i+1) when boundaries[i].t < t ≤
      // boundaries[i+1].t (with boundaries[-1] = zeros at t=0).
      const jM = this.jMaxEff;
      const jSigns = [+jM, 0, -jM, 0, -jM, 0, +jM];
      let phase = 0;
      let prev = { t: 0, p: 0, v: 0, a: 0 };
      while (phase < 7 && t > this.boundaries[phase].t) {
        prev = this.boundaries[phase];
        phase++;
      }
      if (phase >= 7) return prev[want];
      const dt = t - prev.t;
      const j = jSigns[phase];
      const p = prev.p + prev.v * dt + 0.5 * prev.a * dt * dt + (1/6) * j * dt * dt * dt;
      const v = prev.v + prev.a * dt + 0.5 * j * dt * dt;
      const a = prev.a + j * dt;
      return want === 'p' ? p : (want === 'v' ? v : a);
    }
  }

  return { SCurveProfile };
});
