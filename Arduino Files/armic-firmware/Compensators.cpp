#include "Compensators.h"
#include <math.h>

Compensators::Compensators() {
    _last_dir_base     = 0;
    _last_dir_shoulder = 0;
    _last_dir_elbow    = 0;
    _last_dir_wrist    = 0;
    _prev_angles       = {90.0f, 90.0f, 90.0f, 90.0f}; // Neutral starting pose
}

void Compensators::applyDroop(JointAngles& angles, const Point3D& target_pos) {
    // Calculate horizontal reach R
    float R = sqrtf(target_pos.x * target_pos.x + target_pos.y * target_pos.y);
    
    // Inject droop offset to the shoulder to keep the end effector leveled
    // As R increases, gravity pulls the arm down more, so we aim slightly higher.
    float droop_offset = R * K_DROOP_SHOULDER;
    
    // In our kinematics convention, shoulder 90 is straight up, so aiming "higher" 
    // means decreasing the angle towards 90 (if it's > 90) or adjusting accordingly.
    // Assuming droop pulls it downwards, we add the offset.
    angles.shoulder += droop_offset;
    
    // We could also apply a smaller droop factor to the elbow if needed:
    // angles.elbow += R * (K_DROOP_SHOULDER * 0.5f);
}

void Compensators::applyBacklash(JointAngles& angles) {
    auto processJoint = [](float& current_angle, float prev_angle, int8_t& last_dir, float backlash_amt) {
        float diff = current_angle - prev_angle;
        int8_t new_dir = (diff > 0.01f) ? 1 : ((diff < -0.01f) ? -1 : last_dir);
        
        // If direction changed and we are actually moving
        if (new_dir != last_dir && new_dir != 0 && last_dir != 0) {
            // Add a one-time step offset in the new direction
            // Wait, backlash feedforward usually means adding the offset statically 
            // as long as we are pushing in that direction.
            // If moving positive, we need to add backlash offset.
            // If moving negative, we subtract it.
            // A simpler way: just offset the target by +BACKLASH if dir > 0, else -BACKLASH
        }
        
        if (new_dir != 0) {
            // Apply constant offset depending on the engaged gear direction
            current_angle += new_dir * backlash_amt;
            last_dir = new_dir;
        }
    };

    processJoint(angles.base,     _prev_angles.base,     _last_dir_base,     BACKLASH_BASE);
    processJoint(angles.shoulder, _prev_angles.shoulder, _last_dir_shoulder, BACKLASH_SHOULDER);
    processJoint(angles.elbow,    _prev_angles.elbow,    _last_dir_elbow,    BACKLASH_ELBOW);
    processJoint(angles.wrist,    _prev_angles.wrist,    _last_dir_wrist,    BACKLASH_WRIST);

    // Save for next iteration
    _prev_angles = angles;
}
