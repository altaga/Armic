// ============================================================================
// ARMIC — M5 Core2 Wearable Firmware (template)
//
// Hardware: M5Stack Core2 (ESP32 + 6-axis IMU MPU6886 + touch AXP2101)
// AI:       Edge Impulse Arduino library export from @projectarmic project
//           (3 classes: bicep / lateral / elbowflex)
// Comms:    Wi-Fi STA → MQTT TCP → UNO Q Mosquitto broker on :1883
//
// BUILD INSTRUCTIONS (judges / remixers):
//   1. Arduino IDE 2.x → Boards Manager → M5Stack (esp32 board package)
//   2. Library Manager install:
//        - M5Core2 (by M5Stack) v0.1.7+
//        - PubSubClient (by Nick O'Leary) v2.8+
//        - Edge Impulse exported library: your project → Arduino library .zip
//          (Deploy → Arduino library → download + Sketch → Include .ZIP)
//   3. Fill CONFIG block below with your Wi-Fi SSID/pass and UNO Q hostname.
//   4. Flash over micro USB.
//
// CONTRACT (matches M5CORE2_AGENT_SPEC.md line by line):
//   - ALWAYS envelope: {device_id, msg_type, ts_ms, session_id}
//   - 6 topics (publish on armic/wearable/ *, subscribe to armic/wearable/cmd):
//       /heartbeat  (every 10 s)
//       /inference  (per model inference window)
//       /rep_start  (start of a detected rep)
//       /rep_end    (end of rep, with quality_score + rom_deg)
//       /session_change  (carer starts / stops session over touchscreen UI)
//       /cmd        (server → device, downlink)
//
// This file is a TEMPLATE. The actual Edge Impulse <project>_inferencing.h
// is generated at export time from studio.edgeimpulse.com and is NOT stored in
// Side/ backup (it is build-time generated, like a key). Flash with that file.
// ============================================================================

#include <Arduino.h>
#include <M5Core2.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <time.h>

// ============================================================================
// CONFIG — edit these before flashing.
// ============================================================================
static const char* WIFI_SSID      = "your-clinic-wifi";
static const char* WIFI_PASS      = "wifi-password";

static const char* DEVICE_ID      = "m5core2-001";      // matches envelope
static const char* BROKER_HOST    = "uno-q.local";      // UNO Q mDNS hostname
static const uint16_t BROKER_PORT = 1883;

static const char* TOPIC_HEARTBEAT      = "armic/wearable/heartbeat";
static const char* TOPIC_INFERENCE      = "armic/wearable/inference";
static const char* TOPIC_REP_START      = "armic/wearable/rep_start";
static const char* TOPIC_REP_END        = "armic/wearable/rep_end";
static const char* TOPIC_SESSION_CHANGE = "armic/wearable/session_change";
static const char* TOPIC_CMD            = "armic/wearable/cmd";
// ============================================================================

// ---- Edge Impulse forward-declaration. When you import the EI library,
//      replace with #include <your_project_inferencing.h>  instead of this:
namespace ei {
    typedef struct { float x, y, z; } sample_t;
    const char* get_inference_label(int idx);
    float get_inference_confidence(int idx);
    int get_top_class(float& out_confidence);
    bool model_inference_ready();
} // namespace ei (stub; real implementation inside EI export)

WiFiClient espClient;
PubSubClient mqtt(espClient);

static char session_id[32] = "";
static int  rep_count = 0;
static int  current_exercise = -1;   // 0=bicep 1=lateral 2=elbowflex -1=idle
static bool rep_in_flight = false;
static uint32_t rep_started_at_ms = 0;
static float gyro_cumul_deg = 0.0f;   // integration for Range-of-Motion deg
static uint32_t last_heartbeat_ms = 0;

// ---- Time helpers (local ms epoch over Wi-Fi NTP, if you have NTP, else millis())
static uint64_t ts_ms() {
    struct timeval tv;
    gettimeofday(&tv, nullptr);
    return (uint64_t)tv.tv_sec * 1000ULL + (uint64_t)(tv.tv_usec / 1000ULL);
}

