---
name: arduino-bridge
description: >-
  Wire Python (MPU) to the MCU sketch via Router Bridge: call, notify, name
  matching, and silent-failure diagnostics. Use for Armic sketch integration or
  any Bridge RPC on UNO Q.
version: 1.1.0
---

# arduino-bridge — talk to the MCU

The Router Bridge is the **only** way the Python app (MPU) and the Arduino
sketch (MCU) communicate. Two verbs, two directions.

## The verb matrix

| Pattern | Caller | Returns? | Receiver registers as |
|---|---|---|---|
| Python → MCU, sync | `Bridge.call("name", *args)` | yes — value | `Bridge.provide("name", fn)` in sketch |
| Python → MCU, async | `Bridge.notify("name", *args)` | no — fire-and-forget | same |
| MCU → Python, sync | `Bridge.call("name", *args)` | yes — read with `.result(out)` | `Bridge.provide("name", fn)` in Python |
| MCU → Python, async | `Bridge.notify("name", *args)` | no | same |

Use `notify` for high-rate streams (sensor data) so the sender never blocks.
Use `call` when you need the return value.

## The name-matching contract (read this first)

The name passed to `provide` on one side is the lookup key for `call`/`notify`
from the other. **Names must match exactly.** A mismatch surfaces differently
depending on the verb — this is the #1 silent-failure cause:

- **Python `Bridge.call`** to an unknown name → raises (`ValueError` if the
  method doesn't exist on the MCU; `TimeoutError` on timeout).
- **Sketch `Bridge.call(...).result(out)`** → returns `false` — **always check
  the bool**. Many tutorials skip this; if you do, you'll think the call
  succeeded when it didn't.
- **`notify` in either direction** → fails **silently**. No log, no error.
  When "the Bridge does nothing", check the names on both sides first.

## Recipe 1 — Python calls a sketch function (sync)

**Python side** (`python/main.py`):
```python
from arduino.app_utils import *
import time

def loop():
    time.sleep(1)
    Bridge.call("set_led_state", True)   # name matches sketch exactly

App.run(user_loop=loop)
```

**Sketch side** (`sketch/sketch.ino`):
```cpp
#include "Arduino_RouterBridge.h"

void set_led_state(bool on) {
    digitalWrite(LED_BUILTIN, on ? LOW : HIGH);  // active-low on UNO Q
}

void setup() {
    pinMode(LED_BUILTIN, OUTPUT);
    Monitor.begin(115200);
    Bridge.begin();                            // required, before any provide
    Bridge.provide("set_led_state", set_led_state);
}

void loop() { /* nothing — only invoked when Python calls */ }
```

Reference: `examples/core-and-foundational/03-bridge-basics/01-call-sketch-function-from-python`.

## Recipe 2 — Sketch streams data up to Python

Use `notify` so the sketch never blocks waiting for Python to acknowledge.

**Sketch side:**
```cpp
#include "Arduino_RouterBridge.h"

void setup() {
    Monitor.begin(115200);
    Bridge.begin();
    Bridge.notify("sensor", "ready");          // one-shot hello
}

void loop() {
    int v = analogRead(A0);
    Bridge.notify("sensor", v);                // high-rate stream
    delay(50);
}
```

**Python side:**
```python
from arduino.app_utils import *

def on_sensor(value):
    print("sensor:", value)

Bridge.provide("sensor", on_sensor)
App.run()
```

Reference: `examples/core-and-foundational/03-bridge-basics/02-send-data-to-python`.

## Recipe 3 — Structured arguments

Lists, dicts, and primitives all round-trip. Treat them as JSON on both
sides:

**Python:**
```python
Bridge.call("apply_config", {"rate": 100, "labels": ["red", "green"]})
```

**Sketch:**
```cpp
void apply_config(String json) {
    // parse with ArduinoJson if you need to read fields
    Monitor.println(json);
}

void setup() {
    Monitor.begin(115200);
    Bridge.begin();
    Bridge.provide("apply_config", apply_config);
}
```

Reference: `examples/core-and-foundational/03-bridge-basics/03-using-structured-data`.

## Debugging — read the right stream

- **Python side logs** → `arduino-app-cli app logs <path> --follow`
- **Sketch side logs** (anything printed with `Monitor.print` /
  `Serial.print`) → `arduino-app-cli monitor`
- **JSON form for parsing** → `--format json` on any `arduino-app-cli` command

## "Bridge isn't working" — 4-step diagnostic

Run these in order; the first failure is almost always the cause.

1. **Names match exactly?** Grep for the handler name in both sides:
   ```bash
   grep -RIn 'provide("name"' python/main.py sketch/sketch.ino
   grep -RIn 'call("name"'   python/main.py sketch/sketch.ino
   ```
   Mismatch → silent or raises depending on verb. Fix the spelling.

2. **Sketch has `Bridge.begin()` in `setup()`?** Without it, no `provide`
   registers and every call from Python will fail. The first thing in
   `setup()` after `Monitor.begin(...)` should be `Bridge.begin();`.

3. **Sketch built and flashed?** If you only edited `sketch.ino` and the
   changes don't take effect, the cache is stale:
   ```bash
   arduino-app-cli app clean-cache user:<name> --force
   arduino-app-cli app restart ~/ArduinoApps/<name>
   ```

4. **Serial baud correct?** `Monitor.begin(115200)` in sketch; default
   `arduino-app-cli monitor` reads at the same rate.

## Gotchas

- **Active-low LEDs.** UNO Q / VENTUNO Q's built-in LED is active-low —
  `LOW` turns it on, `HIGH` turns it off. Get this wrong and the LED never
  appears to toggle.
- **`Bridge.provide` must be in `setup()`** (sketch side) or **module
  level** (Python side). Doing it inside `loop()` re-registers on every
  iteration.
- **Don't call `Bridge.notify` before `Bridge.begin()`.** The first send will
  silently drop.
- **Single instance of each name.** Re-providing the same name on the same
  side replaces the previous handler.
- **High-rate `call` blocks the sender.** Switch to `notify` if you're sending
  sensor data at >10 Hz.
