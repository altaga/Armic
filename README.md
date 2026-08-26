# Armic

<img src="./Images/logo.jpg" alt="Armic logo" width="280">

**ARMIC** — autonomous rehabilitation with a 4-DOF assistive arm, edge AI, and the **Arduino UNO Q**.

Patient motion is verified at the edge; the UNO Q MCU drives therapy-assist protocols on a calibrated robotic arm in real time.

---

## What makes the motion “industrial” on hobby hardware

MG90 servos + PCA9685 PWM — but motion is shaped by a full **MCU control stack**:

- Analytical **FK / IK** with torque-aware branch selection  
- **2 mm Cartesian waypoints** + loaded **C-curve (HTL)** planning  
- **Rate-limited** joints + cubic ease + 7-segment S-curves  
- Static **gravity torque** model → velocity derating before stall  
- **Yoshikawa manipulability** + floor FK guards on rehab paths  

Start here: **[docs/control-stack.md](docs/control-stack.md)**

---

## What this repo is

Documentation and project baseline for the **Arduino UNO Q** build of Armic.

Active firmware (kinematics, pipeline, protocols, exercises) is being ported onto the **UNO Q MCU**. This repository holds **product docs, math, conventions, and BOM**.

| Area | Status |
|------|--------|
| Control docs / conventions | **In repo** |
| 4-DOF arm firmware brain | **In progress** (UNO Q MCU port) |
| App Lab dashboard / Edge Impulse | Planned (UNO Q Linux MPU) |

---

## Why Arduino UNO Q

| Brain | Role in Armic |
|--------|----------------|
| **MCU (STM32U585)** | Real-time arm control: IK, S-curve motion, rehab protocols, PCA9685 PWM |
| **MPU (Qualcomm Dragonwing / Debian)** | App Lab UI, Edge Impulse exercise classification, session logging |

**Contest lanes:** Social Impact & Robotics.

---

## Documentation

| Doc | Contents |
|-----|----------|
| **[control-stack.md](docs/control-stack.md)** | Overview — how layers combine |
| [architecture.md](docs/architecture.md) | Dual-brain layout, modules, safety |
| [kinematics.md](docs/kinematics.md) | FK, IK equations, PWM calibration |
| [motion-planning.md](docs/motion-planning.md) | Planner, S-curves, exercises, protocols |
| [dynamics.md](docs/dynamics.md) | Torque model, derating, manipulability |
| [hardware.md](docs/hardware.md) | UNO Q + arm BOM |
| [setup.md](docs/setup.md) | Bring-up checklist |
| [serial-protocol.md](docs/serial-protocol.md) | Command reference |
| [exercises.md](docs/exercises.md) | Locked rehab poses |
| [htl-reference.md](docs/htl-reference.md) | Heavy Tucked Lift |
| [bom.md](docs/bom.md) | Bill of materials |

**AI rule:** [`.cursor/rules/arm-rehab-exercises.mdc`](.cursor/rules/arm-rehab-exercises.mdc)

---

## Locked conventions

- Stable home: `{90, 90, 95, 90}`
- Elbow band: **[90°, 180°]** only
- Tip above floor: FK **Z ≥ ~15 mm**

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
