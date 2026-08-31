#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "edge-impulse-sdk/classifier/ei_classifier_types.h"
#include "exercise_map.h"

bool mqttWearableBegin();
bool mqttWearableConnected();
void mqttWearableLoop();

void mqttPublishHeartbeat(bool eiReady, int8_t wifiRssi);
void mqttPublishInference(const ei_impulse_result_t *result, ArmicExerciseId exercise,
                          uint16_t rep, int inferenceMs, bool inRep);
void mqttPublishRepStart(ArmicExerciseId exercise, uint16_t rep);
void mqttPublishRepEnd(ArmicExerciseId exercise, uint16_t rep);
void mqttPublishSessionChange(ArmicExerciseId exercise);
void mqttOnCommand(const char *payload, size_t len);
