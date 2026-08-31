#pragma once

#include "exercise_map.h"

#include "edge-impulse-sdk/classifier/ei_classifier_types.h"

// Single active exercise session — reps count only for sessionExercise.
// Switching to a different exercise resets sessionRepCount to 0.
struct RepState {
    bool inRep;
    ArmicExerciseId sessionExercise;
    uint16_t sessionRepCount;
    uint16_t currentRep;
    bool prevWasBaseline;
};

void repTrackerInit(RepState *state);
void repTrackerUpdate(RepState *state, const ei_impulse_result_t *result,
                      float confidenceMin, ArmicExerciseId *outExercise, uint16_t *outRep,
                      bool *repStart, bool *repEnd,
                      ArmicExerciseId *outEndExercise, uint16_t *outEndRep,
                      bool *sessionChanged, ArmicExerciseId *outSessionExercise);
