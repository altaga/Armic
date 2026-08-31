// SPDX-FileCopyrightText: Armic project
//
// SPDX-License-Identifier: MPL-2.0
//
// TEMP / hackathon only — MQTT wearable feed for M5 Core2 testing.
// Used by wearable-mqtt.html (standalone debug page).

const WearableMqttDebug = (() => {
  const ui = new WebUI();
  const MAX_LOG = 50;

  const statusEl = document.getElementById('wearableMqttStatus');
  const brokerEl = document.getElementById('wearableMqttBroker');
  const countEl = document.getElementById('wearableMqttCount');
  const lastEl = document.getElementById('wearableMqttLast');
  const detailEl = document.getElementById('wearableMqttDetail');
  const probsEl = document.getElementById('wearableMqttProbs');
  const logEl = document.getElementById('wearableMqttLog');
  const closeBtn = document.getElementById('wearableMqttClose');

  let broker = '—';
  let msgCount = 0;

  function ts() {
    return new Date().toLocaleTimeString([], { hour12: false });
  }

  function setStatus(text, kind) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className = 'status-pill' + (kind ? ' ' + kind : '');
  }

  function updateCount() {
    if (countEl) countEl.textContent = `Messages: ${msgCount}`;
  }

  function renderProbs(probabilities) {
    if (!probsEl || !probabilities || typeof probabilities !== 'object') {
      if (probsEl) probsEl.hidden = true;
      return;
    }
    const entries = Object.entries(probabilities).sort((a, b) => b[1] - a[1]);
    if (!entries.length) {
      probsEl.hidden = true;
      return;
    }
    const colors = ['#00ff66', '#ffaa00', '#ff3366', '#55aaff', '#cc88ff'];
    probsEl.innerHTML = '';
    entries.forEach(([name, val], i) => {
      const span = document.createElement('span');
      span.style.width = `${Math.max(2, Math.round(Number(val) * 100))}%`;
      span.style.background = colors[i % colors.length];
      span.title = `${name}: ${(Number(val) * 100).toFixed(1)}%`;
      probsEl.appendChild(span);
    });
    probsEl.hidden = false;
  }

  function formatDetail(p) {
    if (!p || !p.msg_type) return '';
    if (p.msg_type === 'inference') {
      const lines = [
        `Device: ${p.device_id}`,
        `Exercise: ${p.exercise} · rep ${p.rep}`,
        `Confidence: ${(Number(p.confidence || 0) * 100).toFixed(1)}%`,
      ];
      if (p.inference_ms != null) lines.push(`EI latency: ${p.inference_ms} ms`);
      return lines.join(' · ');
    }
    if (p.msg_type === 'heartbeat') {
      return `Device: ${p.device_id} · RSSI ${p.wifi_rssi ?? '?'} · EI ${p.ei_ready ? 'ready' : 'not ready'}`;
    }
    return `${p.msg_type} · ${p.device_id}`;
  }

  function formatLast(data) {
    if (!data || !data.payload) return '—';
    const p = data.payload;
    if (p.msg_type === 'inference') {
      return String(p.label || 'unknown');
    }
    if (p.msg_type === 'heartbeat') return '♥ heartbeat';
    if (p.msg_type === 'rep_start') return `▶ rep ${p.rep} start`;
    if (p.msg_type === 'rep_end') return `■ rep ${p.rep} end`;
    if (p.msg_type === 'session_change') return `↻ session ${p.exercise} rep=${p.rep}`;
    return String(p.msg_type);
  }

  function appendLog(line, kind) {
    if (!logEl) return;
    const row = document.createElement('div');
    row.className = 'log-row' + (kind ? ' ' + kind : '');
    row.textContent = line;
    const placeholder = logEl.querySelector('.log-row.sys');
    if (placeholder && msgCount === 0) placeholder.remove();
    logEl.prepend(row);
    while (logEl.children.length > MAX_LOG) {
      logEl.removeChild(logEl.lastChild);
    }
  }

  function onMessage(data) {
    if (!data) return;

    if (data.connected && data.broker) {
      broker = data.broker;
      if (brokerEl) brokerEl.textContent = `Broker: ${broker}`;
      setStatus('Orchestrator subscribed', 'ok');
      appendLog(`[${ts()}] Python MQTT bridge connected (${broker})`, 'sys');
      return;
    }

    if (!data.payload) return;
    msgCount += 1;
    updateCount();

    const p = data.payload;
    const topic = data.topic || '?';
    const line = `[${ts()}] ${topic} → ${formatLast(data)}${p.exercise ? ` (${p.exercise} r${p.rep})` : ''}`;

    if (lastEl) lastEl.textContent = formatLast(data);
    if (detailEl) detailEl.textContent = formatDetail(p);

    let kind = '';
    if (p.msg_type === 'inference') {
      kind = p.label === 'good' ? 'ok' : 'warn';
      renderProbs(p.probabilities);
      setStatus(`Receiving · ${p.label}`, kind === 'ok' ? 'ok' : 'warn');
    } else if (p.msg_type === 'heartbeat') {
      setStatus('Wearable online', 'ok');
      renderProbs(null);
    } else {
      setStatus(`RX: ${p.msg_type}`, 'ok');
    }

    appendLog(line, kind);
  }

  ui.on_message('wearable_mqtt', onMessage);
  ui.on_connect(() => setStatus('WebSocket connected', 'busy'));
  ui.on_disconnect(() => setStatus('WebSocket disconnected', 'err'));

  if (closeBtn) {
    const panel = document.getElementById('wearableMqttDebug');
    closeBtn.addEventListener('click', () => {
      if (panel) panel.hidden = true;
    });
  }

  setStatus('Connecting…', 'busy');
  return {};
})();
