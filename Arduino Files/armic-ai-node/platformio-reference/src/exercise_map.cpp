#include "exercise_map.h"

#include "model-parameters/model_metadata.h"

#include <ctype.h>
#include <string.h>

const char *exerciseToString(ArmicExerciseId kind) {
    switch (kind) {
        case ARMIC_EX_BICEP: return "bicep";
        case ARMIC_EX_LATERAL: return "lateral";
        case ARMIC_EX_ELBOWFLEX: return "elbowflex";
        default: return "none";
    }
}

static bool streqIgnoreCase(const char *a, const char *b) {
    while (*a && *b) {
        if (tolower((unsigned char)*a) != tolower((unsigned char)*b)) {
            return false;
        }
        a++;
        b++;
    }
    return *a == *b;
}

ArmicExerciseId exerciseFromLabel(const char *label) {
    if (!label) {
        return ARMIC_EX_UNKNOWN;
    }
    if (streqIgnoreCase(label, "Bicepcurl")) {
        return ARMIC_EX_BICEP;
    }
    if (streqIgnoreCase(label, "Lateralraise")) {
        return ARMIC_EX_LATERAL;
    }
    if (streqIgnoreCase(label, "Elbowflexion")) {
        return ARMIC_EX_ELBOWFLEX;
    }
    return ARMIC_EX_UNKNOWN;
}

void labelToLower(const char *label, char *out, size_t outLen) {
    if (!label || !out || outLen == 0) {
        return;
    }
    size_t i = 0;
    for (; label[i] && i + 1 < outLen; i++) {
        out[i] = (char)tolower((unsigned char)label[i]);
    }
    out[i] = '\0';
}

bool classificationIsBaseline(const ei_impulse_result_t *result) {
    if (!result) {
        return true;
    }
    size_t top = 0;
    float topVal = result->classification[0].value;
    for (size_t i = 1; i < EI_CLASSIFIER_LABEL_COUNT; i++) {
        if (result->classification[i].value > topVal) {
            topVal = result->classification[i].value;
            top = i;
        }
    }
    return streqIgnoreCase(result->classification[top].label, "Baseline");
}
