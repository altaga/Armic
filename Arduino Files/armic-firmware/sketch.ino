// SPDX-FileCopyrightText: Armic project
//
// SPDX-License-Identifier: MPL-2.0
//
// ============================================================================
// Armic — 4DOF rehab arm firmware for the Arduino UNO Q (MCU side)
//
// Ported from the ESP32 build (support/ArmDriverTesting-Portable/src/main.cpp).
// The kinematics, planner, motion profile, compensators, protocol runner and
// device state are copied verbatim — only this entry point is platform code.
//
// WHAT CHANGED FROM THE ESP32 VERSION
//   * The Serial text command parser (pollSerial/handleLine) is gone. Every
//     command is now a Router Bridge RPC handler, called from Python.
//   * The STATE telemetry line is emitted from DeviceState.cpp as a
//     Bridge.notify("state", mode, values) — Python formats the text line.
//   * PCA9685 lives on Wire2, NOT Wire. Verified by bus scan: the UNO Q maps
//     zephyr_user.i2cs = <&i2c2>, <&i2c4>, <&i2c3> to Wire/Wire1/Wire2, and the
//     driver answers at 0x40 on i2c3 (PC0/PC1 = A4/A5).
//   * PCA_OE_PIN is 17. There is no A3 macro in this core; pin numbers index
//     the devicetree digital-pin-gpios array, where A0..A5 == 14..19.
//   * The legacy calibration commands (sweep/swipe/move/fix/setup/raw pwm) are
//     dropped — they were blocking delay() routines for bench calibration.
//   * NEW: every PWM write funnels through motorWrite(), which applies the
//     per-channel hard clamp and the dry-run gate.
//   * NEW: a Bridge-silence watchdog halts motion if Python dies.
//   * ProtocolRunner's member `_current` was renamed `_cur_angles`. Zephyr's
//     kernel_structs.h defines `_current` as a MACRO expanding to
//     `_kernel.cpus[0].current` (a k_thread*), so the original name silently
//     expanded into kernel internals and produced ~20 bogus type errors.
//     Do not reintroduce identifiers named `_current` anywhere in this sketch.
//
// SAFETY NOTES
//   * Joint limits are enforced twice: in kinematics.cpp (soft, angle domain)
//     and again in motorWrite() (hard, PWM domain). Python cannot widen either.
//   * Servo V+ must come from an external supply. Stall current on the
//     MG90S/MG90D set will brown out the board.
// ============================================================================

#include <Arduino.h>
#include <Arduino_RouterBridge.h>
#include <Wire.h>
#include <Adafruit_PWMServoDriver.h>
#include <vector>

#include "config.h"
#include "ArmPipeline.h"
#include "ProtocolRunner.h"
#include "DeviceState.h"

// ---- Hardware ---------------------------------------------------------------
// Wire2 == i2c3 (PC0/PC1, the A4/A5 header position). Confirmed by scan.
static Adafruit_PWMServoDriver pwm = Adafruit_PWMServoDriver(0x40, Wire2);

static const uint8_t  PCA_OE_PIN   = 17;   // A3, active-low output enable
static const uint16_t PWM_SAFE_MIN = 50;
static const uint16_t PWM_SAFE_MAX = 600;
static const uint16_t PCA_OFF      = 4096; // PCA9685 "full off" (high-Z)

// ---- Per-channel last commanded PWM + torque state -------------------------
struct Motor {
    uint16_t pwm;       // 0 = released
    bool     torqueOn;
};
static Motor m[16];

// ---- Runtime flags ---------------------------------------------------------
// Dry run / "movement lab": gates ONLY the I2C write. IK, planner, S-curve,
// limit checks and telemetry all keep running, so a sequence can be rehearsed
// with the motors silent.
static bool g_dry_run = false;

// Bridge-silence watchdog. Armed by the first command; once tripped it halts
// motion and latches so it cannot spam stop() every tick.
static const uint32_t WATCHDOG_MS = 1500;
static uint32_t g_last_cmd_ms = 0;
static bool     g_wd_tripped  = false;

static void drive(uint8_t ch, uint16_t pwmVal);

static void pwm_callback(uint8_t ch, uint16_t pwm_val) {
    drive(ch, pwm_val);
}
static ArmPipeline    pipeline(pwm_callback);
static ProtocolRunner protocols(pwm_callback);
static uint32_t last_pipeline_update = 0;

