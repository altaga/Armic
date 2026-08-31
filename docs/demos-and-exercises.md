# Demos and rehabilitation exercises

> **Motion clips:** optimized GIFs in [`Images/`](../Images/) (`10bicep.gif`, `3htf.gif`, …). Regenerate: `cd scripts/optimize-images && npm run gifs`.

## Rehabilitation exercises (3 protocols)

3 reps each · cubic ease · hold at peak · return to gravity-safe home.

| Bicep curl | Lateral raise | Elbow flexion |
|---|---|---|
| <img src="../Images/10bicep.gif" alt="Bicep curl" width="280"> | <img src="../Images/11lateral.gif" alt="Lateral raise" width="280"> | <img src="../Images/12elbow.gif" alt="Elbow flexion" width="280"> |

| ID | Protocol | Motion summary |
|----|----------|----------------|
| `bicep` | Bicep curl | Locked shoulder + elbow · wrist **180° → 25°** |
| `lateral` | Lateral raise | Locked shoulder + elbow · wrist tip-out → tip-down |
| `elbowflex` | Elbow flexion | Shoulder horizontal · elbow **95° → 180°** |

Exercise math and waypoints: [exercises.md](exercises.md).

---

## Demo repertoire (capability + calibration check)

Run these after wiring to verify `calibration.json` and link lengths before therapy.

| HTL tucked carry | Orbital trace | Cobra strike | Transport pose | Loaded hold |
|---|---|---|---|---|
| <img src="../Images/3htf.gif" alt="HTL" width="200"> | <img src="../Images/6orbit.gif" alt="Orbital" width="200"> | <img src="../Images/8cobra.gif" alt="Cobra" width="200"> | <img src="../Images/2trans.gif" alt="Transport" width="200"> | <img src="../Images/9dumbell.gif" alt="Loaded hold" width="200"> |

| Demo | What it validates |
|------|-------------------|
| **Orbital** | IK consistency — flat circle, wrist neutral |
| **HTL** | Torque + floor guard — tip Z ≥ 15 mm |
| **Cobra** | Delta snap/brake — max °/tick clamp |
| **Transport** | Idle hold — no hunt at packed pose |
| **Loaded hold** | Payload stress — manipulability ≥ 0.4 |

Protocol IDs: `home`, `cpose`, `transport`, `snake`, `cobra`, `gimmefive`, `orbital`, `htl`, `pendulum` — see [serial-protocol.md](serial-protocol.md).

---

## Why this is not a raw servo arm

| — | Raw PWM on MG90s | With ARMIC firmware |
|---|---|---|
| FK / IK | Manual tuning | Law-of-cosines solver, dual branch, self-verify |
| Calibration | Per-servo drift | MIN/CENTER/MAX per channel in SSoT |
| Planning | IK jumps → snap | 2 mm micro-steps |
| Loaded carries | Shoulder stall | HTL sequence — ~67% less shoulder torque at tuck |
| Profiles | Linear snaps | S-curves, 18°/s therapy cap |
| Floor / elbow | Table scrape, gear strip | Tip Z ≥ 15 mm, elbow ∈ [90°, 180°] |
| Home | Singularity at 90° | Joint home {90, 90, **95**, 90} |

HTL detail: [htl-reference.md](htl-reference.md).
