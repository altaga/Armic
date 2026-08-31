#pragma once

#include <stddef.h>
#include <stdint.h>

#include "edge-impulse-sdk/classifier/ei_classifier_types.h"

typedef enum {
    ARMIC_EX_UNKNOWN = 0,
    ARMIC_EX_BICEP,
    ARMIC_EX_LATERAL,
    ARMIC_EX_ELBOWFLEX,
} ArmicExerciseId;

const char *exerciseToString(ArmicExerciseId kind);
ArmicExerciseId exerciseFromLabel(const char *label);
void labelToLower(const char *label, char *out, size_t outLen);
bool classificationIsBaseline(const ei_impulse_result_t *result);
