#include "motion_gate.h"

#include "config.h"
#include "model-parameters/model_metadata.h"

#include <Arduino.h>
#include <math.h>
#include <string.h>

static float gyroDeadzone(float degPerSec) {
    const float a = fabsf(degPerSec);
    return (a <= MOTION_GYRO_DEADZONE) ? 0.0f : a;
}

static float axisStdDev(const float *buffer, size_t sampleCount, int axisIndex, int axesPerSample) {
    float sum = 0.0f;
    float sumSq = 0.0f;
    for (size_t s = 0; s < sampleCount; s++) {
        const float v = buffer[s * axesPerSample + axisIndex];
        sum += v;
        sumSq += v * v;
    }
    const float mean = sum / (float)sampleCount;
    float variance = (sumSq / (float)sampleCount) - (mean * mean);
    if (variance < 0.0f) {
        variance = 0.0f;
    }
    return sqrtf(variance);
}

static float accelMagnitudeStdDev(const float *buffer, size_t sampleCount, int axesPerSample) {
    float sum = 0.0f;
    float sumSq = 0.0f;
    for (size_t s = 0; s < sampleCount; s++) {
        const float ax = buffer[s * axesPerSample + 0];
        const float ay = buffer[s * axesPerSample + 1];
        const float az = buffer[s * axesPerSample + 2];
        const float mag = sqrtf(ax * ax + ay * ay + az * az);
        sum += mag;
        sumSq += mag * mag;
    }
    const float mean = sum / (float)sampleCount;
    float variance = (sumSq / (float)sampleCount) - (mean * mean);
    if (variance < 0.0f) {
        variance = 0.0f;
    }
    return sqrtf(variance);
}

static float gyroRms(const float *buffer, size_t sampleCount, int axesPerSample) {
    float sumSq = 0.0f;
    for (size_t s = 0; s < sampleCount; s++) {
        for (int a = 3; a < 6; a++) {
            const float g = gyroDeadzone(buffer[s * axesPerSample + a]);
            sumSq += g * g;
        }
    }
    return sqrtf(sumSq / (float)(sampleCount * 3));
}

static float gyroAbsMean(const float *buffer, size_t sampleCount, int axesPerSample) {
    float sum = 0.0f;
    for (size_t s = 0; s < sampleCount; s++) {
        for (int a = 3; a < 6; a++) {
            sum += gyroDeadzone(buffer[s * axesPerSample + a]);
        }
    }
    return sum / (float)(sampleCount * 3);
}

static float gyroPercentile95(const float *buffer, size_t sampleCount, int axesPerSample) {
    float absVals[300];
    size_t count = 0;
    for (size_t s = 0; s < sampleCount && count < sizeof(absVals) / sizeof(absVals[0]); s++) {
        for (int a = 3; a < 6; a++) {
            absVals[count++] = gyroDeadzone(buffer[s * axesPerSample + a]);
        }
    }
    if (count == 0) {
        return 0.0f;
    }
    for (size_t i = 1; i < count; i++) {
        const float key = absVals[i];
        size_t j = i;
        while (j > 0 && absVals[j - 1] > key) {
            absVals[j] = absVals[j - 1];
            j--;
        }
        absVals[j] = key;
    }
    const size_t idx = (size_t)((float)(count - 1) * 0.95f + 0.5f);
    return absVals[idx];
}

static float baselineConfidence(const ei_impulse_result_t *result) {
    for (size_t i = 0; i < EI_CLASSIFIER_LABEL_COUNT; i++) {
        if (strcasecmp(result->classification[i].label, "Baseline") == 0) {
            return result->classification[i].value;
        }
    }
    return 0.0f;
}

static float maxExerciseConfidence(const ei_impulse_result_t *result) {
    float maxVal = 0.0f;
    for (size_t i = 0; i < EI_CLASSIFIER_LABEL_COUNT; i++) {
        if (strcasecmp(result->classification[i].label, "Baseline") == 0) {
            continue;
        }
        if (result->classification[i].value > maxVal) {
            maxVal = result->classification[i].value;
        }
    }
    return maxVal;
}

