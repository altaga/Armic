// SPDX-FileCopyrightText: Armic project
//
// SPDX-License-Identifier: MPL-2.0
//
// Floating chat widget — streams replies from the on-board arduino:llm agent.

const AgentChat = (() => {
  const ui = new WebUI();

  // --- state ---
  let panelOpen = false;
  let busy = false;
  let agentReady = false;
  let activeReply = '';
  let activeBubble = null;
  let routeRunning = false;
  let lastRouteStatus = null;
  let rehabPreviewActive = false;
  let deferredRoutes = null;

  // --- DOM ---
  const fab = document.getElementById('agentChatFab');
  const panel = document.getElementById('agentChatPanel');
  const log = document.getElementById('agentChatLog');
  const input = document.getElementById('agentChatInput');
  const sendBtn = document.getElementById('agentChatSend');
  const stopBtn = document.getElementById('agentChatStop');
  const clearBtn = document.getElementById('agentChatClear');
  const expandBtn = document.getElementById('agentChatExpand');
  const resizeHandle = document.getElementById('agentChatResize');
  const status = document.getElementById('agentChatStatus');

  const STORAGE_EXPANDED = 'armicChatExpanded';
  const STORAGE_SIZE = 'armicChatSize';

  let resizing = false;
  let resizeStartX = 0;
  let resizeStartY = 0;
  let resizeStartW = 0;
  let resizeStartH = 0;

  function setStatus(text, kind) {
    if (!status) return;
    status.textContent = text;
    status.className = 'agent-chat-status' + (kind ? ' ' + kind : '');
  }

  function scrollLog() {
    if (log) log.scrollTop = log.scrollHeight;
  }

  function routeMetaLine(steps) {
    if (!Array.isArray(steps) || !steps.length) return '';
    const reps = steps[0] && steps[0].reps;
    const names = steps
      .map((s) => String(s.label || s.exercise || '').split(' ')[0])
      .join(' · ');
    return reps ? `${names} · ${reps} reps each` : names;
  }

  function clearActiveStreamBubble() {
    if (activeBubble) {
      activeBubble.remove();
      activeBubble = null;
    }
    activeReply = '';
  }

  function startRoute(routeId, btn) {
    if (!routeId || routeRunning) return;
    if (typeof ArmTransport === 'undefined' || !ArmTransport.connected) {
      appendBubble('assistant error', 'Not connected to the arm yet. Wait for the link, then press Execute again.');
      return;
    }
    ArmTransport.sendRouteStart(routeId);
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Starting…';
    }
  }

  function routeButtonLabel(status) {
    if (!status || !status.running) return 'Execute';
    return 'Running…';
  }

  function updateRouteButtons(status) {
    if (status !== undefined) lastRouteStatus = status;
    routeRunning = !!(lastRouteStatus && lastRouteStatus.running);
    document.querySelectorAll('.agent-route-execute').forEach((btn) => {
      const rid = btn.dataset.routeId;
      if (routeRunning && lastRouteStatus && lastRouteStatus.route_id === rid) {
        btn.disabled = true;
        btn.textContent = routeButtonLabel(lastRouteStatus);
      } else if (routeRunning) {
        btn.disabled = true;
      } else {
        btn.disabled = false;
        btn.textContent = 'Execute';
      }
    });
  }

  function buildRouteCard(route) {
    const card = document.createElement('div');
    card.className = 'agent-route-card';
    card.dataset.routeId = route.id || '';
    card.innerHTML = `
      <div class="agent-route-title">${route.title || route.id || 'Route'}</div>
      <div class="agent-route-meta">${routeMetaLine(route.steps)}</div>
      <button type="button" class="agent-route-execute primary" data-route-id="${route.id}">Execute</button>
    `;
    const btn = card.querySelector('.agent-route-execute');
    if (btn) btn.addEventListener('click', () => startRoute(route.id, btn));
    return card;
  }

  function appendRouteCards(routes) {
    if (!log || !Array.isArray(routes) || !routes.length) return;
    const wrap = document.createElement('div');
    wrap.className = 'agent-chat-routes';
    routes.forEach((r) => wrap.appendChild(buildRouteCard(r)));
    log.appendChild(wrap);
    updateRouteButtons();
    scrollLog();
  }

  function flushDeferredRoutes() {
    if (!deferredRoutes || !deferredRoutes.length) return;
    appendRouteCards(deferredRoutes);
    deferredRoutes = null;
  }

  function handlePreviewRoutes(routes) {
    if (!routes.length) return;
    if (busy || activeBubble) {
      deferredRoutes = routes;
      return;
    }
    appendRouteCards(routes);
  }

  function appendBubble(role, text) {
    if (!log) return null;
    const el = document.createElement('div');
    el.className = 'agent-chat-bubble ' + role;
    el.textContent = text;
    log.appendChild(el);
    scrollLog();
    return el;
  }

  function setPanelOpen(open) {
    panelOpen = open;
    if (panel) {
      panel.classList.toggle('open', panelOpen);
      panel.setAttribute('aria-hidden', panelOpen ? 'false' : 'true');
    }
    if (fab) fab.setAttribute('aria-expanded', panelOpen ? 'true' : 'false');
    if (panelOpen && input) input.focus();
  }

  function isExpanded() {
    return !!(panel && panel.classList.contains('expanded'));
  }

  function clearCustomSize() {
    if (!panel) return;
    panel.classList.remove('custom-size');
    panel.style.width = '';
    panel.style.height = '';
    try { localStorage.removeItem(STORAGE_SIZE); } catch (_) { /* ignore */ }
  }

  function setExpanded(expanded, persist = true) {
    if (!panel || !expandBtn) return;
    panel.classList.toggle('expanded', expanded);
    expandBtn.setAttribute('aria-pressed', expanded ? 'true' : 'false');
    expandBtn.title = expanded ? 'Compact view' : 'Expand for reading';
    expandBtn.setAttribute('aria-label', expanded ? 'Compact chat' : 'Expand chat');
    if (!expanded) clearCustomSize();
    if (persist) {
      try { localStorage.setItem(STORAGE_EXPANDED, expanded ? '1' : '0'); } catch (_) { /* ignore */ }
    }
  }

  function applyStoredLayout() {
    if (!panel) return;
    try {
      const raw = localStorage.getItem(STORAGE_SIZE);
      if (raw) {
        const size = JSON.parse(raw);
        const w = Number(size && size.w);
        const h = Number(size && size.h);
        if (w >= 300 && h >= 260) {
          panel.style.width = `${w}px`;
          panel.style.height = `${h}px`;
          panel.classList.add('custom-size');
          setExpanded(true, false);
          return;
        }
      }
      if (localStorage.getItem(STORAGE_EXPANDED) === '1') {
        setExpanded(true, false);
      }
    } catch (_) { /* ignore */ }
  }

  function onResizeMove(e) {
    if (!resizing || !panel) return;
    const dx = resizeStartX - e.clientX;
    const dy = resizeStartY - e.clientY;
    const maxW = window.innerWidth - 24;
    const maxH = window.innerHeight - 88;
    const w = Math.min(maxW, Math.max(300, resizeStartW + dx));
    const h = Math.min(maxH, Math.max(260, resizeStartH + dy));
    panel.style.width = `${w}px`;
    panel.style.height = `${h}px`;
  }

  function onResizeEnd() {
    if (!resizing) return;
    resizing = false;
    document.removeEventListener('mousemove', onResizeMove);
    document.removeEventListener('mouseup', onResizeEnd);
    document.body.style.userSelect = '';
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    panel.classList.add('custom-size', 'expanded');
    setExpanded(true, false);
    try {
      localStorage.setItem(STORAGE_SIZE, JSON.stringify({
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      }));
      localStorage.setItem(STORAGE_EXPANDED, '1');
    } catch (_) { /* ignore */ }
  }

  function startResize(e) {
    if (!panel) return;
    e.preventDefault();
    resizing = true;
    const rect = panel.getBoundingClientRect();
    resizeStartX = e.clientX;
    resizeStartY = e.clientY;
    resizeStartW = rect.width;
    resizeStartH = rect.height;
    panel.classList.add('expanded', 'custom-size');
    setExpanded(true, false);
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onResizeMove);
    document.addEventListener('mouseup', onResizeEnd);
  }

  function setBusy(next) {
    busy = next;
    if (sendBtn) sendBtn.disabled = busy || !agentReady;
    if (input) input.disabled = busy || !agentReady;
    if (stopBtn) stopBtn.disabled = !busy;
  }

  function setAgentReady(ready, warming) {
    agentReady = !!ready;
    if (agentReady) setStatus('Agent ready', 'ok');
    else if (warming) setStatus('Warming up LLM…', 'busy');
    else setStatus('LLM not ready', 'err');
    setBusy(busy);
  }

  function showRoutePreset(btn) {
    if (!btn || busy) return;
    const routeId = btn.dataset.routeId || '';
    const prompt = (btn.dataset.prompt || '').trim();
    const label = (btn.textContent || routeId).trim();
    if (!routeId) return;

    setPanelOpen(true);
    appendBubble('user', prompt || `${label} routine`);
    activeReply = '';
    activeBubble = appendBubble('assistant streaming', '…');
    setBusy(true);
    setStatus('Reviewing routine…', 'busy');
    ui.send_message('agent_show_route', {
      route_id: routeId,
      message: prompt || `${label} routine`,
    });
  }

  function sendPrompt() {
    if (!input || busy) return;
    const message = input.value.trim();
    if (!message) return;

    input.value = '';
    rehabPreviewActive = false;
    appendBubble('user', message);
    activeReply = '';
    activeBubble = appendBubble('assistant streaming', '…');
    setBusy(true);
    setStatus('Thinking…', 'busy');
    ui.send_message('agent_prompt', { message });
  }

  function finishStream() {
    rehabPreviewActive = false;
    if (activeBubble) {
      activeBubble.classList.remove('streaming');
      activeBubble.textContent = activeReply || '(no reply)';
    }
    activeBubble = null;
    activeReply = '';
    flushDeferredRoutes();
    setBusy(false);
    if (agentReady) setStatus('Agent ready', 'ok');
  }

  function showError(message) {
    rehabPreviewActive = false;
    deferredRoutes = null;
    if (activeBubble) {
      activeBubble.classList.remove('streaming');
      activeBubble.classList.add('error');
      activeBubble.textContent = message;
    } else {
      appendBubble('assistant error', message);
    }
    activeBubble = null;
    setBusy(false);
    setStatus('Error', 'err');
  }

  // --- WebSocket events ---
  ui.on_message('agent_status', (data) => {
    const d = data || {};
    if (d.ready) setAgentReady(true, false);
    else if (d.warming) setAgentReady(false, true);
    else setAgentReady(false, false);
  });

  ui.on_message('hello', (data) => {
    if (!data) return;
    if (data.agent_ready) setAgentReady(true, false);
    else if (data.agent_warming) setAgentReady(false, true);
    else setAgentReady(false, false);
    if (data.route_status) updateRouteButtons(data.route_status);
  });

  ui.on_message('ack', (a) => {
    if (!a || a.cmd !== 'route') return;
    if (a.ok === false) {
      updateRouteButtons({ running: false });
      if (typeof RouteProgress !== 'undefined') RouteProgress.paint(null);
      const msg = a.message || a.reason || 'Could not start the route.';
      appendBubble('assistant error', msg);
    }
  });

  ui.on_message('route_status', (data) => {
    updateRouteButtons(data || null);
  });

  ui.on_message('route_congrats', (data) => {
    const msg = (data && data.message) ? String(data.message) : 'Good job!';
    setPanelOpen(true);
    appendBubble('assistant', msg);
    setStatus('Routine complete', 'ok');
    scrollLog();
  });

  ui.on_message('agent_response', (data) => {
    const chunk = (data && data.text) ? String(data.text) : '';
    if (!chunk) return;
    activeReply += chunk;
    if (!activeBubble) {
      activeBubble = appendBubble('assistant streaming', activeReply);
    } else {
      activeBubble.classList.remove('streaming');
      activeBubble.textContent = activeReply;
    }
    scrollLog();
  });

  ui.on_message('agent_stream_end', finishStream);
  ui.on_message('agent_routes', (data) => {
    if (data && data.preview) {
      const routes = Array.isArray(data.routes) ? data.routes : [];
      handlePreviewRoutes(routes);
      return;
    }
    if (data && Array.isArray(data.routes)) {
      appendRouteCards(data.routes);
    }
  });
  ui.on_message('agent_error', (data) => {
    const msg = (data && data.error) ? String(data.error) : 'LLM error';
    showError(msg);
  });

  ui.on_message('agent_chat_cleared', () => {
    if (log) log.innerHTML = '';
    rehabPreviewActive = false;
    deferredRoutes = null;
    clearActiveStreamBubble();
    setBusy(false);
    if (agentReady) setStatus('Agent ready — new conversation', 'ok');
  });

  ui.on_connect(() => {
    ui.send_message('hello', {});
  });
  ui.on_disconnect(() => setStatus('Disconnected', 'err'));

  // --- UI wiring ---
  if (fab) fab.addEventListener('click', () => setPanelOpen(!panelOpen));
  if (expandBtn) {
    expandBtn.addEventListener('click', () => setExpanded(!isExpanded()));
  }
  if (resizeHandle) resizeHandle.addEventListener('mousedown', startResize);
  applyStoredLayout();
  document.querySelectorAll('.agent-chat-preset').forEach((btn) => {
    btn.addEventListener('click', () => showRoutePreset(btn));
  });
  if (sendBtn) sendBtn.addEventListener('click', sendPrompt);
  if (clearBtn) clearBtn.addEventListener('click', () => ui.send_message('agent_clear', {}));
  if (stopBtn) stopBtn.addEventListener('click', () => ui.send_message('agent_stop', {}));
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendPrompt();
      }
    });
  }

  setAgentReady(false, true);
  return { setOpen: setPanelOpen };
})();
