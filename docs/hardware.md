# Hardware — Arduino UNO Q + ARMIC stack

All controller references are **Arduino UNO Q** only.

---

## Hardware list & why each part matters

| Hardware | Why ARMIC needs it | If you skip it |
|----------|-------------------|----------------|
| **Arduino UNO Q** | MCU runs arm firmware (IK, rehab, PCA9685); MPU runs App Lab + Edge Impulse | No dual-brain platform, no contest story, no patient ML |
| **MPU6886 (HW688-class IMU)** | 6-axis motion capture on the **patient** for exercise classification | Arm moves but therapy is never *verified* — no measurable rehab |
| **12 V · 5 A supply** | Reliable peak current for multiple MG90 under load | Sag, buzz, weak motion, controller resets |
| **PCA9685** | Stable 50 Hz PWM for 5 servo channels over I2C | Jitter, timing bugs, harsh/non-repeatable motion |
| **Lozada Dynamics arm** *(or MG90S + DC motor kit)* | Physical 4-DOF plant our kinematics & exercises were built for | Wrong geometry → floor hits, stalls, invalid poses |

---

## Arduino UNO Q

| Spec | Detail |
|------|--------|
| Board | **Arduino UNO Q** (4 GB) |
| MCU | STM32U585 (Cortex-M33) — arm firmware, PCA9685, 100 Hz loop |
| MPU | Qualcomm Dragonwing — Debian, App Lab, Edge Impulse |
| I/O | USB-C, Wi-Fi, BT, UNO headers, **Qwiic** |
| Tooling | App Lab + Arduino IDE 2.x |

---

## MPU6886 (patient IMU)

| Spec | Detail |
|------|--------|
| Part | **MPU6886** (often sold as HW688 / GY-688 breakout) |
| Bus | I2C / Qwiic to UNO Q |
| Data | 3-axis accel + 3-axis gyro, ~50 Hz for Edge Impulse |
| Mount | On patient limb or wearable — **not** on the arm tip |
| Models | Baseline, Bicepcurl, Lateralraise, Elbowflexion (Edge Impulse) |

Patient sensing is **independent** from arm joint control (open-loop servos via PWM).

---

## Power — 12 V · 5 A

| Rail | Feeds |
|------|--------|
| **12 V · 5 A** | Servo bus (via PCA9685 VMOT or 6 V buck — match servo rating) |
| **USB-C PD** | Arduino UNO Q logic (keep servo current off USB when possible) |

**Why 5 A:** shoulder + elbow can stall together during reach-out or HTL; insufficient amps = energetic failure even with perfect code.

---

## PCA9685 PWM driver

| Spec | Detail |
|------|--------|
| Channels used | **0–4** (base, shoulder, elbow, wrist, gripper) |
| Frame rate | **50 Hz** |
| Bus | I2C from UNO Q MCU |
| Library | Adafruit PWM Servo Driver |

### Channel map

| CH | Joint | Servo | Notes |
|----|-------|-------|--------|
| 0 | Base | MG90S | Yaw |
| 1 | Shoulder | MG90D | Gravity joint, inverted PWM |
| 2 | Elbow | MG90D | Band **[90°, 180°]** |
| 3 | Wrist | MG90S | Inverted mount |
| 4 | Gripper | MG90S or servo | Open/close % |

---

## Arm — Lozada Dynamics (or equivalent)

**Primary:** Lozada Dynamics 4-DOF kit.  
**Equivalent:** cheap OWI-class arm with **MG90S** servos and **DC gearmotors** (relay-switched on some axes).

| Component | Typical use |
|-----------|-------------|
| MG90S | Base, wrist, gripper |
| MG90D | Shoulder, elbow (upgrade if kit ships all MG90S) |
| DC motors | Optional on kit — driven via relay module, not PCA9685 |

### Link lengths (mm) — calibrated for this repo

| Segment | mm |
|---------|-----|
| Floor → base | 60 |
| L0 (base → shoulder) | 30 |
| L1 (shoulder → elbow) | 90 |
| L2 (elbow → wrist) | 70 |
| L3 (wrist → tool) | 50 |

Different arm? Re-measure and update [kinematics.md](kinematics.md).

---

## Joint convention (locked)

- **Stable home:** `{90, 90, 95, 90}`
- Elbow **[90°, 180°]** only
- Tip FK **Z ≥ 15 mm** above floor

Full BOM table: [bom.md](bom.md)
