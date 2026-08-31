# armic-mpu / Python MPU Backend + LLM Agent

> 🚩 **DEPLOYS TO:** Arduino UNO Q MPU — `arduino:python` App Lab container (main.py + app.yaml) + shares `agent/` volume with `arduino:llm` container. Compose root = `Arduino Files/armic-brick/brick_compose.yaml`. Starts on boot.

![Armic on-device LLM agent — Qwen3.5 0.8B + 4 tool-use actions (protocol, list, suggest, show)](../Images/AI%20Node.png)

**Runs on:** Arduino UNO Q MPU (Qualcomm Dragonwing QRB2210 · Linux · App Lab container)  
**Bridge to MCU:** Router Bridge RPC — `Bridge.provide` + `Bridge.call` + `Bridge.notify`  
**LLM brick:** `arduino:llm` — Qwen3.5 0.8B on-device via llamacpp-runner  
**Ports:** 7000 (`arduino:web_ui` brick — REST + WebSocket + static assets) · 1883 (MQTT, mosquitto in ../Arduino Files/armic-brick/brick_compose.yaml)

This is the **AI brain + user interface layer**. It never writes a servo angle directly — it calls into the MCU firmware via Bridge RPC commands and subscribes to `on_state` telemetry @ 20 Hz.

## App Lab container status (3/3 containers UP on healthy boot)

![App Lab dashboard — 3 containers RUNNING: arduino:python, arduino:llm, arduino:web_ui — all green after brick compose up -d](../Images/applab.png)

## Agent boot sequence (visual states on the UI)

The LLM agent walks through 2 visible states before it's ready to adapt a session. This is the smoke-test sequence judges verify:

| State # | What the screen shows | When it transitions |
|---|---|---|
| **State 1 · Warming up** | Orange banner "ARMIC AGENT WARMING UP — llama.cpp model load + Router Bridge handshake" | ~8 s after boot while Qwen3.5 0.8B is loaded into RAM on the MPU side |
| → State 2 · **Ready** | Green banner "ARMIC AGENT READY — 4 tool-use actions registered, Bridge RPC handshake OK, telemetry 20 Hz subscribed" | After `llm_agent.__init__()` returns successfully AND first Bridge.notify telemetry tick arrives |

![ARMIC AGENT WARMING UP banner (orange) — llama.cpp model loading + Router Bridge handshake](../Images/warmingupagent.png)

![ARMIC AGENT READY banner (green) — 4 tool-use actions registered, Bridge telemetry 20 Hz live](../Images/agentready.png)

## Folder Map

```
Arduino Files/armic-mpu/
├── main.py                  # App Lab entry: registers web_ui + llm bricks + ws_handlers
├── app.yaml                 # App manifest. Port 7000. Bricks: arduino:web_ui, arduino:llm
├── config.py                # URLs, tick rates, bridge timeouts, dry_run post-boot default
├── context.py               # Global AppContext singleton (firmware handle + telemetry)
├── requirements.txt         # Pure-Python deps (numpy only needed for offline sim)
├── pyproject.toml           # Poetry / PEP-621 metadata
├── rehab_intent.py          # Chat intent classifier (LLM → protocol/exercise name)
├── rehab_routes.py          # Protocol/exercise catalog + speed caps (home 45°, rehab 18°/s)
├── route_runner.py          # HTL / orbital / cobra state machines on the MPU side
├── sanity.py                # pre-flight: cal loaded, motors OFF, telemetry streaming
├── telemetry.py             # 20 Hz pose → all subscribers (simulator, HUD, LLM)
├── mqtt_bridge.py           # wearable MQTT subscriber → armic/wearable/# → inference dict
├── ws_handlers/             # WebSocket per-feature:
│   ├── motion.py            # target x y z [pitch] + joints + payload + park + estop
│   ├── calibration.py       # get/set/stage/commit cal → roundtrip: Python → Firmware → disk
│   ├── agent.py             # LLM chat + .adapt() calls (soreness, fatigue, ROM changes)
│   ├── bench.py             # manual PWM/sweep/setup/release (SERVICE ONLY)
│   ├── common.py            # ws send/error helpers
│   └── registry.py          # ws action router
└── agent/                   # Autonomous Rehab Agent (llm_agent is the brain)
    ├── llm_agent.py         # Qwen3.5 0.8B prompt + session state + tool calls
    ├── tools.py             # Bridge wrapper functions exposed as LLM tool-use actions
    ├── session.py           # session_id, per-patient memory, rep counts, timestamps
    ├── protocol.py          # protocol/adaptation templates for the LLM to fill in
    ├── rehab_preview.py     # pre-visualise proposed angle changes in the simulator
    └── rehab_commentary.py  # LLM-generated per-rep encouragement (inject into HUD feed)
```

## Safety invariants upheld here

- **dry_run defaults TRUE** every time `main.py` boots. A patient carer must click "Enable Motors" in the settings UI (or the agent tool) to clear the gate. This means `python main.py` can never accidentally drive the arm just by being started.
- **The MPU cannot widen joint limits.** It can only *request* values within the band the MCU firmware enforces. If the MPU asks for 190° elbow the MCU clamps to 180° and returns `notify("warning", {type:"clamped", ...})`.
- **E-STOP is a broadcast**, not a function call — any WS client, the LLM, `sanity.py`, or the MCU watchdog can fire it and *all* layers respond: MPU → `estop()` call → MCU write-cache invalidated → PWM 0 → home park.

## Running locally (off-board simulator)

```bash
pip install -r requirements.txt
DRY_RUN=true python main.py        # simulator only, no Bridge connection required
# open http://localhost:7000/arm-simulator.html
```
