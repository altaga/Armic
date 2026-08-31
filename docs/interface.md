# Web interface and App Lab stack

Everything runs on the UNO Q. Power with 12 V, connect to Wi-Fi, open **`http://uno-q.local:7000`**.

| Main UI — session dashboard | MQTT wearable HUD |
|---|---|
| <img src="../Images/mainUI.png" width="520"> | <img src="../Images/testmqttUI.png" width="520"> |
| App Lab containers | Agent ready |
| <img src="../Images/applab.png" width="520"> | <img src="../Images/agentready.png" width="520"> |

## Surfaces

| URL / path | Purpose |
|------------|---------|
| `:7000` | Arm control, calibration gate, agent chat, rehab route cards |
| `/wearable-mqtt.html` | Live 20 Hz wearable topic HUD (6 MQTT topics) |

Wearable HUD shows inference, rep boundaries, and quality scores in real time.

## Deployed layers

| Layer | Where | What |
|-------|--------|------|
| MCU firmware | STM32U585 | Safety, IK, exercises, E-STOP |
| App Lab app | MPU | FastAPI, WebSocket 20 Hz, Qwen agent, route runner |
| Web UI | `:7000` | Static UI from [`armic-webui/`](../Arduino%20Files/armic-webui/) |
| MQTT broker | `:1883` | Wearable → rep counting + adaptation |

Bring-up: [setup.md](setup.md).

## Hardware photos

| Power: 12 V → HW-688 → 5 V | PCA9685 + Qwiic |
|---|---|
| <img src="../Images/HW688 & PCA.png" width="520"> | <img src="../Images/Armic_bb.png" width="520"> |

Schematic source: `Images/Armic.fzz` (Fritzing → Schematic view → Export PNG).
