# ARMIC AI Node — build your own edge inference publisher

An **AI Node** is any Wi-Fi device that runs an **Edge Impulse** (or compatible) IMU classifier and publishes the **6-topic ARMIC wearable MQTT contract** to the UNO Q broker. The closed loop does not care which board you use — only that messages match the schema.

**M5Stack Core2 is the reference hardware** (screen + MPU6886 + battery). We ship it because it straps to a forearm and “just works” for demos. You can port the same contract to ESP32, nRF52, phone edge, Raspberry Pi + IMU hat, etc.

![AI Node concept — Edge Impulse on-device inference publishing to UNO Q MQTT](../Images/AI%20Node.png)

---

## What lives in this folder

| Path | Purpose |
|------|---------|
| [MQTT_CONTRACT.md](MQTT_CONTRACT.md) | **Read first** — topics, JSON schemas, rep/session rules for UNO Q + agent |
| [platformio-reference/](platformio-reference/) | Full **M5 Core2 + PlatformIO** reference firmware (sanitized, no secrets, no EI weights) |
| [../armic-wearable/M5CORE2_FIRMWARE_TEMPLATE.ino](../armic-wearable/M5CORE2_FIRMWARE_TEMPLATE.ino) | Minimal **Arduino IDE** starter (PubSubClient stub) |
| [../armic-wearable/mosquitto.conf](../armic-wearable/mosquitto.conf) | Broker config on UNO Q (server side, not on the node) |

---

## Quick start (M5 Core2 + PlatformIO)

### 1. Train or reuse an Edge Impulse model

1. Create a project at [studio.edgeimpulse.com](https://studio.edgeimpulse.com).
2. **Impulse:** 6-axis IMU fusion, **50 Hz**, **2000 ms** window, **500 ms** stride.
3. **Classes:** `Baseline`, `Bicepcurl`, `Lateralraise`, `Elbowflexion` (names must map — see `exercise_map.cpp`).
4. Deploy → **Arduino library** → extract to:

   `platformio-reference/lib/Armic_inferencing/`

### 2. Configure (no credentials in git)

```powershell
cd "Arduino Files/armic-ai-node/platformio-reference/include"
copy secrets.example.h secrets.h
```

Edit `secrets.h`:

```c
#define WIFI_SSID     "your-clinic-wifi"
#define WIFI_PASSWORD "your-wifi-password"
```

Edit `config.h`:

- `DEVICE_ID` / `MQTT_CLIENT_ID` — unique per node
- `MQTT_BROKER_MDNS` — your UNO Q hostname without `.local` (default `uno-q`)
- `MQTT_BROKER_FALLBACK` — optional static IP if mDNS fails on your LAN

**Never commit `secrets.h`.** It is gitignored.

### 3. Build and flash

```powershell
cd "Arduino Files/armic-ai-node/platformio-reference"
pio run -t upload
pio device monitor -b 115200
```

Confirm serial: `MQTT connected` and `MQTT inference -> ...` lines.

### 4. Verify on UNO Q

Open `http://uno-q.local:7000/wearable-mqtt.html` — all **6 topic badges** should go green as the node publishes.

---

## Porting to another device (“any device can be an AI Node”)

Keep these invariants; swap the HAL:

| Layer | M5 reference | Your port |
|-------|--------------|-----------|
| IMU sampling | MPU6886 @ 50 Hz | Any 6-axis IMU at EI training rate |
| Inference | Edge Impulse `run_classifier` | Same EI export or ONNX with matching window |
| Rep logic | `rep_tracker.cpp` session FSM | Copy or reimplement per [MQTT_CONTRACT.md](MQTT_CONTRACT.md) |
| Transport | ESP-IDF MQTT client | Any MQTT client over TCP :1883 |
| Topics | `armic/wearable/v1/*` | **Must match** — see `armic-mpu/config.py` |

Minimum publish set for route completion on UNO Q:

- `heartbeat` (keepalive)
- `inference` (live class + session sync)
- `rep_end` (**authoritative rep count**)
- `session_change` (reset counter when exercise type changes)

---

## Relationship to `armic-wearable/`

| Folder | Role |
|--------|------|
| `armic-wearable/` | MQTT **contract docs**, broker config, Arduino IDE **template** |
| `armic-ai-node/` | **Production reference** firmware + build kit for judges/remixers |

The full working tree also lives in the author’s local PlatformIO workspace (`Armic-AI-Node`); this repo copy is sanitized for public git.

---

## Data collection (training new classes)

```bash
edge-impulse-data-forwarder --frequency 50 --sensor fusion
```

Capture ~5 minutes per class (bicep curl, lateral raise, elbow flexion, baseline idle). Retrain → re-export → drop library in `lib/` → flash.

---

## Security

- Wi-Fi credentials only in gitignored `secrets.h`.
- MQTT is **LAN anonymous** for contest/demo (`mosquitto.conf` line 1 warning). Do not expose broker port 1883 to the public internet.
- No API keys, tokens, or home IPs in committed `config.h` — use placeholders + local overrides.
