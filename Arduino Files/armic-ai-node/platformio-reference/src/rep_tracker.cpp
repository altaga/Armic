#include "rep_tracker.h"

#include "model-parameters/model_metadata.h"

#include <ctype.h>
#include <string.h>

static bool streqIgnoreCase(const char *a, const char *b) {
    while (*a && *b) {
        if (tolower((unsigned char)*a) != tolower((unsigned char)*b)) {
            return false;
        }
        a++;
        b++;
    }
    return *a == *b;
}

static size_t topClassIndex(const ei_impulse_result_t *result) {
    size_t top = 0;
    float topVal = result->classification[0].value;
    for (size_t i = 1; i < EI_CLASSIFIER_LABEL_COUNT; i++) {
        if (result->classification[i].value > topVal) {
            topVal = result->classification[i].value;
            top = i;
        }
    }
    return top;
}

static void applySessionOutputs(const RepState *state, ArmicExerciseId *outExercise, uint16_t *outRep) {
    if (state->sessionExercise != ARMIC_EX_UNKNOWN) {
        *outExercise = state->sessionExercise;
        *outRep = state->sessionRepCount;
    } else {
        *outExercise = ARMIC_EX_UNKNOWN;
        *outRep = 0;
    }
}

static void switchSession(RepState *state, ArmicExerciseId exercise, bool *sessionChanged,
                          ArmicExerciseId *outSessionExercise) {
    if (state->sessionExercise == exercise && state->sessionRepCount == 0 && !state->inRep) {
        return;
    }
    state->sessionExercise = exercise;
    state->sessionRepCount = 0;
    state->inRep = false;
    state->currentRep = 0;
    *sessionChanged = true;
    *outSessionExercise = exercise;
}

static void beginRep(RepState *state, ArmicExerciseId exercise, bool *repStart,
                     ArmicExerciseId *outExercise, uint16_t *outRep) {
    state->inRep = true;
    state->sessionExercise = exercise;
    state->currentRep = state->sessionRepCount + 1;
    state->prevWasBaseline = false;

    *repStart = true;
    *outExercise = exercise;
    *outRep = state->sessionRepCount;
}

void repTrackerInit(RepState *state) {
    state->inRep = false;
    state->sessionExercise = ARMIC_EX_UNKNOWN;
    state->sessionRepCount = 0;
    state->currentRep = 0;
    state->prevWasBaseline = true;
}

void repTrackerUpdate(RepState *state, const ei_impulse_result_t *result,
                      float confidenceMin, ArmicExerciseId *outExercise, uint16_t *outRep,
                      bool *repStart, bool *repEnd,
                      ArmicExerciseId *outEndExercise, uint16_t *outEndRep,
                      bool *sessionChanged, ArmicExerciseId *outSessionExercise) {
    *repStart = false;
    *repEnd = false;
    *sessionChanged = false;
    *outEndExercise = ARMIC_EX_UNKNOWN;
    *outEndRep = 0;
    *outSessionExercise = ARMIC_EX_UNKNOWN;
    *outExercise = ARMIC_EX_UNKNOWN;
    *outRep = 0;

    applySessionOutputs(state, outExercise, outRep);

    const size_t topIx = topClassIndex(result);
    const char *topLabel = result->classification[topIx].label;
    const float topConf = result->classification[topIx].value;
    const ArmicExerciseId detected = exerciseFromLabel(topLabel);
    const bool isExercise = detected != ARMIC_EX_UNKNOWN;
    const bool isBaseline = streqIgnoreCase(topLabel, "Baseline");
    const bool confident = topConf >= confidenceMin;

    if (!confident) {
        return;
    }

    if (state->inRep) {
        const bool returnedToBaseline = isBaseline;
        const bool switchedExercise = isExercise && detected != state->sessionExercise;

        if (switchedExercise && !returnedToBaseline) {
            switchSession(state, detected, sessionChanged, outSessionExercise);
            beginRep(state, detected, repStart, outExercise, outRep);
            return;
        }

        if (returnedToBaseline) {
            state->sessionRepCount = state->currentRep;
            state->inRep = false;
            state->currentRep = 0;
            state->prevWasBaseline = true;

            *repEnd = true;
            *outEndExercise = state->sessionExercise;
            *outEndRep = state->sessionRepCount;
            *outExercise = state->sessionExercise;
            *outRep = state->sessionRepCount;
            return;
        }

        applySessionOutputs(state, outExercise, outRep);
        return;
    }

    if (isBaseline) {
        state->prevWasBaseline = true;
        applySessionOutputs(state, outExercise, outRep);
        return;
    }

    if (isExercise && state->prevWasBaseline) {
        const bool sameSession = state->sessionExercise == ARMIC_EX_UNKNOWN
            || state->sessionExercise == detected;

        if (!sameSession) {
            switchSession(state, detected, sessionChanged, outSessionExercise);
        } else if (state->sessionExercise == ARMIC_EX_UNKNOWN) {
            state->sessionExercise = detected;
        }

        beginRep(state, detected, repStart, outExercise, outRep);
        return;
    }

    if (isExercise) {
        state->prevWasBaseline = false;
    }
}
