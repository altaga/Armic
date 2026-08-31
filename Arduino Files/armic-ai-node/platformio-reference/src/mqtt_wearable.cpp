#include "mqtt_wearable.h"

#include "config.h"
#include "exercise_map.h"
#include "model-parameters/model_metadata.h"
#include "wifi_util.h"

#include <WiFi.h>
#include <ESPmDNS.h>
#include <mqtt_client.h>

static esp_mqtt_client_handle_t client = nullptr;
static volatile bool connected = false;
static char payloadBuf[768];
static char brokerUri[96];

static void onMqttEvent(void *handlerArgs, esp_event_base_t base, int32_t eventId, void *eventData) {
    (void)handlerArgs;
    (void)base;

    esp_mqtt_event_handle_t event = (esp_mqtt_event_handle_t)eventData;
    switch ((esp_mqtt_event_id_t)eventId) {
        case MQTT_EVENT_CONNECTED:
            connected = true;
            esp_mqtt_client_subscribe(client, TOPIC_CMD, 1);
            Serial.println("MQTT connected");
            break;
        case MQTT_EVENT_DISCONNECTED:
            connected = false;
            Serial.println("MQTT disconnected");
            break;
        case MQTT_EVENT_DATA:
            if (event->topic_len > 0 && event->data_len > 0) {
                mqttOnCommand(event->data, (size_t)event->data_len);
            }
            break;
        case MQTT_EVENT_ERROR:
            Serial.println("MQTT error");
            break;
        default:
            break;
    }
}

static bool resolveBrokerHost(char *hostOut, size_t hostLen) {
    if (!MDNS.begin(MQTT_CLIENT_ID)) {
        Serial.println("WARN: mDNS responder init failed (broker lookup may still work)");
    }

    // 1) Proper LAN mDNS — follows UNO Q even if DHCP IP changes.
    IPAddress ip = MDNS.queryHost(MQTT_BROKER_MDNS, MQTT_MDNS_TIMEOUT_MS);
    if (ip != INADDR_NONE && ip != IPAddress(0, 0, 0, 0)) {
        snprintf(hostOut, hostLen, "%s", ip.toString().c_str());
        Serial.printf("MQTT broker: %s.local -> %s (mDNS)\n", MQTT_BROKER_MDNS, hostOut);
        return true;
    }
    Serial.printf("mDNS: %s.local not found in %ums\n", MQTT_BROKER_MDNS, MQTT_MDNS_TIMEOUT_MS);

    // 2) Standard DNS (works if your router resolves the broker hostname).
    if (WiFi.hostByName(MQTT_BROKER_HOST, ip) && ip != INADDR_NONE) {
        snprintf(hostOut, hostLen, "%s", ip.toString().c_str());
        Serial.printf("MQTT broker: %s -> %s (DNS)\n", MQTT_BROKER_HOST, hostOut);
        return true;
    }

    // 3) Hardcoded fallback from spec.
    Serial.printf("MQTT broker: using fallback IP %s\n", MQTT_BROKER_FALLBACK);
    snprintf(hostOut, hostLen, "%s", MQTT_BROKER_FALLBACK);
    return true;
}

bool mqttWearableBegin() {
    char host[40];
    if (!resolveBrokerHost(host, sizeof(host))) {
        return false;
    }

    snprintf(brokerUri, sizeof(brokerUri), "mqtt://%s:%u", host, MQTT_PORT);
    Serial.printf("MQTT broker URI: %s\n", brokerUri);

    esp_mqtt_client_config_t cfg = {};
#if ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(5, 0, 0)
    cfg.broker.address.uri = brokerUri;
    cfg.credentials.client_id = MQTT_CLIENT_ID;
    cfg.session.keepalive = 30;
    cfg.buffer.size = sizeof(payloadBuf);
#else
    cfg.uri = brokerUri;
    cfg.client_id = MQTT_CLIENT_ID;
    cfg.keepalive = 30;
    cfg.buffer_size = sizeof(payloadBuf);
#endif

    client = esp_mqtt_client_init(&cfg);
    if (!client) {
        return false;
    }
    esp_mqtt_client_register_event(client, MQTT_EVENT_ANY, onMqttEvent, nullptr);
    return esp_mqtt_client_start(client) == ESP_OK;
}

bool mqttWearableConnected() {
    return connected;
}

void mqttWearableLoop() {
    // ESP-IDF MQTT client runs its own task; nothing required here.
}

static int publishJson(const char *topic, int qos, const char *json, int len) {
    if (!connected || !client) {
        return -1;
    }
    return esp_mqtt_client_publish(client, topic, json, len, qos, 0);
}

void mqttPublishHeartbeat(bool eiReady, int8_t rssi) {
    const int len = snprintf(payloadBuf, sizeof(payloadBuf),
        "{\"schema\":1,\"msg_type\":\"heartbeat\",\"device_id\":\"%s\","
        "\"ts_ms\":%llu,\"ei_ready\":%s,\"wifi_rssi\":%d,\"firmware\":\"%s\"}",
        DEVICE_ID,
        (unsigned long long)timestampMs(),
        eiReady ? "true" : "false",
        (int)rssi,
        FIRMWARE_VERSION);
    if (len > 0 && (size_t)len < sizeof(payloadBuf)) {
        publishJson(TOPIC_HEARTBEAT, 0, payloadBuf, len);
    }
}

