#pragma once

// M5 Core2 dashboard layout (320×240) — code names for UI zones.
//
//   Header            Y 0–89    logo, title, status cluster (MQTT/WiFi/BAT)
//   Exercise bar      Y 90–127  active exercise + rep badge (compact)
//   AI detectors bars Y 128–239 compact EI class score bars (flush to bottom)

constexpr int kScreenW = 320;
constexpr int kScreenH = 240;

// Header
constexpr int kHeaderY0 = 0;
constexpr int kHeaderY1 = 89;

constexpr int kHeaderStatusPanelX = 164;
constexpr int kHeaderStatusPanelY = 5;
constexpr int kHeaderStatusPanelW = 150;
constexpr int kHeaderStatusPanelH = 80;
constexpr int kHeaderStatusRowGap = 22;
constexpr int kHeaderStatusRowPad = 12;

// Exercise bar
constexpr int kExerciseBarY0 = 90;
constexpr int kExerciseBarY1 = 127;
constexpr int kExerciseBarRepBadgeX = 228;
constexpr int kExerciseBarRepBadgeY = 94;
constexpr int kExerciseBarRepBadgeW = 82;
constexpr int kExerciseBarRepBadgeH = 32;

// AI detectors bars
constexpr int kAiDetectorsY0 = 128;
constexpr int kAiDetectorsY1 = 239;
