---
name: arduino
description: >-
  Entry point for Arduino UNO Q / VENTUNO Q development with arduino-app-cli,
  Bricks, Bridge, and web UI. Use for any Arduino App task on this board —
  routes to specialist skills. Compatible with Cursor and Claude Code agents.
version: 1.1.1
---

# Arduino — meta orchestrator

Routes the agent to the right specialist skill. Does not do the work itself.

> **Agent note:** These skills use the same format in **Cursor** (`~/.cursor/skills-cursor/`)
> and **Claude Code** (`~/.claude/skills/`). Instructions are shell-first and
> model-agnostic — follow steps literally regardless of which agent runs them.

## This deployment (UNO Q)

| Item | Value |
|------|-------|
| Board | UNO Q (`arduino,imola`) — confirm on device |
| Main project | **Armic** — `~/ArduinoApps/armic/` |
| Backup app | **Board Backup** — `~/ArduinoApps/board-backup/` |
| Web UI port | **7000** |
| Resource limits | See workspace rule `board-resources.mdc` |

**Network:** Query `hostname` and `hostname -I` — never hardcode IP, hostname,
mDNS, or WiFi details in skills or rules.

App Lab Run opens **`http://<board-ip>:7000/...`**; MQTT clients may use
`<hostname>.local`. Both can be valid.

## The bundle

| Skill | Use when |
|-------|----------|
| `arduino-board` | Orient: board model, CLI version, paths, what's running |
| `arduino-armic` | Armic app: arm-simulator, sketch, MQTT, rehab, calibration |
| `arduino-catalog` | Find bricks or examples to copy |
| `arduino-scaffold` | Create a new app from an example |
| `arduino-bridge` | Python ↔ MCU sketch (Router Bridge) |
| `arduino-ui` | Browser UI (`web_ui`) or LED matrix |
| `arduino-backup` | Zip backup / download.html / protect work |
| `arduino-troubleshoot` | Something broken, empty logs, won't start |

## Routing (first match wins)

1. **Armic / arm-simulator / rehab / MQTT** → `arduino-armic`
2. **Backup / download zip / don't lose my work** → `arduino-backup`
3. **Don't know board / CLI / paths yet** → `arduino-board`
4. **Find a brick or example** → `arduino-catalog`
5. **Create or copy an app** → `arduino-scaffold`
6. **Python ↔ sketch wiring** → `arduino-bridge`
7. **Web page / WebSocket / matrix display** → `arduino-ui`
8. **Broken / won't start / silent Bridge** → `arduino-troubleshoot`

Chain skills when needed (e.g. scaffold → bridge → ui).

## Always-on rules

- Read `/etc/arduino-app-cli/AGENTS.md` before board-dependent choices.
- **Query live:** `arduino-app-cli <cmd> --help`, `brick list` — not memory.
- **One app at a time.** `app start` stops the other — confirm with user.
- **One local LLM at a time** on this board (~3.6 GB RAM).
- **Secrets** in App Lab Brick Configuration — never in `app.yaml` or source.
- **Network changes** need user approval + backup first (`arduino-backup`).
- **Never delete** without OK: `ArduinoApps/armic`, models, active caches.
- **Never persist** LAN/WiFi/IP/hostname in rules, skills, or repo files.

## App Lab vs CLI

Use **CLI** for agent-driven work. Mention **App Lab** for Brick env vars, sketch
upload UI, or graphical Run/logs.

## Share this bundle

See [ARDUINO-BUNDLE.md](ARDUINO-BUNDLE.md).
