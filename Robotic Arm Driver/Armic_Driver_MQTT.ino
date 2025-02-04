// MQTT Definitions
#define ESP_getChipId() ((uint32_t)ESP.getEfuseMac())
#define DEVICE_NAME "ESPDev001"

// Control Definitions
#define Claw 25
#define Wrist 26
#define Elbow 27
#define Shoulder 14
#define Base 13
#define vcc 32
#define vee 33

// Libraries
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

// Constants

const char* ssid = "YOUR_SSID";
const char* password = "YOUR_PASSWORD";
const char* mqtt_server = "YOUR_MQTT_SERVER";
const char* mqtt_user = "YOUR_MQTT_USER";
const char* mqtt_password = "YOUR_MQTT_PASS";

// Variables
unsigned long event = millis();
bool flag = true;
bool finish = false;

// Classes
WiFiClient espClient;
PubSubClient client(espClient);
JsonDocument doc;

void callback(char* topic, byte* payload, unsigned int length);
char* string2char(String command);
String byte2string(byte* c, unsigned int len);

void setup() {
  Serial.begin(115200);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  client.setServer(mqtt_server, 1883);
  client.setCallback(callback);
  controlSetup();
}

void loop() {
  // MQTT
  if (!client.connected()) {
    reconnect();
  }
  client.loop();
  if (millis() - event > 1000) {
    event = millis();
    String message = String(finish);
    bool check = client.publish("esp32arm/output", string2char(message));
    if (check) {
      finish = false;
    }
  }
}

//  MQTT Functions

void reconnect() {
  while (!client.connected()) {
    if (client.connect(DEVICE_NAME, mqtt_user, mqtt_password)) {
      client.subscribe("esp32arm/input");
    } else {
      delay(5000);
    }
  }
}

void callback(char* topic, byte* payload, unsigned int length) {
  if (flag) {
    flag = false;  // Avoid re-etrance
    String myPayload = byte2string(payload, length);
    DeserializationError error = deserializeJson(doc, string2char(myPayload));
    const char* result = doc["action"];
    finish = true;
    if (strcmp(result, "efe")) {
      FmoveP();
      Fmove();
      Fmove();
      Fmove();
      FmoveR();
    } else if (strcmp(result, "al")) {
      SmoveP();
      Smove();
      Smove();
      Smove();
      SmoveR();
    } else if (strcmp(result, "ef")) {
      TmoveP();
      Tmove();
      Tmove();
      Tmove();
      TmoveR();
    } else {
      finish = false;
    }
    flag = true;
  }
}

char* string2char(String command) {
  if (command.length() != 0) {
    char* p = const_cast<char*>(command.c_str());
    return p;
  }
}

String byte2string(byte* c, unsigned int len) {
  String r;
  for (int i = 0; i < len; i++) {
    r += String((char)c[i]);
  }
  return r;
}

// Arm Control

void controlSetup() {
  pinMode(vcc, OUTPUT);
  pinMode(vee, OUTPUT);
  pinMode(Claw, OUTPUT);
  pinMode(Wrist, OUTPUT);
  pinMode(Elbow, OUTPUT);
  pinMode(Shoulder, OUTPUT);
  pinMode(Base, OUTPUT);
  digitalWrite(vee, HIGH);
  digitalWrite(vcc, HIGH);
  digitalWrite(Claw, HIGH);
  digitalWrite(Wrist, HIGH);
  digitalWrite(Elbow, HIGH);
  digitalWrite(Shoulder, HIGH);
  digitalWrite(Base, HIGH);
  delay(1000);
}

void VccMove(int pin, int tm) {
  digitalWrite(vee, HIGH);
  delay(50);
  digitalWrite(Claw, HIGH);
  digitalWrite(Wrist, HIGH);
  digitalWrite(Elbow, HIGH);
  digitalWrite(Shoulder, HIGH);
  digitalWrite(Base, HIGH);
  delay(50);
  digitalWrite(pin, LOW);
  digitalWrite(vcc, LOW);
  delay(tm);
  digitalWrite(vcc, HIGH);
  digitalWrite(pin, HIGH);
  delay(50);
}

void VeeMove(int pin, int tm) {
  digitalWrite(vcc, HIGH);
  delay(50);
  digitalWrite(Claw, LOW);
  digitalWrite(Wrist, LOW);
  digitalWrite(Elbow, LOW);
  digitalWrite(Shoulder, LOW);
  digitalWrite(Base, LOW);
  delay(50);
  digitalWrite(pin, HIGH);
  digitalWrite(vee, LOW);
  delay(tm);
  digitalWrite(vee, HIGH);
  delay(50);
  digitalWrite(Claw, HIGH);
  digitalWrite(Wrist, HIGH);
  digitalWrite(Elbow, HIGH);
  digitalWrite(Shoulder, HIGH);
  digitalWrite(Base, HIGH);
  delay(50);
}

void FmoveP(void) {
  VeeMove(Shoulder, 5000);
  VeeMove(Elbow, 5500);
}
void Fmove(void) {
  VccMove(Wrist, 3500);
  VeeMove(Wrist, 3500);
}
void FmoveR(void) {
  VccMove(Shoulder, 5500);
  VccMove(Elbow, 5500);
}

void SmoveP(void) {
  VccMove(Base, 6000);
  VeeMove(Shoulder, 5200);
  VeeMove(Elbow, 5200);
}
void Smove(void) {
  VccMove(Elbow, 5800);
  VeeMove(Elbow, 5200);
}
void SmoveR(void) {
  VccMove(Elbow, 6000);
  VccMove(Shoulder, 5200);
  VeeMove(Base, 6000);
}

void TmoveP(void) {
  VccMove(Base, 6300);
  VeeMove(Shoulder, 5000);
  VccMove(Elbow, 3000);
  VccMove(Wrist, 3500);
}
void Tmove(void) {
  VccMove(Elbow, 4000);
  VeeMove(Elbow, 4000);
}
void TmoveR(void) {
  VeeMove(Elbow, 3500);
  VeeMove(Wrist, 3500);
  VccMove(Shoulder, 5700);
  VeeMove(Base, 6300);
}