// Hardware mode: telemetry mirrors the arm; manual override stages moves in the sim first.
const ArmControl = (() => {
  let _suppress = false;
  let _orig = {};
  let _manualOverride = false;
  let _previewTimer = null;

  function isHardwareMode() {
    return ArmTransport.connected;
  }

  function isManualOverride() {
    return _manualOverride;
  }

  function sendStagedJoints() {
    if (!isHardwareMode() || typeof getAngles !== 'function') return;
    stopLocalMotion();
    const a = getAngles();
    ArmTransport.sendJoints(a.base, a.shoulder, a.elbow, a.wrist);
  }

  function setJointInputsEnabled(enabled) {
    ['base', 'shoulder', 'elbow', 'wrist'].forEach((j) => {
      const s = document.getElementById(j + 'Slider');
      const d = document.getElementById(j + 'Deg');
      if (s) s.disabled = !enabled;
      if (d) d.disabled = !enabled;
    });
  }

  function paintManualOverrideUi() {
    const cb = document.getElementById('manualOverride');
    const execBtn = document.getElementById('manualExecuteBtn');
    const hint = document.getElementById('manualOverrideHint');
    const badge = document.getElementById('manualOverrideBadge');
    if (cb) cb.checked = _manualOverride;
    if (execBtn) execBtn.disabled = !_manualOverride || !isHardwareMode();
    if (badge) {
      if (_manualOverride) {
        badge.textContent = 'SIM PREVIEW — sliders drive simulator only';
        badge.className = 'manual-override-badge preview';
      } else {
        badge.textContent = isHardwareMode()
          ? 'LIVE — arm telemetry drives simulator'
          : 'LOCAL SIM';
        badge.className = 'manual-override-badge live';
      }
    }
    if (hint) {
      hint.textContent = _manualOverride
        ? 'Adjust joints — the 3D view follows slowly. Execute sends joints only (claw is separate).'
        : 'Enable override to stage joint moves in the simulator. Claw stays live below.';
    }
    if (isHardwareMode()) {
      setJointInputsEnabled(_manualOverride);
    } else {
      setJointInputsEnabled(true);
    }
  }

  function syncSlidersFromTelemetry() {
    if (typeof TelemetryMirror === 'undefined' || !TelemetryMirror.last) return;
    _suppress = true;
    try {
      if (_orig.setAngles) _orig.setAngles(TelemetryMirror.last.angles);
    } finally {
      _suppress = false;
    }
  }

  function previewFromSliders() {
    if (!_manualOverride || typeof getAngles !== 'function' || !_orig.tweenToAngles) return;
    stopLocalMotion();
    _orig.tweenToAngles(getAngles());
  }

  function schedulePreview() {
    if (_previewTimer) clearTimeout(_previewTimer);
    _previewTimer = setTimeout(() => {
      _previewTimer = null;
      previewFromSliders();
    }, 40);
  }

  function setManualOverride(on) {
    _manualOverride = !!on;
    if (_manualOverride) {
      syncSlidersFromTelemetry();
      stopLocalMotion();
    } else if (window._tween) {
      window._tween.cancelled = true;
    }
    paintManualOverrideUi();
  }

  function setConnectedUi(on) {
    if (on) stopLocalMotion();
    paintManualOverrideUi();
    const bar = document.getElementById('hwStatusBar');
    if (bar) bar.classList.toggle('active', on);
    const brain = document.getElementById('hwBrainLabel');
    const mirror = document.getElementById('hwMirrorLabel');
    if (brain) brain.textContent = on ? 'UNO Q MCU (firmware)' : 'browser (sim)';
    if (mirror) {
      mirror.textContent = on
        ? (_manualOverride ? 'manual override (sim preview)' : 'STATE telemetry @ 20Hz')
        : 'local JS math';
    }
    if (!on) {
      const mode = document.getElementById('hwModeLabel');
      if (mode) mode.textContent = 'offline';
    }
  }

  function stopLocalMotion() {
    if (typeof activeDemoInterval !== 'undefined' && activeDemoInterval) {
      clearInterval(activeDemoInterval);
      activeDemoInterval = null;
    }
    if (window._tween) window._tween.cancelled = true;
  }

  function applyDeviceState(state) {
    if (!state || !state.angles || !state.pwm) return;
    if (_manualOverride) return;
    _suppress = true;
    try {
      if (_orig.setAngles) _orig.setAngles(state.angles);
      else if (typeof updateLabels === 'function') updateLabels();
      if (typeof updateArm === 'function') updateArm();
      if (typeof updateTargetMarker === 'function' && typeof forwardKinematics === 'function') {
        const f = forwardKinematics(state.angles);
        updateTargetMarker(f.x, f.y, f.z, f.pitch != null ? f.pitch : 0);
      }
    } finally {
      _suppress = false;
    }
  }

  function installPatches() {
    _orig.setAngles = window.setAngles;
    _orig.tweenToAngles = window.tweenToAngles;
    _orig.safeReturnToHome = window.safeReturnToHome;
    _orig.render = window.render;

    window.setAngles = function (a) {
      if (isHardwareMode() && !_suppress && !_manualOverride) return;
      return _orig.setAngles(a);
    };

    window.tweenToAngles = function (target, dur) {
      if (isHardwareMode() && !_suppress && !_manualOverride) return;
      return _orig.tweenToAngles(target, dur);
    };

    window.safeReturnToHome = function (cb) {
      if (isHardwareMode() && !_suppress) {
        setManualOverride(false);
        ArmTransport.sendProtocol('home');
        return;
      }
      return _orig.safeReturnToHome(cb);
    };

    window.render = function () {
      const r = _orig.render();
      if (isHardwareMode() && !_manualOverride
          && typeof TelemetryMirror !== 'undefined' && TelemetryMirror.last) {
        TelemetryMirror.paintUI(TelemetryMirror.last);
      }
      return r;
    };
  }

  function bindHardwareCommandBtn(id, handler) {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      if (!ArmTransport.connected || !isHardwareMode()) return;
      e.stopImmediatePropagation();
      stopLocalMotion();
      setManualOverride(false);
      handler();
    }, true);
  }

  function bindProtocolBtn(id, protocol) {
    bindHardwareCommandBtn(id, () => ArmTransport.sendProtocol(protocol));
  }

  function bindExerciseBtn(id, name) {
    bindHardwareCommandBtn(id, () => ArmTransport.sendExercise(name));
  }

  function bindManualOverride() {
    const cb = document.getElementById('manualOverride');
    const execBtn = document.getElementById('manualExecuteBtn');
    if (cb) {
      cb.addEventListener('change', () => setManualOverride(cb.checked));
    }
    if (execBtn) {
      execBtn.addEventListener('click', () => {
        if (!_manualOverride || !isHardwareMode()) return;
        sendStagedJoints();
      });
    }
    ['base', 'shoulder', 'elbow', 'wrist'].forEach((j) => {
      const s = document.getElementById(j + 'Slider');
      if (!s) return;
      s.addEventListener('input', () => {
        if (!_manualOverride) return;
        getAngles();
        updateLabels();
        schedulePreview();
      });
    });
    paintManualOverrideUi();
  }

  function bindHardwareUi() {
    bindProtocolBtn('homeQuickBtn', 'home');
    bindProtocolBtn('dumbbellUpBtn', 'home');
    bindHardwareCommandBtn('dumbbellDownBtn', () => {
      ArmTransport.sendJoints(90, 137, 180, 135);
    });
    bindProtocolBtn('stopDemoBtn', 'stop');
    bindProtocolBtn('wipeDemoBtn', 'orbital');
    bindProtocolBtn('snakeDemoBtn', 'snake');
    bindProtocolBtn('cobraDemoBtn', 'gimmefive');
    bindProtocolBtn('cobraLoopDemoBtn', 'cobra');
    bindProtocolBtn('htlDemoBtn', 'htl');
    bindProtocolBtn('psDemoBtn', 'pendulum');
    bindExerciseBtn('bicepDemoBtn', 'bicep');
    bindExerciseBtn('lateralDemoBtn', 'lateral');
    bindExerciseBtn('elbowDemoBtn', 'elbowflex');

    bindHardwareCommandBtn('testPoseBtn', () => {
      ArmTransport.sendProtocol('cpose');
      if (typeof updateTargetMarker === 'function') updateTargetMarker(33.4, 0, 224.3, 0);
    });
    bindHardwareCommandBtn('transportPoseBtn', () => {
      ArmTransport.sendProtocol('transport');
    });

    const pSlider = document.getElementById('payloadSlider');
    const pInput = document.getElementById('payloadInput');
    if (pSlider) {
      pSlider.addEventListener('change', () => {
        if (!isHardwareMode()) return;
        ArmTransport.sendPayload(parseFloat(pSlider.value));
      });
    }
    if (pInput) {
      pInput.addEventListener('change', () => {
        if (!isHardwareMode()) return;
        ArmTransport.sendPayload(parseFloat(pInput.value));
      });
    }
  }

  function patchRunIK() {
    const orig = window.runIK;
    if (typeof orig !== 'function') return;
    window.runIK = function (x, y, z, p) {
      if (isHardwareMode() && !_manualOverride) {
        const pitch = (p === undefined || p === null) ? 90 : p;
        ArmTransport.sendTarget(x, y, z, pitch);
        if (typeof updateTargetMarker === 'function') updateTargetMarker(x, y, z, pitch);
        return;
      }
      return orig(x, y, z, p);
    };
  }

  let _initialized = false;

  function init() {
    if (_initialized) return;
    _initialized = true;
    installPatches();
    bindManualOverride();
    bindHardwareUi();
    patchRunIK();
  }

  return {
    init,
    isHardwareMode,
    isManualOverride,
    syncSlidersFromTelemetry,
    applyDeviceState,
    stopLocalMotion,
    setConnectedUi,
  };
})();

document.addEventListener('DOMContentLoaded', () => {
  if (typeof ArmControl !== 'undefined') ArmControl.init();
});

if (document.readyState !== 'loading') ArmControl.init();
