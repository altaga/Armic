# Hardware — Arduino UNO Q + ARMIC stack

All controller references are **Arduino UNO Q** only.

---

## Hardware list & why each part matters

| Hardware | Why ARMIC needs it | If you skip it |
|----------|-------------------|----------------|
| **Arduino UNO Q** | MCU = arm firmware; MPU = App Lab + Edge Impulse | No platform, no dual-brain story |
| **12 V · 5 A barrel adapter** | Laptop-style brick + **5.5×2.1 mm** plug | Sag, weak motion under load |
| **Barrel → screw terminal** | Safe wiring from jack to HW-688 | Loose power, demo failures |
| **HW-688 buck module** | **12 V → stable 5 V** for logic + MG90-safe rail | Brown-out, jitter, MCU resets |
| **PCA9685** | 50 Hz PWM for 5 servo channels over I2C | Timing jitter, harsh motion |
| **Lozada Dynamics arm** *(or MG90S + DC kit)* | Calibrated 4-DOF mechanism | Wrong poses, floor hits, stalls |

---

## Arduino UNO Q

| Spec | Detail |
|------|--------|
| Board | **Arduino UNO Q** (4 GB) |
| MCU | STM32U585 — arm firmware, PCA9685, 100 Hz loop |
| MPU | Qualcomm Dragonwing — Debian, App Lab, Edge Impulse |
| I/O | USB-C, Wi-Fi, BT, UNO headers, **Qwiic** |
| Tooling | App Lab + Arduino IDE 2.x |

---

## Power chain — 12 V brick + terminal adapter + HW-688

### 12 V · 5 A DC adapter (laptop-style)

| Spec | Detail |
|------|--------|
| Form | **Barrel-jack brick** (same idea as a laptop power supply) |
| Output | **12 V DC · 5 A** (60 W class) |
| Connector | **5.5 mm OD × 2.1 mm ID** barrel plug (center-positive — verify on your brick label) |

Main entry power. Sized for **multiple servo stall peaks** (~650 mA each). This feeds the HW-688 — **not** the servos at 12 V.

### 5.5 mm × 2.1 mm → screw terminal adapter

| Spec | Detail |
|------|--------|
| Type | **DC barrel socket → screw terminals** |
| Purpose | Plug in the brick; land **+12 V** and **GND** on a terminal block for bench wiring |
| Why | Solid screw connections to HW-688 and ground bus — no fragile alligator clips during arm motion |

### HW-688 DC-DC buck (step-down)

| Spec | Detail |
|------|--------|
| Type | High-power **buck converter** module |
| Input | **9 V – 36 V** (typically **12 V** from station PSU) |
| Output | **5.0 V – 5.2 V** regulated |
| Feeds | UNO Q logic rail, PCA9685 VCC, PCA9685 VMOT → MG90 servos |

**Why not wire 12 V straight to servos?** MG90-class servos expect **~4.8–6 V**. 12 V destroys them. **Why not USB only?** Servo stall current drops USB voltage → UNO Q brown-out mid-demo.

```
12 V · 5 A brick (5.5×2.1 mm barrel)
        │
        ▼
Screw terminal adapter (+ / −)
        │
        ├──► HW-688 ──► 5 V ──► UNO Q · PCA9685 · servos (VMOT)
        └──► common GND
```

Check your HW-688 module's **maximum output current** (aim **≥3 A** on 5 V for arm + board).

---

## PCA9685 PWM driver

| Spec | Detail |
|------|--------|
| Channels used | **0–4** (base, shoulder, elbow, wrist, gripper) |
| Frame rate | **50 Hz** |
| Bus | I2C from UNO Q MCU |
| Power | **VCC** from 5 V rail; **VMOT** from same 5 V rail (or separate 6 V buck if preferred) |

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
| DC motors | Optional — relay module, not PCA9685 |

### Link lengths (mm)

| Segment | mm |
|---------|-----|
| Floor → base | 60 |
| L0 | 30 |
| L1 | 90 |
| L2 | 70 |
| L3 | 50 |

---

## Patient sensing (planned — separate from HW-688)

| Item | Role |
|------|------|
| Qwiic 6-axis IMU | Patient limb motion → Edge Impulse on **MPU** |

The **HW-688 is power electronics only** — not a sensor. Do not confuse with IMU breakout boards.

---

## Joint convention (locked)

- **Stable home:** `{90, 90, 95, 90}`
- Elbow **[90°, 180°]** only
- Tip FK **Z ≥ 15 mm** above floor

Full BOM: [bom.md](bom.md)
