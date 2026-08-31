# armic-webui / Browser UI + Three.js Digital Twin

> 🚩 **DEPLOYS TO:** Arduino UNO Q MPU — inside `arduino:web_ui` App Lab container (static assets) + served by `armic-mpu` FastAPI, port 7000. Works offline, no CDN needed.

![Armic main UI landing page — telemetry table + 20 Hz pose heartbeats + last rep badge](../Images/mainUI.png)

**Served by:** `armic-mpu` via `arduino:web_ui` brick (port 7000, static assets dir)  
**Transport:** Socket.IO client (`libs/socket.io.min.js`) talking to the Python MPU backend  
**Libraries vendored locally (no CDN required on UNO Q):** `three.min.js` r160, `arduino.js` (web_ui brick API), `socket.io.min.js`

All pages work off the same `state` push subscription @ 20 Hz. The simulator and the HUD are *subscribers*, they never originate motion (that privilege is reserved for `ws_handlers` in the MPU).

## Pages

| File | Purpose |
|---|---|
| [index.html](index.html) | Telemetry landing + 20 Hz pose table + last-message heartbeat indicator |
| [settings.html](settings.html) | **Calibration UI** (staged angles, verify roundtrip, commit to cal.json), dry-run motor gate, E-STOP button, restore defaults |
| [arm-simulator.html](arm-simulator.html) | **Three.js 3D digital twin** — FK-matched robot geometry (60-30-90-70-50 mm link lengths), mirrors real pose every tick. Poses selectable from dropdown. |
| [wearable-mqtt.html](wearable-mqtt.html) | Debug page for the 6-topic wearable MQTT contract — shows inference JSON live, rep counter, confidence bar, session_id |

## JS modules (one per feature, loaded by the HTML pages)

| File | Owns |
|---|---|
| [arm-control.js](arm-control.js) | `target x y z pitch` / `joints` / `payload` / `park` / `estop` WS callers |
| [calibration-client.js](calibration-client.js) | get → stage → commit roundtrip with MCU verification step |
| [arm-simulator.html → inline 3D scene](arm-simulator.html) | Three.js setup, 5-link FK chain, pose subscriber |
| [exercise-hud.js](exercise-hud.js) | bicep / lateral / elbowflex rep progress + LLM commentary feed |
| [agent-chat.js](agent-chat.js) | Chat UI for `llm_agent` — prompt, tool-call rendering, adaptation proposals |
| [route-progress.js](route-progress.js) | HTL/orbital/cobra FSM stage indicator |
| [rehab-routes.js](rehab-routes.js) | `exercise <name>` + `protocol <name>` WS wrappers |
| [sanity-ui.js](sanity-ui.js) | Preflight checklist UI (cal loaded, dry_run on, telemetry OK, broker conn OK) |
| [s_curve.js](s_curve.js) | 7-segment S-curve reference (for simulator overlay + motion preview) |
| [telemetry.js](telemetry.js) | Shared Socket.IO connection, subscribe/unsubscribe helpers |
| [transport.js](transport.js) | Bridge-wait + reconnect loop (UNO Q → browser reconnects) |
| [wearable-mqtt-debug.js](wearable-mqtt-debug.js) | Subscribe to armic/wearable/#, JSON pretty-print of every topic |
| [pipeline.js](pipeline.js) | Dev-only: visualise plan→IK→derate→profile→write stages live |
| [settings.js](settings.js) | Settings page save/restore |

## Offline use (no UNO Q)

Open the files directly in a browser and `telemetry.js` will fall back to a generated-sine-wave synthetic pose feed so the twin and HUD still render.