static void appendProbabilities(const ei_impulse_result_t *result, char *buf, size_t bufLen, int *offset) {
    for (size_t i = 0; i < EI_CLASSIFIER_LABEL_COUNT; i++) {
        char key[32];
        labelToLower(result->classification[i].label, key, sizeof(key));
        const int n = snprintf(buf + *offset, bufLen - (size_t)*offset,
            "%s\"%s\":%.4f",
            i == 0 ? "" : ",",
            key,
            result->classification[i].value);
        if (n <= 0 || (size_t)n >= bufLen - (size_t)*offset) {
            return;
        }
        *offset += n;
    }
}

void mqttPublishInference(const ei_impulse_result_t *result, ArmicExerciseId exercise,
                          uint16_t rep, int inferenceMs, bool inRep) {
    size_t top = 0;
    float topVal = result->classification[0].value;
    for (size_t i = 1; i < EI_CLASSIFIER_LABEL_COUNT; i++) {
        if (result->classification[i].value > topVal) {
            topVal = result->classification[i].value;
            top = i;
        }
    }

    char labelLower[32];
    labelToLower(result->classification[top].label, labelLower, sizeof(labelLower));

    ArmicExerciseId mqttExercise = exercise;
    uint16_t mqttRep = rep;
    if (inRep && exercise != ARMIC_EX_UNKNOWN) {
        mqttExercise = exercise;
    } else if (exercise != ARMIC_EX_UNKNOWN) {
        // Active session between reps — keep session exercise + completed count.
        mqttExercise = exercise;
        mqttRep = rep;
    } else {
        mqttExercise = exerciseFromLabel(result->classification[top].label);
        if (mqttExercise == ARMIC_EX_UNKNOWN) {
            mqttRep = 0;
        }
    }

    char probs[256] = "{";
    int probsLen = 1;
    appendProbabilities(result, probs, sizeof(probs), &probsLen);
    if (probsLen < (int)sizeof(probs) - 1) {
        probs[probsLen++] = '}';
        probs[probsLen] = '\0';
    }

    const int len = snprintf(payloadBuf, sizeof(payloadBuf),
        "{\"schema\":1,\"msg_type\":\"inference\",\"device_id\":\"%s\","
        "\"ts_ms\":%llu,\"exercise\":\"%s\",\"rep\":%u,\"label\":\"%s\","
        "\"confidence\":%.4f,\"probabilities\":%s,"
        "\"window_ms\":%d,\"sample_hz\":%d,\"inference_ms\":%d}",
        DEVICE_ID,
        (unsigned long long)timestampMs(),
        exerciseToString(mqttExercise),
        (unsigned)mqttRep,
        labelLower,
        topVal,
        probs,
        EI_WINDOW_MS,
        EI_SAMPLE_HZ,
        inferenceMs);

    if (len > 0 && (size_t)len < sizeof(payloadBuf)) {
        const int msgId = publishJson(TOPIC_INFERENCE, 1, payloadBuf, len);
        if (msgId >= 0) {
            Serial.printf("MQTT inference -> %s (rep=%u label=%s %.2f)\n",
                exerciseToString(mqttExercise), (unsigned)mqttRep, labelLower, topVal);
        }
    }
}

void mqttPublishRepStart(ArmicExerciseId exercise, uint16_t rep) {
    const int len = snprintf(payloadBuf, sizeof(payloadBuf),
        "{\"schema\":1,\"msg_type\":\"rep_start\",\"device_id\":\"%s\","
        "\"ts_ms\":%llu,\"exercise\":\"%s\",\"rep\":%u}",
        DEVICE_ID,
        (unsigned long long)timestampMs(),
        exerciseToString(exercise),
        (unsigned)rep);
    if (len > 0 && (size_t)len < sizeof(payloadBuf)) {
        publishJson(TOPIC_REP_START, 1, payloadBuf, len);
    }
}

void mqttPublishRepEnd(ArmicExerciseId exercise, uint16_t rep) {
    const int len = snprintf(payloadBuf, sizeof(payloadBuf),
        "{\"schema\":1,\"msg_type\":\"rep_end\",\"device_id\":\"%s\","
        "\"ts_ms\":%llu,\"exercise\":\"%s\",\"rep\":%u}",
        DEVICE_ID,
        (unsigned long long)timestampMs(),
        exerciseToString(exercise),
        (unsigned)rep);
    if (len > 0 && (size_t)len < sizeof(payloadBuf)) {
        publishJson(TOPIC_REP_END, 1, payloadBuf, len);
        Serial.printf("MQTT rep_end -> %s rep=%u\n", exerciseToString(exercise), (unsigned)rep);
    }
}

void mqttPublishSessionChange(ArmicExerciseId exercise) {
    const int len = snprintf(payloadBuf, sizeof(payloadBuf),
        "{\"schema\":1,\"msg_type\":\"session_change\",\"device_id\":\"%s\","
        "\"ts_ms\":%llu,\"exercise\":\"%s\",\"rep\":0}",
        DEVICE_ID,
        (unsigned long long)timestampMs(),
        exerciseToString(exercise));
    if (len > 0 && (size_t)len < sizeof(payloadBuf)) {
        publishJson(TOPIC_SESSION, 1, payloadBuf, len);
        Serial.printf("MQTT session_change -> %s rep=0\n", exerciseToString(exercise));
    }
}

void mqttOnCommand(const char *payload, size_t len) {
    Serial.printf("Orchestrator cmd (%u bytes): %.*s\n", (unsigned)len, (int)len, payload);
}
