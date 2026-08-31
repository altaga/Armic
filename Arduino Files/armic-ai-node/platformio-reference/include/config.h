#pragma once

#include <stdint.h>

// --- Device identity (unique per node) ---
#define DEVICE_ID        "REPLACE_WITH_DEVICE_NAME"
#define MQTT_CLIENT_ID   "armic-ai-node-01"
#define FIRMWARE_VERSION "1.0.0"

// --- MQTT broker (UNO Q on your LAN) ---
// mDNS hostname WITHOUT ".local" suffix, full hostname, optional static fallback IP.
#define MQTT_BROKER_MDNS      "uno-q"
#define MQTT_BROKER_HOST      "uno-q.local"
#define MQTT_BROKER_FALLBACK  "192.168.1.100"
#define MQTT_MDNS_TIMEOUT_MS  3000
#define MQTT_PORT             1883

// --- Topics (must match armic-mpu/config.py: armic/wearable/v1/#) ---
#define TOPIC_HEARTBEAT  "armic/wearable/v1/heartbeat"
#define TOPIC_INFERENCE  "armic/wearable/v1/inference"
#define TOPIC_REP_START  "armic/wearable/v1/rep_start"
#define TOPIC_REP_END    "armic/wearable/v1/rep_end"
#define TOPIC_SESSION    "armic/wearable/v1/session_change"
#define TOPIC_CMD        "armic/orchestrator/v1/cmd"

// --- Timing ---
#define HEARTBEAT_INTERVAL_MS 5000
#define WIFI_TIMEOUT_MS       30000

// --- Edge Impulse window (must match your Studio project) ---
#define EI_WINDOW_MS          2000
#define EI_SAMPLE_HZ          50
#define REP_CONFIDENCE_MIN    0.55f

// --- Motion gate (idle override) ---
#define MOTION_GATE_ENABLED              1
#define MOTION_GYRO_DEADZONE             1.0f
#define MOTION_GYRO_RMS_IDLE             3.5f
#define MOTION_GYRO_RMS_MAX              11.0f
#define MOTION_GYRO_RMS_SOFT             9.0f
#define MOTION_GYRO_RMS_WIDE              13.0f
#define MOTION_GYRO_MEAN_MAX             5.5f
#define MOTION_GYRO_P95_MAX              18.0f
#define MOTION_ACCEL_STD_MAX             3.5f
#define MOTION_ACCEL_MAG_STD_MAX         2.8f
#define MOTION_IDLE_EXERCISE_CONF_MAX    0.75f
#define MOTION_IDLE_EXERCISE_CONF_WIDE   0.85f
#define MOTION_BASELINE_CONF_MIN         0.28f
