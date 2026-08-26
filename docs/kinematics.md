# Kinematics & calibration

Source of truth for the 4-DOF Armic arm. **Do not change constants** without a new measured calibration session.

## Link lengths (mm)

```
floor ──60── base pivot ──30── shoulder ──90── elbow ──70── wrist ──50── gripper base
         FLOOR_OFFSET      L0            L1         L2         L3
```

| Symbol | mm | Meaning |
|--------|-----|---------|
| `FLOOR_OFFSET` | 60 | Floor → base pivot |
| `L0` | 30 | Base → shoulder |
| `L1` | 90 | Shoulder → elbow |
| `L2` | 70 | Elbow → wrist |
| `L3` | 50 | Wrist → gripper base |

## World frame

- **+X** — viewer right  
- **+Y** — forward (away)  
- **+Z** — up  
- **Z = 0** — floor plane  

## Joint convention (locked)

| Joint | 90° meaning | Soft limits |
|-------|-------------|-------------|
| Base | Arm along +X (yaw in floor plane) | [0°, 180°] |
| Shoulder | Upper arm straight up (+Z); >90° leans forward | [0°, 180°] |
| Elbow | Forearm aligned (straight); 180° = folded back ⊥ | **[90°, 180°]** only |
| Wrist | L3 aligned with forearm | [0°, 180°] |

**Stable home:** `{base:90, shoulder:90, elbow:95, wrist:90}`

## PWM direction

| Joint | Direction | Notes |
|-------|-----------|--------|
| Base | Direct (+1) | |
| Shoulder | **Inverted (−1)** | |
| Elbow | Direct (+1) | |
| Wrist | **Inverted (−1)** | Mount folds opposite FK label |

## Per-channel PWM calibration (ticks @ 50 Hz)

Measured ramp protocol (not autodetect). Hard firmware sanity band ≈ **[50, 600]**; calibrated bands must lie inside it.

| CH | Joint | MIN | CENTER | MAX |
|----|-------|-----|--------|-----|
| 0 | Base | 100 | 300 | 500 |
| 1 | Shoulder | 90 | 290 | 490 |
| 2 | Elbow | 100 | 300 | 500 |
| 3 | Wrist | 100 | 300 | 500 |
| 4 | Gripper | 236 (closed) | 338 (mid) | 440 (open) |

1 tick ≈ 4.88 µs at 50 Hz. Center ≈ 1.5 ms class pulse for 90°.

## IK / dynamics (firmware + twin)

- Analytical IK with torque-aware branch selection.
- Failure modes: unreachable, base singularity, out of range, joint limits.
- Payload mass (`payload <kg>`) feeds derating / loaded planning.
- Yoshikawa manipulability used in the digital twin for posture rating.

## Floor safety

Before applying any exercise pose or lerp, tip **Z from FK ≥ 15 mm**.  
Never invent mid-waypoints that dive the tip toward the floor (especially shoulder 180↔90 while elbow also moves).
