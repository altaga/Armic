---
name: arduino-ui
description: >-
  Build browser UIs with arduino:web_ui (port 7000), REST APIs, WebSocket,
  file downloads, and the on-board 8x13 LED matrix. Use for web pages, APIs,
  arm-simulator-style assets, or matrix animations on UNO Q.
version: 1.1.0
---

# arduino-ui — front-ends

Two front-ends ship on every UNO Q / VENTUNO Q:

- **`arduino:web_ui`** — Python-side. Serves `assets/` on port **7000**, plus
  REST endpoints and WebSocket. Reaches the user in a browser.
- **`Arduino_LED_Matrix`** — MCU-side. The 8×13 monochrome blue matrix
  driven directly by the sketch.

They are independent — most apps use one or the other, not both.

---

## Part 1 — `arduino:web_ui`

### Add the brick

```yaml
# app.yaml
bricks:
  - arduino:web_ui
```

```bash
arduino-app-cli app new <name> --from-app \
    /var/lib/arduino-app-cli/examples/core-and-foundational/08-web-ui-basics/01-static-page
```

### Folder shape (after scaffolding)

```
<app>/assets/        ← static files served at http://<board>:7000/
   ├── index.html
   ├── app.js
   ├── style.css
   └── libs/         ← optional vendored JS libs
```

Anything under `assets/` is served at `http://<board-ip>:7000/<path>`.

**This project:** Armic main page is `/arm-simulator.html`; backup is
`/download.html` on the `board-backup` app.

### REST endpoint recipe

```python
from fastapi.responses import FileResponse, Response
from arduino.app_bricks.web_ui import WebUI

ui = WebUI()
ui.expose_api("GET", "/hello", lambda: {"message": "Hello, world!"})
ui.expose_api("POST", "/command", lambda body: do_command(body))
```

Paths are served **as registered** (default prefix is empty), e.g.
`http://<board>:7000/hello` — not necessarily `/api/hello`. Confirm with:

```bash
curl -s http://localhost:7000/hello
```

### File download (zip, export)

Build in memory or on disk, return `Response` or `FileResponse`:

```python
from fastapi.responses import Response

def download_zip():
    data = build_zip_bytes()  # your logic
    return Response(
        content=data,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="backup.zip"'},
    )

ui.expose_api("GET", "/backup/download", download_zip)
```

Full working pattern: `~/ArduinoApps/board-backup/` (see `arduino-backup`).

### Docker note

Python runs in a container. Host paths like `/home/arduino/ArduinoApps` are
**not** visible unless bind-mounted. App folder is always at `/app`. For
cross-app file access, mount host dirs (e.g. `/host/ArduinoApps`) — see
`arduino-backup` / `arduino-scaffold`.

### WebSocket recipe (browser ↔ Python)

The full pattern, from `examples/.../04-blinking-an-led-with-ui`:

**Python side (`python/main.py`):**
```python
from arduino.app_utils import *
from arduino.app_bricks.web_ui import WebUI

led_is_on = False

def toggle_led_state(client, data):
    global led_is_on
    led_is_on = not led_is_on
    Bridge.call("set_led_state", led_is_on)        # talk to the MCU
    ui.send_message("led_status_update", {"led_is_on": led_is_on})

def on_get_initial_state(client, data):
    ui.send_message("led_status_update", {"led_is_on": led_is_on}, client)

ui = WebUI()
ui.on_message("toggle_led", toggle_led_state)
ui.on_message("get_initial_state", on_get_initial_state)
App.run()
```

**Browser side (`assets/app.js`, sketch):**
```javascript
const ws = new WebSocket(`ws://${location.host}:7000/ws`);
ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.event === "led_status_update") updateUI(msg.payload);
};
document.getElementById("btn").onclick = () =>
    ws.send(JSON.stringify({event: "toggle_led", payload: {}}));
