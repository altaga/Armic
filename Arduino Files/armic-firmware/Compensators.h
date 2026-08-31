#pragma once

#include "kinematics.h"
#include "Planner.h" // For Point3D

class Compensators {
public:
    Compensators();

    // Constant for droop compensation: degrees added to shoulder per mm of radial extension
    // This should be tuned empirically.
    static constexpr float K_DROOP_SHOULDER = 0.015f; 

    // Constants for backlash compensation in degrees
    static constexpr float BACKLASH_BASE     = 1.0f;
    static constexpr float BACKLASH_SHOULDER = 1.5f;
    static constexpr float BACKLASH_ELBOW    = 2.0f;
    static constexpr float BACKLASH_WRIST    = 1.0f;

    // Apply Droop Feedforward (Gravity Compensation)
    // Increases the shoulder angle based on the radial extension R.
    void applyDroop(JointAngles& angles, const Point3D& target_pos);

    // Apply Backlash Feedforward (Gear Slack Compensation)
    // Injects an offset when the direction of rotation changes.
    void applyBacklash(JointAngles& angles);

private:
    // Tracks the last movement direction (sign) for each joint
    int8_t _last_dir_base;
    int8_t _last_dir_shoulder;
    int8_t _last_dir_elbow;
    int8_t _last_dir_wrist;
    
    // Tracks previous angles to detect direction changes
    JointAngles _prev_angles;
};
