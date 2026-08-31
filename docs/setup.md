# Setup — Armic (Arduino UNO Q)

## Prerequisites

1. **Arduino UNO Q** board powered (USB-C PD as needed).
2. [Arduino App Lab](https://www.arduino.cc/) and/or **Arduino IDE 2.x** for MCU sketches.
3. PCA9685 wired to the UNO Q **I2C** (Qwiic or header — finalize pins during port).
4. 4-DOF arm + gripper powered with a supply sized for MG90D stall currents.
5. Optional: Chrome/Edge for a future Web Serial / App Lab control UI.

PlatformIO may still be used during the port if you prefer; the **target board profile must be Arduino UNO Q MCU**, not any other MCU module.

---

## Bring-up checklist

1. Flash MCU firmware (arm brain) to the UNO Q.
2. Open serial monitor at **115200** baud.
3. Confirm boot line parks at **home** (`elbow 95°`, claw open).
4. Send `matrix` — channels 0–4 report PWM / OFF.
5. Send `protocol home` then `exercise bicep` — verify photo-matched motion.
6. Send `estop` — must halt and return to stable home.

---

## App Lab deploy (production path)

1. Copy `Arduino Files/` modules into `~/ArduinoApps/armic/` on the UNO Q (or use [AgentSSH/](AgentSSH/) `armic_deploy_bundle`).
2. Start the app: `arduino-app-cli app start ~/ArduinoApps/armic`
3. Open **`http://uno-q.local:7000`** — main UI, agent chat, calibration, wearable HUD.
4. Optional: flash an [AI Node](Arduino%20Files/armic-ai-node/) and verify MQTT at `/wearable-mqtt.html`.

Wiring and calibration: [bom.md](bom.md), [hardware.md](hardware.md), **Calibration policy** below.

---

## No board? Enter the Online Simulator

**→ [onlinesimulator.expo.app](https://onlinesimulator.expo.app)**

Open in any browser. Test arm commands and the 3D simulation — presets, joint sliders, rehab routes — same firmware math as UNO Q. No hardware required to explore.

When you have a board, follow **App Lab deploy** above for the real system (`http://uno-q.local:7000`).

---

## Hackster contest assets (repo)

| Asset | Path | Status |
|-------|------|--------|
| Breadboard wiring | `Images/Armic_bb.png` | In repo |
| Fritzing source | `Images/Armic.fzz` | In repo — export **Schematic view → PNG** as `Images/Armic_sch.png` for Schematics panel |
| UI screenshots | `Images/mainUI.png`, `testmqttUI.png`, `applab.png`, `agentready.png`, `warmingupagent.png` | In repo |
| Demo GIFs | `Images/*.gif` | In repo |

---

## Calibration policy

- PWM MIN / MAX / CENTER per channel come from a **manual ramp** protocol only.
- Never autodetect by sweeping past mechanical stops.
- Legal operating band must stay inside firmware hard clamps (see `config` / [kinematics.md](kinematics.md)).
- After any mechanical change, re-measure and update docs + constants together.

---

## Contest tooling notes

- Prefer documenting the stack as **Arduino UNO Q + App Lab + Edge Impulse**.
- Keep Hackster BOM / schematics / photos aligned with [bom.md](bom.md) and [hardware.md](hardware.md).
