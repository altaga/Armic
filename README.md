# Armic

<img src="./Images/logo.jpg" alt="Armic logo" width="280">

**ARMIC** — autonomous rehabilitation with a 4-DOF assistive arm, edge AI, and the **Arduino UNO Q**.

Patient motion is verified at the edge; the UNO Q MCU drives therapy-assist protocols on a calibrated robotic arm in real time.

---

## What this repo is

Documentation and project baseline for the **Arduino UNO Q** build of Armic.

Active firmware work (kinematics, PWM pipeline, rehab exercises, serial protocol) currently lives in the local PlatformIO portable kit and is being ported onto the **UNO Q MCU** (STM32U585 / Arduino core). This repository holds the **product docs, conventions, and BOM** so the contest entry and team stay aligned.

| Area | Status |
|------|--------|
| Docs / conventions | **In repo** (`docs/`) |
| 4-DOF arm firmware brain | **In progress** (UNO Q MCU port) |
| App Lab dashboard / Edge Impulse | Planned (UNO Q Linux MPU) |
| Web serial control UI | Planned (Bridge / App Lab) |

---

## Why Arduino UNO Q

| Brain | Role in Armic |
|--------|----------------|
| **MCU (STM32U585)** | Real-time arm control: IK, S-curve motion, rehab protocols, PCA9685 PWM, serial / Bridge commands |
| **MPU (Qualcomm Dragonwing / Debian)** | App Lab UI, Edge Impulse exercise classification, session logging, optional HuggingFace coach |

That split matches the contest dual-brain model: **real-time assist on the MCU**, **AI + UX on Linux**.

**Contest lanes:** Social Impact (measurable rehab) and Robotics (assistive arm).

---

## System loop

```
Patient performs therapy
        │
        ▼
Edge ML (MPU / Edge Impulse) ── verifies exercise / reps
        │
        ▼
App Lab / Bridge ── session command
        │
        ▼
UNO Q MCU ── ArmPipeline + ProtocolRunner ── PCA9685 ── 4-DOF arm
        │
        ▼
Assistive motion + telemetry back to dashboard
```

---

## Documentation

| Doc | Contents |
|-----|----------|
| [docs/architecture.md](docs/architecture.md) | Dual-brain layout, firmware modules, data flow |
| [docs/hardware.md](docs/hardware.md) | Arduino UNO Q + arm BOM, I2C PWM, joint map |
| [docs/setup.md](docs/setup.md) | Tooling and bring-up checklist |
| [docs/serial-protocol.md](docs/serial-protocol.md) | Command reference (protocols, exercises, IK) |
| [docs/kinematics.md](docs/kinematics.md) | Link lengths, joint convention, PWM calibration |
| [docs/exercises.md](docs/exercises.md) | Locked rehab pose references |
| [docs/htl-reference.md](docs/htl-reference.md) | Heavy Tucked Lift (loaded C-curve) |
| [docs/bom.md](docs/bom.md) | Bill of materials |

**Locked AI rule:** [`.cursor/rules/arm-rehab-exercises.mdc`](.cursor/rules/arm-rehab-exercises.mdc)

---

## Locked conventions (do not invent)

- Stable home: `{90, 90, 95, 90}` (elbow **95°** hold)
- Elbow band: **[90°, 180°]** only
- Tip above floor: FK **Z ≥ ~15 mm**
- Rehab poses: only the photo-matched sets in `docs/exercises.md`

---

## Quick serial commands (MCU)

```
protocol home|cpose|transport|snake|cobra|gimmefive|orbital|htl|pendulum|stop|estop
exercise bicep|lateral|elbowflex
target <x> <y> <z> [pitch]
joints <b> <sh> <el> <wr>
payload <kg>
gripper <0-100|open|mid|close>
```

Full list: [docs/serial-protocol.md](docs/serial-protocol.md)

---

## Team

- [Victor Alonso Altamirano](https://www.linkedin.com/in/victor-alonso-altamirano-izquierdo-311437137/)
- [Alejandro Sanchez Gutierrez](https://www.linkedin.com/in/alejandro-sanchez-gutierrez-11105a157/)
- [Luis Eduardo Arevalo Oliver](https://www.linkedin.com/in/luis-eduardo-arevalo-oliver-989703122/)

---

*ARMIC — programmable, intelligent rehabilitation on Arduino UNO Q.*
