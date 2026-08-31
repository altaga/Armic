# `sketch/sketch.yaml` schema reference

The sketch's build profile. Lives next to `sketch.ino`; only needed when the
app uses the MCU.

## Minimal form

```yaml
profiles:
  default:
    platforms:
      - platform: arduino:zephyr
default_profile: default
```

That's enough to compile an empty `sketch.ino` that includes
`Arduino_RouterBridge.h` and calls `Bridge.begin()`.

## With Arduino libraries

Pin the version exactly — there is no `lib install` step on the board.

```yaml
profiles:
  default:
    platforms:
      - platform: arduino:zephyr
    libraries:
      - Arduino_Modulino (0.7.0)
      - ArduinoGraphics (1.0.0)
default_profile: default
```

The version string is `(x.y.z)` — copy it verbatim from the example you
copied, including the parens and the space.

## Where Arduino library versions come from

The bundled examples pin the versions that were current when the example was
last verified. Look at the example's `sketch.yaml` and copy it verbatim
unless you have a specific reason to upgrade.

## Gotchas

- **Platform is always `arduino:zephyr`** for UNO Q / VENTUNO Q. Don't
  substitute `arduino:avr` or any other platform.
- **Libraries with parens** — `(0.7.0)` is part of the identifier. YAML
  treats it as a string; quoting isn't required.
- **Build cache** — if you change `sketch.yaml` and the new sketch doesn't
  take effect, run `arduino-app-cli app clean-cache user:<name> --force`
  then `app restart`.

## When you do NOT need `sketch.yaml`

- Python-only apps (started with `--no-sketch`).
- Apps that only use the MPU (Python, web UI, AI Bricks, network) and don't
  touch the on-board LED, sensors, actuators, or LED matrix.

In those cases the entire `sketch/` folder is omitted.
