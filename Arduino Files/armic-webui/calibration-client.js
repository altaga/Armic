// SPDX-FileCopyrightText: Armic project
//
// SPDX-License-Identifier: MPL-2.0
//
// Calibration client — makes the browser follow the board's saved calibration
// instead of its own hardcoded copy.
//
// WHY THIS EXISTS
// The calibration used to live in three places that agreed only by luck:
// the firmware's `joints::` table, this page's JOINTS/RESTRICTIONS/CLAW_PWM_*,
// and the persisted file. Editing one left the others stale, which shows up as
// a simulator that disagrees with the real arm. Now the board is authoritative
// and this file pulls from it.
//
// Loaded by both arm-simulator.html and settings.html.
const ArmicCal = (() => {
  // NOTE: the endpoint is /calibration, NOT /api/calibration. The web_ui brick
  // README claims an /api prefix but the bundled example fetches with no
  // prefix, and only the unprefixed path actually resolves.
  const ENDPOINT = '/calibration';

  let _last = null;
  const _listeners = [];

  // Map our storage keys onto the names pipeline.js already uses.
  function toPipelineJoint(c) {
    return {
      pmin: c.pwm_min, pmid: c.pwm_mid, pmax: c.pwm_max,
      amin: 0, amid: 90, amax: 180,          // angle convention, not calibration
      smin: c.ang_min, smax: c.ang_max,
      dir: c.dir,
    };
  }

  function applyCalibration(cal) {
    if (!cal) return;
    _last = cal;

    // 1. pipeline.js conversion table — patch in place so any closure already
    //    holding a reference sees the new values.
    if (typeof window.JOINTS === 'object' && window.JOINTS) {
      ['base', 'shoulder', 'elbow', 'wrist'].forEach((j) => {
        if (!cal[j] || !window.JOINTS[j]) return;
        Object.assign(window.JOINTS[j], toPipelineJoint(cal[j]));
      });
    }

    // 2. Joint angle bands used by inBand() for the warn colouring.
    if (typeof window.RESTRICTIONS === 'object' && window.RESTRICTIONS) {
      ['base', 'shoulder', 'elbow', 'wrist'].forEach((j) => {
        if (!cal[j] || !window.RESTRICTIONS[j]) return;
        window.RESTRICTIONS[j].min = cal[j].ang_min;
        window.RESTRICTIONS[j].max = cal[j].ang_max;
      });
    }

    // 3. Gripper PWM constants.
    if (cal.gripper) {
      window.CLAW_PWM_CLOSED = cal.gripper.pwm_min;
      window.CLAW_PWM_MID = cal.gripper.pwm_mid;
      window.CLAW_PWM_OPEN = cal.gripper.pwm_max;
    }

    applyToDom(cal);
    applyToBadges(cal);

    _listeners.forEach((fn) => {
      try { fn(cal); } catch (e) { console.warn('[armic-cal] listener failed', e); }
    });
  }

  // The sliders carry their ranges as DOM attributes, so they need updating
  // too — otherwise the UI would silently refuse values the arm now accepts.
  function applyToDom(cal) {
    ['base', 'shoulder', 'elbow', 'wrist'].forEach((j) => {
      const c = cal[j];
      if (!c) return;
      const s = document.getElementById(j + 'Slider');
      if (s) {
        s.min = c.pwm_min;
        s.max = c.pwm_max;
      }
      const d = document.getElementById(j + 'Deg');
      if (d) {
        d.min = c.ang_min;
        d.max = c.ang_max;
      }
    });

    const g = cal.gripper;
    if (g) {
      // Refresh the visible strings that embed the gripper numbers, so the
      // help text cannot contradict the actual calibration.
      setText('clawRangeLabel', `${g.pwm_min} closed → ${g.pwm_max} open`);
      setText('clawHelpLabel',
        `0%→${g.pwm_min} closed · 50%→${g.pwm_mid} · 100%→${g.pwm_max} open`);
    }
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  // The original arm-simulator.html hardcoded `dir` badges (D / I) into the
  // slider labels, which silently lied — wrist is inverted in the firmware but
  // was labeled D in the HTML. We overwrite them at load so the badge always
  // reflects the loaded calibration. Settings page is data-driven already.
  function applyToBadges(cal) {
    ['base', 'shoulder', 'elbow', 'wrist'].forEach((j) => {
      const el = document.getElementById('dir-badge-' + j);
      const c = cal[j];
      if (!el || !c) return;
      const inverted = +c.dir < 0;
      el.classList.toggle('dir-I', inverted);
      el.classList.toggle('dir-D', !inverted);
      el.textContent = inverted ? 'I' : 'D';
    });
  }

  async function load() {
    try {
      const res = await fetch(ENDPOINT, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = await res.json();
      // Follow the committed values — never the staged working copy, which by
      // definition is not what the arm is running.
      applyCalibration(payload.committed || null);
      return payload;
    } catch (e) {
      // Non-fatal: the page keeps its built-in fallbacks. Say so loudly though,
      // because a silent failure here means the sim and the arm disagree.
      console.warn('[armic-cal] could not load calibration, using page defaults:', e);
      return null;
    }
  }

  function onApplied(fn) { _listeners.push(fn); }

  return { load, applyCalibration, onApplied, get last() { return _last; } };
})();

// Run after the inline page scripts have defined JOINTS / RESTRICTIONS /
// CLAW_PWM_*, which happens before DOMContentLoaded fires.
document.addEventListener('DOMContentLoaded', () => { ArmicCal.load(); });
