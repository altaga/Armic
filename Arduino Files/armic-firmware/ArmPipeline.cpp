#include "ArmPipeline.h"
#include "DeviceState.h"
#include <Arduino.h>
#include <math.h>

namespace {
constexpr float STALL_SAFE_SH = 0.2108f * 0.80f;
constexpr float STALL_SAFE_EL = 0.2108f * 0.80f;
constexpr float STALL_SAFE_WR = 0.1863f * 0.80f;
} // namespace

ArmPipeline::ArmPipeline(WritePwmCallback pwm_cb)
    : _write_pwm(pwm_cb), _payload_kg(0.0f), _pitch_deg(90.0f), _active(false) {
    _current_pos = {0.1f, 0.0f, 300.0f}; // FK of home 90/90/90/90 (straight up)
}

void ArmPipeline::init(const Point3D& start_pos) {
    (void)start_pos;
    JointAngles home = {90.0f, 90.0f, 95.0f, 90.0f};
    float hx, hy, hz;
    fk_solve(home, hx, hy, hz);
    _current_pos = {hx, hy, hz};
    _motion.setCurrentAngles(home);
    _active = false;
    DeviceState::updateAngles(home);
    DeviceState::setMode("idle");
}

void ArmPipeline::setPayloadKg(float kg) {
    if (kg < 0.0f) kg = 0.0f;
    if (kg > 0.5f) kg = 0.5f;
    _payload_kg = kg;
}

void ArmPipeline::stop() {
    _active = false;
    DeviceState::setMode("idle");
}

void ArmPipeline::syncFromAngles(const JointAngles& a) {
    float hx, hy, hz;
    fk_solve(a, hx, hy, hz);
    _current_pos = {hx, hy, hz};
    _motion.setCurrentAngles(a);
    _active = false;
}

bool ArmPipeline::isMoving() const {
    return _active && _planner.isMoving();
}

JointAngles ArmPipeline::getCurrentAngles() const {
    return _motion.getCurrentAngles();
}

void ArmPipeline::setTarget(float x, float y, float z, bool is_loaded, float pitch_deg) {
    // Always start from the last commanded joint pose (not a stale Cartesian guess).
    syncFromAngles(DeviceState::getAngles());
    _pitch_deg = pitch_deg;
    _planner.moveTo(_current_pos, {x, y, z}, is_loaded);
    _active = true;
    DeviceState::setMode("pipeline");
}

void ArmPipeline::update(uint32_t dt_ms, uint32_t current_time_ms) {
    // CRITICAL: do nothing while idle — writing PWM here was forcing a bent pose.
    if (!_active || !_planner.isMoving()) {
        _active = false;
        return;
    }

    Point3D next = _planner.getNextWaypoint(_current_pos, 2.0f);

    JointAngles target_angles;
    IkStatus status = ik_solve(next.x, next.y, next.z, _pitch_deg, target_angles);
    if (status != IkStatus::OK) {
        // Do not keep a failed waypoint as the path origin.
        Serial.print(">>> pipeline IK fail @ ");
        Serial.print(next.x); Serial.print(',');
        Serial.print(next.y); Serial.print(',');
        Serial.println(next.z);
        syncFromAngles(DeviceState::getAngles());
        DeviceState::setMode("idle");
        return;
    }
    _current_pos = next;

    // Droop disabled until sign is measured on hardware (was pushing reach down).
    // Backlash feedforward stays off (±2°/tick hunt).

    TorqueEstimate te = estimate_torques(target_angles, _payload_kg * 1000.0f);
    float strainSh = (te.shoulder_Nm / STALL_SAFE_SH) * 100.0f;
    float strainEl = (te.elbow_Nm / STALL_SAFE_EL) * 100.0f;
    float strainWr = (te.wrist_Nm / STALL_SAFE_WR) * 100.0f;
    float maxStrain = strainSh;
    if (strainEl > maxStrain) maxStrain = strainEl;
    if (strainWr > maxStrain) maxStrain = strainWr;
    float scale = 1.0f - (maxStrain / 100.0f) * 0.60f;
    if (scale < 0.40f) scale = 0.40f;
    _motion.setVelocityScale(scale);

    JointAngles current_step = _motion.step(target_angles, dt_ms);

    JointAngles out = current_step;
    if (dither_amplitude > 0.0f) {
        float t_sec = current_time_ms / 1000.0f;
        float dither_val = dither_amplitude * sinf(2.0f * 3.14159f * dither_freq_hz * t_sec);
        out.base     += dither_val;
        out.shoulder += dither_val;
        out.elbow    += dither_val;
        out.wrist    += dither_val;
    }

    JointPwm final_pwm = angles_to_pwm(out);
    if (_write_pwm) {
        _write_pwm(joints::CH_BASE,     final_pwm.base);
        _write_pwm(joints::CH_SHOULDER, final_pwm.shoulder);
        _write_pwm(joints::CH_ELBOW,    final_pwm.elbow);
        _write_pwm(joints::CH_WRIST,    final_pwm.wrist);
    }

    DeviceState::updateAngles(current_step);
    if (!_planner.isMoving()) {
        _active = false;
        DeviceState::setMode("idle");
    }
}
