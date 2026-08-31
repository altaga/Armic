#include "MotionProfile.h"
#include <math.h>

MotionProfile::MotionProfile() {
    _max_vel_deg_per_ms = 90.0f / 1000.0f;
    _velocity_scale = 1.0f;
    _current_angles = {90.0f, 90.0f, 90.0f, 90.0f};
}

void MotionProfile::setMaxVelocity(float max_deg_per_sec) {
    _max_vel_deg_per_ms = max_deg_per_sec / 1000.0f;
}

void MotionProfile::setVelocityScale(float scale) {
    if (scale < 0.10f) scale = 0.10f;
    if (scale > 1.0f) scale = 1.0f;
    _velocity_scale = scale;
}

void MotionProfile::setCurrentAngles(const JointAngles& angles) {
    _current_angles = angles;
}

JointAngles MotionProfile::getCurrentAngles() const {
    return _current_angles;
}

JointAngles MotionProfile::step(const JointAngles& target_angles, uint32_t dt_ms) {
    float max_step = _max_vel_deg_per_ms * _velocity_scale * dt_ms;

    auto moveJoint = [](float& current, float target, float step_limit) {
        float diff = target - current;
        if (fabsf(diff) <= step_limit) {
            current = target;
        } else {
            current += (diff > 0.0f) ? step_limit : -step_limit;
        }
    };

    moveJoint(_current_angles.base,     target_angles.base,     max_step);
    moveJoint(_current_angles.shoulder, target_angles.shoulder, max_step);
    moveJoint(_current_angles.elbow,    target_angles.elbow,    max_step);
    moveJoint(_current_angles.wrist,    target_angles.wrist,    max_step);

    return _current_angles;
}
