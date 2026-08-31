---
name: arduino-scaffold
description: >-
  Create a new Arduino App under ~/ArduinoApps/: copy the closest example,
  edit app.yaml and python/main.py, optional sketch and web assets. Use for new
  apps, board-backup-style utilities, or cloning examples on UNO Q.
version: 1.1.0
---

# arduino-scaffold — build a new app

Use this whenever the user wants to create or copy an Arduino App. The output
is a folder under `~/ArduinoApps/<name>/` that runs without further edits.

> **Always route through `arduino-catalog` first** to pick the brick/example
> before you scaffold. Skipping that step is how you end up with an `app.yaml`
> that imports a brick the user doesn't want.

## Step 1 — confirm intent

Before scaffolding, ask (or infer from context) and confirm:

- **App name** (kebab-case, no spaces — becomes the folder name).
- **Icon** (single emoji or short text).
- **One-line description.**
- **Goal** — what the app should do. Distinguish:
  - "Use Brick X" (e.g. "live camera + telegram alert") → scaffold around the
    brick, copy the brick's example.
  - "Wire Python ↔ MCU sketch" → ensure both `python/main.py` AND
    `sketch/sketch.ino` are scaffolded.
  - "Web UI for the board" → `web_ui` brick + `assets/index.html` scaffold.
- **Sketch needed?** If the user mentions GPIO, sensors, the on-board LED, or
  the LED matrix → `sketch/` is required. Otherwise prefer `--no-sketch` to
  keep builds simple.

## Step 2 — pick the closest example

`arduino-app-cli app new` has a `--from-app` flag that clones an existing app
— **the single best way to scaffold**. Find the closest match from
`arduino-catalog`'s example table, then:

```bash
arduino-app-cli app new <name> -d "..." -i "🚀" \
    -b arduino:<brick1> -b arduino:<brick2> \
    --from-app /var/lib/arduino-app-cli/examples/<path>/<example>
```

For Python-only apps, append `--no-sketch` to skip the empty sketch template.

Verify the exact flags first:

```bash
arduino-app-cli app new --help
```

## Step 3 — the folder shape

```
~/ArduinoApps/<name>/
├── app.yaml            ← manifest (name/icon/description/bricks)
├── README.md
├── python/
│   └── main.py         ← REQUIRED entry point; ends with App.run()
├── sketch/             ← OPTIONAL
│   ├── sketch.ino
│   └── sketch.yaml
├── assets/             ← OPTIONAL — static files for web_ui at :7000
└── .cache/             ← build output, never edit
```

Folder names are fixed — don't rename them. Details in
`references/app-yaml-schema.md` and `references/sketch-yaml-schema.md`.

## Step 4 — edit `python/main.py`

When copying an example, the `main.py` will already work — you usually just:

1. Rename module-level variables to match the new app.
2. Update the `loop()` callback (if any) to do the user's task.
3. Update the WebUI message names and the sketch's `Bridge.provide("name", …)`
   names so they match each other (see `arduino-bridge` — name mismatches are
   the #1 silent failure).
4. Add comments only where the example is unclear; do not rewrite working
   code.

### Rules of the road

- **`App.run(...)` stays last.** Anything after it is dead code.
- **Imports and `bricks:` must match.** Every
  `from arduino.app_bricks.<x> import …` needs a matching `arduino:<x>` entry
  in `app.yaml`. Mismatched imports fail at launch with a clear error.
- **Use `Logger` (or `print`) for logs.** Both surface in `app logs`.
- **Keep license headers** — `# SPDX-FileCopyrightText: …` / `# SPDX-License-Identifier: …`
  on every Python and Arduino file. The official examples use MPL-2.0.

## Step 5 — `app.yaml` checklist

```yaml
name: Face Detector                  # required, human-readable
icon: ☺️                             # required, single emoji recommended
description: Detect faces in a live USB-camera feed.   # required, one line

bricks:
  - arduino:video_object_detection:  # optional per-brick config (model, vars)
      model: face-detection
  - arduino:web_ui                   # simple "use this brick" form
```

Do **not** put secrets in `app.yaml`. Use App Lab's Brick Configuration.

See `references/app-yaml-schema.md` for the full schema and edge cases.

## Step 6 — `sketch.yaml` (only when a sketch is needed)

```yaml
profiles:
  default:
    platforms:
      - platform: arduino:zephyr
    libraries:
      - Arduino_Modulino (0.7.0)     # extra Arduino libs the sketch uses
default_profile: default
```

Pin library versions exactly as in the example you copied. There is no
`lib install` step — the `libraries:` block is the source of truth.

See `references/sketch-yaml-schema.md` for details.

## Step 7 — start and verify

```bash
arduino-app-cli app start ~/ArduinoApps/<name>
arduino-app-cli app logs  ~/ArduinoApps/<name> --follow
arduino-app-cli monitor                       # sketch Serial
```

If `app start` fails immediately, jump to `arduino-troubleshoot` (most often a
mismatched import or a sketch that didn't compile).

If the sketch looks stale after edits:

```bash
arduino-app-cli app clean-cache user:<name> --force
arduino-app-cli app restart ~/ArduinoApps/<name>
```

## Custom app-local components ("mini-bricks")

You don't have to depend on an official Brick — any Python class can become a
long-running component in your app. From
`examples/core-and-foundational/05-apps-basics/01-app-register-and-start-bricks/main.py`:

```python
from arduino.app_utils import App
import time

class Greeter:
    def loop(self):
        print("Hello from the Greeter brick")
        time.sleep(1)

greeter = Greeter()
App.register(greeter)        # adds to App's waiting queue
App.start_brick(greeter)     # spawns a worker thread

try:
    App.loop()               # keep main thread alive until Ctrl+C
finally:
    App.stop_brick(greeter)
```

A class with a `loop(self)` method is auto-discovered and run in a worker
thread. No `bricks:` entry needed — this is in-app, not a distributed package.

## Setting a default boot app

```bash
arduino-app-cli properties set default <name>     # requires confirmation
```

Use sparingly — once set, the app runs on every boot until you change it.

## Gotchas

- **`app start` stops whatever was running.** Confirm with the user first if
  another app is currently active (`arduino-app-cli app list` shows status).
- **`--from-app` clones the example exactly.** Read `python/main.py` and any
  `app.yaml` Brick Configuration entries it expects before you hand it to the
  user; some examples have setup steps not visible in the code.
- **Python `requirements.txt`** (optional, `python/requirements.txt`) holds
  PyPI deps. The Arduino-supplied Python environment already has everything
  needed for the official Bricks — only add this if you import third-party
  packages.
- **The agent's edits count.** If you modify `python/main.py` from the example,
  state the diff so the user can review.
- **Docker only mounts the app folder at `/app`.** If Python must read other
  host paths (e.g. all of `~/ArduinoApps`), add bind mounts to
  `.cache/app-compose.yaml` and use `/host/...` inside the container. See
  `~/ArduinoApps/board-backup/scripts/apply-volumes.sh` and `arduino-backup`.
- **Reference utility on this board:** `board-backup` — web_ui + zip download
  (`download.html`); good template for API + static page apps without a sketch.
