#pragma once

#include "kinematics.h"

class MotionProfile {
public:
    MotionProfile();

    // Sets the maximum degrees per second the joint is allowed to move
    void setMaxVelocity(float max_deg_per_sec);

    // Feeds the target angles and gets the interpolated angles for the current timeframe.
    // dt_ms is the time elapsed since the last call.
    JointAngles step(const JointAngles& target_angles, uint32_t dt_ms);

    // Forces the current angles to a specific value without interpolation (e.g. at startup)
    void setCurrentAngles(const JointAngles& angles);
    void setVelocityScale(float scale);
    JointAngles getCurrentAngles() const;

private:
    float _max_vel_deg_per_ms;
    float _velocity_scale;
    JointAngles _current_angles;
};
