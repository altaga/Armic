#include "DeviceState.h"
#include <Arduino.h>
#include <Arduino_RouterBridge.h>
#include <math.h>
#include <string.h>
#include <vector>

namespace {
constexpr float STALL_SH = 0.2108f;
constexpr float STALL_EL = 0.2108f;
constexpr float STALL_WR = 0.1863f;
constexpr float SAFE_SH  = STALL_SH * 0.80f;
constexpr float SAFE_EL  = STALL_EL * 0.80f;
constexpr float SAFE_WR  = STALL_WR * 0.80f;
constexpr float IDLE_MA  = 30.0f;
constexpr float STALL_MA_SH = 800.0f;
constexpr float STALL_MA_EL = 800.0f;
constexpr float STALL_MA_WR = 700.0f;
constexpr float STALL_MA_B  = 700.0f;

JointAngles g_angles = {90.0f, 90.0f, 90.0f, 90.0f};
JointPwm g_pwm = {300, 290, 300, 300};
char g_mode[16] = "idle";
float g_payload_kg = 0.0f; // calculation-only mass; path "loaded" comes from claw
float g_gripper_pct = 100.0f; // open at boot
uint8_t g_ex_rep = 0;
uint8_t g_ex_step = 0;
uint8_t g_ex_steps = 0;
uint8_t g_ex_total = 0;
float g_ex_leg = 0.0f;
uint32_t g_last_telemetry_ms = 0;
} // namespace

void DeviceState::init() {
    g_angles = {90.0f, 90.0f, 95.0f, 90.0f};
    g_pwm = angles_to_pwm(g_angles);
    strncpy(g_mode, "idle", sizeof(g_mode));
    g_mode[sizeof(g_mode) - 1] = '\0';
    g_payload_kg = 0.0f;
    g_gripper_pct = 100.0f;
    g_last_telemetry_ms = 0;
}

void DeviceState::setMode(const char* mode) {
    if (!mode) return;
    strncpy(g_mode, mode, sizeof(g_mode) - 1);
    g_mode[sizeof(g_mode) - 1] = '\0';
}

void DeviceState::setPayloadKg(float kg) {
    if (kg < 0.0f) kg = 0.0f;
    if (kg > 0.5f) kg = 0.5f;
    g_payload_kg = kg;
}

float DeviceState::getPayloadKg() {
    return g_payload_kg;
}

void DeviceState::setGripperPct(float pct) {
    if (pct < 0.0f) pct = 0.0f;
    if (pct > 100.0f) pct = 100.0f;
    g_gripper_pct = pct;
}

float DeviceState::getGripperPct() {
    return g_gripper_pct;
}

bool DeviceState::isGripperLoaded() {
    // Mid (50%) or more closed ⇒ assume object in claw / loaded arm.
    return g_gripper_pct <= 50.0f + 1e-3f;
}

bool DeviceState::isLoaded() {
    // Path planning / HTL: claw mid or closed. Payload kg is torque math only.
    return isGripperLoaded();
}

void DeviceState::updateAngles(const JointAngles& angles) {
    g_angles = angles;
    g_pwm = angles_to_pwm(angles);
}

const JointAngles& DeviceState::getAngles() {
    return g_angles;
}

const JointPwm& DeviceState::getPwm() {
    return g_pwm;
}

void DeviceState::setExerciseProgress(uint8_t rep, uint8_t step, uint8_t steps, float leg, uint8_t total) {
    g_ex_rep = rep;
    g_ex_step = step;
    g_ex_steps = steps;
    g_ex_total = total;
    g_ex_leg = leg;
    if (g_ex_leg < 0.0f) g_ex_leg = 0.0f;
    if (g_ex_leg > 1.0f) g_ex_leg = 1.0f;
}

void DeviceState::clearExerciseProgress() {
    g_ex_rep = 0;
    g_ex_step = 0;
    g_ex_steps = 0;
    g_ex_total = 0;
    g_ex_leg = 0.0f;
}

void DeviceState::maybeEmitTelemetry(uint32_t now_ms) {
    if (now_ms - g_last_telemetry_ms < 50) return;
    g_last_telemetry_ms = now_ms;

    TorqueEstimate t = estimate_torques(g_angles, g_payload_kg * 1000.0f);
    float strainSh = (t.shoulder_Nm / SAFE_SH) * 100.0f;
    float strainEl = (t.elbow_Nm / SAFE_EL) * 100.0f;
    float strainWr = (t.wrist_Nm / SAFE_WR) * 100.0f;

    float curSh = IDLE_MA + (t.shoulder_Nm / STALL_SH) * (STALL_MA_SH - IDLE_MA);
    float curEl = IDLE_MA + (t.elbow_Nm / STALL_EL) * (STALL_MA_EL - IDLE_MA);
    float curWr = IDLE_MA + (t.wrist_Nm / STALL_WR) * (STALL_MA_WR - IDLE_MA);
    float curBase = IDLE_MA + 0.05f * (STALL_MA_B - IDLE_MA);
    float totalMa = curSh + curEl + curWr + curBase;
    float watts = 5.0f * (totalMa / 1000.0f);

    // Telemetry now leaves the MCU as raw numbers over the Router Bridge; the
    // Python side formats the "STATE ..." line the browser already parses.
    // Rationale: Zephyr builds frequently omit floating-point support in
    // snprintf, so formatting floats here is not portable. Sending numbers and
    // formatting on the MPU sidesteps that entirely.
    //
    // VALUE ORDER — must stay in lockstep with python/armic/__init__.py:
    //   0..3   angles     base, shoulder, elbow, wrist   (deg)
    //   4..7   pwm        base, shoulder, elbow, wrist   (ticks)
    //   8..10  strain     shoulder, elbow, wrist         (% of safe torque)
    //   11     manipulability (Yoshikawa index)
    //   12     watts
    //   13     payload    (kg)
    //   14     claw       (% open)
    //   15     loaded     (0 or 1)
    //   16     ex_rep     (1..6 while exercising, else 0)
    //   17     ex_step    (1..ex_steps within current rep)
    //   18     ex_steps   (waypoints per rep for current rep variant)
    //   19     ex_leg     (0..1 progress along current move)
    //   20     ex_total   (target reps for current exercise)
    std::vector<float> v = {
        g_angles.base, g_angles.shoulder, g_angles.elbow, g_angles.wrist,
        (float)g_pwm.base, (float)g_pwm.shoulder, (float)g_pwm.elbow, (float)g_pwm.wrist,
        strainSh, strainEl, strainWr,
        t.manipulability,
        watts,
        g_payload_kg,
        g_gripper_pct,
        isLoaded() ? 1.0f : 0.0f,
        (float)g_ex_rep,
        (float)g_ex_step,
        (float)g_ex_steps,
        g_ex_leg,
        (float)g_ex_total,
    };
    Bridge.notify("state", String(g_mode), v);
}
