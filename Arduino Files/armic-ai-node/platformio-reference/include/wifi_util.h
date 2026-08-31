#pragma once

#include <Arduino.h>

bool wifiConnect(uint32_t timeoutMs);
void wifiSyncTimeIfNeeded();
int8_t wifiRssi();
uint64_t timestampMs();
