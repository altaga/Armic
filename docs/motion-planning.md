# Motion planning & trajectories

How Armic turns a target into smooth joint motion without encoders or industrial drives.

---

## 1. Cartesian pipeline (`ArmPipeline`)

**Command:** `target <x> <y> <z> [pitch]`

### Control loop (100 Hz)

Each 10 ms tick:

1. **Sync** start pose from `DeviceState` (never a stale Cartesian guess).
2. **Planner** → next waypoint, **2 mm** step toward intermediate target.
3. **IK** → joint angles for that waypoint + tool pitch (default 90° = tool up).
4. **Torque** → `estimate_torques` → **velocity scale** (see [dynamics.md](dynamics.md)).
5. **MotionProfile** → rate-limit all four joints toward IK target.
6. **PWM** → `angles_to_pwm` → PCA9685.

If IK fails mid-path, the pipeline **stops** and re-syncs from live joints — it does not hold a bad waypoint as the new origin.

### Default Cartesian pitch

`pitch = 90°` means the tool link (L3) points along +Z (vertical). Other pitches rotate the gripper in the arm plane before solving the 2-link sub-problem.

---

## 2. Path planner (`Planner`)

### Unloaded / short moves — linear

If `is_loaded == false` **or** Euclidean distance ≤ **50 mm**:

- State: `STATE_LINEAR`
- Intermediate target = final target
- Each tick: move **2 mm** along the straight line in (x, y, z)

### Loaded long moves — C-curve (HTL)

If claw mid/closed (loaded) **and** distance > **50 mm**:

| Phase | State | Goal |
|-------|-------|------|
| 1 | `STATE_TUCKING` | Pull to **r = 60 mm**, **z = 200 mm** at current azimuth θ |
| 2 | `STATE_ROTATING` | Same r, z; rotate θ to target azimuth |
| 3 | `STATE_EXTENDING` | Linear 2 mm steps to final (x, y, z) |

Skip tuck if already compact: `r ≤ 65 mm` and `z ≥ 180 mm`.

**Why:** payload torque scales with **reach × mass**. Tucking CoG over the column before rotating/extending mimics industrial “lift near base, then translate.”

Waypoint interpolation:

```
ratio = step_size / distance
next = current + (target − current) × ratio
```

When `distance ≤ step_size`, advance FSM to next phase.

---

## 3. Joint velocity cap (`MotionProfile`)

After IK (and optional derating), joints do **not** snap to target. Each joint moves at most:

```
max_step = (max_vel_deg_per_ms × velocity_scale) × dt_ms
```

Default **max_vel ≈ 90°/s** (configurable). Per joint:

```
if |target − current| ≤ max_step → current = target
else current += sign(diff) × max_step
```

This is a **trapezoidal velocity limiter** in joint space — cheap to run on MCU, effective at hiding PWM quantization steps.

`velocity_scale ∈ [0.10, 1.0]` comes from strain derating in the pipeline.

---

## 4. Seven-segment S-curve (digital twin + advanced moves)

File concept: `s_curve.js` — **constant-jerk** profile with zero velocity **and** zero acceleration at endpoints.

### Phases (positive move)

1. Jerk-up: a: 0 → +a_max  
2. Constant accel: a = +a_max  
3. Jerk-down: a: +a_max → 0  
4. Cruise: v = v_peak  
5. Jerk-down: a: 0 → −a_max  
6. Constant decel: a = −a_max  
7. Jerk-up: a: −a_max → 0  

Position within a phase (constant jerk j):

```
p(t) = p₀ + v₀·t + ½·a₀·t² + (1/6)·j·t³
v(t) = v₀ + a₀·t + ½·j·t²
a(t) = a₀ + j·t
```

For short moves, cruise (and sometimes constant-accel) is skipped; **a_max** and **j_max** scale down so the profile fits the distance (min natural length ≈ **12·d_j**).

Used in the simulator for joint moves where ringing matters. Firmware rehab paths use cubic ease (below) for MCU cost.

---

## 5. Cubic ease — rehab & demo paths (`ProtocolRunner`)

### easeInOutCubic

```
if u < 0.5:  p = 4·u³
else:        p = 1 − (−2·u + 2)³ / 2
```

Smooth acceleration at start/end without storing a full S-curve table.

### Synced rehab exercise leg

For `exercise bicep|lateral|elbowflex`:

1. Leg duration from **largest joint delta** at **18°/s** (`EX_REHAB_DPS`), clamped **2.8–5.2 s**.
2. All four joints lerp together: `a = lerp(from, to, easeInOutCubic(u))`.
3. **Floor guard:** if FK tip Z < **15 mm**, binary-search `u` down (10 iterations) and use safe `u_lo`.
4. **Hold 650 ms** at peak waypoint.
5. Sequence `0→1→0` × **3 reps** → stable home.

### Rate-limited goto (`stepToward`)

Protocols use explicit **deg/s** caps:

| Mode | Speed |
|------|-------|
| Home | 45°/s |
| Goto | 55°/s (default) |
| Rehab | 18°/s effective |
| HTL chain | 40°/s |
| Orbital | 6°/s |
| Pendulum down/up | 220 / 200°/s |
| Cobra strike | 240 ms cubic leg |

---

## 6. Protocol state machines

Every named protocol **starts from safe home** (joint-space) unless already exercising — avoids cutting through bad postures.

### HTL (joint-space chain)

Cartesian HTL planner targets r=60, z=200, but the **demo protocol** uses locked joint poses (more reliable on hardware):

| Step | Joints `{b, sh, el, wr}` |
|------|--------------------------|
| Reach | `90, 160, 100, 90` |
| Fold in | `90, 110, 170, 170` |
| Carry | `90, 90, 180, 180` (Transport) |
| Home | stable home |

### Orbital

- Precompute **96** IK samples on a circle: center (150, 0, 180), radius 32 mm in Y–Z.
- Each sample uses IK with **`prefer`** = previous solution → continuous path, no branch flip.
- Advance waypoint only when `stepToward` arrives (6°/s).

### Pendulum

Hold extended → fast drop → inertia overshoot to `{110,115}` → staged brake → `{100,105}` → full stop home `{90,95}`.

### Cobra / gimme five

Cubic strike coil ↔ strike; optional single strike then home.

---

## 7. Gripper smoothstep

Independent of arm protocols. Open/close uses **smoothstep** on percent 0–100:

```
s(t) = 3t² − 2t³     (t = elapsed / duration)
pwm = PWM_MIN + (pct/100) × (PWM_MAX − PWM_MIN)
```

Duration scales with travel (~700–2000 ms). Mid/closed ⇒ **loaded** for planner HTL routing.

---

## 8. Design choices vs “raw hobby” control

| Raw hobby | Armic |
|-----------|--------|
| Single PWM write to target | Rate-limited + eased trajectories |
| One IK at destination | IK every 2 mm + branch continuity |
| Same speed when overloaded | Strain-based derating |
| Linear joint lerp | Cubic ease + floor binary search |
| Home = all 90° | Elbow **95°** hold (anti gravity hunt) |
| Cartesian home through r=0 | Joint-space home only |

These layers are why a ~$50 servo arm can demo rehab and carry paths that **look** industrial even though the hardware is not.