// ---- Calibration accessors -------------------------------------------------
// There is now ONE source of truth for the arm joints: the runtime-mutable
// `joints::` variables in kinematics.h. The previous g_lim[5] table duplicated
// the PWM bounds, which meant a clamp could disagree with the mapping that
// produced the value. It is gone.
//
// The gripper (ch4) is not a joint: it has no angle domain, only percent-open,
// so it keeps its own small struct rather than being forced into the joint
// layout.
//
// Writes arrive via cal_set(), which validates against the hard envelope in
// config.h. Nothing else should assign these.
struct GripperCal {
    uint16_t pwm_min;   // fully closed
    uint16_t pwm_max;   // fully open
    uint16_t pwm_mid;
};
static GripperCal g_grip_cal = { GRIPPER_PWM_MIN, GRIPPER_PWM_MAX, GRIPPER_PWM_CENTER };

static void lookupLimits(uint8_t ch, uint16_t &mn, uint16_t &mx) {
    switch (ch) {
        case 0: mn = joints::PWM_MIN_B; mx = joints::PWM_MAX_B; break;
        case 1: mn = joints::PWM_MIN_S; mx = joints::PWM_MAX_S; break;
        case 2: mn = joints::PWM_MIN_E; mx = joints::PWM_MAX_E; break;
        case 3: mn = joints::PWM_MIN_W; mx = joints::PWM_MAX_W; break;
        case 4: mn = g_grip_cal.pwm_min; mx = g_grip_cal.pwm_max; break;
        default: mn = 0; mx = 0; break;
    }
}

static uint16_t lookupCenter(uint8_t ch) {
    switch (ch) {
        case 0: return joints::PWM_MID_B;
        case 1: return joints::PWM_MID_S;
        case 2: return joints::PWM_MID_E;
        case 3: return joints::PWM_MID_W;
        case 4: return g_grip_cal.pwm_mid;
        default: return PWM_CENTER;
    }
}

static void lookupAngleBand(uint8_t ch, float &lo, float &hi) {
    switch (ch) {
        case 0: lo = joints::SOFT_MIN_B; hi = joints::SOFT_MAX_B; break;
        case 1: lo = joints::SOFT_MIN_S; hi = joints::SOFT_MAX_S; break;
        case 2: lo = joints::SOFT_MIN_E; hi = joints::SOFT_MAX_E; break;
        case 3: lo = joints::SOFT_MIN_W; hi = joints::SOFT_MAX_W; break;
        case 4: lo = 0.0f;               hi = 100.0f; break;   // percent open
        default: lo = 0.0f;              hi = 180.0f; break;
    }
}

static float clampAngle(uint8_t ch, float deg) {
    if (ch > 4) return deg;
    float lo, hi;
    lookupAngleBand(ch, lo, hi);
    if (deg < lo) return lo;
    if (deg > hi) return hi;
    return deg;
}

static uint16_t clampPwm(uint8_t ch, int v) {
    if (v < (int)PWM_SAFE_MIN) v = PWM_SAFE_MIN;
    if (v > (int)PWM_SAFE_MAX) v = PWM_SAFE_MAX;
    uint16_t mn, mx;
    lookupLimits(ch, mn, mx);
    if (mn == 0 && mx == 0) return (uint16_t)v;
    if (v < (int)mn) v = mn;
    if (v > (int)mx) v = mx;
    return (uint16_t)v;
}

// ---- THE single PWM write site --------------------------------------------
// Everything that moves a servo goes through here. Two guarantees:
//   1. The value is hard-clamped to the channel's calibrated band, no matter
//      what Python asked for.
//   2. When dry-run is on, no I2C write happens — but the commanded value is
//      still recorded so telemetry and the simulator show intent.
// Releases (PCA_OFF) deliberately bypass this: 4096 is a control code, not a
// pulse width, and clamping it would turn "off" into a real position.
static void motorWrite(uint8_t ch, uint16_t pwmVal) {
    const uint16_t safe = clampPwm(ch, (int)pwmVal);
    m[ch].pwm = safe;
    m[ch].torqueOn = true;
    if (g_dry_run) return;
    digitalWrite(PCA_OE_PIN, LOW);   // engage outputs
    pwm.setPWM(ch, 0, safe);
}

