#pragma once

#include "Planner.h"
#include "kinematics.h"
#include "Compensators.h"
#include "MotionProfile.h"

typedef void (*WritePwmCallback)(uint8_t channel, uint16_t pwm);

class ArmPipeline {
public:
    ArmPipeline(WritePwmCallback pwm_cb);

    void init(const Point3D& start_pos);
    void setTarget(float x, float y, float z, bool is_loaded = false, float pitch_deg = 90.0f);
    void setPayloadKg(float kg);
    void stop();
    void syncFromAngles(const JointAngles& a);
    bool isMoving() const;
    JointAngles getCurrentAngles() const;

    // No-op when idle — never writes PWM unless a target is active.
    void update(uint32_t dt_ms, uint32_t current_time_ms);

    // Keep dither off unless explicitly enabled (1° @ 50 Hz shakes the arm).
    float dither_amplitude = 0.0f;
    float dither_freq_hz   = 50.0f;

private:
    Planner _planner;
    Compensators _compensators;
    MotionProfile _motion;
    WritePwmCallback _write_pwm;

    Point3D _current_pos;
    float _payload_kg;
    float _pitch_deg;
    bool _active;
};
