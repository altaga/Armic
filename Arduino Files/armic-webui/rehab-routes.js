// SPDX-FileCopyrightText: Armic project
//
// SPDX-License-Identifier: MPL-2.0
//
// Rehab route picker — runs preset multi-exercise sessions from the UI or agent.

const RehabRoutes = (() => {
  let _routes = [];
  let _bound = false;

  const el = (id) => document.getElementById(id);

  function stepSummary(steps) {
    return (steps || [])
      .map((s) => `${s.label || s.exercise} ×${s.reps}`)
      .join(' → ');
  }

  function renderCards(routes) {
    const host = el('routeCards');
    if (!host) return;
    host.innerHTML = '';
    routes.forEach((r) => {
      const card = document.createElement('div');
      card.className = 'route-card';
      card.innerHTML = `
        <div class="route-card-title">${r.title}</div>
        <div class="route-card-meta">${r.summary}</div>
        <div class="route-card-steps">${stepSummary(r.steps)}</div>
        <button type="button" class="primary route-run-btn" data-route-id="${r.id}">Run route</button>
      `;
      host.appendChild(card);
    });
    host.querySelectorAll('.route-run-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (typeof ArmTransport !== 'undefined') {
          ArmTransport.sendRouteStart(btn.dataset.routeId);
        }
      });
    });
  }

  function paintStatus(status) {
    const bar = el('routeStatusBar');
    if (!bar || !status) return;
    if (!status.running) {
      bar.textContent = 'No route running.';
      bar.className = 'route-status-bar idle';
      return;
    }
    bar.className = 'route-status-bar active';
    const phase = status.phase;
    if (phase === 'patient_turn') {
      bar.textContent = `Exercise ${status.step_index}/${status.step_total} — your turn (${status.reps} reps)`;
      return;
    }
    if (phase === 'arm_demo') {
      bar.textContent = `Exercise ${status.step_index}/${status.step_total} — watch the arm`;
      return;
    }
    if (phase === 'celebration') {
      bar.textContent = 'Routine complete — gimme five!';
      return;
    }
    const parts = [status.route_title || status.route_id];
    if (status.step_total) parts.push(`step ${status.step_index}/${status.step_total}`);
    if (status.message) parts.push(status.message);
    bar.textContent = parts.join(' · ');
  }

  function bind(ui) {
    if (_bound) return;
    _bound = true;
    ui.on_message('hello', (d) => {
      if (d && Array.isArray(d.routes)) {
        _routes = d.routes;
        renderCards(_routes);
      }
    });
    ui.on_message('route_status', paintStatus);
    const stopBtn = el('routeStopBtn');
    if (stopBtn) {
      stopBtn.addEventListener('click', () => {
        if (typeof ArmTransport !== 'undefined') ArmTransport.sendRouteStop();
      });
    }
  }

  return { bind, renderCards, paintStatus };
})();