```

The exact WS endpoint (`/ws`) and message envelope (`{event, payload}`) come
from the web_ui brick — confirm with
`arduino-app-cli brick details arduino:web_ui` if you change the brick version.

### Hand-off to App Lab

If the user would rather build the UI in the browser with drag-and-drop
instead of editing `assets/`, point them at App Lab — it shows the same
WebSocket connection and lets them wire controls visually.

### Gotchas

- **Port 7000 must be reachable.** If the user can't load the page, check
  firewall / that another app isn't bound to 7000.
- **`send_message(name, payload)` broadcasts to all clients** unless you pass
  a specific `client` as the third argument — see `on_get_initial_state`
  above.
- **Static files cache.** If you change `index.html` and the browser doesn't
  refresh, hard-refresh or append `?v=<n>`.
- **WS message names must match exactly** — same name-matching contract as
  the Bridge (see `arduino-bridge`). The skill's biggest silent-failure
  pattern.

---

## Part 2 — `Arduino_LED_Matrix`

### Hardware facts

- 8 rows × 13 columns = **104 pixels**, monochrome blue.
- **3-bit grayscale (0..7)** per pixel.
- Driven by the MCU via `Arduino_LED_Matrix.h` (bundled with the Arduino/Zephyr
  core).
- **Boot logo runs for ~20–30 s** during startup. Don't drive the matrix
  before then or you'll fight the boot animation.

Ground-truth API lives at:
```
~/.arduino15/packages/arduino/hardware/zephyr/*/libraries/Arduino_LED_Matrix/
```
Use `arduino-app-cli brick details` for the MCU-side library docs, or read
that source — it's small.

### Frame format — pick one, don't mix

**Per-pixel grayscale** (one byte per LED, 0..7):
```cpp
uint8_t frame[104] = { /* 104 values 0..7 */ };
matrix.draw(frame);
```

**Bit-packed on/off** (one uint32_t per column-or-row — read the header):
```cpp
uint32_t frame[4] = { /* 4 uint32s */ };
matrix.loadFrame(frame);
```

**Sequence** (array of frames, played back-to-back):
```cpp
uint32_t sequence[][5] = { /* each row is one frame */ };
matrix.loadSequence(sequence);
matrix.playSequence();         // BLOCKS until sequence finishes
```

### Minimal sketch

```cpp
#include "Arduino_LED_Matrix.h"

ArduinoLEDMatrix matrix;

uint8_t frame[104];
void setup() {
    memset(frame, 0, sizeof(frame));
    // fill the first 8 pixels at half brightness
    for (int i = 0; i < 8; i++) frame[i] = 4;
    matrix.begin();
}

void loop() {
    matrix.draw(frame);
    delay(500);
}
```

### Animation patterns from the bundled examples

| Example | What to study |
|---|---|
| `inspirational/keyword-spotting` | Native sequence with `playSequence()` |
| `inspirational/mascot-jump-game` | Frame-by-frame updates driven by Bridge state |
| `inspirational/led-matrix-painter` | Web editor → matrix (combines web_ui + matrix) |
| `inspirational/air-quality-monitoring` | Status display driven by a Brick |

### Driving the matrix from Python via Bridge

The pattern is the same as any other Bridge interaction — Python calls a
sketch function, the sketch updates the matrix. See `arduino-bridge` Recipe 1.

```python
# python
Bridge.call("matrix_draw_pattern", "happy")
```

```cpp
// sketch
void matrix_draw_pattern(const char* name) {
    if (strcmp(name, "happy") == 0) matrix.loadFrame(happy_frame);
}
```

### Gotchas

- **`matrix.playSequence()` blocks.** Don't call it from a loop that also
  needs to handle Bridge events — either precompute the whole sequence, or
  drive frames manually with a state machine.
- **Prefer `draw()` over `loadFrame()` for grayscale.** `loadFrame()` is
  bit-packed and ignores per-pixel brightness.
- **The matrix is shared with the boot animation.** Wait at least 20–30 s
  after power-on before your sketch touches it, or the boot logo will flicker
  / reset your pixels.
- **Frame coordinates are column-major in `loadFrame` format.** When in
  doubt, read the header at the library path above.

---

## Choosing between the two

| Need | Use |
|---|---|
| Show the user a status, chart, or control panel in their browser | `web_ui` |
| Show a status icon, animation, or game art on the board itself | `Arduino_LED_Matrix` |
| Both (browser control + on-board feedback) | Both — combine via Bridge |
| Headless app, no UI | Neither — skip both |
