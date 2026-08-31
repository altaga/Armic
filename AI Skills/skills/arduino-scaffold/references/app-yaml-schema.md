# `app.yaml` schema reference

The Arduino App manifest. Required keys: `name`, `icon`, `description`.
Optional keys: `bricks` (and per-brick nested config), `version`, and other
metadata used by App Lab.

## Minimal form

```yaml
name: Blink LED from Python
icon: 🔴
description: Blink the on-board LED from Python via the Bridge.
```

That alone is a valid app — Python only, no bricks, no sketch.

## With bricks

```yaml
name: Face Detector
icon: ☺️
description: Detect faces in a live USB-camera feed.
bricks:
  - arduino:video_object_detection
  - arduino:web_ui
```

The `bricks:` list is positional — order doesn't matter to the runtime, but
keep related bricks adjacent for readability.

## Per-brick configuration

Some Bricks accept a config block under their entry. Always read the
per-brick README (`/var/lib/arduino-app-cli/assets/*/docs/arduino/<brick>/README.md`)
for the exact keys. Common shapes:

```yaml
bricks:
  - arduino:video_object_detection:
      model: face-detection                # choose a model variant
      confidence: 0.4                      # optional runtime default
  - arduino:llm:
      model: llama3.2:3b                   # local LLM tag
```

Anything not declared in the README as a config key is silently ignored —
double-check against `arduino-app-cli brick details arduino:<id>` if unsure.

## What NOT to put in `app.yaml`

- **Secrets.** API keys, bot tokens, device IDs. These belong in App Lab's
  Brick Configuration (per-app env vars), never in source-controlled YAML.
- **Paths.** No `python_path`, `sketch_path`, etc. The folder layout is fixed.
- **Sketch build settings.** Those go in `sketch/sketch.yaml`, not here.

## Edge cases

- **Same brick, two configs** — you can declare the same Brick twice if the
  README documents it (rare). Most Bricks support one instance.
- **Brick depends on a model.** Some Bricks (`llm`, `cloud_llm`, the vision
  Bricks) need a model to be installed first. Check `arduino-app-cli model list`.
- **Per-brick env vars.** Set them in App Lab's Brick Configuration menu —
  not in `app.yaml`. They'll be injected at runtime.

## Validation

`arduino-app-cli app new --help` lists the flags `app new` accepts when
scaffolding. After editing an existing `app.yaml`, the next `app start` will
fail-fast if any `bricks:` entry doesn't resolve — read the error message
carefully; it usually names the offending brick.
