// SPDX-FileCopyrightText: Armic project
//
// SPDX-License-Identifier: MPL-2.0
//
// Transport layer — WebSocket to the board, replacing Web Serial.
//
// The page used to talk to an ESP32 over Web Serial from a PC browser. Now the
// UNO Q serves this page itself and relays commands to its own MCU over the
// Router Bridge. The public surface of ArmTransport is unchanged, so
// telemetry.js and arm-control.js work without modification.
//
// One consequence worth knowing: there is no "Connect" button any more. The
// socket opens as soon as the page loads, and "hardware mode" simply means the
// socket is up. If you loaded this page from the board, you are talking to the
// arm.
const ArmTransport = (() => {
  let _onLine = null;
  let _connected = false;
  let _dryRun = null;
  let _limits = null;

  const ui = new WebUI();

  // Ship browser JS errors to the board so they show up in `app logs`. Without
  // this, a failure in the page is invisible unless someone has devtools open
  // on the phone — and a silent JS error looks exactly like "the arm is dead".
  window.addEventListener('error', (e) => {
    try {
      ui.send_message('client_error', {
        message: String(e.message || 'unknown'),
        source: String(e.filename || '').split('/').pop(),
        line: e.lineno || 0,
        col: e.colno || 0,
        stack: e.error && e.error.stack ? String(e.error.stack).slice(0, 500) : '',
      });
    } catch (_) { /* nothing useful to do */ }
    logLine(`JS ERROR ${e.message} @ ${String(e.filename || '').split('/').pop()}:${e.lineno}`);
  });

  window.addEventListener('unhandledrejection', (e) => {
    try {
      ui.send_message('client_error', {
        message: 'unhandled promise rejection: ' + String(e.reason).slice(0, 200),
        source: 'promise', line: 0, col: 0, stack: '',
      });
    } catch (_) { /* ignore */ }
  });

  ui.on_connect(() => {
    _connected = true;
    if (typeof TelemetryMirror !== 'undefined') TelemetryMirror.resetClawBootstrap();
    if (typeof setPayloadKg === 'function') setPayloadKg(0, true);
    if (typeof SanityUi !== 'undefined') SanityUi.bind(ui);
    if (typeof ExerciseHud !== 'undefined') ExerciseHud.bind(ui);
    if (typeof RouteProgress !== 'undefined') RouteProgress.bind(ui);
    if (typeof RehabRoutes !== 'undefined') RehabRoutes.bind(ui);
    ui.send_message('hello', {});
    if (typeof ArmControl !== 'undefined') ArmControl.setConnectedUi(true);
  });

  ui.on_disconnect(() => {
    _connected = false;
    if (typeof ArmControl !== 'undefined') ArmControl.setConnectedUi(false);
  });

  function setStatus(text) {
    const el = document.getElementById('serialStatus');
    if (el) el.textContent = 'Status: ' + text;
  }

  // Small rolling log so refused commands are visible instead of silent.
  function logLine(text) {
    const el = document.getElementById('serialLog');
    if (!el) return;
    const ts = new Date().toLocaleTimeString();
    el.textContent = `${ts}  ${text}\n` + el.textContent;
    if (el.textContent.length > 4000) el.textContent = el.textContent.slice(0, 4000);
  }

  // Handshake reply: capabilities + current state.
  ui.on_message('hello', (d) => {
    if (!d) return;
    _dryRun = d.dry_run;
    _limits = d.limits || null;
    paintDryRun();
    if (typeof SanityUi !== 'undefined' && d.sanity) SanityUi.paint(d.sanity);
    if (d.route_status && typeof RouteProgress !== 'undefined') {
      RouteProgress.paint(d.route_status.running ? d.route_status : null);
    }
    if (d.state) {
      if (typeof ExerciseHud !== 'undefined') ExerciseHud.onArmState(d.state);
      dispatchRx(stateToLine(d.state));
    }
  });

  // Telemetry at ~20 Hz. Python sends both the structured dict and the legacy
  // "STATE ..." text line; telemetry.js already parses the line, so use it.
  ui.on_message('state', (s) => {
    if (!s) return;
    if (typeof ExerciseHud !== 'undefined') ExerciseHud.onArmState(s);
    dispatchRx(s.line || stateToLine(s));
    if (
      typeof ArmControl !== 'undefined'
      && ArmControl.isHardwareMode
      && ArmControl.isHardwareMode()
      && !ArmControl.isManualOverride()
    ) {
      ArmControl.syncSlidersFromTelemetry();
    }
  });

  ui.on_message('ack', (a) => {
    if (!a) return;
    if (a.ok === false) {
      console.warn('[armic] command refused:', a);
      flashStatus(`${a.cmd} refused${a.reason ? ': ' + a.reason : ''}`);
      logLine(`REFUSED ${a.cmd}${a.reason ? ' — ' + a.reason : ''}`);
    } else {
      logLine(`ok ${a.cmd}${a.name ? ' ' + a.name : ''}`);
    }
    if (a.cmd === 'dry_run' && a.ok) {
      _dryRun = a.on;
      paintDryRun();
    }
  });

  ui.on_message('limits', (d) => {
    if (d) _limits = d.stored || null;
  });

  // Fallback formatter, used only if the server ever omits `line`.
  function stateToLine(s) {
    const f1 = (v) => Number(v || 0).toFixed(1);
    return `STATE mode=${s.mode}`
      + ` b=${f1(s.base)},${f1(s.shoulder)},${f1(s.elbow)},${f1(s.wrist)}`
      + ` pwm=${s.pwm_base | 0},${s.pwm_shoulder | 0},${s.pwm_elbow | 0},${s.pwm_wrist | 0}`
      + ` strain=${f1(s.strain_shoulder)},${f1(s.strain_elbow)},${f1(s.strain_wrist)}`
      + ` w=${Number(s.manipulability || 0).toFixed(3)}`
      + ` watts=${Number(s.watts || 0).toFixed(2)}`
      + ` payload=${Number(s.payload || 0).toFixed(2)}`
      + ` claw=${Number(s.claw || 0).toFixed(0)}`
      + ` loaded=${s.loaded ? 1 : 0}`
      + ` ex_rep=${Number(s.ex_rep || 0) | 0}`
      + ` ex_step=${Number(s.ex_step || 0) | 0}`
      + ` ex_steps=${Number(s.ex_steps || 0) | 0}`
      + ` ex_leg=${Number(s.ex_leg || 0).toFixed(2)}`
      + ` ex_total=${Number(s.ex_total || 0) | 0}`;
  }

  function flashStatus(text) {
    const el = document.getElementById('hwModeLabel');
    if (!el) return;
    const prev = el.textContent;
    el.textContent = text;
    setTimeout(() => { if (el.textContent === text) el.textContent = prev; }, 1500);
  }

  function paintDryRun() {
    const el = document.getElementById('armicDryRun');
    if (el) el.checked = !!_dryRun;
    const badge = document.getElementById('armicDryRunBadge');
    if (badge) {
      badge.textContent = _dryRun ? 'DRY RUN — motors gated' : 'LIVE — motors will move';
      badge.className = _dryRun ? 'safety-badge dry' : 'safety-badge live';
    }
    const hint = document.getElementById('armicDryRunHint');
    if (hint) hint.hidden = !_dryRun;
  }

  function setLineHandler(fn) { _onLine = fn; }
  function dispatchRx(line) { if (typeof _onLine === 'function') _onLine(line); }

  // ---- commands ----------------------------------------------------------
  function sendProtocol(name) {
    // The old serial API folded stop/estop into "protocol"; keep that habit
    // working by routing them to their own events.
    if (name === 'stop')  return ui.send_message('halt', {});
    if (name === 'estop') return ui.send_message('estop', {});
    return ui.send_message('protocol', { name });
  }
  function sendExercise(name, reps = 6)          { ui.send_message('exercise', { name, reps: Number(reps) || 6 }); }
  function sendRouteStart(id)                    { ui.send_message('route_start', { id: String(id) }); }
  function sendRouteStop()                       { ui.send_message('route_stop', {}); }
  function sendTarget(x, y, z, pitch = 90)  { ui.send_message('target', { x, y, z, pitch }); }
  function sendJoints(b, sh, el, wr)        { ui.send_message('joints', { b, sh, el, wr }); }
  function sendPayload(kg)                  { ui.send_message('payload', { kg: Number(kg) }); }
  function sendGripper(pctOrCmd)            { ui.send_message('gripper', { pct: pctOrCmd }); }
  function sendPark()                       { ui.send_message('park', {}); }
  function sendEstop()                      { ui.send_message('estop', {}); }
  function sendRelease()                    { ui.send_message('release', {}); }
  function sendDryRun(on)                   { ui.send_message('dry_run', { on: !!on }); }
  function requestLimits()                  { ui.send_message('limits_get', {}); }
  function setLimit(joint, fields)          { ui.send_message('limits_set', Object.assign({ joint }, fields)); }
  function resetLimits(joint)               { ui.send_message('limits_reset', joint ? { joint } : {}); }

  // Kept for source compatibility with the old Web Serial API. The socket is
  // managed for us, so these are no-ops rather than errors.
  async function connect()    { return _connected; }
  async function disconnect() { return false; }
  async function send()       { console.warn('[armic] raw line send is not supported over WebSocket'); }

  return {
    connect, disconnect, send,
    sendProtocol, sendExercise, sendRouteStart, sendRouteStop,
    sendTarget, sendJoints, sendPayload, sendGripper,
    sendPark, sendEstop, sendRelease, sendDryRun,
    requestLimits, setLimit, resetLimits,
    setLineHandler, dispatchRx,
    get connected() { return _connected; },
    get dryRun() { return _dryRun; },
    get limits() { return _limits; },
  };
})();

// The old page exposed a global SerialBridge. A few call sites still reference
// it, so provide a shim backed by the socket instead of deleting them.
const SerialBridge = {
  get connected() { return ArmTransport.connected; },
  connect: () => ArmTransport.connect(),
  disconnect: () => ArmTransport.disconnect(),
  sendLine: (l) => ArmTransport.send(l),
};
