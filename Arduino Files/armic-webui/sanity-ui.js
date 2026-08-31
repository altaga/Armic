// SPDX-FileCopyrightText: Armic project
//
// SPDX-License-Identifier: MPL-2.0
//
// Bridge + MQTT sanity indicators for the arm controller dashboard.

const SanityUi = (() => {
  const bridgeDot = () => document.getElementById('bridgeSanityDot');
  const bridgeText = () => document.getElementById('bridgeSanityText');
  const mqttDot = () => document.getElementById('mqttSanityDot');
  const mqttText = () => document.getElementById('mqttSanityText');
  let _bound = false;

  function paintRow(dotEl, textEl, item, fallbackLabel) {
    if (!dotEl || !textEl) return;
    const status = item && item.status ? item.status : 'warn';
    dotEl.className = 'sanity-dot ' + status;
    const detail = item && item.detail ? item.detail : 'checking…';
    textEl.textContent = detail;
    dotEl.title = `${fallbackLabel}: ${detail}`;
  }

  function paint(data) {
    if (!data) return;
    paintRow(bridgeDot(), bridgeText(), data.bridge, 'Bridge');
    paintRow(mqttDot(), mqttText(), data.mqtt, 'MQTT');
  }

  function bind(ui) {
    if (_bound) return;
    _bound = true;
    ui.on_message('system_sanity', paint);
    ui.on_message('hello', (d) => {
      if (d && d.sanity) paint(d.sanity);
    });
  }

  return { paint, bind };
})();