static void drive(uint8_t ch, uint16_t pwmVal) {
    // Skip redundant writes — re-sending the same PWM causes servo hunt/jitter.
    const uint16_t safe = clampPwm(ch, (int)pwmVal);
    if (m[ch].torqueOn && m[ch].pwm == safe) return;
    motorWrite(ch, safe);
}

// Forget what we think each channel is set to, so the next drive() is
// guaranteed to reach the driver. Required any time the cache may describe
// writes that never physically happened (i.e. after dry run).
static void invalidateWriteCache() {
    for (uint8_t ch = 0; ch < 16; ch++) {
        m[ch].pwm = 0;
        m[ch].torqueOn = false;
    }
}

static void releaseOne(uint8_t ch) {
    pwm.setPWM(ch, 0, PCA_OFF);
    m[ch].pwm = 0;
    m[ch].torqueOn = false;
}

static void releaseAll() {
    for (uint8_t ch = 0; ch < 16; ch++) {
        pwm.setPWM(ch, 0, PCA_OFF);
        m[ch].pwm = 0;
        m[ch].torqueOn = false;
    }
    digitalWrite(PCA_OE_PIN, HIGH);
}

static void engageOutputs() {
    if (!g_dry_run) digitalWrite(PCA_OE_PIN, LOW);
}

// ---- Gripper S-curve (ch4) — avoids violent open/close snaps ---------------
struct GripperMotion {
    bool     active;
    float    startPct;
    float    targetPct;
    uint32_t startMs;
    uint32_t durationMs;
};
static GripperMotion g_grip = {false, 100.0f, 100.0f, 0, 1200};

static float gripperPctToPwm(float pct) {
    if (pct < 0.0f) pct = 0.0f;
    if (pct > 100.0f) pct = 100.0f;
    return (float)g_grip_cal.pwm_min
        + (pct / 100.0f) * ((float)g_grip_cal.pwm_max - (float)g_grip_cal.pwm_min);
}

static float gripperEase(float t) {
    if (t < 0.0f) t = 0.0f;
    if (t > 1.0f) t = 1.0f;
    return (3.0f * t * t) - (2.0f * t * t * t); // smoothstep S-curve
}

static void cancelGripperMotion(float pct) {
    g_grip.active = false;
    if (pct < 0.0f) pct = 0.0f;
    if (pct > 100.0f) pct = 100.0f;
    DeviceState::setGripperPct(pct);
}

static void beginGripperMove(float targetPct) {
    if (targetPct < 0.0f) targetPct = 0.0f;
    if (targetPct > 100.0f) targetPct = 100.0f;

    float cur = DeviceState::getGripperPct();
    if (fabsf(targetPct - cur) < 0.25f) {
        engageOutputs();
        drive(4, clampPwm(4, (int)roundf(gripperPctToPwm(targetPct))));
        cancelGripperMotion(targetPct);
        return;
    }

    g_grip.startPct = cur;
    g_grip.targetPct = targetPct;
    g_grip.startMs = millis();
    const float travel = fabsf(targetPct - cur);
    g_grip.durationMs = (uint32_t)(500.0f + travel * 12.0f);
    if (g_grip.durationMs < 700) g_grip.durationMs = 700;
    if (g_grip.durationMs > 2000) g_grip.durationMs = 2000;
    g_grip.active = true;
    engageOutputs();

    Serial.print(">>> gripper move ");
    Serial.print(cur, 0);
    Serial.print("% -> ");
    Serial.print(targetPct, 0);
    Serial.print("% (");
    Serial.print(g_grip.durationMs);
    Serial.println(" ms S-curve)");
}

static void updateGripperMotion() {
    if (!g_grip.active) return;

    uint32_t elapsed = millis() - g_grip.startMs;
    float u = (float)elapsed / (float)g_grip.durationMs;
    if (u >= 1.0f) {
        u = 1.0f;
        g_grip.active = false;
    }

    const float s = gripperEase(u);
    const float pct = g_grip.startPct + (g_grip.targetPct - g_grip.startPct) * s;
    drive(4, clampPwm(4, (int)roundf(gripperPctToPwm(pct))));
    DeviceState::setGripperPct(pct);

    if (!g_grip.active) {
        DeviceState::setGripperPct(g_grip.targetPct);
        Serial.print(">>> gripper done pct=");
        Serial.println(g_grip.targetPct, 0);
    }
}

