#pragma once

#include "edge-impulse-sdk/classifier/ei_classifier_types.h"

void inferenceRunnerInit();
bool inferenceRunnerTick(ei_impulse_result_t *result, int *inferenceMs);
