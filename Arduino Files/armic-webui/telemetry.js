// Parses STATE telemetry from the UNO Q MCU and mirrors the 3D model + UI
const TelemetryMirror = (() => {
  let last = null;
  let lastRxMs = 0;
  let _clawBootstrapped = false;

  function resetClawBootstrap() {
    _clawBootstrapped = false;
  }

  function bootstrapClawFromTelemetry(state) {
    if (_clawBootstrapped) return;
    if (typeof window.ClawUi !== 'undefined' && window.ClawUi.isUserOwned()) return;
    if (typeof setClawPercent !== 'function') return;
    if (state.claw === undefined || !Number.isFinite(state.claw)) return;
    setClawPercent(state.claw, false);
    _clawBootstrapped = true;
  }

  function parseState(line) {
    if (!line.startsWith('STATE ')) return null;
    const parts = line.trim().split(/\s+/);
    const out = { raw: line };
    for (let i = 1; i < parts.length; i++) {
      const p = parts[i];
      const eq = p.indexOf('=');
      if (eq < 0) continue;
      const key = p.slice(0, eq);
      const val = p.slice(eq + 1);
      out[key] = val;
    }
    if (!out.mode || !out.b || !out.pwm || !out.strain) return null;

    const angles = out.b.split(',').map(Number);
    const pwm = out.pwm.split(',').map(Number);
    const strain = out.strain.split(',').map(Number);
    // Firmware sends strain=sh,el,wr (3). Accept 3 or 4 for forward compat.
    if (angles.length !== 4 || pwm.length !== 4 || strain.length < 3) return null;

    return {
      mode: out.mode,
      angles: { base: angles[0], shoulder: angles[1], elbow: angles[2], wrist: angles[3] },
      pwm: { base: pwm[0], shoulder: pwm[1], elbow: pwm[2], wrist: pwm[3] },
      strain: { sh: strain[0], el: strain[1], wr: strain[2] },
      w: parseFloat(out.w) || 0,
      watts: parseFloat(out.watts) || 0,
      payload: parseFloat(out.payload) || 0,
      claw: out.claw !== undefined ? parseFloat(out.claw) : 50,
      loaded: out.loaded === '1' || out.loaded === 'true',
    };
  }

  function paintUI(state) {
    const tauShEl = document.getElementById('tauSh');
    const strainShEl = document.getElementById('strainSh');
    const tauElEl = document.getElementById('tauEl');
    const strainElEl = document.getElementById('strainEl');
    const tauWrEl = document.getElementById('tauWr');
    const strainWrEl = document.getElementById('strainWr');
    const wEl = document.getElementById('wScore');
    const wattsEl = document.getElementById('sysWatts');
    const postureEl = document.getElementById('postureRating');
    const hwModeEl = document.getElementById('hwModeLabel');

    if (hwModeEl) hwModeEl.textContent = state.mode;

    bootstrapClawFromTelemetry(state);

    if (strainShEl) {
      strainShEl.textContent = `(${state.strain.sh.toFixed(0)}%)`;
      strainShEl.className = state.strain.sh > 90 ? 'v err' : (state.strain.sh > 60 ? 'v warn' : 'v ok');
    }
    if (strainElEl) {
      strainElEl.textContent = `(${state.strain.el.toFixed(0)}%)`;
      strainElEl.className = state.strain.el > 90 ? 'v err' : (state.strain.el > 60 ? 'v warn' : 'v ok');
    }
    if (strainWrEl) {
      strainWrEl.textContent = `(${state.strain.wr.toFixed(0)}%)`;
      strainWrEl.className = state.strain.wr > 90 ? 'v err' : (state.strain.wr > 60 ? 'v warn' : 'v ok');
    }
    if (tauShEl) tauShEl.textContent = 'live';
    if (tauElEl) tauElEl.textContent = 'live';
    if (tauWrEl) tauWrEl.textContent = 'live';
    if (wEl) wEl.textContent = state.w.toFixed(3);
    if (wattsEl) wattsEl.textContent = `${state.watts.toFixed(2)} W`;

    if (postureEl) {
      const maxStrain = Math.max(state.strain.sh, state.strain.el, state.strain.wr);
      if (maxStrain > 90) {
        postureEl.textContent = 'CRITICAL OVERLOAD';
        postureEl.className = 'status-warn';
      } else if (maxStrain > 60) {
        postureEl.textContent = 'HIGH TORQUE';
        postureEl.className = 'status-warn';
      } else if (state.w < 0.15) {
        postureEl.textContent = 'NEAR SINGULARITY';
        postureEl.className = 'status-warn';
      } else {
        postureEl.textContent = 'OPTIMAL LOAD';
        postureEl.className = 'status-ok';
      }
    }

    if (typeof scopePush === 'function' && typeof scopeDraw === 'function') {
      scopePush(state.strain.sh, state.strain.el, state.strain.wr, state.watts);
      scopeDraw();
    }
  }

  function apply(state) {
    last = state;
    lastRxMs = performance.now();
    if (typeof ArmControl !== 'undefined') {
      ArmControl.applyDeviceState(state);
    }
    paintUI(state);
  }

  function handleLine(line) {
    const state = parseState(line);
    if (state) apply(state);
  }

  function hasFreshState(maxAgeMs = 500) {
    return last && (performance.now() - lastRxMs) < maxAgeMs;
  }

  return {
    get last() { return last; },
    handleLine,
    hasFreshState,
    paintUI,
    resetClawBootstrap,
  };
})();

ArmTransport.setLineHandler((line) => {
  TelemetryMirror.handleLine(line);
});
