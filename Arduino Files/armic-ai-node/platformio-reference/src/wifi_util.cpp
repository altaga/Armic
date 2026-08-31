#include "wifi_util.h"

#include "config.h"
#include "secrets.h"

#include <M5Core2.h>
#include <WiFi.h>
#include <time.h>

static bool timeSynced = false;
static bool timeSyncStarted = false;

bool wifiConnect(uint32_t timeoutMs) {
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    const unsigned long start = millis();
    while (WiFi.status() != WL_CONNECTED) {
        if (millis() - start > timeoutMs) {
            return false;
        }
        M5.update();
        delay(50);
    }

    configTime(0, 0, "pool.ntp.org", "time.nist.gov");
    timeSyncStarted = true;
    return true;
}

void wifiSyncTimeIfNeeded() {
    if (timeSynced || !timeSyncStarted) {
        return;
    }
    struct tm timeinfo;
    if (getLocalTime(&timeinfo, 0)) {
        timeSynced = true;
    }
}

int8_t wifiRssi() {
    return WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : 0;
}

uint64_t timestampMs() {
    struct tm timeinfo;
    if (timeSynced && getLocalTime(&timeinfo, 0)) {
        time_t now = mktime(&timeinfo);
        return (uint64_t)now * 1000ULL + (millis() % 1000);
    }
    return (uint64_t)millis();
}
