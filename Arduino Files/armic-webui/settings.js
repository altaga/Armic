// SPDX-FileCopyrightText: Armic project
//
// SPDX-License-Identifier: MPL-2.0
//
// Settings / calibration page logic.
//
// STAGING MODEL
// Editing a field stages it server-side (working copy only). Nothing reaches
// the arm or calibration.json until SAVE, which pushes, reads back to verify,
// and only then persists. The banner reflects whether staged edits exist.
//
// The bench tools are the opposite: they act on hardware immediately and never
// touch stored calibration.

const JOINT_CHANNELS = { base: 0, shoulder: 1, elbow: 2, wrist: 3, gripper: 4 };
const FIELDS = ['pwm_min', 'pwm_mid', 'pwm_max', 'ang_min', 'ang_max', 'dir', 'offset'];

const ui = new WebUI();

let committed = null;   // what the arm is running
let staged = null;      // uncommitted working copy, or null
let envelope = { pwm_min: 50, pwm_max: 600 };

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
function log(text) {
  const el = document.getElementById('log');
  if (!el) return;
  const ts = new Date().toLocaleTimeString();
  el.textContent = `${ts}  ${text}\n` + el.textContent;
  if (el.textContent.length > 6000) el.textContent = el.textContent.slice(0, 6000);
}

window.addEventListener('error', (e) => {
  log(`JS ERROR ${e.message} @ ${String(e.filename || '').split('/').pop()}:${e.lineno}`);
  try {
    ui.send_message('client_error', {
      message: String(e.message), source: 'settings.js',
      line: e.lineno || 0, col: e.colno || 0,
      stack: e.error && e.error.stack ? String(e.error.stack).slice(0, 500) : '',
    });
  } catch (_) { /* ignore */ }
});

// ---------------------------------------------------------------------------
// Calibration table
// ---------------------------------------------------------------------------
function activeCal() { return staged || committed; }

function localValidate(joint, v) {
  const errs = {};
  const pmin = +v.pwm_min, pmid = +v.pwm_mid, pmax = +v.pwm_max;
  if (!(pmin >= envelope.pwm_min)) errs.pwm_min = `min ${envelope.pwm_min}`;
  if (!(pmax <= envelope.pwm_max)) errs.pwm_max = `max ${envelope.pwm_max}`;
  if (!(pmin < pmid)) { errs.pwm_min = 'must be < mid'; errs.pwm_mid = 'must be > min'; }
  if (!(pmid < pmax)) { errs.pwm_mid = 'must be < max'; errs.pwm_max = 'must be > mid'; }
  const ceil = joint === 'gripper' ? 100 : 180;
  if (!(+v.ang_min >= 0)) errs.ang_min = '>= 0';
  if (!(+v.ang_max <= ceil)) errs.ang_max = `<= ${ceil}`;
  if (!(+v.ang_min < +v.ang_max)) { errs.ang_min = 'must be < max'; errs.ang_max = 'must be > min'; }
  if (joint !== 'gripper' && Math.abs(+v.offset) > 30) errs.offset = '|offset| <= 30';
  return errs;
}

