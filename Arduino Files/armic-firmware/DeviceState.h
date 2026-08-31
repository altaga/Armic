#pragma once

#include <stdint.h>
#include "kinematics.h"

// Shared device state for telemetry and cross-module angle tracking.
namespace DeviceState {
    void init();
    void setMode(const char* mode);
    void setPayloadKg(float kg);
    float getPayloadKg();

    // Claw: 0% = closed, 50% = mid, 100% = open.
    // Mid or closed ⇒ treated as loaded (HTL / heavy path planning).
    void setGripperPct(float pct);
    float getGripperPct();
    bool isGripperLoaded(); // pct <= 50 (mid or closed)
    bool isLoaded();        // claw loaded OR payload > 0.05 kg

    void updateAngles(const JointAngles& angles);
    const JointAngles& getAngles();
    const JointPwm& getPwm();

    // Rehab exercise progress (0 = not in an exercise rep cycle).
    void setExerciseProgress(uint8_t rep, uint8_t step, uint8_t steps, float leg, uint8_t total);
    void clearExerciseProgress();

    void maybeEmitTelemetry(uint32_t now_ms);
}