// ---- Park helpers ----------------------------------------------------------
static void parkCenter() {
    engageOutputs();
    for (uint8_t ch = 0; ch < 16; ch++) drive(ch, lookupCenter(ch));
    Serial.println(">>> all channels parked at per-channel 90 deg");
}

// Stable physical home — elbow at 95 deg stays clear of the 90 deg soft-limit
// and the gravity hunt that happens at straight.
static void parkHome() {
    engageOutputs();
    JointAngles home = {90.0f, 90.0f, 95.0f, 90.0f};
    JointPwm p = angles_to_pwm(home);
    drive(0, p.base);
    drive(1, p.shoulder);
    drive(2, p.elbow);
    drive(3, p.wrist);
    drive(4, g_grip_cal.pwm_max);   // boot / park: claw fully open
    for (uint8_t ch = 5; ch < 16; ch++) drive(ch, lookupCenter(ch));
    cancelGripperMotion(100.0f);
    DeviceState::updateAngles(home);
    Serial.println(">>> parked at home (elbow 95 deg hold, claw open)");
}

// ============================================================================
// Bridge RPC surface — replaces the old Serial text commands.
// Every handler refreshes the watchdog.
// ============================================================================
static void touchWatchdog() {
    g_last_cmd_ms = millis();
    g_wd_tripped = false;
}

static bool protocol_start(String name) {
    touchWatchdog();
    name.trim();
    // Stop the Cartesian pipeline so it cannot resume and fight the hold.
    pipeline.stop();
    pipeline.syncFromAngles(DeviceState::getAngles());
    if (protocols.start(name.c_str())) return true;
    Serial.print(">>> unknown protocol/exercise: ");
    Serial.println(name);
    return false;
}

static bool exercise_advance() {
    touchWatchdog();
    protocols.exerciseAdvance();
    return true;
}

static bool exercise_start(String name, float reps_f, float gated_f = 0.0f) {
    touchWatchdog();
    name.trim();
    pipeline.stop();
    pipeline.syncFromAngles(DeviceState::getAngles());
    uint8_t reps = (uint8_t)(reps_f + 0.5f);
    bool gated = gated_f > 0.5f;
    if (protocols.startExercise(name.c_str(), reps, gated)) return true;
    Serial.print(">>> unknown exercise: ");
    Serial.println(name);
    return false;
}

static void protocol_stop() {
    touchWatchdog();
    protocols.stop();
    pipeline.stop();
    pipeline.syncFromAngles(DeviceState::getAngles());
    Serial.println(">>> stop: protocols+pipeline halted");
}

static void protocol_estop() {
    touchWatchdog();
    protocols.stop();
    pipeline.stop();
    g_grip.active = false;          // cancel any in-flight gripper S-curve
    g_dry_run = false;              // motors must obey e-stop even in dry run
    // The cache may describe writes that never happened (dry run), which would
    // make every drive() in parkHome() a no-op. An e-stop that silently fails
    // to move the servos is the worst possible bug, so invalidate first.
    invalidateWriteCache();
    parkHome();                     // stable elbow-95 hold, never parkCenter
    pipeline.syncFromAngles(DeviceState::getAngles());
    DeviceState::setMode("estop");
    Serial.println(">>> E-STOP: halted, parked at home hold");
}

static void home_park() {
    touchWatchdog();
    protocols.stop();
    pipeline.stop();
    parkHome();
    pipeline.syncFromAngles(DeviceState::getAngles());
    DeviceState::setMode("idle");
}

static bool protocol_joints(float b, float sh, float el, float wr) {
    touchWatchdog();
    if (protocols.isActive()) {
        Serial.println(">>> protocol active - stop it first");
        return false;
    }
    pipeline.stop();
    // Clamp to the runtime angle limits before the move is planned. The elbow
    // band in particular is enforced here AND in kinematics.cpp.
    JointAngles a = {
        clampAngle(0, b),
        clampAngle(1, sh),
        clampAngle(2, el),
        clampAngle(3, wr),
    };
    if (a.base != b || a.shoulder != sh || a.elbow != el || a.wrist != wr) {
        Serial.print(">>> joints clamped to limits: ");
        Serial.print(a.base);     Serial.print(", ");
        Serial.print(a.shoulder); Serial.print(", ");
        Serial.print(a.elbow);    Serial.print(", ");
        Serial.println(a.wrist);
    }
    protocols.startGoto(a);
    return true;
}

