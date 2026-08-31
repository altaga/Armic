# AGENTS.md — ARMIC agent playbook

> **Audience:** Coding agents (Cursor, Claude Code, contest judges' agents) reviewing or extending this repo.  
> **Not medical advice.** Proof-of-concept rehab robotics demo only.

Read this file first. Then load skills from [`AI Skills/skills/ARDUINO-BUNDLE.md`](AI%20Skills/skills/ARDUINO-BUNDLE.md) for board-specific workflows.

---

## 1. Repository map

| Path | Role |
|------|------|
| [`Arduino Files/armic-firmware/`](Arduino%20Files/armic-firmware/) | MCU sketch — Bridge RPC, 100 Hz loop, IK, ProtocolRunner, E-STOP, safety clamps |
| [`Arduino Files/armic-mpu/`](Arduino%20Files/armic-mpu/) | Python App Lab backend — FastAPI, WebSocket 20 Hz, LLM agent, MQTT bridge |
| [`Arduino Files/armic-webui/`](Arduino%20Files/armic-webui/) | Static browser UI — Three.js twin, calibration gate, wearable HUD |
| [`Arduino Files/armic-brick/`](Arduino%20Files/armic-brick/) | **Calibration SSoT** — `calibration.json`, compose root, mounted in all containers |
| [`Arduino Files/armic-wearable/`](Arduino%20Files/armic-wearable/) | MQTT contract docs, Mosquitto config, Arduino IDE starter |
| [`Arduino Files/armic-ai-node/`](Arduino%20Files/armic-ai-node/) | AI Node build kit — Edge Impulse + PlatformIO reference (any device can publish wearable MQTT) |
| [`AgentSSH/`](AgentSSH/) | MCP server — 16 SSH tools for laptop agent → UNO Q dev loop |
| [`AI Skills/`](AI%20Skills/) | Agent skills + rules bundle (deploy to board or reference from laptop) |
| [`OnlineSimulator/`](OnlineSimulator/) | Hosted browser twin — [onlinesimulator.expo.app](https://onlinesimulator.expo.app) when no board yet |
| [`docs/`](docs/) | Architecture, BOM, setup, serial protocol, exercises (also [`Docs/architecture.md`](Docs/architecture.md)) |
| [`scripts/mermaid-render.sh`](scripts/mermaid-render.sh) | Local Mermaid → PNG (same as CI) |

**On-board layout** (after deploy): `~/ArduinoApps/armic/` mirrors `Arduino Files/*` bricks + sketch + python.

---

## 2. Dual-brain architecture

```
Browser ──WebSocket 20Hz──► python/main.py ──Bridge──► sketch/ ──I2C Wire2──► PCA9685 ──► servos
     ▲                           │                         │
     └──── telemetry ────────────┘◄──── notify state ──────┘
```

| Layer | Runs on | Owns motion? |
|-------|---------|--------------|
| `sketch/` | MCU (STM32U585) | **Yes** — IK, planner, PWM, limits, protocols |
| `bricks/armic/` + `python/` | MPU (Linux) | Commands, telemetry, LLM, MQTT — **not** real-time PWM |
| M5 / AI Node | External Wi-Fi | Edge Impulse → MQTT `armic/wearable/v1/*` |
| Browser | Client | UI only |

**Invariant:** Motion control stays on MCU. If Python dies, firmware watchdog + hold behavior must keep the arm safe.

---

## 3. Safety invariants (never weaken)

Enforced in **firmware**, not prompt text:

1. **E-STOP first** — `protocol estop` / `estop` halts pipeline, invalidates write cache, parks stable home (elbow **95°**, not 90° gravity hunt).
2. **Elbow soft limits** — **[90°, 180°]** in kinematics + hard PWM clamp in `motorWrite()`.
3. **Floor guard** — tip FK **Z ≥ ~15 mm** before applying Cartesian targets.
4. **Watchdog** — Brick heartbeat ~2 Hz; **1500 ms** silence → halt motion and hold.
5. **Dry run** — motors **gated ON by default** after MPU boot (`ARMIC_DRY_RUN_DEFAULT=true` in `brick_config.yaml`). UI **Enable Motion** / `dry_run(false)` required before assist. Leaving dry run requires `invalidateWriteCache()` or arm stays limp.
6. **Calibration SSoT** — single file [`Arduino Files/armic-brick/calibration.json`](Arduino%20Files/armic-brick/calibration.json). **3-phase commit**: stage → verify → commit (disk write only after MCU confirms). Do not fork per-module copies. AgentSSH deploy uses `only_if_missing` for remote seeding.
7. **MPU cannot widen envelope** — limit writes validated against `[50, 600]` PWM and `[0, 180]°`.
8. **Therapy speed cap** — rehab joint rate **18°/s** (documented in MPU / route runner).

**5-layer stack** (firmware): dry_run → watchdog → angle limits + floor → PWM hard limits → E-STOP.

Details: [`docs/architecture.md`](docs/architecture.md) · [`AI Skills/rules/arm-rehab-exercises.mdc`](AI%20Skills/rules/arm-rehab-exercises.mdc)

---

## 4. LLM agent — 4-tool brick contract

Implementation: [`Arduino Files/armic-mpu/agent/tools.py`](Arduino%20Files/armic-mpu/agent/tools.py)  
System prompt: [`config.py`](Arduino%20Files/armic-mpu/config.py) `AGENT_SYSTEM_PROMPT`  
Model: **Qwen3.5 0.8B** via App Lab `arduino:llm` → `llamacpp-models-runner:9999`. Swappable for cloud proxy; tool surface stays fixed.

The LLM **never outputs raw joint angles**. It only calls:

| Tool | Params (code-accurate) | Purpose |
|------|------------------------|---------|
| `run_arm_protocol` | `protocol: str` only | Demo/single motions: `home`, `cpose`, `transport`, `snake`, `cobra`, `gimmefive`, `orbital`, `htl`, `pendulum`. **Not** full rehab sessions. |
| `list_rehab_routes` | _(none)_ | Emits **light / medium / heavy** route cards to chat. **Display only.** |
| `suggest_rehab_intent` | `description: str` | NL context → best matching route card. **Display only.** |
| `show_rehab_route` | `route_id: str` | One route card (`light` \| `medium` \| `heavy` + aliases). **Display only.** |

> **Critical:** The LLM **never starts rehab motion from chat.** Rehab runs only when the user presses **Execute** on a route card → [`route_runner.py`](Arduino%20Files/armic-mpu/route_runner.py) (arm demos set → patient wearable reps via MQTT → next exercise → ends with `gimmefive`).

> **README vs code:** Narrative examples may show extra params on `run_arm_protocol` (`reps`, `speed`) — **trust `tools.py`**. AgentSSH MCP `rehab_dry_run` *does* accept `reps`/`speed` for engineering preflight (separate from LLM tools).

### Three motion catalogs (do not conflate)

| Catalog | Count | Source | IDs |
|---------|-------|--------|-----|
| **Rehab routes** (multi-exercise sessions) | **3** | `rehab_routes.py` | `light`, `medium`, `heavy` |
| **Demo protocols** | **9** | `armic-brick/__init__.py` `PROTOCOLS` | `home`, `cpose`, `transport`, `snake`, `cobra`, `gimmefive`, `orbital`, `htl`, `pendulum` |
| **Rehab exercises** (single-exercise 3-rep) | **3** | serial `exercise` cmd | `bicep`, `lateral`, `elbowflex` |

README “9 routes” in Scenario 4 mixes protocols + exercise-set names for narrative — **authoritative for agents: 3 + 9 + 3 above.**

**Rehab routes** ([`rehab_routes.py`](Arduino%20Files/armic-mpu/rehab_routes.py)):

| ID | Reps per exercise | Exercises (order) |
|----|-------------------|-------------------|
| `light` | 3 | bicep → lateral → elbowflex |
| `medium` | 6 | same |
| `heavy` | 6 | same |

Aliases: `intro`/`acute`→light, `standard`/`foundation`/`subacute`/`shoulder`→medium, `elbow`/`elbow_focus`→heavy.

`PROGRAMMED_EXERCISES` in `rehab_routes.py` must stay in sync with brick `EXERCISES` and firmware `ProtocolRunner`.

---

## 5. Wearable / AI Node MQTT contract (v1)

Subscriber: [`mqtt_bridge.py`](Arduino%20Files/armic-mpu/mqtt_bridge.py) on `armic/wearable/v1/#`  
Full schema: [`Arduino Files/armic-ai-node/MQTT_CONTRACT.md`](Arduino%20Files/armic-ai-node/MQTT_CONTRACT.md)

| Topic | Purpose |
|-------|---------|
| `armic/wearable/v1/heartbeat` | Keepalive |
| `armic/wearable/v1/inference` | Live Edge Impulse window (**HUD only — not authoritative for rep count**) |
| `armic/wearable/v1/rep_start` | Rep FSM active |
| `armic/wearable/v1/rep_end` | **Authoritative rep count** (+ optional quality, ROM) |
| `armic/wearable/v1/session_change` | Exercise type changed, reset counter |
| `armic/orchestrator/v1/cmd` | Downlink to node |

Every message: `"schema": 1`, `msg_type`, `device_id`, `ts_ms`.

Exercise ids: `bicep`, `lateral`, `elbowflex`, `none`.  
Set size on UNO Q: **3 reps** per exercise. Patient rep wait timeout: **600 s** (`REHAB_PATIENT_REP_TIMEOUT_S`).

---

## 6. Adaptation engine (wearable → agent)

Implementation: [`agent/adaptation.py`](Arduino%20Files/armic-mpu/agent/adaptation.py) · wired in `mqtt_bridge.py`

| Condition | Action |
|-----------|--------|
| **3 consecutive** `rep_end` with quality **≥ 0.75** | Widen ROM **+5°** |
| **3 consecutive** `rep_end` with quality **< 0.40** | Narrow ROM **−5°**, reduce speed cap **−2°/s** |
| Mid band (`0.40 ≤ q < 0.75`) | Reset streaks; hold ROM/speed |

Decisions emit `agent_adaptation` WebSocket events via `llm_agent.enqueue_adaptation()`.

**Separate from adaptation:** token reward layer (README) mints only if avg rep quality **≥ 0.70** across a 3-rep set.

---

## 7. Serial / Bridge command vocabulary

Reference: [`docs/serial-protocol.md`](docs/serial-protocol.md) · baud **115200**

```
protocol home|cpose|transport|snake|cobra|gimmefive|orbital|htl|pendulum|stop|estop
exercise bicep|lateral|elbowflex
target <x> <y> <z> [pitch]
joints <b> <sh> <el> <wr>
gripper open|close|mid|<0-100>
```

PCA9685: **Wire2**, addr `0x40`, **OE pin 17**. Channels 0–4: base, shoulder, elbow, wrist, gripper.

---

## 8. Secrets & push policy

**Never commit:**

- API keys (`sk-`, `ghp_`, `AKIA`, `AIza`, JWTs, PEM private keys)
- `AgentSSH/ssh-hosts.json` (use `ssh-hosts.TEMPLATE.json`)
- `secrets.h` / WiFi passwords on AI Node
- Real home IPs or personal mDNS names in source — use `uno-q.local` placeholders
- `.env`, wallet keys, patient data

**OK to commit:** template placeholders, `allow_anonymous true` in demo Mosquitto with line-1 warning.

Pre-push: scan for credential patterns above.

---

## 9. Agentic dev loops

### Loop A — On-device (bench)

Agent runs **on UNO Q** with `AI Skills/` mounted. Edits local `~/ArduinoApps/armic`, restarts app, dry-runs protocols. See demo clip `Images/0.5claude.mp4` (original GIF in `Images/originals/`).

### Loop B — Laptop + AgentSSH MCP

Agent on dev PC → [`AgentSSH/`](AgentSSH/) MCP (16 tools) → SSH to `uno-q.local`. Deploy bundle, tail logs, `rehab_dry_run`, compile/upload. Skill: [`AI Skills/skills/arduino-ssh-mcp/SKILL.md`](AI%20Skills/skills/arduino-ssh-mcp/SKILL.md).

Both loops share the same **4-tool brick** and **AI Skills** rules.

---

## 10. AI Skills bundle

| Location | Contents |
|----------|----------|
| [`AI Skills/skills/`](AI%20Skills/skills/) | 31 skills — see [`ARDUINO-BUNDLE.md`](AI%20Skills/skills/ARDUINO-BUNDLE.md) |
| [`AI Skills/rules/`](AI%20Skills/rules/) | `arduino-development.mdc`, `board-resources.mdc`, `arm-rehab-exercises.mdc` |

**Arduino-specific skills:** `arduino`, `arduino-board`, `arduino-armic`, `arduino-bridge`, `arduino-catalog`, `arduino-scaffold`, `arduino-ui`, `arduino-troubleshoot`, `arduino-ssh-mcp`.

Install on board: tar skills folder to `~/.cursor/skills-cursor/` or deploy via `armic_deploy_bundle`.

---

## 11. Contest / judge context

Public story lives in README + `docs/`. Internal paste maps and 100-item gate are in gitignored `Hackster Contest Plan/Armic-hackster/` (D11–D14). Judges using agents: evaluate **real committed code** under `Arduino Files/`, not mockups.

Mermaid diagrams in markdown auto-render to PNG via [`.github/workflows/mermaid-to-png.yml`](.github/workflows/mermaid-to-png.yml) → `Docs/refs/generated/` (Hackster WYSIWYG does not render Mermaid).

---

## 12. Common agent mistakes (avoid)

1. Moving motion logic from MCU to Python.
2. Removing Bridge heartbeat or extending watchdog without analysis.
3. Hardcoding personal hostnames or home IPs — read `config.py` / use `uno-q.local` placeholders.
4. Duplicating or overwriting `calibration.json` on deploy (`deploy_calibration_ssot=never` default).
5. Subscribing to flat `armic/wearable/*` without `/v1/` prefix.
6. Letting LLM emit joint targets instead of tool calls.
7. Committing `ssh-hosts.json` or Edge Impulse model weights unintentionally.
8. **Starting rehab from chat** — route cards are display-only; motion requires UI **Execute**.
9. **Counting reps from `inference`** — only `rep_end` is authoritative for route completion and adaptation.
10. **Conflating catalogs** — 3 rehab routes ≠ 9 demo protocols ≠ README narrative “9 routes”.
11. **Trusting README tool signatures** over `tools.py` for LLM params.

---

## 13. Quick verification checklist

```bash
# On board
arduino-app-cli app list
curl -s http://localhost:7000/calibration | head
mosquitto_sub -h localhost -t 'armic/wearable/v1/#' -v

# From laptop (AgentSSH MCP — engineering preflight, not LLM tools)
rehab_dry_run(host=uno-q, protocol=elbowflex-set, reps=3, speed=12)
```

Web UI: `http://uno-q.local:7000` · Wearable debug: `/wearable-mqtt.html`

---

*ARMIC — agent-readable specs for programmable rehabilitation on Arduino UNO Q.*
