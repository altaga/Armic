# Kinematics & calibration

Source of truth for the 4-DOF Armic arm on **Arduino UNO Q MCU**. **Do not change constants** without a new measured calibration session.

Related: [control-stack.md](control-stack.md) · [motion-planning.md](motion-planning.md) · [dynamics.md](dynamics.md)

---

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
- Base pivot at **Z = FLOOR_OFFSET**

---

## Joint convention (locked)

| Joint | 90° meaning | Soft limits |
|-------|-------------|-------------|
| Base | Arm along +X (yaw in floor plane) | [0°, 180°] |
| Shoulder | Upper arm straight up (+Z); >90° leans forward | [0°, 180°] |
| Elbow | Forearm aligned (straight); 180° = folded back ⊥ | **[90°, 180°]** only |
| Wrist | L3 aligned with forearm | [0°, 180°] |

**Stable home:** `{base:90, shoulder:90, elbow:95, wrist:90}` — elbow 95° resists gravity hunt at straight.

---

## Forward kinematics (FK)

Joint math always uses **label degrees**, not PWM ticks.

### Cumulative link directions (arm plane)

```
shDir = (shoulder − 90°) · (π/180)
elDir = shDir + (elbow − 90°) · (π/180)
wrDir = elDir + (wrist − 90°) · (π/180)
```

### Tip in (r, z) then base yaw

```
sh_r = L1 · sin(shDir)          sh_z = FLOOR_OFFSET + L0 + L1 · cos(shDir)
el_r = sh_r + L2 · sin(elDir)   el_z = sh_z + L2 · cos(elDir)
ee_r = el_r + L3 · sin(wrDir)   ee_z = el_z + L3 · cos(wrDir)

baseRad = (base − 90°) · (π/180)
x =  ee_r · cos(baseRad)
y = −ee_r · sin(baseRad)
z =  ee_z
```

Neutral pose (all 90°): tip at `(0, 0, FLOOR_OFFSET + L0 + L1 + L2 + L3)`.

---

## Inverse kinematics (IK)

**Input:** floor-frame `(x, y, z)` in mm, tool **pitch** (L3 angle from horizontal; 90° = tool up).

**Output:** `JointAngles` or error code.

### Step 1 — Base yaw

```
r = √(x² + y²)
if r < ε → ERR_BASE_SINGULARITY

base = 90° − atan2(y, x) · (180/π)
```

### Step 2 — Reduce to 2R + tool offset

```
z_local = z − FLOOR_OFFSET
rw = r − L3 · cos(pitch)
vw = (z_local − L0) − L3 · sin(pitch)
D  = √(rw² + vw²)
```

Reachability:

```
|L1 − L2| ≤ D ≤ L1 + L2     else ERR_UNREACHABLE / ERR_OUT_OF_RANGE
```

### Step 3 — Elbow angle (law of cosines)

Internal elbow angle β between upper and lower arm:

```
cos(β) = (D² − L1² − L2²) / (2 · L1 · L2)
β = acos(clamp(cos(β), −1, 1))
```

Two solutions: **+β** and **−β** (elbow “elbow-up” vs “elbow-down” in the plane).

### Step 4 — Shoulder & wrist per branch

For each β:

```
math_s = atan2(vw, rw) − atan2(L2·sin(β), L1 + L2·cos(β))
math_w = pitch − math_s − β

shoulder = 180° − math_s · (180/π)
elbow    = 90° + |β| · (180/π)
wrist    = 90° − math_w · (180/π)
```

Normalize to [0, 360), apply static offsets, check soft limits, **FK verify** |Δz| ≤ 0.5 mm and |Δr| ≤ 0.5 mm.

### Step 5 — Branch selection

| Condition | Pick |
|-----------|------|
| Both valid + `prefer` set | Minimize Σ(Δq)² to previous joints |
| Both valid, no prefer | Lower `max(τ_shoulder, τ_elbow, τ_wrist)` |
| One valid | That branch |

### IK status codes

| Code | Meaning |
|------|---------|
| `OK` | Solution inside safe bands |
| `ERR_BASE_SINGULARITY` | Target on base axis (r ≈ 0) |
| `ERR_UNREACHABLE` | Beyond L1 + L2 + L3 |
| `ERR_OUT_OF_RANGE` | Inside dead zone \|L1 − L2\| |
| `ERR_JOINT_LIMIT` | Angles outside soft bands |

---

## Angle ↔ PWM (calibration layer)

Hobby servos are **not** linear in angle. Each channel has measured **MIN / CENTER / MAX** ticks at 50 Hz.

### Piecewise linear map (direct joint)

For angle `deg` with soft limits and calibrated (amin, amid, amax) → (pmin, pmid, pmax):

```
if deg ≤ amid:
    t = (deg − amin) / (amid − amin)
    pwm = pmin + t · (pmid − pmin)
else:
    t = (deg − amid) / (amax − amid)
    pwm = pmid + t · (pmax − pmid)
```

### Inverted mount (shoulder, wrist)

Reflect PWM about center after the linear map so +angle on the label matches physical motion when the servo is flipped.

### Hard safety band

All commanded PWM clamped to per-channel **[MIN, MAX]** inside global **[50, 600]** ticks. Gripper ch4 uses open/close ticks, not 0°/180° rotation.

| CH | Joint | MIN | CENTER | MAX | Dir |
|----|-------|-----|--------|-----|-----|
| 0 | Base | 100 | 300 | 500 | Direct |
| 1 | Shoulder | 90 | 290 | 490 | **Inverted** |
| 2 | Elbow | 100 | 300 | 500 | Direct |
| 3 | Wrist | 100 | 300 | 500 | **Inverted** |
| 4 | Gripper | 236 | 338 | 440 | open/close |

1 tick ≈ 4.88 µs at 50 Hz (~1.5 ms center ≈ 90°).

---

## Floor safety (FK guard)

Before applying any exercise lerp or new pose:

```
fk_solve(pose) → tip_z
require tip_z ≥ 15 mm
```

If a cubic lerp would violate this, binary-search the interpolation parameter `u` downward until safe (see [motion-planning.md](motion-planning.md)).

Never lerp shoulder 180↔90 while elbow also moves — mid-pose can dive toward the floor.

---

## Why analytical IK (not Jacobian iterative)

- **Deterministic** on MCU — fixed upper bound on compute per tick  
- **Two discrete branches** — explicit choice vs numerical drift  
- **FK verify** every solution — catches convention bugs early  
- Matches simulator JS 1:1 for Hackster reproducibility  

This is the same class of solver used in many industrial teach pendants for planar 2R + wrist segments, adapted to Armic’s joint labeling and PWM layer.
