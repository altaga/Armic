// SPDX-FileCopyrightText: Armic project
//
// SPDX-License-Identifier: MPL-2.0
//
// Route progress strip — exercise pills + phase banner on the 3D view.

const RouteProgress = (() => {
  const EXERCISE_SHORT = {
    bicep: 'Bicep',
    lateral: 'Lateral',
    elbowflex: 'Elbow',
  };

  const EXERCISE_SUB = {
    bicep: 'Curl',
    lateral: 'Raise',
    elbowflex: 'Flexion',
  };

  let _bound = false;
  let _lastStatus = null;
  let _patientRep = 0;

  const el = (id) => document.getElementById(id);

  function norm(s) {
    return String(s || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  }

  function normalizeExercise(id) {
    const key = norm(id);
    if (key === 'bicepcurl' || key === 'bicep') return 'bicep';
    if (key === 'lateralraise' || key === 'lateral') return 'lateral';
    if (key === 'elbowflexion' || key === 'elbowflex' || key === 'elbow') return 'elbowflex';
    return key;
  }

  function stepsFromStatus(status) {
    if (status && Array.isArray(status.steps) && status.steps.length) {
      return status.steps;
    }
    return [
      { exercise: 'bicep', reps: 3, label: 'Bicep Curl' },
      { exercise: 'lateral', reps: 3, label: 'Lateral Raise' },
      { exercise: 'elbowflex', reps: 3, label: 'Elbow Flexion' },
    ];
  }

  function paintPills(status) {
    const host = el('routeProgressPills');
    if (!host) return;
    const steps = stepsFromStatus(status);
    const activeIdx = Math.max(0, (Number(status.step_index) || 1) - 1);

    host.innerHTML = steps.map((step, i) => {
      const ex = normalizeExercise(step.exercise);
      let cls = 'route-pill';
      if (i < activeIdx) cls += ' done';
      else if (i === activeIdx) cls += ' active';
      const check = i < activeIdx ? '<span class="route-pill-check">✓</span>' : '';
      const title = EXERCISE_SHORT[ex] || (step.label || ex).split(' ')[0];
      const sub = EXERCISE_SUB[ex] || '';
      return `<div class="${cls}" data-exercise="${ex}">${check}<span class="route-pill-title">${title}</span><span class="route-pill-sub">${sub}</span></div>`;
    }).join('');
  }

  function paintBanner(status) {
    const banner = el('routeProgressBanner');
    const text = el('routeProgressBannerText');
    const sub = el('routeProgressBannerSub');
    if (!banner || !text) return;

    const phase = String(status.phase || '');
    const reps = Number(status.reps) || 0;
    banner.className = 'route-progress-banner';
    sub.textContent = '';

    if (phase === 'patient_turn') {
      banner.classList.add('patient', 'visible');
      text.textContent = 'YOUR TURN';
      const target = reps > 0 ? reps : '?';
      const cur = _patientRep > 0 ? _patientRep : 0;
      sub.textContent = cur > 0
        ? `${cur} / ${target} reps`
        : `Complete ${target} reps`;
      return;
    }
    if (phase === 'arm_demo') {
      banner.classList.add('arm', 'visible');
      text.textContent = 'WATCH THE ARM';
      sub.textContent = status.message || '';
      return;
    }
    if (phase === 'celebration' || phase === 'complete') {
      banner.classList.add('celebration', 'visible');
      text.textContent = 'NICE WORK!';
      sub.textContent = 'Gimme five';
      return;
    }
    if (phase === 'starting') {
      banner.classList.add('arm', 'visible');
      text.textContent = 'STARTING';
      sub.textContent = '';
      return;
    }
    banner.classList.remove('visible');
  }

  function paint(status) {
    const root = el('routeProgress');
    const titleEl = el('routeProgressTitle');
    const stepEl = el('routeProgressStep');
    if (!root) return;

    if (!status || !status.running) {
      root.classList.add('hidden');
      _lastStatus = null;
      _patientRep = 0;
      if (typeof ExerciseHud !== 'undefined' && ExerciseHud.setRoutePhase) {
        ExerciseHud.setRoutePhase(null, null);
      }
      return;
    }

    root.classList.remove('hidden');
    _lastStatus = status;

    if (titleEl) {
      titleEl.textContent = status.route_title || status.route_id || 'Rehab route';
    }
    if (stepEl) {
      const total = Number(status.step_total) || 0;
      const idx = Number(status.step_index) || 0;
      stepEl.textContent = total > 0 ? `Exercise ${idx} of ${total}` : '';
    }

    paintPills(status);
    paintBanner(status);

    if (typeof ExerciseHud !== 'undefined' && ExerciseHud.setRoutePhase) {
      ExerciseHud.setRoutePhase(status.phase, status);
    }
  }

  function onWearable(data) {
    if (!_lastStatus || !_lastStatus.running) return;
    if (String(_lastStatus.phase) !== 'patient_turn') return;
    const p = data && data.payload;
    if (!p) return;

    const msgType = p.msg_type;
    if (msgType !== 'rep_end') return;

    const ex = normalizeExercise(p.exercise);
    const routeEx = normalizeExercise(_lastStatus.exercise);
    if (ex && routeEx && ex !== routeEx) return;

    const rep = Number(p.rep) || 0;
    const target = Number(_lastStatus.reps) || 0;
    if (rep > 0) {
      _patientRep = rep;
    } else {
      _patientRep = Math.min(_patientRep + 1, target || _patientRep + 1);
    }
    paintBanner(_lastStatus);
  }

  function bind(ui) {
    if (_bound) return;
    _bound = true;

    const stopBtn = el('routeProgressStop');
    if (stopBtn) {
      stopBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof ArmTransport !== 'undefined') ArmTransport.sendRouteStop();
      });
    }

    ui.on_message('route_status', (data) => {
      if (data && data.running && data.phase === 'patient_turn') {
        _patientRep = 0;
      }
      paint(data || null);
    });
    ui.on_message('wearable_mqtt', onWearable);
    paint(null);
  }

  return { bind, paint };
})();
