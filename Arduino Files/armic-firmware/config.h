// ============================================================================
// ArmDriverTesting — per-servo PWM calibration values
//
// These are the *measured* safe PWM ticks (0..4095) that produce the
// physical 0° and 180° positions for each servo. They were obtained with
// the manual ramp protocol (NEVER via autodetect / over-sweep).
//
// Per-servo channel map (matches the original main.cpp):
//   ch0 = base (rotation)     ← calibrated
//   ch1 = shoulder
//   ch2 = elbow
//   ch3 = wrist
//   ch4 = gripper
//
// Safe-band reference (ticks at 50 Hz, 1 tick ≈ 4.88 µs):
//   102  = 0.5 ms absolute mechanical minimum
//   205  = 1.0 ms standard minimum
//   307  = 1.5 ms center (90°)
//   410  = 2.0 ms standard maximum
//   512  = 2.5 ms absolute mechanical maximum
//
// LEGAL OPERATING BAND: the calibrated (MIN, MAX) MUST always lie inside
//   [PWM_FLOOR_HARD, PWM_CEIL_HARD] = [110, 500].
// Anything outside that means the servo is being driven past its stops —
// STOP and re-measure.
// ============================================================================

#pragma once

// ---- Hard safety limits (firmware must never write outside these) ---------
// These are the firmware floor / ceiling that EVERY per-servo range must lie
// inside. They're wide enough to catch typos but tight enough that the
// firmware never produces the "weird values / weird behaviour" pattern
// (stall / reverse) that drove the original 53-tick destruction.
static const uint16_t PWM_FLOOR_HARD = 50;    // well below every servo MIN
static const uint16_t PWM_CEIL_HARD  = 600;   // well above every servo MAX
static const uint16_t PWM_CENTER     = 300;   // 1.46 ms — true 90° for THIS arm

// ============================================================================
// PER-SERVO FINAL CALIBRATION (measured 2026-08-20, ramp protocol)
// ============================================================================
// Each motor has its own physical 0° / 180° / 90° PWM. The sweep test on
// any channel uses the per-channel (MIN, MAX, CENTER) — NOT a universal
// band. Ch4 (gripper) is an open/close joint, not a rotation: 236 = fully
// closed, 440 = fully open, 338 = mid. The sweep still does
// MIN -> CENTER -> MAX -> MIN -> CENTER but those labels are just
// "low / mid / high" for the gripper, not 0° / 90° / 180°.

// ---- ch0: base (rotation) ----
static const uint16_t BASE_PWM_MIN     = 100;
static const uint16_t BASE_PWM_MAX     = 500;
static const uint16_t BASE_PWM_CENTER  = 300;

// ---- ch1: shoulder ----
static const uint16_t SHOULDER_PWM_MIN    = 90;    // slightly below the [100,500] band
static const uint16_t SHOULDER_PWM_MAX    = 490;   // slightly below the [100,500] band
static const uint16_t SHOULDER_PWM_CENTER = 290;

// ---- ch2: elbow ----
static const uint16_t ELBOW_PWM_MIN    = 100;
static const uint16_t ELBOW_PWM_MAX    = 500;
static const uint16_t ELBOW_PWM_CENTER = 300;

// ---- ch3: wrist ----
static const uint16_t WRIST_PWM_MIN    = 100;
static const uint16_t WRIST_PWM_MAX    = 500;
static const uint16_t WRIST_PWM_CENTER = 300;

// ---- ch4: gripper (open/close, not a rotation) ----
static const uint16_t GRIPPER_PWM_MIN    = 236;   // fully closed
static const uint16_t GRIPPER_PWM_MAX    = 440;   // fully open
static const uint16_t GRIPPER_PWM_CENTER = 338;   // mid (between closed and open)
