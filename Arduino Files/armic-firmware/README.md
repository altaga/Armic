# armic-firmware / MCU Motion Brain

> 🚩 **DEPLOYS TO:** Arduino UNO Q MCU side (STM32U585 · Zephyr RTOS) — flashed into the MCU internal flash. Boots on every power-up before Linux MPU even starts userspace. Burn via PlatformIO or Arduino CLI using `sketch.yaml`.

**Runs on:** Arduino UNO Q MCU (STM32U585 · Zephyr RTOS)  
**Tick rate:** 100 Hz deterministic loop  
**I²C bus:** Wire2 (I2C3 · PC0/PC1 = A4/A5 board position)  
**Output driver:** PCA9685 16-channel PWM · OE gate on pin 17 · channels 0-4

This is the **deterministic safety core** of ARMIC. It owns *all* joint-angle writes and guarantees:

1. **Soft + hard joint limits** (angle-domain + PWM-domain dual clamp, one cannot widen the other)
2. **MPU-silence watchdog** at 1500 ms — if the Python backend dies, motion halts within 1.5 s
3. **Write-cache invalidation on E-STOP** — a command stuck in a queue can never replay after stop
4. **Heartbeat @2 Hz** to prevent spurious watchdog timeouts during long protocols
5. **Dry-run default** after every MPU-side boot — motors are gated until `dry_run(false)` is explicitly called

## Files (C++ / .ino)

| File | Owns |
|---|---|
| [sketch.ino](sketch.ino) | `setup()` / `loop()` 100 Hz tick, Router Bridge registrations (`call` + `notify`), E-STOP handler, dry_run gate |
| [config.h](config.h) | Compile-time channel map, PCA9685 addr, watchdog timeout, OE pin, loop Hz |
| [kinematics.h](kinematics.h) | Joint calibration (runtime-mutable `extern`), PWM↔angle conversion prototypes, 5 IK steps |
| [kinematics.cpp](kinematics.cpp) | FK / IK analytical solver, PWM↔angle tables, **project default calibration values** (mirror of DEFAULT_CALIBRATION in ../Arduino Files/armic-brick/__init__.py) |
| [Planner.h](Planner.h) / [Planner.cpp](Planner.cpp) | Cartesian waypoint queue, 2 mm step size, IK per step, torque scale pre-filter |
| [MotionProfile.h](MotionProfile.h) / [MotionProfile.cpp](MotionProfile.cpp) | Rate-limited joints, cubic ease-in-out, 7-seg S-curve reference (simulator implements full; MCU uses cubic for cycle cost) |
| [ArmPipeline.h](ArmPipeline.h) / [ArmPipeline.cpp](ArmPipeline.cpp) | Pipeline stage order: plan → IK → torque scale → MotionProfile → PWM write |
| [ProtocolRunner.h](ProtocolRunner.h) / [ProtocolRunner.cpp](ProtocolRunner.cpp) | Rehab leg 3-rep + 650 ms hold + HTL (Heavy Tucked Lift) 4-stage FSM + orbital/snake/cobra/gimmefive pendulum |
| [DeviceState.h](DeviceState.h) / [DeviceState.cpp](DeviceState.cpp) | Current pose register, `notify("state", {...})` push-back to MPU @ 20 Hz |
| [Compensators.h](Compensators.h) / [Compensators.cpp](Compensators.cpp) | Twin-only: gravity-droop K_DROOP = 0.015 °/mm radial + per-channel backlash offsets (base1.0/sh1.5/el2.0/wr1.0°) |
| [sketch.yaml](sketch.yaml) | UNO Q sketch manifest (Bridge RPC surface) |

## Safety Architecture (5 layers)

This MCU is the **only code that writes PWM values to the servos**. Everything goes through it; nothing on the MPU can by bypass these 5 layers.

```mermaid
flowchart TD
    CMD["Any command source<br/>(LLM Agent · WS Client · Serial · sanity.py)"]
    DRY["Layer 1 — dry_run Gate<br/>GATED default ON (after each MPU boot)"]
    CMD --> DRY
    DRY -- "dry_run(false) explicit → pass
    WD["Layer 2 — MPU Watchdog<br/>1500 ms timeout counter"]
    DRY --> WD
    LIM["Layer 3 — Soft Joint Limits (angle domain)<br/>base [0,180] · sh [0,180] · elb [90,180] · wr [0,180]<br/>Tip Z-min 15 mm"]
    WD -->|"MPU alive → pass| LIM
    LIM --> PASS --> HARD["Layer 4 — Hard Joint Limits (PWM domain)<br/>ch/ch mapping<br/>Independent from calibration.json"]
    HARD --> ESTOP["Layer 5 — E-STOP · Write Cache Invalidation<br/>clear all queues → PWM 0 → OE=1 (disabled) → Park at Home"]
    style ESTOP
    HARD --> OE["PCA9685 OE Pin 17
    OE --> PWM["PWM Write to servos (PCA9685<br/>Channels 0-4 → 5× servos"]

    subgraph Emergency path
        ANY_ESTOP[Any E-STOP source → ESTOP
    end

    subgraph Watchdog path
        WATCHDOG_FIRE[1.5 s MPU silence]
        |Fire Watchdog → ESTOP
    end

    style ESTOP fill:#ffcdd2,stroke:#c62828,stroke-width:2px
    style WD fill:#fff3cd
    style OE fill:#e8f5e9
```

### E-STOP flow — broadcast from *any* source

```mermaid
sequenceDiagram
    actor Any as Any Source<br/>(LLM · WS button · Serial · Watchdog · sanity.py
    participant FW as MCU Firmware<br/>sketch.ino E-STOP handler
    participant CACHE as In-flight write<br/>command queue
    participant PCA as PCA9685<br/>(PWM driver)
    participant SERVOS["5× MG90D servos"]

    Any->>FW: estop()
    FW->>CACHE: INVALIDATE entire cache<br/>(all queued writes dropped; nothing replays)
    FW->>PCA: ALL channels PWM_center<br/>(idle / center)
    FW->>PCA: OE pin 17 → HIGH (disabled)
    Note over PCA,SERVOS: Motors go limp. No voltage to servos.
    FW->>FW: Park at stable home [90,90,95,90]
    FW-->>Any: notify("estop_triggered", reason)
```

### MPU-Silence Watchdog flow

```mermaid
stateDiagram-v2
    [*] --> Armed: Boot.bridge_initialized
    Armed --> WaitingForTick: Bridge.notify("hb" received from MPU (≥ 2 Hz heartbeat)
    WaitingForTick --> Armed: Tick within < 1500 ms
    WaitingForTick --> Fire: no tick > 1500 ms timeout
    Fire: E-STOP triggered, parked, PWM 0, OE=1
    Fire --> [*
    Fire -- (Python reconnected → new handshake, dry_run reset to true
```

