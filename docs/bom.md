# Bill of materials — ARMIC (Arduino UNO Q build)

One demo station. All items in the **main list** are required unless marked optional.

---

## Main hardware list

| # | Item | Qty | Why it matters |
|---|------|-----|----------------|
| 1 | **Arduino UNO Q** (4 GB) | 1 | **Dual brain:** MCU = real-time arm (100 Hz, PCA9685, protocols); MPU = App Lab + Edge Impulse. **Without it:** project doesn't exist. |
| 2 | **12 V · 5 A** DC power supply | 1 | **Main input.** Multiple MG90 servos can draw **>2 A** at stall. You need a real bench/barrel supply — not USB-only. **Without it:** weak motion, voltage sag under load. |
| 3 | **HW-688** DC-DC buck (step-down) | 1 | **Stable 5 V rail.** Converts **9–36 V in** (typically **12 V** from the PSU above) to **5.0–5.2 V out** for UNO Q logic, PCA9685, and MG90-class servos (4.8–6 V range). High-efficiency switching — cooler and steadier than a linear regulator at arm currents. **Without it:** powering servos from USB/unregulated taps → **brown-out, buzz, UNO Q resets** when shoulder/elbow load spikes. |
| 4 | **PCA9685** 16-channel PWM driver | 1 | Hardware **50 Hz** servo timing over I2C (ch0–4 = joints + gripper). **Without it:** jittery PWM, CPU load, bad rehab timing. |
| 5 | **Lozada Dynamics** 4-DOF arm *(or OWI-class: MG90S + DC motors)* | 1 | Physical plant calibrated in firmware (link lengths, poses). **Without it / wrong kit:** IK and exercises don't match reality. |

---

## HW-688 — power module detail

| Spec | Typical value |
|------|----------------|
| Type | High-power **DC-DC buck** (step-down) |
| Input | **9 V – 36 V** (we use **12 V** from the 5 A PSU) |
| Output | **5.0 V – 5.2 V** regulated |
| Role | Feeds **logic + servo bus** at a voltage MG90 servos tolerate |

**Do not** feed **12 V directly** to MG90 servos (rated ~4.8–6 V). The HW-688 (or a 6 V buck if you prefer) sits between the high-voltage supply and the load.

Suggested tree:

```
12 V · 5 A ──► HW-688 ──► 5 V ──► UNO Q (logic) + PCA9685 VCC + PCA9685 VMOT
                │
                └── common GND with PSU and UNO Q
```

USB-C can still power UNO Q for **development**, but for **demo / load testing** use the HW-688 rail so servo current doesn't starve the board.

---

## Included with / on the arm kit

| Item | Qty | Notes |
|------|-----|--------|
| MG90S micro servo | 2–4 | Base, wrist, gripper (kit-dependent) |
| MG90D (upgrade) | 2 | Shoulder + elbow — recommended for gravity |
| DC gearmotor | 0–2 | Some kits — relay-driven, not PCA9685 |
| 8-ch relay module | 0–1 | For DC motor axes on cheap kits |
| Gripper / claw | 1 | PCA9685 **ch4** |

---

## Interconnect & misc

| Item | Qty | Notes |
|------|-----|--------|
| Qwiic / Dupont cable | — | UNO Q ↔ PCA9685 I2C |
| USB-C cable + PD adapter | 1 | UNO Q (dev / backup logic power) |
| **Common ground** | — | PSU ↔ HW-688 ↔ PCA9685 ↔ UNO Q |
| Patient IMU (Qwiic) | 0–1 | **Optional / planned** — Edge Impulse on MPU, not part of HW-688 |

---

## Power budget (rule of thumb)

| Load | Current |
|------|---------|
| MG90 idle | ~100–150 mA each |
| MG90 stall | ~650 mA each |
| **Two joints stall** | ~1.3 A+ |
| **Recommended input PSU** | **12 V · 5 A** |
| **HW-688 output** | Must sustain **≥3 A** on 5 V rail if spec allows (check module rating) |

---

## Software (no BOM cost)

| Item | Role |
|------|------|
| Arduino App Lab / IDE 2.x | UNO Q development |
| Edge Impulse | Patient exercise ML (MPU) |
| ARMIC firmware + docs | Arm algorithms |

---

## Alternatives

| Item | Substitute |
|------|------------|
| HW-688 | Any **12 V → 5 V** buck **≥3 A** (LM2596 class minimum; prefer named high-current module) |
| Arm | 4-DOF MG90 kit — **re-calibrate** kinematics + PWM |
| PSU | **12 V · ≥5 A** regulated |

Update when UNO Q I2C pins and exact Lozada Dynamics measurements are frozen.
