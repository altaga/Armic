# Arduino Skill Bundle

Skills for **UNO Q** and **VENTUNO Q** that teach any coding agent (Cursor,
Claude Code, etc.) how to build, run, debug, and back up Arduino Apps.

Companion to `/etc/arduino-app-cli/AGENTS.md` (canonical on-board rules).

> **Bundle version:** 1.1.1 · **Verified on:** UNO Q (`arduino,imola`)

## What's in the bundle

| Folder | Purpose |
|--------|---------|
| `arduino/` | Meta orchestrator — routes to sub-skills |
| `arduino-board/` | Board model, paths, hostname, resources |
| `arduino-armic/` | **This project** — 4DOF rehab arm app |
| `arduino-backup/` | Zip backup + `download.html` workflow |
| `arduino-catalog/` | Discover bricks and examples |
| `arduino-scaffold/` | Scaffold new apps |
| `arduino-bridge/` | MPU ↔ MCU Router Bridge |
| `arduino-ui/` | `web_ui` + LED matrix |
| `arduino-troubleshoot/` | Symptom → fix table |
| `arduino-ssh-mcp/` | Laptop agent → UNO Q via AgentSSH MCP |
| `ARDUINO-BUNDLE.md` | This manifest |

## Agent compatibility (Cursor + Claude)

- Skills are plain Markdown + YAML frontmatter — no Cursor-only APIs.
- Steps assume **shell on the board** (`arduino-app-cli`, `docker`, `curl`).
- Descriptions use third-person trigger phrases so any agent can match them.
- Install path differs by product; content is identical.

| Product | Install skills to |
|---------|-------------------|
| **Cursor** (this board) | `~/.cursor/skills-cursor/` |
| **Claude Code** | `~/.claude/skills/` |

## Install / share — one command

**From this board (Cursor path):**

```bash
cd ~/.cursor/skills-cursor && tar czf /tmp/arduino-skills.tgz \
  arduino arduino-board arduino-armic arduino-backup \
  arduino-catalog arduino-scaffold arduino-bridge \
  arduino-ui arduino-troubleshoot ARDUINO-BUNDLE.md
```

**On target (Claude Code):**

```bash
mkdir -p ~/.claude/skills
cd ~/.claude/skills && tar xzf /tmp/arduino-skills.tgz
```

**On target (Cursor):**

```bash
mkdir -p ~/.cursor/skills-cursor
cd ~/.cursor/skills-cursor && tar xzf /tmp/arduino-skills.tgz
```

Restart the agent session after extracting.

## Verify install

```bash
ls ~/.cursor/skills-cursor/arduino*/SKILL.md   # or ~/.claude/skills/
arduino-app-cli version
arduino-app-cli app list
```

Ask: **"what board am I on?"** → should trigger `arduino-board`.

## This deployment quick reference

| | |
|---|---|
| Main app | `~/ArduinoApps/armic` → `http://<board-ip>:7000/arm-simulator.html` |
| Backup UI | `~/ArduinoApps/board-backup` → `http://<board-ip>:7000/download.html` |
| Network | Query `hostname` / `hostname -I` — do not hardcode in skills |
| Workspace rule | `~/.cursor/rules/board-resources.mdc` (disk/RAM) |

## Updating

1. `arduino-app-cli brick list` — refresh `arduino-catalog/references/bricks-catalog.md` if needed.
2. Re-tar and copy to other boards.
3. Bump version in this file and skill `version:` fields when behavior changes.

## Authoring rules

1. `name:` matches folder name; description = WHAT + WHEN (third person).
2. Keep `SKILL.md` under ~500 lines; use `references/` for depth.
3. Query the board live — do not hardcode brick lists, CLI flags, or **network details** (IP, hostname, mDNS, WiFi).
4. Model-agnostic wording — no "Cursor-only" or "Claude-only" steps.

## License

Skill docs are original; Arduino examples referenced are MPL-2.0.
