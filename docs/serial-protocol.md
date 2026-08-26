# Serial protocol — MCU command reference

Baud: **115200**. Lines are newline-terminated text commands.

The Arduino UNO Q MCU accepts these commands over USB serial today; the same vocabulary should map to **App Lab Bridge** RPC later.

---

## Protocols

```
protocol home|cpose|transport|snake|cobra|gimmefive|orbital|htl|pendulum|stop|estop
```

| Name | Behavior |
|------|----------|
| `home` | Move to stable home `{90,90,95,90}` |
| `cpose` | Demo C-curve pose after home |
| `transport` | Compact carry pose (loaded tuck family) |
| `snake` / `cobra` / `gimmefive` | Continuous demo animations |
| `orbital` | Circular path demo |
| `htl` | Heavy Tucked Lift — see [htl-reference.md](htl-reference.md) |
| `pendulum` | Inertia / brake demo sequence |
| `stop` | Halt protocol + pipeline |
| `estop` | Emergency stop → stable home hold |

Aliases: bare `estop` and `protocol estop`.

---

## Rehab exercises

```
exercise bicep|lateral|elbowflex
```

Each runs **photo-matched waypoints × 3 reps**, then returns to stable home.  
Pose tables: [exercises.md](exercises.md).

---

## Cartesian & joints

```
target <x> <y> <z> [pitch]     # mm; pitch default 90 = tool-up
joints <b> <sh> <el> <wr>      # degrees
payload <kg>                   # torque derating / loaded planning
```

`target` feeds **ArmPipeline** (planner + S-curve). Blocked while a protocol is active — send `protocol stop` first.

---

## Gripper

```
gripper open|close|mid|<0-100>
claw ...                       # alias
```

| Value | Meaning |
|-------|---------|
| `0` / `close` | Fully closed |
| `50` / `mid` | Mid |
| `100` / `open` | Fully open |

S-curve open/close (no violent snaps). Mid or closed counts as **loaded** for HTL / heavy path planning (also if `payload > 0.05 kg`).

---

## Calibration / service commands

```
<pwm>,<ch>                 # manual PWM (per-channel clamped)
sweep <ch> <speed>         # 1=slow 2=med 3=fast full sweep
swipe <ch> <X> <Y>         # blocking 90→X→90(hold)→Y
move <ch> <X> <Y>          # non-blocking variant, returns to 90
stop                       # abort move / protocol / pipeline
center                     # park stable home
release [ch]               # high-Z all or one channel
setup <ch> <pwm>           # clamped
setup <ch> <pwm> free      # raw 0..4095 — experts only
setup <ch> off             # release one channel
fix <ch>                   # park all except ch at 90°
fixall                     # park all at 90°
matrix                     # status table ch0..ch4
help
```

---

## Telemetry

`DeviceState` periodically emits **STATE** lines while connected so a host UI can mirror joint angles, mode, payload, and gripper %. Exact frame format is defined in firmware (`DeviceState` module) and should stay stable for App Lab consumers.
