# Architecture — Armic on Arduino UNO Q

## Dual-brain split

```
┌─────────────────────────────────────────────────────────────┐
│                     Arduino UNO Q                           │
│  ┌──────────────────────┐    ┌───────────────────────────┐  │
│  │  MPU (Linux)         │    │  MCU (STM32U585)          │  │
│  │  App Lab / Debian    │◄──►│  Arduino sketch           │  │
│  │  • Edge Impulse      │Bridge│  • ArmPipeline (IK path) │  │
│  │  • Dashboard / UI    │ RPC │  • ProtocolRunner        │  │
│  │  • Session / AI coach│    │  • DeviceState telemetry  │  │
│  └──────────────────────┘    │  • PCA9685 PWM @ 50 Hz    │  │
│                              └─────────────┬─────────────┘  │
└────────────────────────────────────────────┼────────────────┘
                                             │ I2C
                                      ┌──────▼──────┐
                                      │   PCA9685   │
                                      │  16-ch PWM  │
                                      └──────┬──────┘
                         ch0..ch4 ── base / shoulder / elbow / wrist / gripper
                                      └──────────────► 4-DOF arm + claw
```

| Side | Responsibility |
|------|----------------|
| **MCU** | Deterministic motion: kinematics, S-curve, protocols, exercises, PWM safety clamps |
| **MPU** | AI classification, web/App Lab UI, logging, high-level session commands |

Today’s active work is the **MCU arm brain** (ported from the portable ArmDriver kit). MPU App Lab pieces come next.

---

## Firmware modules (MCU)

| Module | Role |
|--------|------|
| `main` | Serial command parser, PWM drive/release, boot home, 100 Hz update loop |
| `config.h` | Per-channel PWM MIN / CENTER / MAX (calibrated) |
| `kinematics` | Link lengths, FK / IK, angle ↔ PWM, joint soft limits |
| `ArmPipeline` | Cartesian target → planner → compensators → motion profile → PWM |
| `ProtocolRunner` | Named protocols + rehab exercises (joint-space S-curves) |
| `DeviceState` | Shared angles / payload / gripper / `STATE` telemetry |
| `Planner` | Path planning (including loaded tuck behavior) |
| `MotionProfile` | S-curve timing |
| `Compensators` | Droop + backlash feedforward (twin / future HW enable) |

Update cadence: **~100 Hz** (`dt` ≈ 10 ms) while protocols or the Cartesian pipeline are active.

**Control math (full detail):** [control-stack.md](control-stack.md) · [kinematics.md](kinematics.md) · [motion-planning.md](motion-planning.md) · [dynamics.md](dynamics.md)

---

## Control path (current)

```
Host (serial / later App Lab Bridge)
        │  commands
        ▼
MCU command handler
        │
        ├─► ProtocolRunner  (home, snake, exercises, …)
        ├─► ArmPipeline     (target x y z [pitch])
        └─► Direct PWM / gripper helpers
                │
                ▼
        PCA9685 → servos
                │
                ▼
        DeviceState telemetry → host
```

---

## Safety layers

1. **Hard PWM band** — firmware never writes outside a global safe tick range.
2. **Per-channel calibrated band** — each servo has its own MIN / CENTER / MAX.
3. **Elbow soft limits** — angles clamped to **[90°, 180°]**.
4. **Floor rule** — tip FK **Z ≥ ~15 mm** before applying poses.
5. **E-stop / stop** — halt protocols + pipeline; park at **stable home** (elbow 95°), never gravity-hunt at elbow 90°.

---

## Roadmap (docs ↔ code)

| Phase | Deliverable |
|-------|-------------|
| Now | Document conventions; port MCU firmware to UNO Q Arduino core; remap I2C / OE pins |
| Next | App Lab Brick: send `exercise` / `protocol` over Bridge; show telemetry |
| Next | Edge Impulse on MPU for patient-side exercise detection |
| Contest | Hackster write-up: BOM, schematics, code, demo video |
