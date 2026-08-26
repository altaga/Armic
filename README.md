# Armic

<img src="./Images/logo.jpg" alt="Armic logo" width="320">

**Autonomous rehabilitation with a 4-DOF assistive arm, edge AI, and the Arduino UNO Q.**

ARMIC turns physical therapy into a closed, measurable loop: the patient moves, on-device ML verifies the exercise, and a calibrated robotic arm assists with **industrial-grade motion math** on hobby hardware — all orchestrated from the **Arduino UNO Q** dual brain (STM32 MCU + Linux MPU).

---

## Table of contents

1. [Vision & problem](#vision--problem)
2. [The ARMIC loop](#the-armic-loop)
3. [Arduino UNO Q platform](#arduino-uno-q-platform)
4. [System architecture](#system-architecture)
5. [Hardware & bill of materials](#hardware--bill-of-materials)
6. [Industrial motion on a hobby arm](#industrial-motion-on-a-hobby-arm)
7. [Control stack overview](#control-stack-overview)
8. [Real-time firmware loop](#real-time-firmware-loop)
9. [Firmware modules](#firmware-modules)
10. [Kinematics — forward (FK)](#kinematics--forward-fk)
11. [Kinematics — inverse (IK)](#kinematics--inverse-ik)
12. [Angle ↔ PWM calibration](#angle--pwm-calibration)
13. [Path planning & HTL C-curve](#path-planning--htl-c-curve)
14. [Cartesian pipeline (ArmPipeline)](#cartesian-pipeline-armpipeline)
15. [Motion profiles & trajectories](#motion-profiles--trajectories)
16. [ProtocolRunner — demos & rehab](#protocolrunner--demos--rehab)
17. [Dynamics, torque & derating](#dynamics-torque--derating)
18. [Manipulability & branch selection](#manipulability--branch-selection)
19. [Compensators & feedforward](#compensators--feedforward)
20. [Telemetry](#telemetry)
21. [Rehabilitation exercises](#rehabilitation-exercises)
22. [Heavy Tucked Lift (HTL)](#heavy-tucked-lift-htl)
23. [Safety layers](#safety-layers)
24. [Serial command reference](#serial-command-reference)
25. [Setup & bring-up](#setup--bring-up)
26. [Locked conventions](#locked-conventions)
27. [Project status & roadmap](#project-status--roadmap)
28. [Team](#team)
29. [Supplementary docs](#supplementary-docs)

---

## Vision & problem

Rehabilitation today is **manual, inconsistent, and hard to measure**. Patients drop out, progress is rarely quantified, and outcomes are difficult to trust.

**ARMIC** addresses this with:

| Pillar | How |
|--------|-----|
| **Detect** | Edge Impulse classifies patient exercises on-device (MPU) |
| **Assist** | 4-DOF arm runs photo-matched therapy protocols (MCU) |
| **Measure** | Telemetry: joint angles, strain, manipulability, session mode |
| **Scale** | Arduino UNO Q + App Lab — contest-ready, dual-brain edge AI |

**Hackster / Arduino UNO Q contest focus:** **Social Impact** (measurable rehab) and **Robotics** (assistive arm).

---

## The ARMIC loop

```
Patient performs therapy
        │
        ▼
Edge ML (UNO Q MPU / Edge Impulse) ── verifies exercise & reps
        │
        ▼
App Lab / Bridge ── session command (exercise, coach, log)
        │
        ▼
UNO Q MCU ── ArmPipeline + ProtocolRunner ── PCA9685 ── 4-DOF arm
        │
        ▼
Assistive motion + STATE telemetry ──► dashboard / session record
```

The arm does not blindly copy motion — it runs **locked rehab pose sequences** (bicep curl, lateral raise, elbow flexion) with cubic easing, floor guards, and 3-rep cycles before returning to stable home.

---

## Arduino UNO Q platform

All controller references in this project are **Arduino UNO Q only**.

| Brain | Silicon | Role in ARMIC |
|-------|---------|---------------|
| **MCU** | STM32U585 (Cortex-M33) | Real-time arm brain: IK, planning, protocols, PCA9685 @ 50 Hz |
| **MPU** | Qualcomm Dragonwing QRB2210 (Linux) | App Lab UI, Edge Impulse, session logging, optional HuggingFace coach |

| Feature | Use |
|---------|-----|
| Wi-Fi 5 / Bluetooth 5.1 | Connectivity for App Lab & cloud optional |
| USB-C | Power, serial, future video |
| UNO headers + **Qwiic** | PCA9685, IMU expansion |
| **Bridge RPC** | MCU sketch ↔ Linux App Lab (planned) |

Tooling: **Arduino App Lab** (full stack) and/or **Arduino IDE 2.x** (MCU sketches).

---

## System architecture

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

### Control path (MCU)

```
Host (serial today → App Lab Bridge tomorrow)
        │  text commands
        ▼
Command handler (main)
        │
        ├─► ProtocolRunner   protocol … / exercise …
        ├─► ArmPipeline      target x y z [pitch]
        └─► Direct helpers   gripper, calibration, matrix
                │
                ▼
        angles → PWM (calibrated, clamped)
                │
                ▼
        PCA9685 → MG90 servos
                │
                ▼
        DeviceState → STATE telemetry @ ~20 Hz
```

---

## Hardware & bill of materials

### Core compute

| Qty | Item | Notes |
|-----|------|--------|
| 1 | **Arduino UNO Q** (4 GB) | MCU arm + MPU App Lab / Edge AI |

### Motion

| Qty | Item | Notes |
|-----|------|--------|
| 1 | 4-DOF robotic arm (OWI-class) | Base / shoulder / elbow / wrist |
| 1 | Gripper servo | PCA9685 **ch4** — open/close % |
| 2 | **MG90D** | Shoulder + elbow (gravity joints) |
| 2 | **MG90S** | Base + wrist |
| 1 | **PCA9685** 16-ch PWM | 50 Hz frame, I2C |
| 1 | DC supply (servo-rated) | Sized for MG90D stall current |

### Interconnect & sensing (planned)

| Item | Notes |
|------|--------|
| Qwiic / header wiring | UNO Q MCU ↔ PCA9685 I2C + OE |
| USB-C PD | UNO Q power + serial |
| IMU (Qwiic) | Patient exercise ML on MPU |

### PCA9685 channel map

| CH | Joint | Servo | PWM dir |
|----|-------|-------|---------|
| 0 | Base (yaw) | MG90S | Direct |
| 1 | Shoulder | MG90D | **Inverted** |
| 2 | Elbow | MG90D | Direct — band **[90°, 180°]** |
| 3 | Wrist | MG90S | **Inverted** |
| 4 | Gripper | — | Open/close ticks (not rotation) |

### Mechanical chain (mm) — do not change without re-calibration

```
floor ──60── base pivot ──30── shoulder ──90── elbow ──70── wrist ──50── gripper
         FLOOR_OFFSET      L0            L1         L2         L3
```

| Symbol | mm |
|--------|-----|
| `FLOOR_OFFSET` | 60 |
| `L0` | 30 |
| `L1` | 90 |
| `L2` | 70 |
| `L3` | 50 |

**World frame:** +X viewer-right, +Y forward, +Z up, **Z = 0** at floor.

---

## Industrial motion on a hobby arm

ARMIC uses **MG90-class servos** and a **PCA9685** — not harmonic drives, not encoders, not force control. Motion feels industrial because the **MCU runs the same class of algorithms** teach pendants and small cobots use, adapted to open-loop PWM:

| Industrial concept | ARMIC on UNO Q MCU |
|--------------------|---------------------|
| Kinematic model | Analytical FK / IK + tool pitch |
| Path planning | 2 mm Cartesian waypoints + loaded **C-curve (HTL)** FSM |
| Trajectory generation | Rate-limited joints + **ease-in-out cubic** + 7-segment S-curves |
| Dynamics awareness | Static gravity τ → **velocity derating** before stall |
| Posture quality | **Yoshikawa manipulability** in telemetry |
| Calibration | Per-servo PWM maps, DIRECT/INVERTED, hard clamps |
| Safe motion | Floor FK guard, elbow band, stable home, E-stop |

**Result:** a ~$50 servo arm can demo rehab assist, HTL carry, and orbital paths that **look and behave** like a much more expensive system — because the **math stack** does the heavy lifting, not the bill of materials.

---

## Control stack overview

```
Cartesian command                Joint-space command
      │                                │
      ▼                                ▼
  Planner (mm)                   ProtocolRunner
      │                          (protocols / exercises)
      ▼                                │
  waypoint stream (2 mm)               │
      ▼                                │
  IK solver ◄──────────────────────────┘
      │
      ▼
  estimate_torques → velocity_scale
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

### Why it feels smooth

1. **No Cartesian jumps** — IK every **2 mm**, not only at destination  
2. **No IK flips** — dual elbow branches; pick lower τ or closest to current pose  
3. **No velocity steps** — capped deg/s; rehab uses cubic ease  
4. **No stall hunting** — strain > ~80% safe stall → slow to min **40%** speed  
5. **No floor scrapes** — exercise lerps binary-search `u` if tip Z < **15 mm**  
6. **No bad home** — joint-space home `{90,90,95,90}`; never IK through r ≈ 0  

---

## Real-time firmware loop

Two motion engines share one PWM bus; **only one active at a time**.

| Engine | Trigger | Rate |
|--------|---------|------|
| **ArmPipeline** | `target x y z [pitch]` | **~100 Hz** (10 ms) |
| **ProtocolRunner** | `protocol …` / `exercise …` | Same main loop |

**Critical rules:**

- When **idle**, ArmPipeline **does not write PWM** (prevents bent-pose hunt).  
- Identical PWM ticks are **skipped** (redundant I2C writes cause jitter).  
- After `stop` / `estop`, park at **stable home** (elbow **95°**), not elbow 90°.  

Digital twin JS (`pipeline.js`, `s_curve.js`) mirrors firmware math for offline tuning before flashing UNO Q.

---

## Firmware modules

| Module | Responsibility |
|--------|----------------|
| `main` | Serial parser, PCA9685 drive/release, gripper smoothstep, 100 Hz tick |
| `config.h` | Per-channel PWM MIN / CENTER / MAX (measured ramp protocol) |
| `kinematics` | FK, IK, `estimate_torques`, angle ↔ PWM, soft limits |
| `Planner` | mm waypoints; loaded tuck FSM (HTL routing) |
| `ArmPipeline` | Planner → IK → derating → MotionProfile → PWM |
| `MotionProfile` | Joint-space velocity cap with scale factor |
| `ProtocolRunner` | Named protocols, rehab exercises, orbital path |
| `Compensators` | Droop + backlash feedforward (twin / future enable) |
| `DeviceState` | Shared angles, mode, payload, claw %, STATE telemetry |

---

## Kinematics — forward (FK)

Joint math uses **label degrees**, not raw PWM.

### Cumulative link directions (arm plane)

```
shDir = (shoulder − 90°) · (π/180)
elDir = shDir + (elbow − 90°) · (π/180)
wrDir = elDir + (wrist − 90°) · (π/180)
```

### Tip position

```
sh_r = L1 · sin(shDir)          sh_z = FLOOR_OFFSET + L0 + L1 · cos(shDir)
el_r = sh_r + L2 · sin(elDir)   el_z = sh_z + L2 · cos(elDir)
ee_r = el_r + L3 · sin(wrDir)   ee_z = el_z + L3 · cos(wrDir)

baseRad = (base − 90°) · (π/180)
x =  ee_r · cos(baseRad)
y = −ee_r · sin(baseRad)
z =  ee_z
```

**Neutral** (all joints 90°): tip at `(0, 0, FLOOR_OFFSET + L0 + L1 + L2 + L3)`.

### Joint convention (locked)

| Joint | 90° means | Soft limits |
|-------|-----------|-------------|
| Base | Arm along +X | [0°, 180°] |
| Shoulder | Upper arm straight up (+Z) | [0°, 180°] |
| Elbow | Forearm aligned (straight) | **[90°, 180°]** only |
| Wrist | Tool aligned with forearm | [0°, 180°] |

**Stable home:** `{90, 90, 95, 90}` — elbow **95°** resists gravity hunt at straight.

---

## Kinematics — inverse (IK)

**Input:** floor-frame `(x, y, z)` mm, tool **pitch** (L3 from horizontal; **90° = tool up**).  
**Output:** `JointAngles` or `IkStatus` error.

### Step 1 — Base yaw

```
r = √(x² + y²)
if r < ε  →  ERR_BASE_SINGULARITY

base = 90° − atan2(y, x) · (180/π)
```

### Step 2 — Planar 2R + tool offset

```
z_local = z − FLOOR_OFFSET
rw = r − L3 · cos(pitch)
vw = (z_local − L0) − L3 · sin(pitch)
D  = √(rw² + vw²)

Require:  |L1 − L2| ≤ D ≤ L1 + L2
```

### Step 3 — Law of cosines (elbow)

```
cos(β) = (D² − L1² − L2²) / (2 · L1 · L2)
β = acos(clamp(cos(β), −1, 1))
```

Two branches: **+β** and **−β**.

### Step 4 — Shoulder & wrist (per branch)

```
math_s = atan2(vw, rw) − atan2(L2·sin(β), L1 + L2·cos(β))
math_w = pitch − math_s − β

shoulder = 180° − math_s · (180/π)
elbow    = 90° + |β| · (180/π)
wrist    = 90° − math_w · (180/π)
```

FK verify: |Δz| ≤ 0.5 mm, |Δr| ≤ 0.5 mm. Check soft limits.

### Step 5 — Branch selection

| Case | Choose |
|------|--------|
| Both valid + `prefer` (orbital) | Minimize Σ(Δq)² to previous joints |
| Both valid, no prefer | Lower `max(τ_shoulder, τ_elbow, τ_wrist)` |
| One valid | That branch |

### IK error codes

| Code | Meaning |
|------|---------|
| `OK` | Solution in safe bands |
| `ERR_BASE_SINGULARITY` | Target on base axis (r ≈ 0) |
| `ERR_UNREACHABLE` | Beyond reach envelope |
| `ERR_OUT_OF_RANGE` | Inside \|L1−L2\| dead zone |
| `ERR_JOINT_LIMIT` | Angle outside soft band |

**Why analytical IK:** deterministic MCU cost, explicit branches, FK verify — same class as many industrial 2R+ wrist solvers.

---

## Angle ↔ PWM calibration

Hobby servos are **nonlinear**. Each channel has measured **MIN / CENTER / MAX** at **50 Hz** (manual ramp — never autodetect sweep).

### Piecewise linear map

```
if deg ≤ amid:
    pwm = pmin + ((deg − amin)/(amid − amin)) · (pmid − pmin)
else:
    pwm = pmid + ((deg − amid)/(amax − amid)) · (pmax − pmid)
```

**Inverted** joints (shoulder, wrist): reflect PWM about center after mapping.

### Calibrated ticks

| CH | Joint | MIN | CENTER | MAX | Dir |
|----|-------|-----|--------|-----|-----|
| 0 | Base | 100 | 300 | 500 | Direct |
| 1 | Shoulder | 90 | 290 | 490 | Inverted |
| 2 | Elbow | 100 | 300 | 500 | Direct |
| 3 | Wrist | 100 | 300 | 500 | Inverted |
| 4 | Gripper | 236 (closed) | 338 (mid) | 440 (open) | — |

Hard firmware band: **[50, 600]** ticks; per-channel clamp inside **[MIN, MAX]**.  
1 tick ≈ 4.88 µs @ 50 Hz (~1.5 ms ≈ 90°).

---

## Path planning & HTL C-curve

### Unloaded or short move (≤ 50 mm)

- **STATE_LINEAR** — straight line in (x, y, z), **2 mm** steps.

### Loaded long move (claw mid/closed, distance > 50 mm)

| Phase | State | Target |
|-------|-------|--------|
| 1 | `TUCKING` | **r = 60 mm**, **z = 200 mm**, keep current θ |
| 2 | `ROTATING` | Same r, z; θ → target azimuth |
| 3 | `EXTENDING` | 2 mm steps to final (x, y, z) |

Skip tuck if already **r ≤ 65 mm** and **z ≥ 180 mm**.

```
ratio = step_size / distance
next = current + (target − current) × ratio
```

**Why:** payload torque ∝ **mass × reach**. Tucking CoG over the column before rotate/extend mirrors industrial “lift near base, then translate.”

---

## Cartesian pipeline (ArmPipeline)

**Command:** `target <x> <y> <z> [pitch]`

Each **10 ms** tick:

1. Sync from `DeviceState` angles (never stale Cartesian guess)  
2. `Planner.getNextWaypoint(current, 2.0 mm)`  
3. `ik_solve(waypoint, pitch)` → joint target  
4. `estimate_torques` → `velocity_scale` (see [Dynamics](#dynamics-torque--derating))  
5. `MotionProfile.step(target, dt)` — rate-limited joints  
6. `angles_to_pwm` → PCA9685  

IK failure mid-path → **stop**, re-sync live joints (bad waypoint is not kept as origin).

Default **pitch = 90°** → tool link points +Z (vertical).

---

## Motion profiles & trajectories

### Joint velocity cap (`MotionProfile`)

```
max_step = (max_vel_deg_per_ms × velocity_scale) × dt_ms    # default ~90°/s

if |target − current| ≤ max_step  →  current = target
else  current += sign(diff) × max_step
```

Trapezoidal limiter in joint space — hides PWM quantization, cheap on MCU.

### easeInOutCubic (rehab & cobra)

```
if u < 0.5:  p = 4·u³
else:        p = 1 − (−2·u + 2)³ / 2
```

### Seven-segment S-curve (digital twin)

Constant-jerk profile; **v = 0** and **a = 0** at endpoints:

```
p(t) = p₀ + v₀·t + ½·a₀·t² + (1/6)·j·t³
```

Phases: jerk-up → const accel → jerk-down → cruise → jerk-down → const decel → jerk-up.  
Short moves auto-scale `a_max` / `j_max` to fit distance.

### Protocol speed table

| Mode | Speed |
|------|-------|
| Home | 45°/s |
| Goto | 55°/s |
| Rehab exercise | 18°/s effective |
| HTL chain | 40°/s |
| Orbital | 6°/s |
| Pendulum down/up | 220 / 200°/s |
| Cobra strike leg | 240 ms cubic |

### Gripper smoothstep (ch4)

```
s(t) = 3t² − 2t³
pwm = PWM_MIN + (pct/100) · (PWM_MAX − PWM_MIN)
```

Duration ~700–2000 ms. Mid/closed ⇒ **loaded** for HTL routing.

---

## ProtocolRunner — demos & rehab

Every named protocol **starts from safe home** (joint-space) unless mid-exercise — avoids cutting through invalid poses.

### Available protocols

| Command | Behavior |
|---------|----------|
| `protocol home` | Joint-space → `{90,90,95,90}` |
| `protocol cpose` | Demo C-curve pose `{90,55,155,150}` |
| `protocol transport` | Compact carry `{90,90,180,180}` |
| `protocol snake` | Continuous sin-wave demo joints |
| `protocol cobra` | Coil ↔ strike loop |
| `protocol gimmefive` | Single cobra strike → home |
| `protocol orbital` | 96-point IK circle, 6°/s |
| `protocol htl` | Heavy Tucked Lift chain |
| `protocol pendulum` | Inertia + staged brake demo |
| `protocol stop` / `estop` | Halt + stable home hold |

### Orbital path

- Circle center **(150, 0, 180)**, radius **32 mm** in Y–Z  
- **96** IK samples; each uses `prefer` = previous solution → no branch flip  
- Advance waypoint only on arrival  

### Rehab exercise engine

For `exercise bicep|lateral|elbowflex`:

1. Leg duration from **max joint delta** @ **18°/s**, clamp **2.8–5.2 s**  
2. Synced lerp all joints: `lerp(from, to, easeInOutCubic(u))`  
3. **Floor guard:** if FK tip Z < 15 mm, binary-search `u` down (10 iter)  
4. **Hold 650 ms** at peak  
5. Sequence **0→1→0** × **3 reps** → stable home  

### Raw hobby vs ARMIC

| Raw hobby | ARMIC |
|-----------|--------|
| One PWM write to target | Rate-limited + eased trajectories |
| One IK at destination | IK every 2 mm + branch continuity |
| Same speed when overloaded | Strain-based derating |
| Linear lerp | Cubic ease + floor binary search |
| Home = all 90° | Elbow **95°** anti-hunt |
| Cartesian home through r=0 | Joint-space home only |

---

## Dynamics, torque & derating

### Link model (static gravity)

| Link | Mass (kg) | CoG (mm) |
|------|-----------|----------|
| L1 upper arm | 0.080 | 45 |
| L2 forearm | 0.050 | 35 |
| L3 tool | 0.030 | 25 |

```
φ₁ = (shoulder − 90°) · (π/180)
φ₂ = φ₁ + (elbow − 90°) · (π/180)
φ₃ = φ₂ + (wrist − 90°) · (π/180)

τ_wrist    = g · |M₃·r₃·sin(φ₃) + m_p·L₃·sin(φ₃)|
τ_elbow    = g · |M₂·r₂·sin(φ₂) + … + m_p·(L₂·sin(φ₂)+L₃·sin(φ₃))|
τ_shoulder = g · |M₁·r₁·sin(φ₁) + … + m_p·(L₁·sin(φ₁)+L₂·sin(φ₂)+L₃·sin(φ₃))|
```

### Stall-safe derating

```
STALL_SAFE ≈ stall_torque × 0.80     # MG90D ~0.2108 Nm, wrist ~0.1863 Nm
strain_%   = (τ / STALL_SAFE) × 100
maxStrain  = max(strain_sh, strain_el, strain_wr)
scale      = clamp(1 − 0.60·(maxStrain/100), 0.40, 1.0)
```

`MotionProfile.setVelocityScale(scale)` slows all joints near stall — less thermal shutdown and gear buzz.

`payload <kg>` clamped **[0, 0.5]** for torque math. Claw mid/closed ⇒ **loaded** for HTL (independent of kg).

---

## Manipulability & branch selection

Planar Jacobian (shoulder, elbow, wrist):

```
j₀ₖ = L_k · cos(φ_k)      j₁ₖ = −L_k · sin(φ_k)

w = √(det(J·Jᵀ)) = √(a₀₀·a₁₁ − a₀₁²)    # Yoshikawa index
```

Emitted as `w=…` in STATE. Low **w** ⇒ near singular posture.

IK branch pick (when both valid):

- **Orbital:** minimize joint-space distance to previous pose  
- **Else:** minimize peak gravity torque  

---

## Compensators & feedforward

| Compensator | Formula | Status |
|-------------|---------|--------|
| **Droop** | `Δθ_sh = R · 0.015 °/mm` where `R = √(x²+y²)` | Twin; HW validation pending |
| **Backlash** | +1.0° base, +1.5° shoulder, +2.0° elbow, +1.0° wrist on direction change | Twin; disabled live (caused hunt) |

Dither (±2° @ 50 Hz) **off** by default on hardware.

---

## Telemetry

~**20 Hz** on serial (**115200** baud):

```
STATE mode=… b=base,sh,el,wr pwm=… strain=sh,el,wr w=… watts=… payload=… claw=… loaded=…
```

**Watts estimate** (diagnostic):

```
I_joint ≈ I_idle + (τ/τ_stall)·(I_stall − I_idle)
P ≈ 5 V × Σ I_joint
```

Compare Transport vs reach-out poses in demos and Hackster videos.

---

## Rehabilitation exercises

Photo-matched poses only — **do not invent mid-waypoints**.

### Shared rules

- Elbow **[90°, 180°]** only  
- Tip FK **Z ≥ 15 mm**  
- **3 reps** → stable home  
- Serial: `exercise bicep|lateral|elbowflex`  

### 1 — Bicep curl

| Pose | `{b, sh, el, wr}` | Visual |
|------|-------------------|--------|
| Bottom | `90, 120, 170, 180` | Tip **down** |
| Top | `90, 120, 170, 25` | Tip **up** |

Shoulder **120°** + elbow **170°** **locked**; **wrist only** 180→25.

### 2 — Lateral raise

<img src="./docs/refs/lateral-tip-out.png" alt="Lateral tip out" width="200"> <img src="./docs/refs/lateral-tip-down.png" alt="Lateral tip down" width="200">

| Pose | `{b, sh, el, wr}` | Visual |
|------|-------------------|--------|
| Tip out | `90, 90, 180, 90` | Horizontal out |
| Tip down | `90, 90, 180, 180` | Tip down |

Shoulder **90°** + elbow **180°** locked; wrist **90↔180** only. Seq `0→1→0`.

### 3 — Elbow flexion

| Pose | `{b, sh, el, wr}` | Visual |
|------|-------------------|--------|
| Extended | `90, 0, 95, 90` | Upper arm horizontal **left** (`sh 0`, **not** 180) |
| Peak | `90, 0, 180, 180` | C-fold toward base |

Shoulder fixed **0°**; elbow + wrist flex together.

---

## Heavy Tucked Lift (HTL)

**Command:** `protocol htl`

Industrial idea: pull payload **in toward the column** before carrying — torque scales with **mass × CoG offset**.

### Joint-space demo chain (locked)

| Phase | `{b, sh, el, wr}` | Tip (approx) |
|-------|-------------------|--------------|
| Reach | `90, 160, 100, 90` | Wide out, high torque |
| Fold in | `90, 110, 170, 170` | Radius coming in |
| Carry | `90, 90, 180, 180` | Transport — compact |
| Home | `{90, 90, 95, 90}` | Stable hold |

Cartesian planner tuck target: **r=60, z=200** before rotate/extend when loaded.

---

## Safety layers

1. **Hard PWM band** — global [50, 600] + per-channel [MIN, MAX]  
2. **Elbow soft limits** — never below **90°**  
3. **Floor rule** — tip FK **Z ≥ 15 mm** on exercises  
4. **Stable home** — elbow **95°**, claw open at boot  
5. **E-stop / stop** — halt pipeline + protocols; joint-space home  
6. **Idle = no PWM writes** — pipeline must not fight gravity at rest  
7. **No IK home through r=0** — base singularity avoided  
8. **Calibration policy** — manual ramp only; never sweep past mechanical stops  

---

## Serial command reference

**Baud:** 115200 · newline-terminated text · UNO Q MCU USB serial (Bridge RPC planned).

### Protocols

```
protocol home|cpose|transport|snake|cobra|gimmefive|orbital|htl|pendulum|stop|estop
estop                              # alias
```

### Rehab

```
exercise bicep|lateral|elbowflex
```

### Cartesian & joints

```
target <x> <y> <z> [pitch]       # mm; pitch default 90
joints <b> <sh> <el> <wr>        # degrees
payload <kg>                     # 0..0.5 for torque derating
```

### Gripper

```
gripper open|close|mid|<0-100>
claw ...                         # alias
```

### Service / calibration

```
<pwm>,<ch>                       # manual PWM (clamped)
sweep <ch> <1|2|3>               # slow / med / fast full sweep
swipe <ch> <X> <Y>               # blocking 90→X→90(hold)→Y
move <ch> <X> <Y>                # non-blocking
stop | center | release [ch]
setup <ch> <pwm> [free] | off
fix <ch> | fixall | matrix | help
```

---

## Setup & bring-up

### Prerequisites

1. **Arduino UNO Q** + USB-C power  
2. [Arduino App Lab](https://www.arduino.cc/) and/or **Arduino IDE 2.x**  
3. PCA9685 on UNO Q **I2C** (Qwiic or headers — pin map finalized during port)  
4. Servo supply sized for MG90D stall  
5. Chrome/Edge for future Web Serial / App Lab UI  

### Checklist

1. Flash MCU arm firmware to UNO Q  
2. Serial monitor **115200**  
3. Boot → home (elbow 95°, claw open)  
4. `matrix` — ch0..4 status  
5. `protocol home` then `exercise bicep`  
6. `estop` → stable home  

### Calibration policy

- PWM MIN/CENTER/MAX from **manual ramp** only  
- Update docs + `config.h` together after any mechanical change  
- Never use `setup … free` except expert probing  

---

## Locked conventions

| Rule | Value |
|------|--------|
| Stable home | `{90, 90, 95, 90}` |
| Elbow band | **[90°, 180°]** only |
| Floor tip Z | **≥ 15 mm** |
| Cartesian step | **2 mm** |
| Rehab reps | **3** per exercise |
| Controller | **Arduino UNO Q** only in docs & contest build |
| AI rule file | [`.cursor/rules/arm-rehab-exercises.mdc`](.cursor/rules/arm-rehab-exercises.mdc) |

---

## Project status & roadmap

| Area | Status |
|------|--------|
| Control math & docs | ✅ In this repo |
| 4-DOF firmware brain | 🔄 Port to UNO Q MCU |
| App Lab dashboard | 📋 Planned (MPU) |
| Edge Impulse patient ML | 📋 Planned (MPU) |
| Bridge RPC command bridge | 📋 Planned |
| Hackster submission | 📋 BOM, schematics, video |

| Phase | Deliverable |
|-------|-------------|
| **Now** | UNO Q MCU port; I2C pin map; flash + serial verify |
| **Next** | App Lab Brick: exercise commands + STATE mirror |
| **Next** | Edge Impulse on MPU for patient-side classification |
| **Contest** | Full Hackster write-up aligned with this README |

---

## Team

Biomedical engineers at the intersection of robotics, AI, and connected care.

- [Victor Alonso Altamirano](https://www.linkedin.com/in/victor-alonso-altamirano-izquierdo-311437137/)
- [Alejandro Sanchez Gutierrez](https://www.linkedin.com/in/alejandro-sanchez-gutierrez-11105a157/)
- [Luis Eduardo Arevalo Oliver](https://www.linkedin.com/in/luis-eduardo-arevalo-oliver-989703122/)

---

## Supplementary docs

Split copies for deep reference (content mirrored here):

| File | Topic |
|------|--------|
| [docs/control-stack.md](docs/control-stack.md) | Control layer summary |
| [docs/kinematics.md](docs/kinematics.md) | FK/IK reference |
| [docs/motion-planning.md](docs/motion-planning.md) | Planner & profiles |
| [docs/dynamics.md](docs/dynamics.md) | Torque & derating |
| [docs/architecture.md](docs/architecture.md) | Dual-brain diagram |
| [docs/hardware.md](docs/hardware.md) | Hardware detail |
| [docs/serial-protocol.md](docs/serial-protocol.md) | Command reference |
| [docs/exercises.md](docs/exercises.md) | Rehab poses |
| [docs/htl-reference.md](docs/htl-reference.md) | HTL detail |
| [docs/setup.md](docs/setup.md) | Setup |
| [docs/bom.md](docs/bom.md) | BOM |

---

*ARMIC — programmable, intelligent rehabilitation on Arduino UNO Q.*
