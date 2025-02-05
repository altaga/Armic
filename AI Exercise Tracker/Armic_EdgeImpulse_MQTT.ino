#define ESP_getChipId() ((uint32_t)ESP.getEfuseMac())
#define DEVICE_NAME "ESP32Client"

#include <Armic_inferencing.h>
#include <WiFi.h>
#include <PubSubClient.h>

// Constants

const char* ssid = "YOUR_SSID";
const char* password = "YOUR_PASSWORD";
const char* mqtt_server = "YOUR_MQTT_SERVER";
const char* mqtt_user = "YOUR_MQTT_USER";
const char* mqtt_password = "YOUR_MQTT_PASS";
unsigned long event1 = millis();
unsigned long event2 = millis();

// Classes
WiFiClient espClient;
PubSubClient client(espClient);

// Memory
float features[900];
int counter = 0;

// Prototypes
int raw_feature_get_data(size_t offset, size_t length, float* out_ptr);
void print_inference_result(ei_impulse_result_t result);
void callback(char* topic, byte* payload, unsigned int length);
char* string2char(String command);

void setup() {
  Serial.begin(115200);
  //while (!Serial);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  client.setServer(mqtt_server, 1883);
  client.setCallback(callback);
}

void loop() {
  // MQTT
  if (!client.connected()) {
    reconnect();
  }
  client.loop();
  if ((millis() - event1) >= 5) {
    event1 = millis();
    features[counter++] = (float)analogRead(A2);
    features[counter++] = (float)analogRead(A3);
    features[counter++] = (float)analogRead(A4);
  }
  if ((millis() - event2) >= 100) {
    event2 = millis();
    client.publish("esp32/x", string2char(String(features[counter-3])));
    client.publish("esp32/y", string2char(String(features[counter-2])));
    client.publish("esp32/z", string2char(String(features[counter-1])));
  }
  // AI Model
  if (counter >= 900) {
    counter = 0;
    //ei_printf("Edge Impulse standalone inferencing (Arduino)\n");
    ei_impulse_result_t result = { 0 };
    signal_t features_signal;
    features_signal.total_length = sizeof(features) / sizeof(features[0]);
    features_signal.get_data = &raw_feature_get_data;
    EI_IMPULSE_ERROR res = run_classifier(&features_signal, &result, false);
    if (res != EI_IMPULSE_OK) {
      //ei_printf("ERR: Failed to run classifier (%d)\n", res);
      return;
    }
    //ei_printf("run_classifier returned: %d\r\n", res);
    float max_v = 0;
    int max_i = 0;
    for (uint16_t i = 0; i < EI_CLASSIFIER_LABEL_COUNT; i++) {
      if (result.classification[i].value > max_v) {
        max_v = result.classification[i].value;
        max_i = i;
      }
      //ei_printf("  %s: ", ei_classifier_inferencing_categories[i]);
      //ei_printf("%.5f\r\n", result.classification[i].value);
    }
    String value = "{\"" + String(ei_classifier_inferencing_categories[max_i]) + "\":" + String(max_v) + "}";
    client.publish("esp32/output", string2char(value));
  }
}

void reconnect() {
  // Loop until we're reconnected
  while (!client.connected()) {
    Serial.print("Attempting MQTT connection...");
    // Attempt to connect
    if (client.connect(DEVICE_NAME, mqtt_user, mqtt_password)) {
      Serial.println("connected");
      // Subscribe
      client.subscribe("esp32/input");
    } else {
      Serial.print("failed, rc=");
      Serial.print(client.state());
      Serial.println(" try again in 5 seconds");
      // Wait 5 seconds before retrying
      delay(5000);
    }
  }
}

void callback(char* topic, byte* payload, unsigned int length) {
  Serial.print("Message arrived [");
  Serial.print(topic);
  Serial.print("] ");
  for (int i = 0; i < length; i++) {
    Serial.print((char)payload[i]);
  }
  Serial.println();
}

int raw_feature_get_data(size_t offset, size_t length, float* out_ptr) {
  memcpy(out_ptr, features + offset, length * sizeof(float));
  return 0;
}

char* string2char(String command) {
  if (command.length() != 0) {
    char* p = const_cast<char*>(command.c_str());
    return p;
  }
}
