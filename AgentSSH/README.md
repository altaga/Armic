# ClaudeSSH — MCP + Arduino UNO Q + ARMIC

MCP server that lets your LOCAL PC `claude` agent (or any MCP-capable agent, e.g. ChatGPT, Gemini) run shell commands and push files on SSH-reachable hosts. Originally built for OpenWRT routers, now also adapted as the **agentic-hardware dev loop for Arduino UNO Q + ARMIC rehab robotics (and any SSH-reachable SBC running an Arduino toolchain).**

## What it does (16 MCP tools)

Registers **16** tools with your local agent, organized into four groups:

### Core SSH (6 tools)

| Tool | Description |
|------|-------------|
| `ssh_exec(host, command, [timeout])` | Run one shell command, return stdout/stderr/exit code |
| `ssh_exec_many(hosts[], command, [timeout])` | Run the same command on N hosts in parallel |
| `ssh_upload(host, contents, path, [permissions])` | Write a file via SFTP |
| `ssh_download(host, remote_path, [encoding])` | Download a file from the remote host via SFTP (utf8 or base64) |
| `ssh_ls(host, path, [recursive], [max_depth])` | Structured directory listing via SFTP (name, type, size, modified) |
| `ssh_log_tail(host, source, [lines], [timeout])` | Non-blocking log tail — supports file paths, `journalctl:<unit>`, `docker:<container>` |

### Infrastructure (4 tools)

| Tool | Description |
|------|-------------|
| `docker_manage(host, action, [container], [compose_dir])` | Container lifecycle: ps, start, stop, restart, logs, compose_up, compose_down |
| `mqtt_pub(host, topic, payload, [qos])` | Publish to the on-device MQTT broker (armic-mosquitto) |
| `mqtt_sub(host, topic, [count], [timeout])` | Subscribe and capture MQTT messages with wildcards |
| `system_info(host)` | One-shot board health dashboard: kernel, disk, memory, CPU temp, network, docker, serial, arduino-cli |

### Arduino / ARMIC (6 tools)

| Tool | Description |
|------|-------------|
| `board_setup(host, board_family)` | Bring-up helper. `uno-q` = App Lab preflight. `generic` = install arduino-cli + cores |
| `armic_deploy_bundle(host, local_armic_repo, remote_target_dir, [deploy_calibration_ssot])` | Recursive SFTP upload of AI Skills bundle (SSoT guard on calibration.json) |
| `rehab_dry_run(host, protocol, [reps], [speed], [timeout])` | POST to on-device FastAPI with dry_run=true |
| `rehab_list_routes(host, [timeout])` | Fetch the 9 preset routes from the on-device agent |
| `arduino_list_boards(host)` | Discover boards, serial ports, and installed cores via arduino-cli |
| `arduino_compile_upload(host, sketch_path, fqbn, [port], [upload], [build_flags])` | Compile and optionally flash Arduino sketches with custom build flags |

### Architecture: Connection Pool

v0.3.0 includes a **connection pool** that keeps SSH sessions alive for 60s between tool calls. Sequential operations reuse the same connection, significantly reducing latency for multi-step workflows.

Host aliases resolve from `ssh-hosts.json` (project-local) FIRST, then fall back to `~/.ssh/config`. Template host aliases `uno-q` and `rpi-arduino-host` are pre-written in `ssh-hosts.json` — just edit the User / HostName / IdentityFile.

## Setup

### 1. Install dependencies and build

```bash
cd ClaudeSSH
npm install
npm run build
```

The MCP server entry is `dist/server.js`.

### 2. Make sure Claude Code picks up the server

`.mcp.json` at the project root registers the server with Claude Code for this workspace. Restart Claude Code after the first build so the registration is loaded:

```
exit
claude     # start a new session in this directory
```

In the new session, ask "what MCP tools do you have?" — you should see all 16 tools.

### 3. Set up SSH access to your OpenWRT box

Generate a key if you don't have one you want to use:

```bash
ssh-keygen -t ed25519
```

Push the public key to the OpenWRT host. Dropbear's authorized_keys file is at `/etc/dropbear/authorized_keys`:

```bash
# from your Windows shell, after ssh-copy-id is installed (or use scp + edit)
type $HOME\.ssh\id_ed25519.pub | ssh root@192.168.1.1 "cat >> /etc/dropbear/authorized_keys"
```

(OpenWRT typically runs dropbear rather than OpenSSH, so `ssh-copy-id` may not work directly. The above pipes the key into the authorized_keys file.)

On the OpenWRT side, make sure dropbear accepts key auth. In `/etc/config/dropbear`:

```
config dropbear
    option PasswordAuth 'on'   # can be 'off' once keys work
    option RootPasswordAuth 'on'
    option Port '22'
    option RootLogin '1'       # required for key-based root login
```

Then reload: `/etc/init.d/dropbear restart`.

### 4. Add a host entry

You can put host definitions in either of two places — `ssh-hosts.json` (project-local) or `~/.ssh/config` (global). Project file wins when both define the same alias.

