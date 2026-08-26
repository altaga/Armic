# Control stack — industrial motion on a hobby arm

Armic runs on **MG90-class servos** and a **PCA9685** PWM board — not harmonic drives or closed-loop encoders. Smooth, predictable motion comes from **layered math** on the **Arduino UNO Q MCU**, the same ideas industrial arms use at a smaller scale:

| Industrial idea | Armic implementation |
|-----------------|----------------------|
| Kinematic model | Analytical FK / IK with pitch and branch selection |
| Path planning | Cartesian waypoints + loaded **C-curve (HTL)** state machine |
| Trajectory generation | Rate-limited joints + **ease-in-out cubic** + 7-segment S-curves |
| Dynamics awareness | Static gravity torques → **velocity derating** before stall |
| Posture quality | **Yoshikawa manipulability** in telemetry / twin |
| Calibration | Per-servo PWM maps + DIRECT/INVERTED + hard clamps |
| Safe motion | Floor FK guard, elbow band, stable home, E-stop hold |

```
Cartesian command                Joint-space command
      │                                │
      ▼                                ▼
  Planner (mm)                   ProtocolRunner
      │                          (protocols / exercises)
      ▼                                │
  waypoint stream                      │
      ▼                                │
  IK solver ◄──────────────────────────┘
      │
      ▼
  Torque estimate → velocity scale
      │
      ▼
  MotionProfile (deg/s cap)  or  easeInOutCubic lerp
      │
      ▼
  angles → PWM (calibrated, clamped)
      │
      ▼
  PCA9685 @ 50 Hz → servos
```

Deep dives:

| Doc | Topic |
|-----|--------|
| [kinematics.md](kinematics.md) | FK, IK, PWM maps, branch selection |
| [motion-planning.md](motion-planning.md) | Planner, profiles, exercises, protocols |
| [dynamics.md](dynamics.md) | Torque model, strain derating, manipulability, compensators |

---

## Real-time loop (MCU)

Two motion engines share one PWM bus; only one runs at a time.

| Engine | Trigger | Update |
|--------|---------|--------|
| **ArmPipeline** | `target x y z [pitch]` | ~**100 Hz** (10 ms tick) |
| **ProtocolRunner** | `protocol …` / `exercise …` | Same tick via `main` loop |

**Critical rule:** when idle, the pipeline **does not write PWM**. Re-sending the same PWM tick is also skipped to avoid servo hunt/jitter.

---

## Why it feels smooth

1. **No Cartesian jumps** — IK runs every 2 mm along the path, not only at the destination.
2. **No IK flips** — dual elbow branches; pick lower gravity torque or pose closest to current joints.
3. **No velocity steps** — joints move at capped deg/s; rehab legs use cubic ease, not linear snap.
4. **No stall hunting** — strain above ~80% of safe stall torque slows motion (min 40% speed).
5. **No floor scrapes** — exercise lerps binary-search `u` if FK tip Z would drop below 15 mm.
6. **No bad home paths** — home is always **joint-space** to `{90,90,95,90}`; never IK to base singularity (r ≈ 0).

---

## Digital twin parity

The simulator (`pipeline.js`, `s_curve.js`) mirrors firmware math so poses, HTL routing, and S-curves can be tuned offline before flashing the UNO Q MCU.

---

## Module map (firmware)

| Module | Responsibility |
|--------|----------------|
| `kinematics` | FK, IK, `estimate_torques`, angle ↔ PWM |
| `Planner` | mm waypoints; loaded tuck FSM |
| `ArmPipeline` | IK loop + derating + `MotionProfile` |
| `MotionProfile` | Per-joint velocity cap with scale factor |
| `ProtocolRunner` | Demos, HTL chain, rehab exercises |
| `Compensators` | Droop + backlash feedforward (twin / future HW) |
| `DeviceState` | Angles, mode, `STATE` telemetry |
| `main` | Serial parser, gripper smoothstep, PCA9685 drive |
