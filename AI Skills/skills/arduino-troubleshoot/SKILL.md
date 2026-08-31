---
name: arduino-troubleshoot
description: >-
  Diagnose Arduino App failures: won't start, Bridge silent, stale sketch, model
  404, WebSocket issues, Docker path errors, mDNS vs IP, empty backup zip, or
  network/USB problems on UNO Q. Symptom → command → fix table.
version: 1.1.1
---

# arduino-troubleshoot — fix it

Use this when the user reports that something doesn't work. The skill is a
symptom → diagnosis table with the exact `arduino-app-cli` commands to run.

## Preflight (always run these first)

Paste these four commands and read their output before diagnosing anything:

```bash
arduino-app-cli app list                                  # what is / isn't running
arduino-app-cli app logs  <path> --tail 200               # Python traceback (most useful)
arduino-app-cli brick list                                # are the bricks actually installed
arduino-app-cli monitor                                   # sketch Serial — separate from app logs
```

Almost every "broken" report is explained by one of these four outputs.

## Symptom → first check → fix

### App won't start / `app start` fails immediately

- **Read the traceback** in `app logs <path> --tail 200`.
- Most common: a `from arduino.app_bricks.<x>` with no matching `arduino:<x>`
  in `app.yaml`. Add the missing entry and restart.
- Second most common: syntax error in `python/main.py`. Run the same Python
  locally to confirm.

### App starts but the sketch changes don't take effect

The cached sketch build is stale.

```bash
arduino-app-cli app clean-cache user:<name> --force
arduino-app-cli app restart ~/ArduinoApps/<name>
```

### Bridge call returns nothing / silently fails

This is **always** the name-matching contract (see `arduino-bridge`).

```bash
grep -RIn 'provide("name"' python/main.py sketch/sketch.ino
grep -RIn 'call("name"'   python/main.py sketch/sketch.ino
```

- Names must match **exactly** (case, underscores, even spacing).
- Python `Bridge.call` to an unknown name raises — read the traceback.
- Sketch `Bridge.call(...).result(out)` returns `false`; **always check the bool**.
- `Bridge.notify` mismatch is **completely silent**. No log, no error.

### Sketch Serial is empty

- Is `arduino-app-cli monitor` running? It is a separate stream from `app logs`.
- Did the sketch call `Monitor.begin(115200)` in `setup()`? Default rate is
  115200.
- Did the sketch build? If `app logs` shows a compile error, fix the sketch.

### Brick import fails / "no module named arduino.app_bricks.X"

- The Python package name uses **underscores** that may not match the brick
  ID exactly. Compare against the example:
  ```bash
  ls /var/lib/arduino-app-cli/examples/bricks/arduino/<brick>/
  ```
- Brick ID and Python module can differ — `arduino:video_object_detection`
  imports as `arduino.app_bricks.video_objectdetection` (no underscore
  between `object` and `detection`). Check the example's `python/main.py`.

### Brick raises 404 / "model not found"

The Brick is installed but the AI model it depends on isn't.

```bash
arduino-app-cli model list               # what's installed
arduino-app-cli model pull <name>        # download a specific model
```

Some Bricks expect a specific model name — read the brick's README under
`/var/lib/arduino-app-cli/assets/*/docs/arduino/<brick>/README.md`.

### LED matrix is black / doesn't update

- **Wait 20–30 s after power-on** — the boot logo owns the matrix until then.
- Did the sketch call `matrix.begin()` before `matrix.draw(...)`?
- Are you using `draw()` (grayscale) or `loadFrame()` (bit-packed)? Mixing
  them silently no-ops.
- `matrix.playSequence()` **blocks** until done — if your sketch is stuck in
  a sequence, the rest of `loop()` won't run.

### Camera not detected

- USB webcams often need a USB-C hub with USB-A ports on UNO Q.
- Check: `lsusb` on the board lists the camera?
- Some Bricks (`video_object_detection`) explicitly require a USB camera; they
  cannot use the MPU's built-in camera (there isn't one).

### Web UI / WebSocket won't connect

- Port 7000 reachable? `curl -s -o /dev/null -w '%{http_code}' http://localhost:7000/`
- User opens an **IP** URL but expects **mDNS** — both can work; App Lab often logs the IP.
- WebSocket message names must match Python `send_message` / JS `event` exactly.
- Hard-refresh after editing `assets/` (`Ctrl+Shift+R` or `?v=2`).

### REST API / backup returns empty or 404

Apps run in Docker with only `~/ArduinoApps/<app>` mounted at `/app`. Code that
reads `/home/arduino/ArduinoApps` **inside the container** sees nothing.

**Fix (board-backup):**

```bash
~/ArduinoApps/board-backup/scripts/apply-volumes.sh
```

Re-test: `curl -s http://localhost:7000/backup/info | head`

For custom apps needing host files: add read-only binds to `.cache/app-compose.yaml`
(e.g. `/host/ArduinoApps`) and use `/host/...` paths in Python — see
`arduino-backup`.

### Another app is running / can't start

```bash
arduino-app-cli app list
arduino-app-cli app stop user:<name>
arduino-app-cli app start ~/ArduinoApps/<name>
```

Only one app at a time on this board.

### LLM 503 / OOM on Armic

- Stop other apps; one local LLM (~500–900 MB) at a time.
- Armic uses Qwen 3.5 0.8B only — lower `max_tokens` if needed.
- Check `free -h` and `arduino-app-cli app logs user:armic --tail 100`.

### USB storage not visible

```bash
lsusb
lsblk
dmesg | tail -20
```

If only root hubs appear, USB mass storage is not connected — use
`arduino-backup` (web or `~/backups/`) instead.

### Network — user fears "breaking the board"

1. **Do not** change hostname, NetworkManager, or mDNS without explicit approval.
2. Run `arduino-backup` first.
3. Prefer bookmarking `http://<ip>:7000/...` over reconfiguring DNS.

### Telegram bot / cloud brick returns auth errors

- **Secrets go in App Lab's Brick Configuration**, not in `app.yaml`. If
  they're in `app.yaml`, fix that immediately and rotate the key — secrets
  in source have a way of leaking.
- After updating Brick Configuration, restart the app so the env vars reload.

### App keeps restarting / crashes in a loop

- `arduino-app-cli app logs <path> --follow` — most loop-crashes are
  exceptions during startup; the traceback is in the first 50 lines.
- If the sketch reboots the MCU, the MCU's serial output lands in
  `arduino-app-cli monitor`, not `app logs`.

## Escalation order

When stuck, walk down this list — each step adds information.

1. **Preflight** (the four read-only commands above).
2. **Compare with the example.** Copy the closest example under
   `/var/lib/arduino-app-cli/examples/`, run it as-is, then diff against your
   app. The diff usually contains the bug.
3. **Re-read the brick README** at
   `/var/lib/arduino-app-cli/assets/*/docs/arduino/<brick>/README.md` —
   method signatures and config keys change between CLI versions.
4. **Restart the daemon** — `arduino-app-cli system restart` (requires
   confirmation). Fixes most "the daemon got into a weird state" issues.
5. **Reboot the board** as a last resort.

## Anti-patterns to flag

- **Editing `.cache/`.** Never. It's build output.
- **Renaming `python/` or `sketch/`.** The folder names are fixed; the CLI
  looks for them by name.
- **Pasting secrets into `app.yaml`** or `python/main.py`. Use App Lab.
- **Asserting "it works" without starting the app.** The agent's responsibility
  per `AGENTS.md` is to verify with `app start` + `app logs --follow`.
- **Adding `time.sleep(...)` to mask a race.** Diagnose the race; sleeps hide
  bugs and degrade later.
