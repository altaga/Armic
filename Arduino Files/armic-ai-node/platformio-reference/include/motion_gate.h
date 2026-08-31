#pragma once

#include <stdbool.h>
#include <stddef.h>

#include "edge-impulse-sdk/classifier/ei_classifier_types.h"

// Returns true if the window was overridden to Baseline (stationary).
bool motionGateApply(const float *buffer, size_t sampleCount, int axesPerSample,
                     ei_impulse_result_t *result);
