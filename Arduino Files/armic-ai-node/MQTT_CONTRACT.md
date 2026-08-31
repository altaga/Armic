# ARMIC wearable MQTT contract (v1)

Any **AI Node** — M5 Core2, ESP32 devkit, nRF52, etc. — must speak this contract so `armic-mpu/mqtt_bridge.py` and `wearable-mqtt.html` can subscribe without custom glue.

**Broker:** UNO Q Mosquitto on port **1883** (LAN only). See [../armic-wearable/mosquitto.conf](../armic-wearable/mosquitto.conf).

**Schema version:** `"schema": 1` on every message (matches `MQTT_SCHEMA_VERSION` in `armic-mpu/config.py`).

---

## Topics

| Topic | Direction | QoS | Purpose |
|-------|-----------|-----|---------|
| `armic/wearable/v1/heartbeat` | Node → broker | 0 | Keepalive + link health |
| `armic/wearable/v1/inference` | Node → broker | 1 | Live classifier output (session sync) |
| `armic/wearable/v1/rep_start` | Node → broker | 1 | Rep FSM entered active phase |
| `armic/wearable/v1/rep_end` | Node → broker | 1 | **Authoritative rep count** for agent + rewards |
| `armic/wearable/v1/session_change` | Node → broker | 1 | Exercise type changed; reset rep counter |
| `armic/orchestrator/v1/cmd` | Broker → node | 1 | Downlink commands (optional subscribe) |

MPU subscribes to: `armic/wearable/v1/#`

---

## Common envelope

Every JSON object includes:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `schema` | int | yes | Always `1` |
| `msg_type` | string | yes | One of the types below |
| `device_id` | string | yes | Stable node id, e.g. `m5core2-001` |
| `ts_ms` | uint64 | yes | Unix epoch milliseconds |

Optional on all types: `exercise` (`none`, `bicep`, `lateral`, `elbowflex`), `rep` (1-based count).

---

## Message types

### `heartbeat`

Published every ~5 s while connected.

```json
{
  "schema": 1,
  "msg_type": "heartbeat",
  "device_id": "m5core2-001",
  "ts_ms": 1712345678901,
  "ei_ready": true,
  "wifi_rssi": -58,
  "firmware": "1.0.0"
}
```

### `inference`

Published each Edge Impulse window while running.

```json
{
  "schema": 1,
  "msg_type": "inference",
  "device_id": "m5core2-001",
  "ts_ms": 1712345678901,
  "exercise": "bicep",
  "rep": 2,
  "label": "bicepcurl",
  "confidence": 0.87,
  "probabilities": { "baseline": 0.05, "bicepcurl": 0.87, "lateralraise": 0.04, "elbowflexion": 0.04 },
  "window_ms": 2000,
  "sample_hz": 50,
  "inference_ms": 42
}
```

### `rep_start`

```json
{
  "schema": 1,
  "msg_type": "rep_start",
  "device_id": "m5core2-001",
  "ts_ms": 1712345678901,
  "exercise": "bicep",
  "rep": 2
}
```

### `rep_end`

**This message closes the rehab loop** — MPU adaptation + token reward logic key off quality/ROM when present.

Minimal (reference firmware):

```json
{
  "schema": 1,
  "msg_type": "rep_end",
  "device_id": "m5core2-001",
  "ts_ms": 1712345678901,
  "exercise": "bicep",
  "rep": 2
}
```

Extended (recommended for adaptation):

```json
{
  "schema": 1,
  "msg_type": "rep_end",
  "device_id": "m5core2-001",
  "ts_ms": 1712345678901,
  "exercise": "bicep",
  "rep": 2,
  "quality_0_1": 0.82,
  "actual_rom_deg": 48.5,
  "hold_ms": 320
}
```

MPU accepts flat fields or nested `payload` (see `mqtt_bridge._rep_fields`).

### `session_change`

Emit when the active exercise class changes so subscribers reset counters.

```json
{
  "schema": 1,
  "msg_type": "session_change",
  "device_id": "m5core2-001",
  "ts_ms": 1712345678901,
  "exercise": "lateral",
  "rep": 0
}
```

### `cmd` (orchestrator downlink)

Topic: `armic/orchestrator/v1/cmd` — node **subscribes**; MPU/agent **publishes**.

```json
{
  "schema": 1,
  "msg_type": "cmd",
  "device_id": "m5core2-001",
  "ts_ms": 1712345678901,
  "payload": {
    "from": "agent",
    "action": "pause",
    "params": {}
  }
}
```

---

## Exercise id mapping

Edge Impulse label → MQTT `exercise` string (see `exercise_map.cpp`):

| EI class label | MQTT exercise |
|----------------|---------------|
| Baseline | `none` |
| Bicepcurl | `bicep` |
| Lateralraise | `lateral` |
| Elbowflexion | `elbowflex` |

MPU normalizes aliases (`bicepcurl`, `elbowflexion`, etc.) in `normalize_wearable_exercise()`.

---

## Rep counting rules

1. On exercise class change → publish `session_change` with `rep: 0`.
2. On rep FSM active edge → `rep_start` with 1-based `rep`.
3. On rep complete → `rep_end` with same `rep` index (**MPU increments session totals from this**).
4. `inference` may carry live `rep` for HUD sync; do not rely on it alone for rewards.

Target set size on UNO Q: **3 reps** per exercise (`REHAB_REPS_PER_SET`).

---

## Broker discovery (nodes)

Reference firmware resolves the broker in order:

1. mDNS `MQTT_BROKER_MDNS` (default `uno-q`) → IP
2. DNS `MQTT_BROKER_HOST` (default `uno-q.local`)
3. Static `MQTT_BROKER_FALLBACK` in `config.h` (set your LAN IP locally — never commit real home IPs)

---

## Verification

1. Flash node firmware with valid `secrets.h`.
2. UNO Q containers up; mosquitto listening on `:1883`.
3. Open `http://uno-q.local:7000/wearable-mqtt.html` — six green topic badges.
4. Serial log shows `MQTT inference ->` and `MQTT rep_end ->` during movement.

---

## Related docs

- [README.md](README.md) — build kit overview
- [../armic-wearable/M5CORE2_AGENT_SPEC.md](../armic-wearable/M5CORE2_AGENT_SPEC.md) — agent-facing narrative spec
- [../armic-mpu/mqtt_bridge.py](../armic-mpu/mqtt_bridge.py) — subscriber implementation