static void forceBaseline(ei_impulse_result_t *result) {
    for (size_t i = 0; i < EI_CLASSIFIER_LABEL_COUNT; i++) {
        const bool isBaseline = strcasecmp(result->classification[i].label, "Baseline") == 0;
        result->classification[i].value = isBaseline ? 1.0f : 0.0f;
    }
}

static size_t topClassIndex(const ei_impulse_result_t *result) {
    size_t top = 0;
    float topVal = result->classification[0].value;
    for (size_t i = 1; i < EI_CLASSIFIER_LABEL_COUNT; i++) {
        if (result->classification[i].value > topVal) {
            topVal = result->classification[i].value;
            top = i;
        }
    }
    return top;
}

static bool isHardIdle(float gRms, float gMean, float gP95, float accStdMax, float accMagStd) {
    if (gRms < MOTION_GYRO_RMS_IDLE) {
        return true;
    }
    return gRms < MOTION_GYRO_RMS_MAX
        && gMean < MOTION_GYRO_MEAN_MAX
        && gP95 < MOTION_GYRO_P95_MAX
        && accStdMax < MOTION_ACCEL_STD_MAX
        && accMagStd < MOTION_ACCEL_MAG_STD_MAX;
}

static bool isSoftIdle(float gRms, float accStdMax, float maxExConf) {
    return gRms < MOTION_GYRO_RMS_SOFT
        && accStdMax < MOTION_ACCEL_STD_MAX
        && maxExConf < MOTION_IDLE_EXERCISE_CONF_MAX;
}

static bool isWideIdle(float gRms, float accStdMax, float maxExConf, float baselineConf) {
    if (gRms >= MOTION_GYRO_RMS_WIDE || accStdMax >= MOTION_ACCEL_STD_MAX) {
        return false;
    }
    if (maxExConf < MOTION_IDLE_EXERCISE_CONF_WIDE) {
        return true;
    }
    return baselineConf >= MOTION_BASELINE_CONF_MIN && maxExConf < 0.90f;
}

bool motionGateApply(const float *buffer, size_t sampleCount, int axesPerSample,
                     ei_impulse_result_t *result) {
#if !MOTION_GATE_ENABLED
    (void)buffer;
    (void)sampleCount;
    (void)axesPerSample;
    (void)result;
    return false;
#else
    const float gRms = gyroRms(buffer, sampleCount, axesPerSample);
    const float gMean = gyroAbsMean(buffer, sampleCount, axesPerSample);
    const float gP95 = gyroPercentile95(buffer, sampleCount, axesPerSample);
    const float accStdX = axisStdDev(buffer, sampleCount, 0, axesPerSample);
    const float accStdY = axisStdDev(buffer, sampleCount, 1, axesPerSample);
    const float accStdZ = axisStdDev(buffer, sampleCount, 2, axesPerSample);
    const float accStdMax = fmaxf(accStdX, fmaxf(accStdY, accStdZ));
    const float accMagStd = accelMagnitudeStdDev(buffer, sampleCount, axesPerSample);
    const float maxExConf = maxExerciseConfidence(result);
    const float baselineConf = baselineConfidence(result);

    const bool idle = isHardIdle(gRms, gMean, gP95, accStdMax, accMagStd)
        || isSoftIdle(gRms, accStdMax, maxExConf)
        || isWideIdle(gRms, accStdMax, maxExConf, baselineConf);

    if (!idle) {
        return false;
    }

    const size_t topBefore = topClassIndex(result);
    const char *labelBefore = result->classification[topBefore].label;
    const bool wasExercise = strcasecmp(labelBefore, "Baseline") != 0;

    forceBaseline(result);

    if (wasExercise) {
        Serial.printf("motion gate -> Baseline (rms=%.2f mean=%.2f p95=%.2f acc=%.2f base=%.2f ex=%.2f was %s)\n",
            gRms, gMean, gP95, accStdMax, baselineConf, maxExConf, labelBefore);
    }

    return true;
#endif
}
