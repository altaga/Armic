---
name: arduino-catalog
description: >-
  Discover installed Arduino Bricks and bundled examples; map a goal to the
  closest example to copy. Use before scaffolding a new app on UNO Q.
version: 1.1.0
---

# arduino-catalog — discover Bricks and examples

Use this when the user has a goal in mind and wants to find an existing Brick
or reference app instead of writing everything from scratch. Output is a
**shortlist** (1–3 candidates), not the whole catalog — the catalog itself is
in `references/bricks-catalog.md`.

## Step 1 — refresh the catalog

Always run live. Don't rely on values cached in this skill.

```bash
arduino-app-cli brick list
arduino-app-cli brick list --format json   # if you need to parse it
```

## Step 2 — match goal → brick

Translate the user's goal into 1–3 candidate brick IDs. The full per-board list
is in `references/bricks-catalog.md`. Common mappings:

| User goal | Brick IDs to consider |
|---|---|
| Detect faces / objects from a USB camera | `arduino:video_object_detection`, `arduino:video_image_classification`, `arduino:object_detection` |
| Recognize a sound / wake-word | `arduino:audio_classification`, `arduino:keyword_spotting` |
| Read a sensor, log to disk | `arduino:dbstorage_sqlstore`, `arduino:dbstorage_tsstore` |
| Talk to an LLM (local or cloud) | `arduino:llm`, `arduino:cloud_llm`, `arduino:mcp_client` |
| Push to a chat / messaging app | `arduino:telegram_bot` |
| Serve a dashboard / camera stream in a browser | `arduino:web_ui`, `arduino:streamlit_ui` |
| Read weather / air quality | `arduino:weather_forecast`, `arduino:air_quality_monitoring` |
| Generate sound / music | `arduino:sound_generator`, `arduino:wave_generator` |
| Detect vibration anomalies | `arduino:vibration_anomaly_detection` |
| QR / barcode scan | `arduino:camera_code_detection` |

Some bricks are **board-specific**. The board's own `brick list` is authoritative
— trust it over anything in this skill.

## Step 3 — fetch the brick's API

Each installed Brick has a README at:

```
/var/lib/arduino-app-cli/assets/<pkg-version>/docs/arduino/<brick-name>/README.md
```

The `<brick-name>` is the bare ID with underscores, **no** `arduino:` prefix.
The `<pkg-version>` is whichever folder currently exists under `assets/` — use
a glob:

```bash
ls /var/lib/arduino-app-cli/assets/*/docs/arduino/<brick-name>/README.md
```

Read the file and surface the **class name, constructor arguments, key
methods, and any required env vars / Brick Configuration keys** to the user.
Do not invent method names — pull them verbatim from the README.

## Step 4 — match goal → example to copy

The bundled examples are the single best starting point. They live at:

```
/var/lib/arduino-app-cli/examples/
├── core-and-foundational/    ← minimal patterns (LED, Bridge, camera, web UI)
├── inspirational/            ← end-to-end demos (face detector, telegram bot…)
├── bricks/arduino/<brick>/   ← one folder per brick with 1+ usage examples
└── examples.json
```

Browse with:

```bash
ls /var/lib/arduino-app-cli/examples/core-and-foundational/
ls /var/lib/arduino-app-cli/examples/inspirational/
ls /var/lib/arduino-app-cli/examples/bricks/arduino/<brick>/
```

Suggested mappings for common goals:

| User goal | Copy this example |
|---|---|
| "make an LED blink" | `examples/core-and-foundational/01-led-blink/03-blinking-an-led-from-python` |
| "LED with a web UI" | `examples/core-and-foundational/01-led-blink/04-blinking-an-led-with-ui` |
| "sketch calls a function from Python" | `examples/core-and-foundational/03-bridge-basics/01-call-sketch-function-from-python` |
| "stream data from the MCU up to Python" | `examples/core-and-foundational/03-bridge-basics/02-send-data-to-python` |
| "send a structured dict over Bridge" | `examples/core-and-foundational/03-bridge-basics/03-using-structured-data` |
| "show a custom frame on the LED matrix" | `examples/core-and-foundational/02-led-matrix/02-led-matrix-frame` |
| "live camera → AI Brick → web UI" | `examples/inspirational/video-face-detection` |
| "telegram bot that echoes messages" | `examples/bricks/arduino/telegram_bot/01_text_echo` |
| "use a Brick as a custom app-local component" | `examples/core-and-foundational/05-apps-basics/01-app-register-and-start-bricks` |
| "static web page from the board" | `examples/core-and-foundational/08-web-ui-basics/01-static-page` |

## Step 5 — hand off

Once the user has picked a Brick and an example, hand off to `arduino-scaffold`
which knows how to copy the example, edit `python/main.py` and `app.yaml`, and
start the app.

## Gotchas

- **Brick IDs are verbatim** — don't pluralize, abbreviate, or camelCase them.
  `arduino:video_object_detection`, not `arduino:video-object-detection` and not
  `arduino:video_objectdetection`.
- **Some bricks are AI model–backed.** The first call may download a model —
  that takes time. Check `arduino-app-cli model list` for status; the catalog
  README usually mentions the model name.
- **A brick may be installed but not available on this board's image.** Always
  trust `brick list` over docs folders.
- **Per-brick secrets live in App Lab's Brick Configuration menu.** Never
  paste API keys into `app.yaml` or source — even in examples meant for the
  user to read.
