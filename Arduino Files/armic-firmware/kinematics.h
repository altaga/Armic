// ============================================================================
// ArmDriver kinematics — header
//   All references in this file come from the user's calibration session on
//   2026-08-20/21 (see memory/armdriver-base-calibration.md and the
//   per-channel conversation). DO NOT change any constant without the user
//   confirming the new measurement.
// ============================================================================

#pragma once

#include <stdint.h>
#include <stdbool.h>

// ---------------------------------------------------------------------------
// Link lengths (mm) — measured by user 2026-08-21.
//
//   floor ──60mm── base pivot ──30mm── shoulder pivot ──90mm── elbow pivot
//                                              ──70mm── wrist pivot ──50mm── gripper base
//
// L0..L3 are joint-to-joint distances (NO floor offset). The floor offset is
// applied separately so the base pivot sits 60mm above floor — useful for
// obstacles and for the simulator's grid placement.
// ---------------------------------------------------------------------------
namespace links {
    static constexpr float L0 = 30.0f;   // base → shoulder (vertical column)
    static constexpr float L1 = 90.0f;   // shoulder → elbow (upper arm)
    static constexpr float L2 = 70.0f;   // elbow → wrist (forearm)
    static constexpr float L3 = 50.0f;   // wrist → gripper base (tool link)
    static constexpr float FLOOR_OFFSET = 60.0f;   // floor → base pivot
}

// ---------------------------------------------------------------------------
// Per-joint calibration.
//
// Joint convention (user's expectation, 2026-08-21):
//   ALL joints at 90° → arm is fully straight.
//   shoulder=90° → upper arm straight up (+Z).
//   elbow=90°    → forearm aligned with upper arm (straight).
//   wrist=90°    → L3 aligned with forearm (straight).
//   elbow=0°     → forearm folded back perpendicular to upper arm.
//   base=90°     → arm along +X (yaw in floor plane).
//
// World frame: (x, y) = floor plane, z = vertical up.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Per-joint calibration.
//
// RUNTIME-MUTABLE (Armic). These were `static constexpr` in the ESP32 build.
// They are now `extern` with a single mutable definition in kinematics.cpp, so
// the calibration can be edited live from the settings UI and persisted to
// ../Arduino Files/armic-brick/calibration.json. The conversion helpers in kinematics.cpp read
// them at call time, so nothing else had to change.
//
// Channel numbers stay compile-time: which servo is plugged into which PCA9685
// output is wiring, not calibration.
//
// Writes go through cal_set() in sketch.ino, which validates against the hard
// envelope in config.h. Do not assign these directly from elsewhere.
// ---------------------------------------------------------------------------
namespace joints {
    // ch0 base (DIRECT)
    static constexpr uint8_t CH_BASE = 0;
    extern uint16_t PWM_MIN_B;
    extern uint16_t PWM_MAX_B;
    extern uint16_t PWM_MID_B;
    extern int8_t   DIR_BASE;
    extern float    SOFT_MIN_B;
    extern float    SOFT_MAX_B;
    extern float    OFFSET_B;      // static offset in degrees

    // ch1 shoulder (INVERTED)
    static constexpr uint8_t CH_SHOULDER = 1;
    extern uint16_t PWM_MIN_S;
    extern uint16_t PWM_MAX_S;
    extern uint16_t PWM_MID_S;
    extern int8_t   DIR_SHOULDER;
    extern float    SOFT_MIN_S;
    extern float    SOFT_MAX_S;
    extern float    OFFSET_S;

    // ch2 elbow (DIRECT) — restricted by user 2026-08-21 to [90°, 180°].
    // In our convention: elbow=90° = straight (aligned with upper arm).
    // elbow=180° = fully folded back perpendicular (the "elbow pointing
    // behind" position). The [90, 180] band prevents the forearm from
    // folding FORWARD past alignment with the upper arm.
    static constexpr uint8_t CH_ELBOW = 2;
    extern uint16_t PWM_MIN_E;
    extern uint16_t PWM_MAX_E;
    extern uint16_t PWM_MID_E;
    extern int8_t   DIR_ELBOW;
    extern float    SOFT_MIN_E;
    extern float    SOFT_MAX_E;
    extern float    OFFSET_E;

    // ch3 wrist (INVERTED) — mount folds opposite of FK label; matches
    // C/Transport on hardware.
    static constexpr uint8_t CH_WRIST = 3;
    extern uint16_t PWM_MIN_W;
    extern uint16_t PWM_MAX_W;
    extern uint16_t PWM_MID_W;
    extern int8_t   DIR_WRIST;
    extern float    SOFT_MIN_W;
    extern float    SOFT_MAX_W;
    extern float    OFFSET_W;
}

