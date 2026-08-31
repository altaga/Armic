# Bricks catalog (as of `arduino-app-cli` 0.13.0 on UNO Q)

This is a snapshot for offline reference. **Always refresh with
`arduino-app-cli brick list` before recommending a brick** — installs change
between CLI versions.

## Vision (camera input)

| Brick ID | What it does |
|---|---|
| `arduino:image_classification` | Classify a single image (file or snapshot). |
| `arduino:object_detection` | Detect + label objects in a single image. |
| `arduino:video_object_detection` | Live USB-camera object detection, event callbacks. |
| `arduino:video_image_classification` | Live USB-camera image classification, event callbacks. |
| `arduino:motion_detection` | Detect motion in a video stream. |
| `arduino:visual_anomaly_detection` | Spot visual defects / anomalies. |
| `arduino:camera_code_detection` | Read QR codes and barcodes. |
| `arduino:mood_detector` | Estimate mood from facial cues. |

## Audio

| Brick ID | What it does |
|---|---|
| `arduino:audio_classification` | Classify recorded audio (e.g. glass breaking). |
| `arduino:keyword_spotting` | On-device wake-word detection ("Hey Arduino"). |
| `arduino:vibration_anomaly_detection` | Flag anomalous vibration patterns. |

## Language

| Brick ID | What it does |
|---|---|
| `arduino:llm` | Local LLM chat with streaming + tool calling. |
| `arduino:cloud_llm` | Cloud LLM chat (OpenAI-compatible providers). |
| `arduino:cloud_asr` | Cloud speech-to-text, microphone or file. |
| `arduino:mcp_client` | Connect to an MCP server (Model Context Protocol). |

## UI / I/O

| Brick ID | What it does |
|---|---|
| `arduino:web_ui` | Serves `assets/` on port 7000 + REST + WebSocket. |
| `arduino:streamlit_ui` | Streamlit dashboard served from the board. |
| `arduino:telegram_bot` | Full Telegram bot client with handlers. |

## Data / storage

| Brick ID | What it does |
|---|---|
| `arduino:dbstorage_sqlstore` | SQLite-style key/value store. |
| `arduino:dbstorage_tsstore` | Time-series store for sensor logs. |

## Sound / signal generation

| Brick ID | What it does |
|---|---|
| `arduino:sound_generator` | Play notes, chords, sequences, WAV files. |
| `arduino:wave_generator` | Sine / square / saw / sweep tone synthesis. |

## Cloud / external services

| Brick ID | What it does |
|---|---|
| `arduino:arduino_cloud` | Bind sketches to Arduino Cloud variables. |
| `arduino:weather_forecast` | Weather by city or coords. |
| `arduino:air_quality_monitoring` | Air quality index by city. |

## Quick-path cheat sheet

```text
I have a USB camera and want to detect objects    → arduino:video_object_detection
I want a chat assistant                          → arduino:llm  (local)  or  arduino:cloud_llm
I want to send a Telegram alert when X happens    → arduino:telegram_bot
I want a browser dashboard                       → arduino:web_ui
I want a Streamlit dashboard                     → arduino:streamlit_ui
I want to log sensor readings over time           → arduino:dbstorage_tsstore
I want to play a melody                           → arduino:sound_generator
I want to react to "Hey Arduino"                  → arduino:keyword_spotting
```

If a goal doesn't map to any of these, that's a hint to write a custom
app-local component (see `arduino-scaffold` → "Custom app-local components")
rather than wait for a new official Brick.
