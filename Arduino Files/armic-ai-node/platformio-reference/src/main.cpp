/*
 * Armic-AI-Node — M5Stack Core2 wearable agent
 *
 * Runs the Armic Edge Impulse fusion model (6-axis IMU @ 50 Hz, 2 s window)
 * Publishes UNO Q MQTT contract messages (armic/wearable/v1/*).
 */

#include <Arduino.h>
#include <M5Core2.h>

#include "model-parameters/model_metadata.h"

#include "config.h"
#include "display_ui.h"
#include "exercise_map.h"
#include "imu_reader.h"
#include "inference_runner.h"
#include "mqtt_wearable.h"
#include "rep_tracker.h"
#include "wifi_util.h"

#if !defined(EI_CLASSIFIER_SENSOR) || EI_CLASSIFIER_SENSOR != EI_CLASSIFIER_SENSOR_FUSION
#error "Armic model must be EI_CLASSIFIER_SENSOR_FUSION"
#endif

static RepState repState;
static unsigned long lastHeartbeatMs = 0;
static bool eiReady = false;

static ei_impulse_result_t lastResult;
static bool hasInferenceResult = false;
static ArmicExerciseId displayExercise = ARMIC_EX_UNKNOWN;
static uint16_t displayRep = 0;

static void maybeHeartbeat() {
    const unsigned long now = millis();
    if (now - lastHeartbeatMs < HEARTBEAT_INTERVAL_MS) {
        return;
    }
    lastHeartbeatMs = now;
    mqttPublishHeartbeat(eiReady, wifiRssi());
}

static void refreshDisplay() {
    const bool mqttOk = mqttWearableConnected();
    const int8_t rssi = wifiRssi();

    if (!hasInferenceResult) {
        displayEnterDashboard(mqttOk, rssi);
        return;
    }

    displayDashboard(&lastResult, displayExercise, displayRep, mqttOk, rssi, 0,
        repState.inRep);
}

void setup() {
    M5.begin();
    displayInit();
    displayBootScreen();

    Serial.begin(115200);
    delay(200);
    Serial.println();
    Serial.println("=== Armic-AI-Node ===");

    displayBootProgress("IMU init", false, true);
    M5.update();
    if (!imuInit()) {
        displayBootProgress("IMU init", false, false);
        while (true) {
            M5.update();
            delay(100);
        }
    }

    float discard[6];
    for (int i = 0; i < 10; i++) {
        imuRead(discard);
        M5.update();
        delay(10);
    }
    eiReady = true;
    displayBootProgress("IMU init", true, false);

    displayBootProgress("WiFi connect", false, true);
    M5.update();
    if (!wifiConnect(WIFI_TIMEOUT_MS)) {
        displayBootProgress("WiFi connect", false, false);
    } else {
        displayBootProgress("WiFi connect", true, false);

        displayBootProgress("MQTT broker", false, true);
        M5.update();
        if (!mqttWearableBegin()) {
            displayBootProgress("MQTT broker", false, false);
        } else {
            displayBootProgress("MQTT broker", true, false);
        }
    }

    repTrackerInit(&repState);
    inferenceRunnerInit();
    lastHeartbeatMs = millis();

    Serial.printf("EI: %d Hz, window %d ms, classes %d\n",
        EI_CLASSIFIER_FREQUENCY,
        EI_CLASSIFIER_RAW_SAMPLE_COUNT * EI_CLASSIFIER_INTERVAL_MS,
        (int)EI_CLASSIFIER_LABEL_COUNT);

    displayEnterDashboard(mqttWearableConnected(), wifiRssi());
}

void loop() {
    M5.update();
    wifiSyncTimeIfNeeded();
    maybeHeartbeat();
    mqttWearableLoop();

    ei_impulse_result_t result;
    int inferenceMs = 0;
    const bool inferenceReady = inferenceRunnerTick(&result, &inferenceMs);
    if (inferenceReady) {
        ArmicExerciseId exercise = ARMIC_EX_UNKNOWN;
        ArmicExerciseId endExercise = ARMIC_EX_UNKNOWN;
        ArmicExerciseId sessionExercise = ARMIC_EX_UNKNOWN;
        uint16_t rep = 0;
        uint16_t endRep = 0;
        bool repStart = false;
        bool repEnd = false;
        bool sessionChanged = false;

        repTrackerUpdate(&repState, &result, REP_CONFIDENCE_MIN, &exercise, &rep,
            &repStart, &repEnd, &endExercise, &endRep, &sessionChanged, &sessionExercise);

        if (sessionChanged && sessionExercise != ARMIC_EX_UNKNOWN) {
            mqttPublishSessionChange(sessionExercise);
        }
        if (repEnd && endExercise != ARMIC_EX_UNKNOWN) {
            mqttPublishRepEnd(endExercise, endRep);
        }
        if (repStart && exercise != ARMIC_EX_UNKNOWN) {
            mqttPublishRepStart(exercise, repState.currentRep);
        }

        mqttPublishInference(&result, exercise, rep, inferenceMs, repState.inRep);

        lastResult = result;
        hasInferenceResult = true;
        displayExercise = exercise;
        displayRep = rep;
    }

    refreshDisplay();

    if (!inferenceReady) {
        delay(2);
    }
}