// ---------------------------------------------------------------------------
// Result types.
// ---------------------------------------------------------------------------
struct JointAngles {
    float base;      // degrees, in [0, 180]
    float shoulder;  // degrees, in [0, 180]
    float elbow;     // degrees, in [0, 180]
    float wrist;     // degrees, in [0, 180]
};

struct JointPwm {
    uint16_t base;
    uint16_t shoulder;
    uint16_t elbow;
    uint16_t wrist;
};

// ---------------------------------------------------------------------------
// IK reason codes. The IK can fail for several reasons; we surface them so
// the caller can log or react.
// ---------------------------------------------------------------------------
enum class IkStatus : uint8_t {
    OK = 0,
    ERR_BASE_SINGULARITY,    // target sits on the base yaw axis (r == 0)
    ERR_UNREACHABLE,         // target is farther than L1+L2+L3 from shoulder
    ERR_OUT_OF_RANGE,        // geometrically reachable but joints can't fold
                             // to that pose (e.g. behind the shoulder column)
    ERR_JOINT_LIMIT,         // solved angles are outside the per-joint safe
                             // angle band (after DIRECT/INVERTED handling)
};

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

// Forward kinematics: joint angles → tool-tip position (mm).
// Frame: +X = viewer-right, +Y = forward (away), +Z = up, with z = 0 at
// the FLOOR (so the base pivot sits at z = FLOOR_OFFSET). At the neutral
// pose (all joints = 90°, arm fully straight up) the tool tip is at
// (0, 0, FLOOR_OFFSET + L0 + L1 + L2 + L3).
void fk_solve(const JointAngles& a, float& x, float& y, float& z);

// Planar IK: given elbow and wrist, solve shoulder so the tool tip sits on the
// base column (x = y = 0, i.e. radial distance r = 0 in the arm plane).
// Returns false if no solution lies within the shoulder soft band.
bool shoulder_for_xy_zero(float elbow_deg, float wrist_deg, float& shoulder_out);

// Inverse kinematics: tool-tip position → joint angles.
//   x, y, z in mm in the FK convention above (z is measured from the floor).
//   pitch_deg is the angle of the L3 link relative to horizontal:
//       pitch_deg = 0   → L3 is horizontal (tool pointing forward in r-z plane)
//       pitch_deg = 90  → L3 points straight up
//   If pitch_deg is omitted, defaults to 0 (horizontal tool).
//
// Returns:
//   OK              — angles populated, all within safe bands.
//   ERR_*           — IK failed, angles not modified.
IkStatus ik_solve(float x, float y, float z, float pitch_deg,
                  JointAngles& out_angles);

// Same as above, but if both elbow branches are valid, pick the one closer
// to `prefer` (avoids mid-path IK flips / jumps).
IkStatus ik_solve(float x, float y, float z, float pitch_deg,
                  JointAngles& out_angles, const JointAngles* prefer);

IkStatus ik_solve(float x, float y, float z, JointAngles& out_angles);

// Angle → PWM, applying the per-joint DIRECT/INVERTED convention and clamping
// to the per-channel safe band. The 90° reference maps to PWM_MID.
uint16_t angle_to_pwm_base    (float deg);
uint16_t angle_to_pwm_shoulder(float deg);
uint16_t angle_to_pwm_elbow   (float deg);
uint16_t angle_to_pwm_wrist   (float deg);

// Convert a whole joint-angle set to PWMs in one call.
JointPwm angles_to_pwm(const JointAngles& a);

// Inverse of the above: PWM → angle, applying DIRECT/INVERTED.
// Useful for reading back from a calibrated servo.
float pwm_to_angle_base    (uint16_t pwm);
float pwm_to_angle_shoulder(uint16_t pwm);
JointAngles pwm_to_angles(const JointPwm& pwm);

// ---------------------------------------------------------------------------
// Static Torque & Manipulability estimation API.
// ---------------------------------------------------------------------------
struct TorqueEstimate {
    float shoulder_Nm;
    float elbow_Nm;
    float wrist_Nm;
    float manipulability;   // Yoshikawa Manipulability Index w
};

TorqueEstimate estimate_torques(const JointAngles& a, float payload_grams = 100.0f);

float pwm_to_angle_elbow   (uint16_t pwm);
float pwm_to_angle_wrist   (uint16_t pwm);

// Friendly name for an IkStatus (for serial logging).
const char* ik_status_str(IkStatus s);
