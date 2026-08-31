---
name: arduino-ssh-mcp
description: >-
  Develop ARMIC on Arduino UNO Q from a local PC via AgentSSH MCP (16 SSH tools).
  Use when the agent runs on a laptop but deploys to uno-q.local — board_setup,
  armic_deploy_bundle, rehab_dry_run, arduino_compile_upload, mqtt_pub/sub.
version: 1.0.0
---

# arduino-ssh-mcp — local agent → remote board

**Repo:** `AgentSSH/` at repo root (MCP server, 16 tools).  
**Host config:** `AgentSSH/ssh-hosts.TEMPLATE.json` → copy to gitignored `ssh-hosts.json`.

## When to use

| Loop | Where agent runs | How |
|------|------------------|-----|
| On-device | UNO Q shell / App Lab | `AI Skills/` mounted on board |
| **Remote (this skill)** | Your laptop Cursor/Claude | AgentSSH MCP → SSH to `uno-q` |

Same **4-tool LLM brick** on the board; MCP handles deploy, logs, dry-run, compile.

## Setup (once)

1. `cd AgentSSH && npm install && npm run build`
2. Copy `ssh-hosts.TEMPLATE.json` → `ssh-hosts.json`; set `User`, `HostName` (`uno-q.local`), `IdentityFile`
3. Register MCP via `AgentSSH/.mcp.json`; restart agent session
4. Verify: `ssh uno-q.local "uname -a"`

## Key MCP tools

| Tool | Use |
|------|-----|
| `system_info` | Board health before risky edits |
| `board_setup` | App Lab preflight (`board_family=uno-q`) |
| `armic_deploy_bundle` | Upload `AI Skills/` + repo slice to board |
| `rehab_dry_run` | POST protocol with `dry_run=true` |
| `rehab_list_routes` | Fetch light/medium/heavy presets |
| `arduino_compile_upload` | Flash sketch from remote path |
| `mqtt_pub` / `mqtt_sub` | Wearable contract debug |
| `ssh_exec` / `ssh_upload` | General shell + SFTP |

Full table: `AgentSSH/README.md`.

## Typical prompt chain

```
system_info(host=uno-q)
→ board_setup(host=uno-q, board_family=uno-q)
→ armic_deploy_bundle(host=uno-q, local_armic_repo=<repo>, remote_target_dir=/data/armic/AI Skills)
→ rehab_list_routes(host=uno-q)
→ rehab_dry_run(host=uno-q, protocol=elbowflex-set, reps=3, speed=12)
```

## Rules

- Never commit `ssh-hosts.json` or passwords
- Deploy `calibration.json` only with `deploy_calibration_ssot=only_if_missing`
- Prefer key auth over `Password` in host config
- See `arduino-armic` for motion safety; see `AGENTS.md` §7 for adaptation
