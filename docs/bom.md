# Bill of materials — ARMIC (Arduino UNO Q build)

One demo station. All items in the **main list** are required unless marked optional.

**Cost summary (USD, Aug 2026):**

| Tier | Items | Total |
|------|--------|-------|
| **Core arm station** | UNO Q (4 GB) + 12 V PSU + HW-688 + PCA9685 + MG90 arm kit + interconnect | **$154** |
| **Core (2 GB UNO Q)** | Same stack with 2 GB RAM UNO Q (**$59**) | **$134** |
| **+ Wearable** | M5 Core2 (Edge Impulse classifier → MQTT) | **+$36 → $190** |
| **Hobby baseline** | MG90 arm kit only (no UNO Q, no agent, no safety stack) | **$50** |

The **+$104** over a bare hobby arm (4 GB UNO Q build) buys: dual-brain UNO Q host, 5-layer safety stack, on-device LLM agent, MQTT wearable loop, and calibration SSoT — see the Creativity table in the Hackster story.

**UNO Q SKUs (Arduino Store):** 2 GB RAM **$59** · 4 GB RAM **$79**. ARMIC recommends **4 GB** for App Lab containers + Qwen 0.8B alongside the broker and Web UI.

---

## Main hardware list

| # | Item | Qty | USD | Why it matters |
|---|------|-----|-----|----------------|
| 1 | **Arduino UNO Q** (4 GB **$79**; 2 GB **$59**) | 1 | $79 | **Dual brain:** MCU = real-time arm (100 Hz, PCA9685, protocols); MPU = App Lab + Edge Impulse. **4 GB recommended** for the full agent stack. **Without it:** project doesn't exist. |
| 2 | **12 V · 5 A DC adapter** (laptop-style barrel) | 1 | $12 | **Main input.** Brick-style **12 V DC / 5 A** supply. Multiple MG90 stalls need **>2 A** — not USB. |
| 2b | **5.5 mm × 2.1 mm DC → screw terminal adapter** | 1 | $2 | Screws the barrel plug into a **+ / − terminal block** for the **12 V bus** to the HW-688 and ground bus. |
| 3 | **HW-688** DC-DC buck (step-down) | 1 | $4 | **Stable 5 V rail.** **9–36 V in** ← **12 V** → **5.0–5.2 V out** for UNO Q, PCA9685, MG90 servos. |
| 4 | **PCA9685** 16-channel PWM driver | 1 | $4 | Hardware **50 Hz** servo timing over I2C (ch0–4 = joints + gripper). **Without it:** jittery PWM, CPU load, bad rehab timing. |
| 5 | **MG90 assembled arm kit** (KUKA-style 4-DOF) | 1 | $50 | Physical plant calibrated in firmware (link lengths, poses). [Mercado Libre MX listing](https://listado.mercadolibre.com.mx/kit-brazo-robotico-armado-servo-mg90s). **Without it / wrong kit:** IK and exercises don't match reality. |
| — | Dupont / Qwiic cables, heat-shrink, breadboard | — | $3 | UNO Q ↔ PCA9685 I2C + ground bus. |

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
12 V · 5 A brick (barrel jack, center-positive 5.5×2.1 mm typical)
        │
        ▼
DC barrel → screw terminal adapter (+ / −)
        │
        ├──► HW-688 IN+ / IN−
        │         │
        │         └──► 5 V OUT ──► UNO Q logic · PCA9685 VCC · PCA9685 VMOT
        │
        └──► common GND (star at terminal adapter −)
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
| **5.5 mm × 2.1 mm barrel → screw terminal** | 1 | Mate with 12 V brick; wire to HW-688 |
| USB-C cable + PD adapter | 1 | UNO Q dev / backup logic power (not for servos) |
| **Common ground** | — | Terminal **−** ↔ HW-688 ↔ PCA9685 ↔ UNO Q |
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
