# Demos and rehabilitation exercises

## Rehabilitation exercises (3 protocols)

3 reps each · cubic ease · hold at peak · return to gravity-safe home.

### Bicep curl

Locked shoulder + elbow. Wrist curls 180° → 25° and back.

<video src="../Images/10bicep.mp4" width="420" autoplay loop muted playsinline title="Bicep curl protocol"></video>

### Lateral raise

Locked shoulder + elbow. Wrist rotates tip-out → tip-down.

<video src="../Images/11lateral.mp4" width="420" autoplay loop muted playsinline title="Lateral raise protocol"></video>

### Elbow flexion

Shoulder fixed horizontal. Elbow sweeps 95° → 180°.

<video src="../Images/12elbow.mp4" width="420" autoplay loop muted playsinline title="Elbow flexion protocol"></video>

Exercise math and waypoints: [exercises.md](exercises.md).

---

## Demo repertoire (capability + calibration check)

Run these after wiring to verify `calibration.json` and link lengths before therapy.

| HTL tucked carry | Orbital trace | Cobra strike | Transport pose | Loaded hold |
|---|---|---|---|---|
| <video src="../Images/3htf.mp4" width="230" autoplay loop muted playsinline title="HTL tucked carry"></video> | <video src="../Images/6orbit.mp4" width="230" autoplay loop muted playsinline title="Orbital trace"></video> | <video src="../Images/8cobra.mp4" width="230" autoplay loop muted playsinline title="Cobra strike"></video> | <video src="../Images/2trans.mp4" width="230" autoplay loop muted playsinline title="Transport pose"></video> | <video src="../Images/9dumbell.mp4" width="230" autoplay loop muted playsinline title="Loaded hold"></video> |

| Demo | What it validates |
|------|-------------------|
| **Orbital** | IK consistency — flat circle, wrist neutral |
| **HTL** | Torque + floor guard — tip Z ≥ 15 mm, no shoulder buzz at fold |
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