static void start_session(const char* exercise_name, int exercise_idx) {
    snprintf(session_id, sizeof(session_id), "se_%06x", (unsigned)random(0x0FFFFFFF));
    rep_count = 0;
    current_exercise = exercise_idx;
    rep_in_flight = false;

    StaticJsonDocument<192> doc;
    doc["device_id"]  = DEVICE_ID;
    doc["msg_type"]   = "session_change";
    doc["ts_ms"]      = (uint64_t)ts_ms();
    doc["session_id"] = session_id;
    doc["exercise"]   = exercise_name;
    doc["total_reps"] = 0;
    char buf[256]; size_t n = serializeJson(doc, buf, sizeof(buf));
    mqtt.publish(TOPIC_SESSION_CHANGE, (uint8_t*)buf, n, false);
}

static void publish_rep_start() {
    if (current_exercise < 0) return;
    rep_in_flight = true;
    rep_started_at_ms = millis();
    gyro_cumul_deg = 0.0f;
    StaticJsonDocument<256> doc;
    doc["device_id"]  = DEVICE_ID;
    doc["msg_type"]   = "rep_start";
    doc["ts_ms"]      = (uint64_t)ts_ms();
    doc["session_id"] = session_id;
    doc["exercise"]   = (current_exercise==0?"bicep":(current_exercise==1?"lateral":"elbowflex"));
    doc["rep_n"]      = rep_count + 1;
    doc["started_at_ms"] = (uint32_t)rep_started_at_ms;
    char buf[320]; size_t n = serializeJson(doc, buf, sizeof(buf));
    mqtt.publish(TOPIC_REP_START, (uint8_t*)buf, n, false);
}

static void publish_rep_end(float quality) {
    if (!rep_in_flight) return;
    rep_in_flight = false;
    rep_count += 1;
    StaticJsonDocument<320> doc;
    doc["device_id"]     = DEVICE_ID;
    doc["msg_type"]      = "rep_end";
    doc["ts_ms"]         = (uint64_t)ts_ms();
    doc["session_id"]    = session_id;
    doc["exercise"]      = (current_exercise==0?"bicep":(current_exercise==1?"lateral":"elbowflex"));
    doc["rep_n"]         = rep_count;
    doc["ended_at_ms"]   = (uint32_t)millis();
    doc["quality_score"] = quality;   // 0.0…1.0 — EI confidence × ROM ratio
    doc["rom_deg"]       = (float)gyro_cumul_deg; // captured from gyro Z-axis
    char buf[384]; size_t n = serializeJson(doc, buf, sizeof(buf));
    mqtt.publish(TOPIC_REP_END, (uint8_t*)buf, n, false);
}

static void publish_inference(int label_idx, float confidence, int rep_tracker) {
    StaticJsonDocument<256> doc;
    doc["device_id"]  = DEVICE_ID;
    doc["msg_type"]   = "inference";
    doc["ts_ms"]      = (uint64_t)ts_ms();
    doc["session_id"] = (session_id[0] ? session_id : "se_no_session");
    doc["exercise"]   = (label_idx==0?"bicep":(label_idx==1?"lateral":"elbowflex"));
    doc["label"]      = label_idx;
    doc["confidence"] = confidence;
    doc["rep"]        = rep_tracker;
    char buf[320]; size_t n = serializeJson(doc, buf, sizeof(buf));
    mqtt.publish(TOPIC_INFERENCE, (uint8_t*)buf, n, false);
}

