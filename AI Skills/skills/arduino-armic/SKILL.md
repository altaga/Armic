---
name: arduino-armic
description: >-
  Develop and debug the Armic 4DOF rehab arm app on UNO Q. Use for
  arm-simulator.html, PCA9685 sketch, MQTT wearable, rehab protocols,
  calibration, dry-run safety, LLM agent, or any work under ~/ArduinoApps/armic/.
version: 1.0.1
---

# arduino-armic — main project

**Path:** `~/ArduinoApps/armic/`  
**Primary UI:** `http://<board-ip>:7000/arm-simulator.html` (discover IP with `hostname -I`)

Network names for MQTT/mDNS live in `python/config.py` — **read that file**; do not
hardcode them in skills or rules.

## Architecture (do not invert)

```
Browser ──WebSocket──► python/main.py ──Bridge──► sketch/ ──I²C──► PCA9685 ──► servos
```

| Layer | Location | Owns motion? |
|-------|----------|--------------|
| `sketch/` | MCU | **Yes** — IK, planner, PWM, limits, 100 Hz loop |
| `bricks/armic/` | MPU (Python brick) | Command API, telemetry, limits memory |
| `python/main.py` | MPU | Glue only — WebSocket ↔ Bridge |
| `assets/` | Browser | `arm-simulator.html`, settings, Three.js twin |

Motion **must** stay on the MCU. If Python dies, the arm must hold safely.

## Key URLs (port 7000)

| Page | Path |
|------|------|
| Arm controller | `/arm-simulator.html` |
| Settings / calibration | `/settings.html` |
| Wearable MQTT view | `/wearable-mqtt.html` |
| Root redirect | `/` → `arm-simulator.html` |

App Lab **Run** typically opens the **IP** URL from app logs — that is expected.

## Hardware gotchas

- PCA9685 on **`Wire2`** (i2c3), address `0x40` (also `0x70` all-call).
- **OE on pin 17** — no `A3` macro; use pin number from devicetree.
- External servo supply required; common ground with the board.

## Safety (read before changing firmware)

1. **Dry run** gates motors after Python starts; firmware may still `parkHome()` once on boot.
2. **Heartbeat** (~2 Hz) — do not remove; without it long protocols fail ~1.5 s in.
3. **E-stop** forces dry-run off so motors actually stop.
4. **Write-cache** must be invalidated when leaving dry run or arm stays limp.

Details: `~/ArduinoApps/armic/README.md`

## MQTT / wearable (M5 Core2)

- Broker host/port: **`python/config.py`** (`MQTT_BOARD_MDNS`, `MQTT_BROKER_*`)
- Inside Docker app: `host.docker.internal` (same file)
- Spec: `bricks/armic/mqtt/M5CORE2_AGENT_SPEC.md`

Do not change board hostname, mDNS, or WiFi without user approval and a backup.

## LLM brick

- Model: **Qwen3.5 0.8B** only (`arduino:llm` + llamacpp runner)
- ~500–900 MB RAM when loaded — one local LLM at a time
- Agent tools: `run_arm_protocol`, `list_rehab_routes`, `suggest_rehab_intent`, `show_rehab_route`
- **Rehab motion never starts from chat** — user presses **Execute** on route card → `route_runner.py`
- Full contract: repo root `AGENTS.md` §4

## Calibration single source of truth

`bricks/armic/calibration.json` → firmware `joints::` + browser via `GET /calibration`.

## Common tasks

```bash
arduino-app-cli app start ~/ArduinoApps/armic
arduino-app-cli app logs  ~/ArduinoApps/armic --follow
arduino-app-cli app restart ~/ArduinoApps/armic
arduino-app-cli monitor    # MCU serial — separate from app logs
```

Stale sketch after edits:

```bash
arduino-app-cli app clean-cache user:armic --force
arduino-app-cli app restart ~/ArduinoApps/armic
```

## Related skills

| Topic | Skill |
|-------|-------|
| Bridge / MCU RPC | `arduino-bridge` |
| Web UI / API | `arduino-ui` |
| Backup before risky changes | `arduino-backup` |
| App won't start / Bridge silent | `arduino-troubleshoot` |
| Disk / RAM limits | workspace rule `board-resources.mdc` |
