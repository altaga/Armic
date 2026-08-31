#pragma once

#include <stdint.h>
#include <stdbool.h>

#include "edge-impulse-sdk/classifier/ei_classifier_types.h"
#include "exercise_map.h"

// Dashboard zones (see display_ui_layout.h): Header | Exercise bar | AI detectors bars

void displayInit();
void displayBootScreen();
void displayBootProgress(const char *step, bool ok, bool active);
void displayDashboard(const ei_impulse_result_t *result, ArmicExerciseId exercise,
                      uint16_t rep, bool mqttOk, int8_t rssi, int inferenceMs,
                      bool inRep);
void displayEnterDashboard(bool mqttOk, int8_t rssi);