**Option A — project-local `ssh-hosts.json`** (this directory):

```json
{
  "openwrt": {
    "HostName": "192.168.1.1",
    "Port": 22,
    "User": "root",
    "IdentityFile": "~/.ssh/id_ed25519"
  }
}
```

This file is in `.gitignore`. **Don't put private keys here** — `IdentityFile` is a path; the key stays in `~/.ssh/`.

If the host only accepts password auth, use `Password` instead of `IdentityFile`:

```json
{
  "openwrt": {
    "HostName": "192.168.1.101",
    "User": "root",
    "Password": "your-password"
  }
}
```

The password sits in plaintext on disk in this folder (the file is gitignored, so it won't leak via git, but anything running as your user account can read it). Prefer key auth when you can.

**Option B — `~/.ssh/config`** (Windows: `C:\Users\<you>\.ssh\config`):

```
Host openwrt
    HostName 192.168.1.1
    Port 22
    User root
    IdentityFile ~/.ssh/id_ed25519
```

Verify plain SSH works before invoking from Claude:

```bash
ssh openwrt "uname -a"
```

## Optional: per-tool configuration

Create `~/.claude-ssh.json` if you want to override defaults:

```json
{
  "max_output_bytes": 102400,
  "default_timeout_seconds": 60,
  "max_timeout_seconds": 600,
  "pool_idle_timeout_ms": 60000,
  "pool_max_connections": 5,
  "download_max_bytes": 5242880
}
```

| key                       | default     | meaning                                           |
|---------------------------|-------------|---------------------------------------------------|
| `max_output_bytes`        | `51200`     | stdout/stderr cap per command                     |
| `default_timeout_seconds` | `30`        | used when a tool call omits `timeout`             |
| `max_timeout_seconds`     | `300`       | hard ceiling; longer calls are rejected           |
| `pool_idle_timeout_ms`    | `60000`     | how long idle SSH connections stay in the pool     |
| `pool_max_connections`    | `5`         | max simultaneous pooled SSH connections            |
| `download_max_bytes`      | `5242880`   | max file size for ssh_download (5MB default)       |

## Arduino UNO Q + ARMIC setup — the two agentic-hardware dev loops

ARMIC ships two agentic-hardware dev loops that share the same 4-tool LLM brick contract. Devs choose their pick:

### Option 1 — Claude CLI *on-device* (original ARMIC dev loop shown in `0.5claude.gif`)

Install Anthropic's `claude` CLI **inside a terminal session literally on the UNO Q itself** (SSH shell → App Lab container), mount the `AI Skills/` bundle (3 rules + 31 skills) so the agent inherits the joint hard bands, E-STOP-first, calibration 3-phase commit rules, and prompt. The agent edits, deploys, and self-corrects *all on the same filesystem the firmware and agent actually run on.* Zero cross-compile, zero re-plug, zero copy from laptop → board because the agent already sits on the board.

Use Option 1 when: you are physically at the bench and want the single-Source-of-Truth dev loop.

### Option 2 — Local PC `claude` + ClaudeSSH MCP (this repo. **NEW**, focus of this adaptation)

Run your *local PC* `claude` (the one you already use every day on your dev laptop). The local agent is running on YOUR machine and uses the 16 MCP tools from this repo to SSH into the UNO Q (or any SSH-reachable Arduino host SBC) — executing commands, uploading files, managing Docker containers, interacting with MQTT, compiling Arduino sketches, and running the ARMIC 4-tool LLM brick contract remotely. Same `AI Skills/` rules + 31 skills get uploaded to the board (via `armic_deploy_bundle`). Same rehab protocols. Same safety stack. The difference: the agent model runs on YOUR beefy laptop GPU / CPU / big-RAM instead of the UNO Q MPU, so you get big-model reasoning (Sonnet-level tool calls) while still coding *for the actual board* and deploying *to the actual board* over SSH.

**Setup steps for Option 2 (Arduino UNO Q + ARMIC):**
1. Generate an SSH key on your local Windows PC if you don't already have one:
   ```powershell
   ssh-keygen -t ed25519
   ```
2. Push your public key to the UNO Q so your local agent can auth without a password prompt. Replace `REPLACE_WITH_USER` with the username your UNO Q exposes over SSH:
   ```powershell
   type $HOME\.ssh\id_ed25519.pub | ssh REPLACE_WITH_USER@uno-q.local "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
   ```
   Verify plain SSH works before involving the agent:
   ```powershell
   ssh uno-q.local "uname -a && brick compose ps"
   ```
3. Open `ssh-hosts.json` in this repo and edit the pre-written `uno-q` entry:
   - Set `User` to your actual UNO Q SSH username
   - Verify `HostName = uno-q.local` resolves on your LAN (or replace with a static IP if mDNS is flaky)
   - Delete the `Password` field entirely (use key auth) if using IdentityFile `~/.ssh/id_ed25519`
4. ⚠️ **Manually run build in a real PowerShell window** (do NOT run via sandboxed IDE command — Bitdefender ATD may flag trae-sandbox spawning Node):
   ```powershell
   cd "C:\Users\VAI\Documents\Node\Playground\ClaudeSSH"
   npm install
   npm run build
   ```
   Expected result: `dist/tools/*.js` + `dist/server.js` regenerated with all 16 MCP tools.
5. Restart your local `claude` session (exit + restart) inside this **ClaudeSSH** directory so it reloads `.mcp.json` and registers the 16 MCP tools. Confirm by asking it: *"what MCP tools do you have registered?"*
6. Typical prompt. A single natural-language prompt in your local `claude` session chains the whole ARMIC dev loop end-to-end:
   ```
   you: "I'm prepping a new rehab protocol for a 9-week post-stroke patient. Use the host alias uno-q. First,
         run system_info to check board health. Then run board_setup (uno-q family) to make sure App Lab is
         healthy. Deploy my local ARMIC AI Skills bundle from C:/Users/VAI/Github/Armic up to /data/armic/AI Skills
         on the board. Seed calibration.json ONLY if it's missing on the remote. Then fetch the route list,
         then run elbowflex-set at 12 deg/s and 3 reps with dry_run=true as a safety pre-flight. Tell me what
         changed and what the adaptation engine would do after 3 strong reps."

   local claude → system_info      host=uno-q
           → board_setup     host=uno-q board_family=uno-q
           → armic_deploy_bundle host=uno-q
                                local_armic_repo="C:/Users/VAI/Github/Armic"
                                remote_target_dir="/data/armic/AI Skills"
                                deploy_calibration_ssot=only_if_missing
           → rehab_list_routes  host=uno-q
           → rehab_dry_run     host=uno-q protocol=elbowflex-set reps=3 speed=12 timeout=180
           → answers with natural-language rationale + WIDEN ROM 5deg / extend hold after 3 strong
   ```

### Option 2 (generic): ANY SSH-reachable Linux host with a USB-attached Arduino

If you have a Raspberry Pi / Orange Pi / any Linux SBC anywhere on LAN with a plain Arduino connected over USB serial, you can also use Option 2 — no UNO Q required:
1. Same SSH-key → host step as above.
2. In `ssh-hosts.json`, edit the `rpi-arduino-host` entry (or add your own alias) with the right `HostName`, `User`, `IdentityFile`.
3. Prompt your local agent: *"Run system_info on rpi-arduino-host, then board_setup (board_family=generic) to install arduino-cli and AVR/ESP32 cores. List the boards with arduino_list_boards. Then write a classic Blink sketch for an Arduino Uno on /dev/ttyUSB0, compile it via arduino_compile_upload, and upload it. Verify the LED blinks by toggling the D13 GPIO."*

### Example session (OpenWRT — original use case)

```
you: show me the wifi status on openwrt
claude: → ssh_exec openwrt "uci show wireless"
       returns the wireless config

you: bump the txpower on radio0 to 20 and apply
claude: → ssh_upload openwrt, NEW_UCI, /etc/config/wireless
       → ssh_exec openwrt, "wifi reload"
```

### Example session (new tools — board diagnostics)

```
you: check the health of my arduino board
claude: → system_info host=uno-q
       returns kernel, disk (87% used!), memory, CPU temp 35.7°C, docker containers, serial ports

you: show me the mosquitto logs
claude: → ssh_log_tail host=uno-q source="docker:armic-mosquitto" lines=20

you: list what's in the armic project
claude: → ssh_ls host=uno-q path="/home/arduino/ArduinoApps/armic" recursive=true max_depth=2

you: pull the calibration file to review it
claude: → ssh_download host=uno-q remote_path="/data/armic/calibration.json"

you: restart the main armic container
claude: → docker_manage host=uno-q action=restart container=armic-main-1

you: publish a test MQTT message and see if it comes back
claude: → mqtt_pub host=uno-q topic="test/ping" payload='{"hello":"world"}'
       → mqtt_sub host=uno-q topic="test/#" count=1 timeout=5
```

## Troubleshooting

| symptom                                            | likely cause                                                   |
|----------------------------------------------------|----------------------------------------------------------------|
| `Host "openwrt" not found`                         | no entry in `ssh-hosts.json` or `~/.ssh/config`; check the alias spelling |
| `IdentityFile "...id_ed25519" does not exist`      | wrong path, or you didn't run `ssh-keygen` yet                 |
| `SSH connection ... failed: All configured authentication methods failed` | key not on the remote box, or dropbear has key auth off |
| `Command on "openwrt" timed out after 30s`         | raise `default_timeout_seconds` in `~/.claude-ssh.json`, or pass `timeout` per call |
| MCP tools don't show up                            | did you restart Claude Code after the first `npm run build`?   |
| `ssh_download: exceeds download_max_bytes limit`   | increase `download_max_bytes` in `~/.claude-ssh.json`          |
| `docker_manage: "container" is required`           | the `start`/`stop`/`restart`/`logs` actions need a container name — run `docker_manage ps` first |

## Dev mode

```bash
npm run dev
```

Runs `tsx watch src/server.ts` — restart-free iteration while editing.