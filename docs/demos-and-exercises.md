# Demos and rehabilitation exercises

> **Demo clips:** MP4 files live in [`Images/`](../Images/) (e.g. `10bicep.mp4`). GitHub/Hackster READMEs cannot embed `<video>` — open files locally or use the [Online Simulator](https://onlinesimulator.expo.app) for live motion.

## Rehabilitation exercises (3 protocols)

3 reps each · cubic ease · hold at peak · return to gravity-safe home.

| ID | Protocol | Motion summary | Clip |
|----|----------|----------------|------|
| `bicep` | Bicep curl | Locked shoulder + elbow · wrist **180° → 25°** | `Images/10bicep.mp4` |
| `lateral` | Lateral raise | Locked shoulder + elbow · wrist tip-out → tip-down | `Images/11lateral.mp4` |
| `elbowflex` | Elbow flexion | Shoulder horizontal · elbow **95° → 180°** | `Images/12elbow.mp4` |

Exercise math and waypoints: [exercises.md](exercises.md).

---

## Demo repertoire (capability + calibration check)

Run these after wiring to verify `calibration.json` and link lengths before therapy.

| Demo | Clip | What it validates |
|------|------|-------------------|
| **Orbital trace** | `Images/6orbit.mp4` | IK consistency — flat circle, wrist neutral |
| **HTL tucked carry** | `Images/3htf.mp4` | Torque + floor guard — tip Z ≥ 15 mm |
| **Cobra strike** | `Images/8cobra.mp4` | Delta snap/brake — max °/tick clamp |
| **Transport pose** | `Images/2trans.mp4` | Idle hold — no hunt at packed pose |
| **Loaded hold** | `Images/9dumbell.mp4` | Payload stress — manipulability ≥ 0.4 |

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