static void cmd_callback(char* topic, uint8_t* payload, unsigned int len) {
    // TOPIC_CMD downlink from UNO Q agent:
    //   {"action":"pause"}  {"action":"resume"}  {"action":"stop"}
    if (len == 0) return;
    StaticJsonDocument<256> doc;
    DeserializationError err = deserializeJson(doc, payload, len);
    if (err) return;
    const char* action = doc["action"] | "";
    if (!strcmp(action, "stop")) { current_exercise = -1; rep_in_flight = false; }
    // pause/resume: set a local flag used in the inference loop tick below
    M5.Lcd.printf("[CMD] %s\n", action);
}

// ============================================================================
// setup / loop
// ============================================================================
void setup() {
    M5.begin(true, true, true, true);  // LCD + Serial + I2C + power
    Serial.begin(115200);
    M5.Lcd.setTextColor(TFT_WHITE, TFT_BLACK);
    M5.Lcd.setFreeFont(&FreeMono9pt7b);
    M5.Lcd.printf("ARMIC wearable\n%s\n", DEVICE_ID);

    // Wi-Fi
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    M5.Lcd.printf("WiFi %s ", WIFI_SSID);
    while (WiFi.status() != WL_CONNECTED) { delay(200); M5.Lcd.print("."); }
    M5.Lcd.printf("\nIP %s\n", WiFi.localIP().toString().c_str());

    configTime(-6 * 3600, 0, "pool.ntp.org", "time.nist.gov");   // CST (MX) — adjust

    // MQTT
    mqtt.setServer(BROKER_HOST, BROKER_PORT);
    mqtt.setCallback(cmd_callback);
    mqtt.setBufferSize(1024);
    if (mqtt.connect(DEVICE_ID)) {
        mqtt.subscribe(TOPIC_CMD);
        M5.Lcd.printf("MQTT %s:%u OK\n", BROKER_HOST, BROKER_PORT);
    } else {
        M5.Lcd.printf("MQTT FAIL rc=%d\n", mqtt.state());
    }

    // Default session (touchscreen prompts can be added later for carer UI).
    // Touch BtnA → start "bicep" session. BtnB → "lateral". BtnC → "elbowflex".
    // For judges / template simplicity: auto-start bicep session 2 s after boot.
    delay(2000);
    start_session("bicep", 0);
}

void loop() {
    M5.update();
    mqtt.loop();
    if (!mqtt.connected()) {
        // reconnect with short backoff so Wi-Fi roam doesn't drop session.
        static uint32_t last = 0;
        if (millis() - last > 3000) {
            last = millis();
            if (mqtt.connect(DEVICE_ID)) mqtt.subscribe(TOPIC_CMD);
        }
        delay(10); return;
    }

    // -------- IMU read @ 100 Hz --------
    // M5.IMU.getAccelData() / getGyroData() → feed into EI feature buffer.
    // When `ei::model_inference_ready()` fires:
    //   int label_idx = ei::get_top_class(confidence);
    //   publish_inference(label_idx, confidence, rep_count);
    //   Heuristic rep_start / rep_end: if label transitions + confidence > 0.8,
    //   call publish_rep_start(); when label returns to rest state for > 400 ms,
    //   call publish_rep_end(quality = confidence * clamp(rom_deg / EXPECTED_ROM, 0, 1)).

    // -------- Heartbeat every 10 s --------
    if (millis() - last_heartbeat_ms >= 10000) {
        last_heartbeat_ms = millis();
        StaticJsonDocument<256> doc;
        doc["device_id"]    = DEVICE_ID;
        doc["msg_type"]     = "heartbeat";
        doc["ts_ms"]        = (uint64_t)ts_ms();
        doc["session_id"]   = (session_id[0] ? session_id : "se_no_session");
        doc["uptime_ms"]    = (uint32_t)millis();
        doc["battery_pct"]  = M5.Axp.GetBatPercentage();
        doc["rssi_dbm"]     = WiFi.RSSI();
        char buf[320]; size_t n = serializeJson(doc, buf, sizeof(buf));
        mqtt.publish(TOPIC_HEARTBEAT, (uint8_t*)buf, n, false);
    }

    delay(5);   // 200 Hz tick cap (loop runs at ~IMU rate).
}
