#include "display_ui.h"

#include "armic_icon.h"
#include "armic_icon_md.h"
#include "config.h"
#include "display_ui_layout.h"
#include "model-parameters/model_metadata.h"

#include <M5Core2.h>
#include <ctype.h>
#include <string.h>

namespace {

constexpr uint16_t kBg      = 0x0841;
constexpr uint16_t kPanel   = 0x18C3;
constexpr uint16_t kDivider = 0x39E7;
constexpr uint16_t kSilver  = 0xDEFB;
constexpr uint16_t kMuted   = 0x7BEF;
constexpr uint16_t kAccent  = 0x37FF;
constexpr uint16_t kRepCol  = 0xFD20;
constexpr uint16_t kOk      = 0x07E0;
constexpr uint16_t kErr     = 0xF800;

static TFT_eSprite aiDetectorsSprite(&M5.Lcd);
static TFT_eSprite exerciseBarRepSprite(&M5.Lcd);
static bool spritesReady = false;
static bool chromeReady = false;

static bool lastMqtt = false;
static int8_t lastRssi = 0;
static int lastBatteryPct = -1;
static unsigned long lastBatteryMs = 0;
static char lastExerciseBarText[32] = "";
static uint16_t lastRep = 0;
static bool lastInRep = false;
static float lastBarValues[EI_CLASSIFIER_LABEL_COUNT] = {};
static bool lastBarValuesValid = false;

static const char *exerciseLabel(ArmicExerciseId ex) {
    switch (ex) {
        case ARMIC_EX_BICEP: return "Bicep Curl";
        case ARMIC_EX_LATERAL: return "Lateral Raise";
        case ARMIC_EX_ELBOWFLEX: return "Elbow Flexion";
        default: return "Ready";
    }
}

static void exerciseBarDisplayText(const ei_impulse_result_t *result, ArmicExerciseId exercise,
                                   bool inRep, char *out, size_t outLen) {
    if (exercise != ARMIC_EX_UNKNOWN) {
        snprintf(out, outLen, "%s", exerciseLabel(exercise));
        return;
    }
    if (classificationIsBaseline(result)) {
        snprintf(out, outLen, "Idle");
        return;
    }
    snprintf(out, outLen, "Idle");
}

static uint16_t aiDetectorBarColor(float v) {
    if (v >= 0.75f) return kOk;
    if (v >= 0.50f) return kAccent;
    return 0xFFE0;
}

static const char *aiDetectorShortLabel(const char *eiLabel) {
    if (!eiLabel) return "?";
    if (strcasecmp(eiLabel, "Baseline") == 0) return "Base";
    if (strcasecmp(eiLabel, "Bicepcurl") == 0) return "Bicep";
    if (strcasecmp(eiLabel, "Elbowflexion") == 0) return "Elbow Flx";
    if (strcasecmp(eiLabel, "Lateralraise") == 0) return "Lateral";
    return eiLabel;
}

static int textWidth(const char *s, uint8_t size) {
    M5.Lcd.setTextSize(size);
    return M5.Lcd.textWidth(s);
}

static void drawEllipsisText(int x, int y, int maxW, const char *text,
                             uint16_t fg, uint16_t bg, uint8_t size) {
    char buf[40];
    strncpy(buf, text, sizeof(buf) - 1);
    buf[sizeof(buf) - 1] = '\0';

    M5.Lcd.setTextSize(size);
    M5.Lcd.setTextColor(fg, bg);
    while (strlen(buf) > 1 && textWidth(buf, size) > maxW) {
        buf[strlen(buf) - 1] = '\0';
    }
    if (textWidth(text, size) > maxW && strlen(buf) >= 4) {
        size_t n = strlen(buf);
        buf[n - 1] = '\0';
        buf[n - 2] = '.';
        buf[n - 3] = '.';
        buf[n - 4] = '.';
    }
    M5.Lcd.setCursor(x, y);
    M5.Lcd.print(buf);
}

static void headerDrawBrand() {
    M5.Lcd.pushImage(8, 16, ARMIC_ICON_MD_W, ARMIC_ICON_MD_H, ARMIC_ICON_MD);
    M5.Lcd.setTextSize(3);
    M5.Lcd.setTextColor(kSilver, kBg);
    M5.Lcd.setCursor(54, 18);
    M5.Lcd.print("ARMIC");
    M5.Lcd.setTextSize(1);
    M5.Lcd.setTextColor(kMuted, kBg);
    M5.Lcd.setCursor(54, 54);
    M5.Lcd.print("Wearable AI Node");
}

static int headerReadBatteryPct() {
    int pct = (int)(M5.Axp.GetBatteryLevel() + 0.5f);
    if (pct < 0) {
        pct = 0;
    }
    if (pct > 100) {
        pct = 100;
    }
    return pct;
}

static uint16_t headerBatteryColor(int pct) {
    if (pct <= 15) {
        return kErr;
    }
    if (pct <= 30) {
        return 0xFFE0;
    }
    return kOk;
}

static void headerDrawWifiBars(int x, int y, int8_t rssi, bool connected) {
    const int bars = !connected ? 0 : (rssi > -55 ? 4 : rssi > -67 ? 3 : rssi > -75 ? 2 : 1);
    for (int i = 0; i < 4; i++) {
        const int h = 3 + i * 3;
        const int bx = x + i * 5;
        const int by = y + (12 - h);
        const uint16_t col = (i < bars) ? kOk : kDivider;
        M5.Lcd.fillRoundRect(bx, by, 3, h, 1, col);
    }
}

static void headerDrawBatteryIcon(int x, int y, int w, int h, int pct) {
    M5.Lcd.drawRoundRect(x, y, w, h, 2, kMuted);
    M5.Lcd.fillRect(x + w, y + h / 2 - 2, 2, 4, kMuted);
    const int fillW = ((w - 4) * pct) / 100;
    if (fillW > 0) {
        M5.Lcd.fillRoundRect(x + 2, y + 2, fillW, h - 4, 1, headerBatteryColor(pct));
    }
}

static void headerDrawStatusCluster(bool mqttOk, int8_t rssi, int batteryPct) {
    const int px = kHeaderStatusPanelX;
    const int py = kHeaderStatusPanelY;
    const int valueX = px + kHeaderStatusPanelW - 8;

    M5.Lcd.fillRoundRect(px, py, kHeaderStatusPanelW, kHeaderStatusPanelH, 8, kPanel);
    M5.Lcd.drawRoundRect(px, py, kHeaderStatusPanelW, kHeaderStatusPanelH, 8, kDivider);

    const int row1 = py + kHeaderStatusRowPad;
    const int row2 = row1 + kHeaderStatusRowGap;
    const int row3 = row2 + kHeaderStatusRowGap;

    M5.Lcd.setTextSize(1);
    M5.Lcd.setTextDatum(TL_DATUM);

    // MQTT row
    M5.Lcd.fillCircle(px + 12, row1 + 4, 4, mqttOk ? kOk : kErr);
    M5.Lcd.setTextColor(kSilver, kPanel);
    M5.Lcd.setCursor(px + 24, row1);
    M5.Lcd.print("MQTT");
    M5.Lcd.setTextColor(mqttOk ? kOk : kErr, kPanel);
    M5.Lcd.setTextDatum(TR_DATUM);
    M5.Lcd.drawString(mqttOk ? "OK" : "--", valueX, row1 + 7);

    M5.Lcd.drawFastHLine(px + 10, row2 - 5, kHeaderStatusPanelW - 20, kDivider);

    // WiFi row
    headerDrawWifiBars(px + 8, row2 + 1, rssi, rssi != 0);
    M5.Lcd.setTextDatum(TL_DATUM);
    M5.Lcd.setTextColor(kSilver, kPanel);
    M5.Lcd.setCursor(px + 24, row2);
    M5.Lcd.print("WiFi");
    M5.Lcd.setTextColor(rssi != 0 ? kSilver : kErr, kPanel);
    M5.Lcd.setTextDatum(TR_DATUM);
    if (rssi != 0) {
        char rssiBuf[12];
        snprintf(rssiBuf, sizeof(rssiBuf), "%ddBm", (int)rssi);
        M5.Lcd.drawString(rssiBuf, valueX, row2 + 7);
    } else {
        M5.Lcd.drawString("---", valueX, row2 + 7);
    }

    M5.Lcd.drawFastHLine(px + 10, row3 - 5, kHeaderStatusPanelW - 20, kDivider);

    // Battery row
    headerDrawBatteryIcon(px + 10, row3 + 2, 24, 11, batteryPct);
    M5.Lcd.setTextDatum(TL_DATUM);
    M5.Lcd.setTextColor(kSilver, kPanel);
    M5.Lcd.setCursor(px + 40, row3);
    M5.Lcd.print("BAT");
    M5.Lcd.setTextColor(headerBatteryColor(batteryPct), kPanel);
    M5.Lcd.setTextDatum(TR_DATUM);
    char batBuf[8];
    snprintf(batBuf, sizeof(batBuf), "%d%%", batteryPct);
    M5.Lcd.drawString(batBuf, valueX, row3 + 7);

    M5.Lcd.setTextDatum(TL_DATUM);
}

static void headerDraw(bool mqttOk, int8_t rssi, int batteryPct) {
    M5.Lcd.fillRect(kHeaderStatusPanelX - 4, kHeaderY0, kScreenW - kHeaderStatusPanelX + 4, kHeaderY1 + 1, kBg);
    headerDrawBrand();
    headerDrawStatusCluster(mqttOk, rssi, batteryPct);
    M5.Lcd.drawFastHLine(0, kHeaderY1, kScreenW, kDivider);
}

static void exerciseBarDrawStaticBackground() {
    M5.Lcd.fillRect(0, kExerciseBarY0, kScreenW, kExerciseBarY1 - kExerciseBarY0 + 1, kPanel);
    M5.Lcd.drawFastHLine(0, kExerciseBarY1, kScreenW, kDivider);
}

static void headerDrawStatic() {
    headerDrawBrand();
    M5.Lcd.drawFastHLine(0, kHeaderY1, kScreenW, kDivider);
}

static void exerciseBarDraw(const char *exerciseText) {
    M5.Lcd.fillRect(0, kExerciseBarY0, kExerciseBarRepBadgeX - 6,
        kExerciseBarY1 - kExerciseBarY0 + 1, kPanel);
    M5.Lcd.setTextSize(1);
    M5.Lcd.setTextColor(kAccent, kPanel);
    M5.Lcd.setCursor(10, kExerciseBarY0 + 3);
    M5.Lcd.print("EXERCISE");
    const bool idle = strcmp(exerciseText, "Idle") == 0;
    drawEllipsisText(10, kExerciseBarY0 + 16, 200, exerciseText,
        idle ? kMuted : kSilver, kPanel, 2);
}

static void exerciseBarRenderRepBadge(uint16_t rep, bool inRep) {
    exerciseBarRepSprite.fillSprite(kPanel);
    exerciseBarRepSprite.drawRoundRect(0, 0, kExerciseBarRepBadgeW, kExerciseBarRepBadgeH, 5, kDivider);

    exerciseBarRepSprite.setTextSize(1);
    exerciseBarRepSprite.setTextColor(inRep ? kRepCol : kMuted, kPanel);
    exerciseBarRepSprite.setCursor(28, 2);
    exerciseBarRepSprite.print("REP");

    char repBuf[8];
    snprintf(repBuf, sizeof(repBuf), "%02u", (unsigned)rep);
    exerciseBarRepSprite.setTextSize(2);
    exerciseBarRepSprite.setTextColor(kSilver, kPanel);
    exerciseBarRepSprite.setTextDatum(MC_DATUM);
    exerciseBarRepSprite.drawString(repBuf, kExerciseBarRepBadgeW / 2, 21);
    exerciseBarRepSprite.setTextDatum(TL_DATUM);

    if (inRep) {
        exerciseBarRepSprite.fillRoundRect(4, 2, 18, 8, 3, kRepCol);
        exerciseBarRepSprite.setTextColor(kBg, kRepCol);
        exerciseBarRepSprite.setTextSize(1);
        exerciseBarRepSprite.setCursor(6, 3);
        exerciseBarRepSprite.print("ON");
    }
}

static void aiDetectorsBarsRender(const ei_impulse_result_t *result) {
    aiDetectorsSprite.fillSprite(kBg);

    constexpr int kRowH = 22;
    constexpr int kBarX = 82;
    constexpr int kBarW = 168;
    constexpr int kBarH = 9;
    constexpr int kPctX = 308;

    for (size_t i = 0; i < EI_CLASSIFIER_LABEL_COUNT; i++) {
        const int rowY = 8 + (int)i * kRowH;
        const float v = result->classification[i].value;
        const char *label = aiDetectorShortLabel(result->classification[i].label);

        aiDetectorsSprite.setTextSize(1);
        aiDetectorsSprite.setTextColor(kMuted, kBg);
        aiDetectorsSprite.setTextDatum(TR_DATUM);
        aiDetectorsSprite.drawString(label, 80, rowY + 9);
        aiDetectorsSprite.setTextDatum(TL_DATUM);

        aiDetectorsSprite.drawRoundRect(kBarX, rowY + 4, kBarW, kBarH, 3, kDivider);
        const int fillW = (int)(v * (kBarW - 2));
        if (fillW > 0) {
            aiDetectorsSprite.fillRoundRect(kBarX + 1, rowY + 5, fillW, kBarH - 2, 3, aiDetectorBarColor(v));
        }

        char pct[8];
        snprintf(pct, sizeof(pct), "%3d%%", (int)(v * 100.0f + 0.5f));
        aiDetectorsSprite.setTextColor(kSilver, kBg);
        aiDetectorsSprite.setTextDatum(TR_DATUM);
        aiDetectorsSprite.drawString(pct, kPctX, rowY + 9);
        aiDetectorsSprite.setTextDatum(TL_DATUM);
    }
}

static void ensureSprites() {
    if (spritesReady) {
        return;
    }
    aiDetectorsSprite.setColorDepth(16);
    aiDetectorsSprite.createSprite(kScreenW, kAiDetectorsY1 - kAiDetectorsY0 + 1);
    exerciseBarRepSprite.setColorDepth(16);
    exerciseBarRepSprite.createSprite(kExerciseBarRepBadgeW, kExerciseBarRepBadgeH);
    spritesReady = true;
}

static void drawStaticChrome() {
    M5.Lcd.fillScreen(kBg);
    headerDrawStatic();
    exerciseBarDrawStaticBackground();

    M5.Lcd.setTextSize(1);
    M5.Lcd.setTextColor(kMuted, kBg);
    M5.Lcd.setCursor(8, kAiDetectorsY0 + 2);
    M5.Lcd.print("CLASS SCORES");
}

static void fillRoundPanel(int x, int y, int w, int h, uint16_t fill, uint16_t border) {
    M5.Lcd.fillRoundRect(x, y, w, h, 8, fill);
    M5.Lcd.drawRoundRect(x, y, w, h, 8, border);
}

static void fillIdleResult(ei_impulse_result_t *result) {
    static const char *kLabels[] = {"Baseline", "Bicepcurl", "Elbowflexion", "Lateralraise"};
    *result = {};
    for (size_t i = 0; i < EI_CLASSIFIER_LABEL_COUNT; i++) {
        result->classification[i].label = kLabels[i];
        result->classification[i].value = (i == 0) ? 1.0f : 0.0f;
    }
}

}  // namespace