static bool pipeline_target(float x, float y, float z, float pitch) {
    touchWatchdog();
    if (protocols.isActive()) {
        Serial.println(">>> protocol active - stop it first");
        return false;
    }
    pipeline.setTarget(x, y, z, DeviceState::isLoaded(), pitch);
    pipeline.setPayloadKg(DeviceState::getPayloadKg());
    return true;
}

static void payload_set(float kg) {
    touchWatchdog();
    DeviceState::setPayloadKg(kg);
    pipeline.setPayloadKg(kg);
}

static void gripper_set(float pct) {
    touchWatchdog();
    beginGripperMove(pct);          // independent of arm protocols
}

static void dry_run_set(bool on) {
    touchWatchdog();
    const bool was = g_dry_run;
    g_dry_run = on;

    if (was && !on) {
        // Leaving dry run. While gated, motorWrite() kept updating the
        // redundant-write cache (m[]) even though nothing reached the driver.
        // If we do not invalidate it here, drive() sees "already at that PWM"
        // and skips the write, so the servos stay limp and the arm looks dead.
        // Invalidate, then deliberately re-assert the pose the firmware
        // believes it is in, so taking up position is an explicit act rather
        // than a surprise on some later command.
        invalidateWriteCache();
        const JointAngles a = DeviceState::getAngles();
        const JointPwm p = angles_to_pwm(a);
        engageOutputs();
        drive(0, p.base);
        drive(1, p.shoulder);
        drive(2, p.elbow);
        drive(3, p.wrist);
        drive(4, clampPwm(4, (int)roundf(gripperPctToPwm(DeviceState::getGripperPct()))));
        Serial.println(">>> dry run OFF: cache invalidated, current pose re-asserted");
    }

    Serial.print(">>> dry run ");
    Serial.println(on ? "ON (motors gated)" : "OFF (motors live)");
}

static bool get_dry_run() {
    return g_dry_run;
}

// Liveness beat from the MPU. The watchdog exists to catch the Python process
// dying mid-motion; it must NOT interpret ordinary quiet between user commands
// as a failure, or every protocol longer than WATCHDOG_MS gets killed. The
// Armic Brick calls this ~2x/second.
static bool heartbeat() {
    touchWatchdog();
    return true;
}

