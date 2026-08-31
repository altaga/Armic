---
name: arduino-board
description: >-
  Orient on UNO Q or VENTUNO Q: board model, arduino-app-cli version, apps and
  examples paths, disk/RAM headroom, and what is currently running. Use at
  session start or when the user asks what board or paths they are on.
version: 1.1.1
---

# arduino-board — orient

Establish ground truth on the board before other skills run work. Output is
short and structured.

**Privacy:** Report network values only in chat after querying the board — do
not write IP, hostname, mDNS, or WiFi SSID into rules, skills, or source files.

## Step 1 — identify the board

```bash
cat /sys/firmware/devicetree/base/compatible 2>/dev/null | tr '\0' '\n' | head -5
hostname
hostname -I 2>/dev/null | awk '{print $1}'
```

| Token | Board |
|-------|-------|
| `arduino,imola` | **UNO Q** (default) |
| `arduino,monza` | **VENTUNO Q** |

Use `hostname` / `hostname -I` for URLs — never assume a fixed IP or mDNS name.

**IP vs mDNS:** App Lab and `app logs` often print `http://<board-ip>:7000/...`.
MQTT/wearables may use `<hostname>.local` from app config. Both can be valid;
do not reconfigure networking to fix Run opening an IP URL.

## Step 2 — CLI version

```bash
arduino-app-cli version
df -h / /home/arduino
free -h
```

Flag CLI/daemon mismatch. Warn if disk or RAM is in the yellow zone per
`board-resources.mdc`.

## Step 3 — paths

```bash
arduino-app-cli config get
```

| Path | Role |
|------|------|
| `~/ArduinoApps/` | User apps (`app.yaml`, `python/main.py`, optional `sketch/`, `assets/`) |
| `/var/lib/arduino-app-cli/` | Data dir: `examples/`, brick packages |
| `~/backups/` | Host-side zip backups (optional) |

## Step 4 — what's installed / running

```bash
arduino-app-cli app list
arduino-app-cli brick list
```

Summarize: running app (only one), user apps (armic, board-backup, …), brick count.

## Step 5 — hand off

| Intent | Skill |
|--------|-------|
| Armic / arm controller | `arduino-armic` |
| Backup | `arduino-backup` |
| New app | `arduino-scaffold` |
| Bridge | `arduino-bridge` |
| Web UI | `arduino-ui` |
| Broken | `arduino-troubleshoot` |

## Gotchas

- **Not on the board?** (`compatible` missing) — SSH/App Lab/adb to the real device.
- **JSON output?** — `arduino-app-cli config set format text` or `--format text`.
- **USB storage** — verify with `lsusb` and `lsblk`; often not present on UNO Q.