void displayInit() {
    M5.Lcd.setBrightness(200);
    M5.Lcd.fillScreen(kBg);
    chromeReady = false;
    spritesReady = false;
    lastBarValuesValid = false;
}

void displayBootScreen() {
    M5.Lcd.fillScreen(kBg);
    const int ix = (kScreenW - ARMIC_ICON_W) / 2;
    M5.Lcd.pushImage(ix, 36, ARMIC_ICON_W, ARMIC_ICON_H, ARMIC_ICON);

    M5.Lcd.setTextSize(3);
    M5.Lcd.setTextColor(kSilver, kBg);
    M5.Lcd.setCursor(72, 120);
    M5.Lcd.print("ARMIC");

    M5.Lcd.setTextSize(1);
    M5.Lcd.setTextColor(kMuted, kBg);
    M5.Lcd.setCursor(98, 152);
    M5.Lcd.print("Wearable AI Node");

    fillRoundPanel(40, 178, kScreenW - 80, 44, kPanel, kDivider);
    M5.Lcd.setTextColor(kAccent, kPanel);
    M5.Lcd.setCursor(52, 188);
    M5.Lcd.print("Starting...");
}

void displayBootProgress(const char *step, bool ok, bool active) {
    M5.Lcd.fillRect(48, 192, kScreenW - 96, 20, kPanel);
    M5.Lcd.setTextSize(1);
    M5.Lcd.setTextColor(active ? kAccent : (ok ? kOk : kErr), kPanel);
    M5.Lcd.setCursor(52, 198);
    M5.Lcd.print(active ? "> " : ok ? "+ " : "x ");
    M5.Lcd.print(step);
}

