# Bill of materials — ARMIC (Arduino UNO Q build)

One demo station. All items are **required** unless marked optional.

---

## Main hardware list

| # | Item | Qty | Est. role | Why it matters |
|---|------|-----|-----------|----------------|
| 1 | **Arduino UNO Q** (4 GB) | 1 | Compute | Dual brain: **MCU** = real-time arm control (100 Hz motion loop, PCA9685, serial/Bridge); **MPU** = Debian + App Lab + Edge Impulse for patient ML and dashboard. **Without UNO Q:** no contest platform, no edge AI, no Bridge — project doesn't exist. |
| 2 | **MPU6886** 6-axis IMU (HW688-class breakout, Qwiic/I2C) | 1 | Patient sensing | Feeds **acc + gyro @ ~50 Hz** into Edge Impulse models (Baseline / Bicepcurl / Lateralraise / Elbowflexion). Validates that the *patient* did the rep, not just the assist arm. **Without IMU:** rehab is open-loop — no measurable adherence, no ML loop. |
| 3 | **12 V · 5 A** DC power supply | 1 | Servo power | Servos need **6–7.4 V** at **high peak current** (multiple MG90 stalls). 5 A headroom prevents **voltage sag** → brown-out, buzz, weak throws, UNO Q resets on shared grounds. **Without adequate PSU:** arm looks “dead” under load; HTL and reach-out demos fail. |
| 4 | **PCA9685** 16-channel PWM driver | 1 | Servo PWM | Hardware-timed **50 Hz** pulses on I2C; drives **5 channels** (4 joints + gripper). MCU sends angle ticks, not raw timing loops. **Without PCA9685:** jittery motion, CPU starvation, unreliable rehab timing. |
| 5 | **Lozada Dynamics** 4-DOF arm *(or OWI-class kit: MG90S + DC motors)* | 1 | Mechanism | **MG90S** on lighter joints (base, wrist); **MG90D** recommended on shoulder/elbow; **DC motors** on some kits via relay module for claw/base. Matches our **link lengths & joint conventions**. **Without this arm (or equivalent calibrated kit):** IK, exercises, and HTL poses don't match physics — tips hit floor or servos stall. |

---

## Included with / on the arm kit

| Item | Qty | Notes |
|------|-----|--------|
| MG90S micro servo | 2–4 | Base, wrist, gripper (kit-dependent) |
| MG90D (upgrade) | 2 | Shoulder + elbow — **strongly recommended** for gravity loads |
| DC gearmotor | 0–2 | Some kits use DC + relay instead of servo on one axis |
| 8-ch relay module | 0–1 | If kit uses DC motors (legacy Armic driver path) |
| Gripper / claw | 1 | PCA9685 **ch4** |

---

## Interconnect & misc

| Item | Qty | Notes |
|------|-----|--------|
| Qwiic / Dupont cable | — | UNO Q ↔ PCA9685 I2C; UNO Q ↔ MPU6886 |
| USB-C cable + PD adapter | 1 | UNO Q logic power (separate from 12 V servo rail recommended) |
| Common ground | — | PSU GND ↔ PCA9685 GND ↔ UNO Q GND |
| Optional buck (12 V → 6 V) | 0–1 | If PCA9685 VMOT needs regulated 6 V instead of full 12 V (check servo rating) |

---

## Software (no BOM cost)

| Item | Role |
|------|------|
| Arduino App Lab / IDE 2.x | UNO Q development |
| Edge Impulse | Train/deploy patient exercise model on MPU |
| ARMIC firmware + docs | Arm algorithms, rehab protocols |

---

## Power budget (rule of thumb)

| Load | Current |
|------|---------|
| MG90 idle | ~100–150 mA each |
| MG90 stall | ~650 mA each |
| **Worst case** (2 joints stall) | ~1.3 A + others idle ≈ **2 A+** |
| **Recommended PSU** | **12 V · 5 A** (margin for inrush + UNO Q noise immunity) |

---

## Alternatives

| Spec item | Acceptable substitute |
|-----------|------------------------|
| Arm | Any **4-DOF** kit with MG90-class servos + known link lengths — **re-calibrate** PWM + kinematics |
| IMU | Any **6-axis** Qwiic IMU with Edge Impulse support — retrain model |
| PSU | 12 V · **≥5 A** regulated bench supply; do **not** use USB-only for servos |

Update this file when the UNO Q port locks I2C pins and exact Lozada Dynamics SKU measurements.
