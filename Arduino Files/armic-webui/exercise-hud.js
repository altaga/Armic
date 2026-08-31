// SPDX-FileCopyrightText: Armic project
//
// SPDX-License-Identifier: MPL-2.0
//
// AI Node HUD — wearable MQTT only (no arm exercise telemetry).

const ExerciseHud = (() => {
  const LIVE_NAMES = {
    baseline: 'Idle',
    bicepcurl: 'Bicep curl',
    lateralraise: 'Lateral raise',
    elbowflexion: 'Elbow flexion',
    bicep: 'Bicep curl',
    lateral: 'Lateral raise',
    elbowflex: 'Elbow flexion',
    good: 'Good form',
    bad_form: 'Bad form',
    incomplete: 'Incomplete',
    none: 'Idle',
    idle: 'Idle',
  };

  let _bound = false;

  const state = {
    wearable: {
      online: false,
      live: null,
      sessionExercise: null,
      rep: 0,
    },
  };

  const el = (id) => document.getElementById(id);

  function norm(s) {
    return String(s || '').trim().toLowerCase();
  }

  function titleCase(s) {
    return String(s || '')
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function isNoneExercise(name) {
    const key = norm(name);
    return !key || key === 'none';
  }

  function isIdleLabel(label) {
    const key = norm(label);
    return !key || key === 'baseline' || key === 'none' || key === 'idle';
  }

  function hasLiveLabel() {
    return state.wearable.live != null && String(state.wearable.live).trim() !== '';
  }

  function formatLive(label) {
    if (!label) return '—';
    return LIVE_NAMES[norm(label)] || titleCase(label);
  }

  function exerciseLabel(exercise) {
    const key = norm(exercise);
    if (!key || key === 'none') return '—';
    return LIVE_NAMES[key] || titleCase(exercise);
  }

  function showRepNumber(rep) {
    const repsWrap = el('exerciseHudReps');
    const repEl = el('exerciseRepNumber');
    const n = Math.max(0, Number(rep) || 0);
    if (repEl) repEl.textContent = n > 0 ? String(n) : '';
    if (repsWrap) repsWrap.classList.toggle('hidden', n <= 0);
  }

  function paint() {
    const root = el('viewHud');
    const liveEl = el('exerciseHudLive');
    if (!root || !liveEl) return;

    root.classList.toggle('online', state.wearable.online);
    root.classList.toggle('offline', !state.wearable.online);

    if (!state.wearable.online) {
      liveEl.textContent = 'Waiting for AI Node…';
      liveEl.className = 'exercise-hud-live idle';
      showRepNumber(0);
      return;
    }

    const rep = Math.max(0, Number(state.wearable.rep) || 0);

    // Live inference drives the display: idle → exercise → idle per rep.
    if (hasLiveLabel() && !isIdleLabel(state.wearable.live)) {
      liveEl.textContent = formatLive(state.wearable.live);
      liveEl.className = 'exercise-hud-live active';
      showRepNumber(rep);
      return;
    }

    if (hasLiveLabel() && isIdleLabel(state.wearable.live)) {
      liveEl.textContent = 'Idle';
      liveEl.className = 'exercise-hud-live idle';
      showRepNumber(rep);
      return;
    }

    liveEl.textContent = 'Ready';
    liveEl.className = 'exercise-hud-live idle';
    showRepNumber(rep > 0 ? rep : 0);
  }

  function setRoutePhase(_phase, _status) {
    // Route phase lives on the center progress strip — not this HUD.
  }

  function onArmState(_s) {
    // Arm telemetry is intentionally not shown here (AI Node only).
  }

  function applyWearablePayload(p) {
    if (!p || !p.msg_type) return;
    if (p.msg_type === 'heartbeat') {
      state.wearable.online = true;
      return paint();
    }

    state.wearable.online = true;
    const msgType = p.msg_type;

    if (msgType === 'session_change') {
      const ex = norm(p.exercise);
      state.wearable.sessionExercise = isNoneExercise(ex) ? null : p.exercise;
      state.wearable.rep = Number(p.rep) || 0;
      if (p.label != null) state.wearable.live = p.label;
      return paint();
    }

    if (msgType === 'rep_end' || msgType === 'rep_start') {
      if (!isNoneExercise(p.exercise)) {
        state.wearable.sessionExercise = p.exercise;
      }
      if (p.rep != null) state.wearable.rep = Number(p.rep) || 0;
      if (msgType === 'rep_end') {
        // Rep complete — show idle until the next exercise inference arrives.
        state.wearable.live = p.label != null ? p.label : 'baseline';
      } else if (p.label != null) {
        state.wearable.live = p.label;
      }
      return paint();
    }

    if (msgType === 'inference') {
      if (p.label != null) state.wearable.live = p.label;
      if (!isNoneExercise(p.exercise)) {
        state.wearable.sessionExercise = p.exercise;
      }
      if (p.rep != null) state.wearable.rep = Number(p.rep) || 0;
      return paint();
    }

    paint();
  }

  function onWearableMessage(data) {
    if (!data) return;
    if (data.connected === true) {
      state.wearable.online = true;
      return paint();
    }
    if (!data.payload) return;
    applyWearablePayload(data.payload);
  }

  function bind(ui) {
    if (_bound) return;
    _bound = true;
    ui.on_message('wearable_mqtt', onWearableMessage);
    paint();
  }

  return { bind, paint, onArmState, setRoutePhase };
})();