void displayDashboard(const ei_impulse_result_t *result, ArmicExerciseId exercise,
                      uint16_t rep, bool mqttOk, int8_t rssi, int inferenceMs,
                      bool inRep) {
    (void)inferenceMs;
    const unsigned long now = millis();

    if (!chromeReady) {
        drawStaticChrome();
        ensureSprites();
        chromeReady = true;
        lastMqtt = !mqttOk;
        lastRssi = rssi == 0 ? -127 : (int8_t)(rssi + 1);
        lastBatteryPct = -1;
        lastBatteryMs = 0;
        lastExerciseBarText[0] = '\0';
        lastRep = rep + 1;
        lastInRep = !inRep;
    }

    char exerciseBarText[32];
    exerciseBarDisplayText(result, exercise, inRep, exerciseBarText, sizeof(exerciseBarText));

    const int batteryPct = headerReadBatteryPct();
    const bool batteryDue = (now - lastBatteryMs) >= 5000;
    if (mqttOk != lastMqtt || rssi != lastRssi
        || batteryPct != lastBatteryPct || batteryDue) {
        headerDraw(mqttOk, rssi, batteryPct);
        lastMqtt = mqttOk;
        lastRssi = rssi;
        lastBatteryPct = batteryPct;
        lastBatteryMs = now;
    }

    if (strcmp(exerciseBarText, lastExerciseBarText) != 0 || rep != lastRep || inRep != lastInRep) {
        exerciseBarDraw(exerciseBarText);
        exerciseBarRenderRepBadge(rep, inRep);
        exerciseBarRepSprite.pushSprite(kExerciseBarRepBadgeX, kExerciseBarRepBadgeY);
        strncpy(lastExerciseBarText, exerciseBarText, sizeof(lastExerciseBarText) - 1);
        lastExerciseBarText[sizeof(lastExerciseBarText) - 1] = '\0';
        lastRep = rep;
        lastInRep = inRep;
    }

    bool barsChanged = !lastBarValuesValid;
    for (size_t i = 0; i < EI_CLASSIFIER_LABEL_COUNT && !barsChanged; i++) {
        if (result->classification[i].value != lastBarValues[i]) {
            barsChanged = true;
        }
    }
    if (barsChanged) {
        aiDetectorsBarsRender(result);
        aiDetectorsSprite.pushSprite(0, kAiDetectorsY0);
        for (size_t i = 0; i < EI_CLASSIFIER_LABEL_COUNT; i++) {
            lastBarValues[i] = result->classification[i].value;
        }
        lastBarValuesValid = true;
    }
}

void displayEnterDashboard(bool mqttOk, int8_t rssi) {
    ei_impulse_result_t idle;
    fillIdleResult(&idle);
    displayDashboard(&idle, ARMIC_EX_UNKNOWN, 0, mqttOk, rssi, 0, false);
}
