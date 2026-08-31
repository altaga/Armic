# M5Stack Core2 (AWS) → Arduino UNO Q MQTT contract

Hand this file to the agent building the M5 firmware. The UNO Q runs the MQTT
**broker** and subscribes to wearable messages.

## Network

| Setting | Value |
|---------|--------|
| **Broker host** | `uno-q.local` (mDNS — use hostname, not a committed home IP) |
| **Broker port** | `1883` |
| **Protocol** | MQTT 3.1.1 |
| **TLS** | Off (hackathon LAN only) |
| **Auth** | None (anonymous) |
| **M5 `client_id`** | `m5core2-<last3bytes_of_mac_hex>` e.g. `m5core2-a1b2c3` |

Verify from a laptop on the same WiFi:

```bash
ping uno-q.local
mosquitto_sub -h uno-q.local -p 1883 -t 'armic/wearable/v1/#' -v
```

If mDNS fails on ESP32, allow IP fallback via build flag (last resort).

## Topics

| Direction | Topic | QoS | Purpose |
|-----------|-------|-----|---------|
| M5 → UNO Q | `armic/wearable/v1/heartbeat` | 0 | Every 5 s while connected |
| M5 → UNO Q | `armic/wearable/v1/inference` | 1 | **Required** — classification result |
| M5 → UNO Q | `armic/wearable/v1/rep_start` | 1 | Optional — rep boundary |
| M5 → UNO Q | `armic/wearable/v1/rep_end` | 1 | Rep complete — **authoritative rep count** |
| M5 → UNO Q | `armic/wearable/v1/session_change` | 1 | Active exercise changed — **reset rep to 0** |
| UNO Q → M5 | `armic/orchestrator/v1/cmd` | 1 | Optional — session commands |

## JSON rules (all messages)

- UTF-8 JSON object, one per publish
- **Required on every message:**
  - `"schema": 1`
  - `"msg_type": "<type>"`
  - `"device_id": "m5core2-01"` (stable per device)
  - `"ts_ms": <unix_epoch_ms>`

---

## 1. `heartbeat` (publish every 5 s)

**Topic:** `armic/wearable/v1/heartbeat`  
**QoS:** 0

```json
{
  "schema": 1,
  "msg_type": "heartbeat",
  "device_id": "m5core2-01",
  "ts_ms": 1735344000123,
  "ei_ready": true,
  "wifi_rssi": -58,
  "firmware": "1.0.0"
}
```

---

## 2. `inference` (REQUIRED — main result)

**Topic:** `armic/wearable/v1/inference`  
**QoS:** 1  
**When:** After each Edge Impulse classification (your 2 s window @ 50 Hz, stride 500 ms — publish when you want a scored event; recommend **once per rep** or on label change).

```json
{
  "schema": 1,
  "msg_type": "inference",
  "device_id": "m5core2-01",
  "ts_ms": 1735344000456,
  "exercise": "lateral",
  "rep": 2,
  "label": "good",
  "confidence": 0.9699,
  "probabilities": {
    "good": 0.9699,
    "bad_form": 0.0200,
    "incomplete": 0.0101
  },
  "window_ms": 2000,
  "sample_hz": 50,
  "inference_ms": 2
}
```

### Field requirements

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `exercise` | string | yes | One of: `bicep`, `lateral`, `elbowflex` |
| `rep` | int | yes | 1-based rep number in current set |
| `label` | string | yes | **Must match EI class names exactly** (lowercase) |
| `confidence` | float | yes | 0.0–1.0, winning class probability |
| `probabilities` | object | yes | All class scores, keys = class names |
| `window_ms` | int | yes | `2000` (your EI window) |
| `sample_hz` | int | yes | `50` |
| `inference_ms` | int | no | EI timing on M5 |

**UNO Q uses:** `label`, `confidence`, `exercise`, `rep`, `probabilities`, `ts_ms` for UI and session log. It does **not** need raw acc/gyro arrays.

---

## 3. `session_change` (exercise switch — reset reps)

**Topic:** `armic/wearable/v1/session_change`  
**QoS:** 1  
**When:** User switches active exercise (lateral → bicep, etc.). UNO Q must reset its rep counter.

```json
{
  "schema": 1,
  "msg_type": "session_change",
  "device_id": "m5core2-01",
  "ts_ms": 1735344002000,
  "exercise": "bicep",
  "rep": 0
}
```

| Field | Notes |
|-------|-------|
| `exercise` | `bicep`, `lateral`, `elbowflex`, or `none` when idle |
| `rep` | Always `0` on session change |

**UNO Q rule:** set session exercise → `msg.exercise`, rep counter → `0`. Never count reps from `inference`.

---

## 4. `rep_start` / `rep_end` (rep boundaries)

Align wearable scoring with arm exercise reps.

**Topic:** `armic/wearable/v1/rep_start` or `.../rep_end`  
**QoS:** 1

```json
{
  "schema": 1,
  "msg_type": "rep_start",
  "device_id": "m5core2-01",
  "ts_ms": 1735344001000,
  "exercise": "bicep",
  "rep": 1
}
```

```json
{
  "schema": 1,
  "msg_type": "rep_end",
  "device_id": "m5core2-01",
  "ts_ms": 1735344005500,
  "exercise": "bicep",
  "rep": 1,
  "label": "good",
  "confidence": 0.94
}
```

---

## 5. Commands from UNO Q (optional subscribe)

**Topic:** `armic/orchestrator/v1/cmd`  
**QoS:** 1

```json
{
  "schema": 1,
  "msg_type": "session_cmd",
  "ts_ms": 1735344000000,
  "cmd": "start_exercise",
  "exercise": "lateral",
  "reps": 3
}
```

| `cmd` | Meaning |
|-------|---------|
| `start_exercise` | M5 should set `exercise` and reset `rep` counter |
| `stop` | Stop publishing inference until next start |
| `ping` | Reply with heartbeat |

---

## Edge Impulse on M5 (reference)

| EI setting | Value |
|------------|--------|
| Input axes | accX, accY, accZ, gyrX, gyrY, gyrZ |
| Window | 2000 ms |
| Stride | 500 ms |
| Frequency | 50 Hz |
| Model | Quantized int8 flatten + classifier |

Map EI `classification[].label` and `.value` directly into `label`, `confidence`, and `probabilities`.

---

## M5 implementation checklist

1. WiFi connect (same LAN as UNO Q).
2. Resolve broker: `uno-q.local:1883` (PubSubClient / ESP-IDF mqtt).
3. Run EI infer on IMU stream.
4. Publish `heartbeat` every 5 s.
5. Publish `inference` (QoS 1) on each scored rep or classification event.
6. Use exact `label` strings from training (e.g. `good`, `bad_form`, `incomplete`).

## Test without M5

```bash
mosquitto_pub -h uno-q.local -p 1883 -t armic/wearable/v1/inference -q 1 -m '{
  "schema":1,"msg_type":"inference","device_id":"test","ts_ms":1,
  "exercise":"lateral","rep":1,"label":"good","confidence":0.97,
  "probabilities":{"good":0.97,"bad_form":0.03},
  "window_ms":2000,"sample_hz":50
}'
```

Check Armic logs: `wearable inference 'good' (0.97) ex='lateral' rep=1`
