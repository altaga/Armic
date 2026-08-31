#include "inference_runner.h"

#include "imu_reader.h"
#include "motion_gate.h"

#include <Armic_inferencing.h>

#include <string.h>

static constexpr int kAxisCount = 6;
static constexpr bool kDebugNn = false;
static constexpr size_t kSampleCount = EI_CLASSIFIER_RAW_SAMPLE_COUNT;
static constexpr uint32_t kSamplePeriodUs =
    (uint32_t)(1000000.0f / (float)EI_CLASSIFIER_FREQUENCY);

static float gBuffer[EI_CLASSIFIER_DSP_INPUT_FRAME_SIZE];
static size_t gSampleIx = 0;
static int64_t gNextSampleUs = 0;
static bool gReady = false;

void inferenceRunnerInit() {
    memset(gBuffer, 0, sizeof(gBuffer));
    gSampleIx = 0;
    gNextSampleUs = micros();
    gReady = true;
}

bool inferenceRunnerTick(ei_impulse_result_t *result, int *inferenceMs) {
    if (!gReady) {
        inferenceRunnerInit();
    }

    const int64_t now = micros();
    if (now < gNextSampleUs) {
        return false;
    }

    float sample[kAxisCount];
    if (!imuRead(sample)) {
        return false;
    }

    const size_t offset = gSampleIx * kAxisCount;
    for (int i = 0; i < kAxisCount; i++) {
        gBuffer[offset + i] = sample[i];
    }

    gSampleIx++;
    gNextSampleUs = now + (int64_t)kSamplePeriodUs;

    if (gSampleIx < kSampleCount) {
        return false;
    }

    gSampleIx = 0;
    gNextSampleUs = micros();

    signal_t signal;
    int err = numpy::signal_from_buffer(gBuffer, EI_CLASSIFIER_DSP_INPUT_FRAME_SIZE, &signal);
    if (err != 0) {
        return false;
    }

    *result = {};
    const unsigned long t0 = millis();
    err = run_classifier(&signal, result, kDebugNn);
    *inferenceMs = (int)(millis() - t0);

    if (err != EI_IMPULSE_OK) {
        return false;
    }

    motionGateApply(gBuffer, kSampleCount, kAxisCount, result);
    return true;
}
