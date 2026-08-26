# Dynamics, torque & compensators

Static models and feedforward used to keep hobby servos inside their safe envelope and to rate telemetry like an industrial controller would.

---

## 1. Link model (gravity torques)

`estimate_torques(angles, payload_grams)` uses a **planar static** model:

| Link | Mass (kg) | CoG offset (mm) |
|------|-----------|-----------------|
| Upper arm (L1) | 0.080 | 45 |
| Forearm (L2) | 0.050 | 35 |
| Tool (L3) | 0.030 | 25 |

Payload mass `m_p = payload_grams / 1000`.

### Cumulative tilt (world frame)

```
φ₁ = (shoulder − 90°) · (π/180)
φ₂ = φ₁ + (elbow − 90°) · (π/180)
φ₃ = φ₂ + (wrist − 90°) · (π/180)
```

### Joint torques (Nm, magnitude)

```
τ_wrist   = g · |M₃·r₃·sin(φ₃) + m_p·L₃·sin(φ₃)|
τ_elbow   = g · |M₂·r₂·sin(φ₂) + M₃·(L₂·sin(φ₂)+r₃·sin(φ₃)) + m_p·(L₂·sin(φ₂)+L₃·sin(φ₃))|
τ_shoulder= g · |M₁·r₁·sin(φ₁) + … + m_p·(L₁·sin(φ₁)+L₂·sin(φ₂)+L₃·sin(φ₃))|
```

with g = 9.81 m/s² and link lengths converted to meters.

This is the same structure used in the simulator for “strain” bars and watts estimates.

---

## 2. Stall-safe derating (pipeline)

MG90D-class stall torque ≈ **0.2108 Nm**; wrist ≈ **0.1863 Nm**. Firmware uses **80%** as continuous safe limit:

```
STALL_SAFE = stall_torque × 0.80
strain_%   = (τ_joint / STALL_SAFE) × 100
maxStrain  = max(strain_sh, strain_el, strain_wr)
scale      = 1 − 0.60 × (maxStrain / 100)
scale      = clamp(scale, 0.40, 1.0)
```

`MotionProfile.setVelocityScale(scale)` slows **all joints** when the pose is heavy — reduces thermal shutdown and “buzzing” near stall.

Payload input: `payload <kg>` clamped **[0, 0.5]**. Claw mid/closed also marks **loaded** for path planning (HTL), independent of kg.

---

## 3. Yoshikawa manipulability

Planar Jacobian columns (shoulder, elbow, wrist) in the arm plane:

```
J = [ ∂x/∂q₁  ∂x/∂q₂  ∂x/∂q₃ ]
    [ ∂z/∂q₁  ∂z/∂q₂  ∂z/∂q₃ ]

j₀ₖ = L_k · cos(φ_k)    (radial)
j₁ₖ = −L_k · sin(φ_k)   (vertical)
```

Manipulability index:

```
w = √(det(J · Jᵀ)) = √(a₀₀·a₁₁ − a₀₁²)
```

Emitted in `STATE` telemetry as `w=…`. Low **w** ⇒ near singular posture (elbow locked straight, tip far on axis). IK branch selection prefers **lower peak τ** when both elbow solutions are valid — aligns with staying away from gravity-heavy configurations.

---

## 4. IK branch selection (torque-aware)

When both elbow branches (+β and −β from law of cosines) pass joint limits and FK verify:

- If **prefer** pointer set (orbital path): pick branch **closer in joint space** to previous pose.
- Else: pick branch with **lower** `max(τ_shoulder, τ_elbow, τ_wrist)`.

Prevents mid-path flips and favors postures that need less holding torque.

---

## 5. Compensators (feedforward)

`Compensators` module — active in digital twin; droop disabled on hardware until sign is validated.

### Gravity droop

Radial reach `R = √(x² + y²)` adds shoulder offset:

```
Δθ_shoulder = R × K_DROOP     (K_DROOP = 0.015 °/mm)
```

Compensates flex under load so the tip stays level when extending.

### Backlash (gear slack)

When joint direction reverses, inject offset in new direction:

| Joint | Backlash (°) |
|-------|--------------|
| Base | 1.0 |
| Shoulder | 1.5 |
| Elbow | 2.0 |
| Wrist | 1.0 |

**Disabled in live pipeline** (`dither` also off by default) — ±2°/tick caused hunt on MG90 gears. Available for twin tuning before re-enabling on UNO Q.

---

## 6. Telemetry (`DeviceState`)

~**20 Hz** `STATE` lines on serial (50 ms min interval):

```
STATE mode=… b=…,…,…,… pwm=… strain=sh,el,wr w=… watts=… payload=… claw=… loaded=…
```

**Watts estimate** (diagnostic, not measured):

```
I_joint ≈ I_idle + (τ / τ_stall) × (I_stall − I_idle)
P ≈ 5 V × Σ I_joint
```

Useful for comparing poses (Transport vs reach-out) in demos and Hackster videos.

---

## 7. Industrial parallels

| Concept | Armic on hobby hardware |
|---------|---------------------------|
| Payload rating vs reach | HTL tuck + Transport carry pose |
| Torque-limited speed | `velocity_scale` from static τ |
| Singularity avoidance | Manipulability + IK branch rules |
| Jerk limits | S-curve / cubic ease |
| Gravity comp | Droop feedforward (twin) |
| Gear backlash comp | Direction-aware offset (twin) |

The arm is not force-controlled — but **planning + limiting + modeling** give much of the *behavior* users associate with industrial arms, without the bill of materials.