// ---- Calibration read / write ----------------------------------------------
// Payload order (7 floats):
//   pwm_min, pwm_mid, pwm_max, ang_min, ang_max, dir, offset
// For ch4 (gripper) only the three PWM values are used; ang_* are percent-open
// bounds and dir/offset are ignored.
//
// All-or-nothing: returns false and changes NOTHING if any field is invalid, so
// a rejected write can never leave a joint half-updated with min > max.
static bool cal_set(int ch, std::vector<float> v) {
    touchWatchdog();
    if (ch < 0 || ch > 4 || v.size() < 7) {
        Serial.println(">>> cal_set: bad channel or payload");
        return false;
    }

    const int   pmin = (int)roundf(v[0]);
    const int   pmid = (int)roundf(v[1]);
    const int   pmax = (int)roundf(v[2]);
    const float amin = v[3];
    const float amax = v[4];
    const int   dir  = (int)roundf(v[5]);
    const float off  = v[6];

    // The absolute envelope is not negotiable from the MPU.
    if (pmin < (int)PWM_FLOOR_HARD || pmax > (int)PWM_CEIL_HARD) {
        Serial.print(">>> cal_set ch"); Serial.print(ch);
        Serial.print(": PWM outside hard envelope [");
        Serial.print(PWM_FLOOR_HARD); Serial.print(",");
        Serial.print(PWM_CEIL_HARD); Serial.println("]");
        return false;
    }
    if (!(pmin < pmid && pmid < pmax)) {
        Serial.println(">>> cal_set: need pwm_min < pwm_mid < pwm_max");
        return false;
    }
    const float ang_ceil = (ch == 4) ? 100.0f : 180.0f;
    if (amin < 0.0f || amax > ang_ceil || amin >= amax) {
        Serial.println(">>> cal_set: angle range invalid");
        return false;
    }
    if (ch != 4) {
        if (dir != 1 && dir != -1) {
            Serial.println(">>> cal_set: dir must be +1 or -1");
            return false;
        }
        if (off < -30.0f || off > 30.0f) {
            Serial.println(">>> cal_set: |offset| must be <= 30 deg");
            return false;
        }
    }

    switch (ch) {
        case 0:
            joints::PWM_MIN_B = pmin; joints::PWM_MID_B = pmid; joints::PWM_MAX_B = pmax;
            joints::SOFT_MIN_B = amin; joints::SOFT_MAX_B = amax;
            joints::DIR_BASE = (int8_t)dir; joints::OFFSET_B = off;
            break;
        case 1:
            joints::PWM_MIN_S = pmin; joints::PWM_MID_S = pmid; joints::PWM_MAX_S = pmax;
            joints::SOFT_MIN_S = amin; joints::SOFT_MAX_S = amax;
            joints::DIR_SHOULDER = (int8_t)dir; joints::OFFSET_S = off;
            break;
        case 2:
            joints::PWM_MIN_E = pmin; joints::PWM_MID_E = pmid; joints::PWM_MAX_E = pmax;
            joints::SOFT_MIN_E = amin; joints::SOFT_MAX_E = amax;
            joints::DIR_ELBOW = (int8_t)dir; joints::OFFSET_E = off;
            break;
        case 3:
            joints::PWM_MIN_W = pmin; joints::PWM_MID_W = pmid; joints::PWM_MAX_W = pmax;
            joints::SOFT_MIN_W = amin; joints::SOFT_MAX_W = amax;
            joints::DIR_WRIST = (int8_t)dir; joints::OFFSET_W = off;
            break;
        case 4:
            g_grip_cal.pwm_min = (uint16_t)pmin;
            g_grip_cal.pwm_mid = (uint16_t)pmid;
            g_grip_cal.pwm_max = (uint16_t)pmax;
            break;
    }

    // The write cache now describes a mapping that no longer applies.
    invalidateWriteCache();

    Serial.print(">>> cal ch"); Serial.print(ch);
    Serial.print(" pwm="); Serial.print(pmin);
    Serial.print("/"); Serial.print(pmid);
    Serial.print("/"); Serial.print(pmax);
    Serial.print(" ang="); Serial.print(amin, 1);
    Serial.print(".."); Serial.print(amax, 1);
    Serial.print(" dir="); Serial.print(dir);
    Serial.print(" off="); Serial.println(off, 1);
    return true;
}

static std::vector<float> cal_get(int ch) {
    uint16_t pmin = 0, pmax = 0;
    float amin = 0.0f, amax = 0.0f;
    int dir = 1;
    float off = 0.0f;

    if (ch < 0 || ch > 4) return std::vector<float>();
    lookupLimits((uint8_t)ch, pmin, pmax);
    lookupAngleBand((uint8_t)ch, amin, amax);
    switch (ch) {
        case 0: dir = joints::DIR_BASE;     off = joints::OFFSET_B; break;
        case 1: dir = joints::DIR_SHOULDER; off = joints::OFFSET_S; break;
        case 2: dir = joints::DIR_ELBOW;    off = joints::OFFSET_E; break;
        case 3: dir = joints::DIR_WRIST;    off = joints::OFFSET_W; break;
        default: break;   // gripper has no direction or offset
    }
    return std::vector<float>{
        (float)pmin,
        (float)lookupCenter((uint8_t)ch),
        (float)pmax,
        amin, amax,
        (float)dir,
        off,
    };
}

// ---- Bench tools: raw PWM write and A->B sweep ------------------------------
// These exist for calibration. They deliberately bypass the per-channel clamp,
// because discovering that a joint's real range is wider than the stored one is
// the whole point. The PCA9685's own 0..4095 bound still applies.
//
// They do NOT touch stored calibration. Testing is ephemeral; committing is a
// separate, explicit act from the settings UI.
static bool pwm_write_raw(int ch, int value) {
    touchWatchdog();
    if (ch < 0 || ch > 15) return false;
    if (value < 0 || value > 4095) {
        Serial.println(">>> pwm_write_raw: value outside 0..4095");
        return false;
    }
    if (g_dry_run) {
        // Refusing loudly beats appearing to work and doing nothing.
        Serial.println(">>> pwm_write_raw refused: dry run is ON");
        return false;
    }
    // Stop the control loop so it cannot fight the manual value.
    protocols.stop();
    pipeline.stop();
    g_grip.active = false;

    digitalWrite(PCA_OE_PIN, LOW);
    pwm.setPWM((uint8_t)ch, 0, (uint16_t)value);
    m[ch].pwm = (uint16_t)value;
    m[ch].torqueOn = true;

    Serial.print(">>> RAW write ch"); Serial.print(ch);
    Serial.print(" = "); Serial.println(value);
    return true;
}

