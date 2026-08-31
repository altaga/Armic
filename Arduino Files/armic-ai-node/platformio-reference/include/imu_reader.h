#pragma once

#include <Arduino.h>

bool imuInit();
bool imuRead(float out[6]);
