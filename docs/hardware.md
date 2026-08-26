# Hardware — Arduino UNO Q + 4-DOF arm

All controller references in this project are **Arduino UNO Q** only.

## Controller

| Item | Spec |
|------|------|
| Board | **Arduino UNO Q** (4 GB class) |
| MCU | STMicroelectronics **STM32U585** (Arm Cortex-M33) — real-time arm firmware |
| MPU | Qualcomm **Dragonwing QRB2210** — Debian Linux, App Lab, Edge AI |
| Connectivity | Wi-Fi 5, Bluetooth 5.1, USB-C, classic UNO headers, **Qwiic** |
| Tooling | Arduino App Lab (MPU + MCU) and/or Arduino IDE 2.x (MCU) |

The MCU runs the assistive-arm brain. The MPU hosts App Lab UI and on-device ML.

---

## Actuation & I2C PWM

| Item | Notes |
|------|--------|
| PWM driver | **PCA9685** 16-channel, **50 Hz** servo frame |
| Bus | I2C from UNO Q MCU (header / Qwiic — **pin map TBD during UNO Q port**) |
| Output enable | Optional OE line for high-Z / safe release |
| Library | Adafruit PWM Servo Driver (Arduino) |

### Channel map

| CH | Joint | Servo class | Notes |
|----|-------|-------------|--------|
| 0 | Base (yaw) | MG90S | Horizontal rotation, light load |
| 1 | Shoulder | MG90D | Primary gravity joint (**inverted** PWM dir) |
| 2 | Elbow | MG90D | Band **[90°, 180°]** only |
| 3 | Wrist | MG90S | Tip orientation (**inverted** mount) |
| 4 | Gripper | — | Open/close % (not a rotation joint) |

Torque derating uses a **0.80** safety factor vs max continuous torque to avoid thermal shutdown.

---

## Mechanical links (mm)

Measured chain (do not change without a new calibration session):

| Segment | Length | Meaning |
|---------|--------|---------|
| Floor → base pivot | 60 | `FLOOR_OFFSET` |
| L0 | 30 | Base → shoulder |
| L1 | 90 | Shoulder → elbow (upper arm) |
| L2 | 70 | Elbow → wrist (forearm) |
| L3 | 50 | Wrist → gripper base |

World frame: **+X** viewer-right, **+Y** forward, **+Z** up, **Z = 0** at floor.

---

## Joint convention (locked)

- All joints at **90°** ⇒ straight vertical chain (except base yaw).
- **Stable home:** `{90, 90, 95, 90}` — elbow **95°** resists gravity hunt.
- Elbow never below **90°**.
- Tip FK **Z ≥ 15 mm** above floor.

Details: [kinematics.md](kinematics.md).

---

## Sensors (planned on UNO Q)

| Sensor | Role | Brain |
|--------|------|-------|
| IMU (Qwiic / shield) | Patient exercise tracking | MPU Edge Impulse and/or MCU sample |
| Optional biosignal | Session context | MPU |

Patient sensing is separate from the arm’s joint encoders (this arm is open-loop servo angle via PWM calibration).

---

## What is explicitly out of scope for docs

Do **not** document or recommend non-Arduino controller boards for this contest build. The product target is **Arduino UNO Q**.