// Non-blocking sweep. The ESP32 build used delay() for this, which on the UNO Q
// would stall the 100 Hz loop AND starve the Bridge heartbeat — tripping the
// watchdog and killing the sweep it was meant to perform. So this is a state
// machine ticked from loop(), like the gripper S-curve.
struct SweepMotion {
    bool     active;
    uint8_t  ch;
    uint16_t from;
    uint16_t to;
    uint32_t startMs;
    uint32_t durationMs;
};
static SweepMotion g_sweep = {false, 0, 0, 0, 0, 0};

static bool pwm_sweep(int ch, int from, int to, int ms) {
    touchWatchdog();
    if (ch < 0 || ch > 15) return false;
    if (from < 0 || from > 4095 || to < 0 || to > 4095) return false;
    if (g_dry_run) {
        Serial.println(">>> pwm_sweep refused: dry run is ON");
        return false;
    }
    if (ms < 200) ms = 200;
    if (ms > 20000) ms = 20000;

    protocols.stop();
    pipeline.stop();
    g_grip.active = false;

    g_sweep.active = true;
    g_sweep.ch = (uint8_t)ch;
    g_sweep.from = (uint16_t)from;
    g_sweep.to = (uint16_t)to;
    g_sweep.startMs = millis();
    g_sweep.durationMs = (uint32_t)ms;

    Serial.print(">>> SWEEP ch"); Serial.print(ch);
    Serial.print(" "); Serial.print(from);
    Serial.print(" -> "); Serial.print(to);
    Serial.print(" over "); Serial.print(ms); Serial.println(" ms");
    return true;
}

static bool sweep_active() {
    return g_sweep.active;
}

static void updateSweep() {
    if (!g_sweep.active) return;
    const uint32_t elapsed = millis() - g_sweep.startMs;
    float u = (float)elapsed / (float)g_sweep.durationMs;
    if (u >= 1.0f) {
        u = 1.0f;
        g_sweep.active = false;
    }
    // Reuse the gripper's smoothstep so the sweep eases in and out instead of
    // slamming the servo at constant velocity.
    const float s = gripperEase(u);
    const uint16_t val = (uint16_t)roundf(
        (float)g_sweep.from + ((float)g_sweep.to - (float)g_sweep.from) * s);

    digitalWrite(PCA_OE_PIN, LOW);
    pwm.setPWM(g_sweep.ch, 0, val);
    m[g_sweep.ch].pwm = val;
    m[g_sweep.ch].torqueOn = true;

    if (!g_sweep.active) {
        Serial.print(">>> sweep done ch"); Serial.print(g_sweep.ch);
        Serial.print(" at "); Serial.println(val);
    }
}

static void release_channel(int ch) {
    touchWatchdog();
    if (ch < 0 || ch > 15) return;
    if (g_sweep.active && g_sweep.ch == (uint8_t)ch) g_sweep.active = false;
    releaseOne((uint8_t)ch);
    Serial.print(">>> released ch"); Serial.println(ch);
}

static void release_all() {
    touchWatchdog();
    protocols.stop();
    pipeline.stop();
    releaseAll();
    DeviceState::setMode("released");
    Serial.println(">>> all channels released (high-Z)");
}

// Diagnostics kept from the bring-up sketch — cheap and useful.
static int i2c_probe(int addr) {
    if (addr < 0x03 || addr > 0x77) return 0;
    Wire2.beginTransmission((uint8_t)addr);
    return (Wire2.endTransmission() == 0) ? 1 : 0;
}

static String ping(String msg) {
    return msg + " pong";
}