function buildRows() {
  const tbody = document.getElementById('calRows');
  tbody.innerHTML = '';
  const cal = activeCal();
  if (!cal) return;

  Object.keys(JOINT_CHANNELS).forEach((joint) => {
    const v = cal[joint];
    if (!v) return;
    const base = committed ? committed[joint] : v;
    const errs = localValidate(joint, v);

    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="jname">${joint}</td><td class="ch">ch${JOINT_CHANNELS[joint]}</td>`;

    FIELDS.forEach((f) => {
      const td = document.createElement('td');
      if (f === 'dir') {
        if (joint === 'gripper') {
          td.innerHTML = '<span style="color:#666">n/a</span>';
        } else {
          const sel = document.createElement('select');
          sel.innerHTML = '<option value="1">+1</option><option value="-1">−1</option>';
          sel.value = String(+v.dir);
          // Direction is the one field where a wrong value sends the joint the
          // opposite way, so flag any change from the committed value hard.
          if (+v.dir !== +base.dir) sel.classList.add('flipped');
          sel.addEventListener('change', () => {
            if (+sel.value !== +base.dir &&
                !confirm(`Reverse the ${joint} direction?\n\nThis inverts the joint. Test with dry run ON before saving.`)) {
              sel.value = String(+base.dir);
              return;
            }
            stage(joint, { dir: +sel.value });
          });
          td.appendChild(sel);
        }
      } else if (joint === 'gripper' && f === 'offset') {
        td.innerHTML = '<span style="color:#666">n/a</span>';
      } else {
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.value = v[f];
        inp.step = (f === 'offset' || f.startsWith('ang')) ? '0.5' : '1';
        if (+v[f] !== +base[f]) inp.classList.add('edited');
        if (errs[f]) { inp.classList.add('bad'); inp.title = errs[f]; }
        inp.addEventListener('change', () => stage(joint, { [f]: +inp.value }));
        td.appendChild(inp);
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

function paintBanner() {
  const el = document.getElementById('banner');
  const dirty = !!staged;
  document.getElementById('saveBtn').disabled = !dirty;
  document.getElementById('revertBtn').disabled = !dirty;

  let anyBad = false;
  const cal = activeCal();
  if (cal) {
    Object.keys(JOINT_CHANNELS).forEach((j) => {
      if (cal[j] && Object.keys(localValidate(j, cal[j])).length) anyBad = true;
    });
  }

  if (anyBad) {
    el.className = 'banner err';
    el.textContent = 'Some values are out of range — fix the red fields before saving.';
    document.getElementById('saveBtn').disabled = true;
  } else if (dirty) {
    el.className = 'banner dirty';
    el.textContent = 'Unsaved edits staged. The arm is still using the previous calibration — press SAVE to apply.';
  } else {
    el.className = 'banner clean';
    el.textContent = 'Calibration matches the arm.';
  }
}

function stage(joint, fields) {
  ui.send_message('cal_stage', Object.assign({ joint }, fields));
}

// ---------------------------------------------------------------------------
// 3D view — mirrors the controller's scene (arm-simulator.html) so both pages
// show the same arm. Includes joint spheres, accent rings, gripper fingers
// that open/close with telemetry, pedestal with bolts, floor plate, shadows.
//
// Convention (locked): all joints at 90 deg => arm straight up. So the
// rendered rotation is (angle - 90) about the joint axis, and 90 - a for
// inverted joints (mathematically the same as -(a-90)).
// ---------------------------------------------------------------------------
const View = (() => {
  const L0 = 30, L1 = 90, L2 = 70, L3 = 50, FLOOR = 60, S = 0.04;
  let renderer, scene, camera, worldGroup;
  let baseGroup, shoulderGroup, elbowGroup, wristGroup, gripperGroup;
  let finger1, finger2;
  let ok = false;

  // Gripper animation state
  let _clawPct = 100;
  let _clawTween = null;

  function init() {
    const host = document.getElementById('view');
    if (!host || typeof THREE === 'undefined') return;
    const w = host.clientWidth, h = host.clientHeight;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x08080a);
    camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 200);
    camera.position.set(11, 8, 16);
    camera.lookAt(0, 6, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const dir = new THREE.DirectionalLight(0xffffff, 0.75);
    dir.position.set(9, 14, 7);
    scene.add(dir);
    scene.add(new THREE.GridHelper(40, 40, 0x444444, 0x222222));

    // ---- Materials (must match the controller) ----
    const jointMat  = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.7, roughness: 0.35 });
    const armMat    = new THREE.MeshStandardMaterial({ color: 0xd0d0d0, metalness: 0.5, roughness: 0.25 });
    const linkMat   = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.4, roughness: 0.4 });
    const accentMat = new THREE.MeshStandardMaterial({ color: 0x00ffcc, wireframe: true, opacity: 0.5, transparent: true, emissive: 0x003322 });
    const fingerMat = new THREE.MeshStandardMaterial({ color: 0xffaa00, metalness: 0.3, roughness: 0.5 });

    // ---- World: floor + pedestal + arm ----
    worldGroup = new THREE.Group();
    scene.add(worldGroup);

    // Pedestal: floor plate + tapered riser + 4 corner bolts
    const floorPlate = new THREE.Mesh(
      new THREE.CylinderGeometry(2.1, 2.4, 0.12, 32),
      new THREE.MeshStandardMaterial({ color: 0x1f232a, metalness: 0.5, roughness: 0.3 }));
    floorPlate.position.y = 0.06;
    floorPlate.castShadow = true;
    floorPlate.receiveShadow = true;
    worldGroup.add(floorPlate);

    const pedestalH = FLOOR * S;
    const pedestalStand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 2.0, pedestalH - 0.12, 32),
      new THREE.MeshStandardMaterial({ color: 0x2d323b, metalness: 0.5, roughness: 0.35 }));
    pedestalStand.position.y = (pedestalH + 0.12) / 2;
    worldGroup.add(pedestalStand);

    const boltMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.8, roughness: 0.2 });
    const boltGeom = new THREE.CylinderGeometry(0.08, 0.08, 0.12, 8);
    const boltR = 1.95;
    for (let b = 0; b < 4; b++) {
      const ang = (b * Math.PI) / 2 + Math.PI / 4;
      const bolt = new THREE.Mesh(boltGeom, boltMat);
      bolt.position.set(boltR * Math.cos(ang), 0.12, boltR * Math.sin(ang));
      worldGroup.add(bolt);
    }

    // Reach envelope (transparent sphere)
    const envelope = new THREE.Mesh(
      new THREE.SphereGeometry((L1 + L2 + L3) * S, 32, 24),
      new THREE.MeshPhongMaterial({ color: 0x00ffcc, transparent: true, opacity: 0.04, wireframe: true, depthWrite: false }));
    envelope.position.y = (FLOOR + L0) * S;
    worldGroup.add(envelope);

    // ---- Arm chain ----
    baseGroup = new THREE.Group();
    baseGroup.position.y = FLOOR * S;
    worldGroup.add(baseGroup);

    const l0Column = new THREE.Mesh(
      new THREE.CylinderGeometry(0.45, 0.55, L0 * S, 24), armMat);
    l0Column.position.y = (L0 * S) / 2;
    baseGroup.add(l0Column);

    shoulderGroup = new THREE.Group();
    shoulderGroup.position.y = L0 * S;
    baseGroup.add(shoulderGroup);
    shoulderGroup.add(new THREE.Mesh(new THREE.SphereGeometry(0.55, 24, 24), jointMat));
    shoulderGroup.add(new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 12), accentMat));
    const upperArm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.32, L1 * S, 24), armMat);
    upperArm.position.y = (L1 * S) / 2;
    shoulderGroup.add(upperArm);

    elbowGroup = new THREE.Group();
    elbowGroup.position.y = L1 * S;
    shoulderGroup.add(elbowGroup);
    elbowGroup.add(new THREE.Mesh(new THREE.SphereGeometry(0.45, 24, 24), jointMat));
    elbowGroup.add(new THREE.Mesh(new THREE.SphereGeometry(0.58, 16, 12), accentMat));
    const lowerArm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.28, L2 * S, 24), armMat);
    lowerArm.position.y = (L2 * S) / 2;
    elbowGroup.add(lowerArm);

    wristGroup = new THREE.Group();
    wristGroup.position.y = L2 * S;
    elbowGroup.add(wristGroup);
    wristGroup.add(new THREE.Mesh(new THREE.SphereGeometry(0.36, 20, 20), jointMat));
    wristGroup.add(new THREE.Mesh(new THREE.SphereGeometry(0.48, 16, 12), accentMat));
    const wristSegment = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.22, L3 * S, 20), armMat);
    wristSegment.position.y = (L3 * S) / 2;
    wristGroup.add(wristSegment);

    gripperGroup = new THREE.Group();
    gripperGroup.position.y = L3 * S;
    wristGroup.add(gripperGroup);
    const gripperBase = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.25, 0.4), linkMat);
    gripperBase.position.y = 0.1;
    gripperGroup.add(gripperBase);

    const fingerGeom = new THREE.BoxGeometry(0.18, 0.5, 0.1);
    finger1 = new THREE.Mesh(fingerGeom, fingerMat);
    finger1.position.set(0, 0.45, -0.3);
    gripperGroup.add(finger1);
    finger2 = new THREE.Mesh(fingerGeom, fingerMat);
    finger2.position.set(0, 0.45, +0.3);
    gripperGroup.add(finger2);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);

    [l0Column, upperArm, lowerArm, wristSegment, floorPlate, pedestalStand, ...worldGroup.children].forEach(() => {});
    // Enable shadows on the relevant meshes
    floorPlate.receiveShadow = true;
    [l0Column, upperArm, lowerArm, wristSegment].forEach(m => m.castShadow = true);
    dir.castShadow = true;
    dir.shadow.mapSize.width = 1024;
    dir.shadow.mapSize.height = 1024;
    dir.shadow.camera.near = 0.5;
    dir.shadow.camera.far = 50;

    ok = true;

    window.addEventListener('resize', () => {
      if (!ok) return;
      const nw = host.clientWidth, nh = host.clientHeight;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
      renderer.render(scene, camera);
    });
    setClawVisual(100);
    renderer.render(scene, camera);
  }

  // Match the controller's convention exactly so both views stay in lockstep.
  function setAngles(b, sh, el, wr) {
    if (!ok) return;
    const rad = Math.PI / 180;
    baseGroup.rotation.y     = (b - 90) * rad;
    shoulderGroup.rotation.z = (90 - sh) * rad;     // mathematically -(sh-90)
    elbowGroup.rotation.z    = -(el - 90) * rad;
    wristGroup.rotation.z    = (90 - wr) * rad;
    renderer.render(scene, camera);
  }

  function clawEase(u) {
    const t = Math.max(0, Math.min(1, u));
    return t * t * (3 - 2 * t);
  }

  function setClawVisual(pct) {
    _clawPct = Math.max(0, Math.min(100, Number(pct)));
    const spread = 0.10 + 0.22 * (_clawPct / 100);
    finger1.position.z = -spread;
    finger2.position.z = +spread;
    renderer.render(scene, camera);
  }

  function tweenClaw(targetPct) {
    const target = Math.max(0, Math.min(100, Number(targetPct)));
    if (_clawTween) { _clawTween.cancelled = true; _clawTween = null; }
    const start = _clawPct;
    const delta = target - start;
    if (Math.abs(delta) < 0.5) { setClawVisual(target); return; }
    const durationMs = Math.min(2000, Math.max(700, 500 + Math.abs(delta) * 12));
    const t0 = performance.now();
    const token = { cancelled: false };
    _clawTween = token;
    const step = (now) => {
      if (token.cancelled || !ok) return;
      const u = Math.min(1, (now - t0) / durationMs);
      setClawVisual(start + delta * clawEase(u));
      if (u < 1) requestAnimationFrame(step);
      else _clawTween = null;
    };
    requestAnimationFrame(step);
  }

  return {
    init,
    setAngles,
    setClawPercent(pct) { tweenClaw(pct); },
  };
})();

// ---------------------------------------------------------------------------
// Socket wiring
// ---------------------------------------------------------------------------
function applyCalPayload(p) {
  if (!p) return;
  committed = p.committed || committed;
  staged = p.staged || null;
  if (p.envelope) envelope = p.envelope;
  buildRows();
  paintBanner();
}

ui.on_connect(() => {
  document.getElementById('connState').textContent = 'connected';
  log('connected to board');
  ui.send_message('hello', {});
});

ui.on_disconnect(() => {
  document.getElementById('connState').textContent = 'disconnected';
  log('connection lost');
});

ui.on_message('hello', (d) => {
  if (!d) return;
  document.getElementById('dryRun').checked = !!d.dry_run;
  refreshProbeEnabled();
  if (d.calibration) applyCalPayload(d.calibration);
});

ui.on_message('calibration', applyCalPayload);

ui.on_message('state', (s) => {
  if (!s) return;
  document.getElementById('modeLabel').textContent = s.mode;
  const f = (v) => Number(v || 0).toFixed(1);
  document.getElementById('tBase').textContent = f(s.base);
  document.getElementById('tSh').textContent = f(s.shoulder);
  document.getElementById('tEl').textContent = f(s.elbow);
  document.getElementById('tWr').textContent = f(s.wrist);
  View.setAngles(s.base, s.shoulder, s.elbow, s.wrist);
  if (typeof s.claw === 'number' && Number.isFinite(s.claw)) {
    View.setClawPercent(s.claw);
  }
});

ui.on_message('ack', (a) => {
  if (!a) return;
  if (a.ok === false) {
    log(`REFUSED ${a.cmd}${a.reason ? ' — ' + a.reason : ''}`);
  } else if (a.cmd === 'cal_commit') {
    log('calibration SAVED and verified against the arm');
  } else if (a.cmd !== 'cal_stage') {
    log(`ok ${a.cmd}`);
  }
  if (a.cmd === 'dry_run' && a.ok) {
    document.getElementById('dryRun').checked = !!a.on;
    refreshProbeEnabled();
  }
});

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------
function refreshProbeEnabled() {
  const armed = document.getElementById('armProbe').checked;
  const gated = document.getElementById('dryRun').checked;
  const usable = armed && !gated;
  ['probePwm', 'probeWriteBtn', 'probeReleaseBtn', 'sweepBtn', 'sweepBackBtn']
    .forEach((id) => { document.getElementById(id).disabled = !usable; });
}

document.addEventListener('DOMContentLoaded', () => {
  View.init();

  document.getElementById('dryRun').addEventListener('change', (e) => {
    ui.send_message('dry_run', { on: e.target.checked });
    refreshProbeEnabled();
  });
  document.getElementById('armProbe').addEventListener('change', refreshProbeEnabled);

  document.getElementById('parkBtn').onclick = () => ui.send_message('park', {});
  document.getElementById('haltBtn').onclick = () => ui.send_message('halt', {});
  document.getElementById('estopBtn').onclick = () => ui.send_message('estop', {});

  document.getElementById('saveBtn').onclick = () => {
    if (confirm('Push this calibration to the arm and save it?\n\nThe arm will start using it immediately.')) {
      ui.send_message('cal_commit', {});
    }
  };
  document.getElementById('revertBtn').onclick = () => ui.send_message('cal_revert', {});
  document.getElementById('defaultsBtn').onclick = () => {
    if (confirm('Stage the original project defaults?\n\nYou still have to press SAVE to apply them.')) {
      ui.send_message('cal_defaults', {});
    }
  };
  document.getElementById('reloadBtn').onclick = () => ui.send_message('cal_get', {});

  const pwmSlider = document.getElementById('probePwm');
  const pwmVal = document.getElementById('probePwmVal');
  pwmSlider.addEventListener('input', () => { pwmVal.textContent = pwmSlider.value; });

  document.getElementById('probeWriteBtn').onclick = () => {
    const ch = +document.getElementById('probeCh').value;
    ui.send_message('pwm_write', { ch, value: +pwmSlider.value });
    log(`raw write ch${ch} = ${pwmSlider.value}`);
  };
  document.getElementById('probeReleaseBtn').onclick = () => {
    const ch = +document.getElementById('probeCh').value;
    ui.send_message('release_channel', { ch });
  };

  function doSweep(reverse) {
    const ch = +document.getElementById('probeCh').value;
    const a = +document.getElementById('sweepA').value;
    const b = +document.getElementById('sweepB').value;
    const ms = +document.getElementById('sweepMs').value;
    ui.send_message('sweep', { ch, from: reverse ? b : a, to: reverse ? a : b, ms });
    log(`sweep ch${ch} ${reverse ? b : a} -> ${reverse ? a : b} over ${ms}ms`);
  }
  document.getElementById('sweepBtn').onclick = () => doSweep(false);
  document.getElementById('sweepBackBtn').onclick = () => doSweep(true);

  document.getElementById('releaseAllBtn').onclick = () => {
    if (confirm('Cut torque to every servo?\n\nThe arm will go limp and fall.')) {
      ui.send_message('release', {});
    }
  };

  refreshProbeEnabled();
});