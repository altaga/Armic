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

## Host UI (planned)

| Mode | Purpose |
|------|---------|
| Simulator | Offline digital twin (kinematics / torque) — no hardware |
| Live control | Commands + telemetry mirror while MCU is connected |

Until App Lab / Bridge UI lands, use the **serial command set** in [serial-protocol.md](serial-protocol.md).

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