// ============================================================================
void setup() {
    Monitor.begin(115200);
    delay(500);
    Serial.println();
    Serial.println("=== Armic 4DOF arm (UNO Q) ===");
    Serial.println("ch0=base 100..500@300 | ch1=shoulder 90..490@290 | ch2=elbow 100..500@300 | ch3=wrist 100..500@300 | ch4=gripper 236..440@338");

    // Outputs disabled until something intentionally drives a channel.
    pinMode(PCA_OE_PIN, OUTPUT);
    digitalWrite(PCA_OE_PIN, HIGH);

    Wire2.begin();
    pwm.begin();
    pwm.setOscillatorFrequency(27000000);
    pwm.setPWMFreq(50);

    if (i2c_probe(0x40)) {
        Serial.println("PCA9685 present at 0x40 on Wire2 (i2c3, A4/A5)");
    } else {
        Serial.println("WARNING: PCA9685 NOT responding at 0x40 on Wire2");
    }

    for (uint8_t ch = 0; ch < 16; ch++) {
        m[ch].pwm = 0;
        m[ch].torqueOn = false;
    }

    // Boot to stable home — elbow 95 deg resists gravity hunt at straight.
    parkHome();
    DeviceState::init();
    pipeline.init({0.1f, 0.0f, 300.0f});
    pipeline.syncFromAngles(DeviceState::getAngles());
    DeviceState::setMode("idle");

    Bridge.begin();
    Bridge.provide("ping",            ping);
    Bridge.provide("heartbeat",       heartbeat);
    Bridge.provide("i2c_probe",       i2c_probe);
    Bridge.provide("protocol_start",  protocol_start);
    Bridge.provide("exercise_start",  exercise_start);
    Bridge.provide("exercise_advance", exercise_advance);
    Bridge.provide("protocol_stop",   protocol_stop);
    Bridge.provide("protocol_estop",  protocol_estop);
    Bridge.provide("protocol_joints", protocol_joints);
    Bridge.provide("pipeline_target", pipeline_target);
    Bridge.provide("payload_set",     payload_set);
    Bridge.provide("gripper_set",     gripper_set);
    Bridge.provide("home_park",       home_park);
    Bridge.provide("dry_run_set",     dry_run_set);
    Bridge.provide("get_dry_run",     get_dry_run);
    Bridge.provide("cal_set",         cal_set);
    Bridge.provide("cal_get",         cal_get);
    Bridge.provide("pwm_write_raw",   pwm_write_raw);
    Bridge.provide("pwm_sweep",       pwm_sweep);
    Bridge.provide("sweep_active",    sweep_active);
    Bridge.provide("release_channel", release_channel);
    Bridge.provide("release_all",     release_all);

    Serial.println("READY. At home. Bridge up.");
}

void loop() {
    updateGripperMotion();
    updateSweep();

    // 6-stage continuous math pipeline, skipped while a protocol runs on-device.
    uint32_t now = millis();
    static bool was_protocol = false;

    // Bridge-silence watchdog. The MPU beats via heartbeat() ~2x/second, so
    // silence here means the Python side really is gone (crashed, OOM-killed,
    // app stopped) rather than just idle between user commands. Latched so it
    // fires once per silence episode.
    if (!g_wd_tripped && g_last_cmd_ms != 0 && (now - g_last_cmd_ms) > WATCHDOG_MS) {
        if (protocols.isActive() || pipeline.isMoving()) {
            protocols.stop();
            pipeline.stop();
            pipeline.syncFromAngles(DeviceState::getAngles());
            Serial.println(">>> watchdog: MPU heartbeat lost, holding position");
        }
        g_wd_tripped = true;
    }

    if (now - last_pipeline_update >= 10) { // 100 Hz
        uint32_t dt = now - last_pipeline_update;
        last_pipeline_update = now;
        const bool proto_before = protocols.isActive();
        if (proto_before) {
            protocols.update(dt, now);
        }
        // Re-read after update — home may finish mid-tick and queue a handoff.
        const bool proto = protocols.isActive();
        if (!proto && pipeline.isMoving()) {
            pipeline.update(dt, now);
        }
        // After a protocol ends, lock the pipeline start pose to the held joints
        // so a leftover Cartesian move cannot resume and fight the hold.
        if (was_protocol && !proto) {
            float px, py, pz, ppitch;
            if (protocols.takePendingPipeline(px, py, pz, ppitch)) {
                pipeline.setTarget(px, py, pz, DeviceState::isLoaded(), ppitch);
                Serial.print(">>> pipeline handoff: ");
                Serial.print(px); Serial.print(", ");
                Serial.print(py); Serial.print(", ");
                Serial.print(pz);
                Serial.print(" pitch="); Serial.println(ppitch);
            } else {
                pipeline.stop();
                pipeline.syncFromAngles(DeviceState::getAngles());
            }
        }
        was_protocol = proto;
        DeviceState::maybeEmitTelemetry(now);
    }
}
