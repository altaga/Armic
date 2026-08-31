import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { drainPool } from './ssh-client.js';

// ── Core SSH tools ─────────────────────────────────────────────────
import { handleSshExec, sshExecSchema } from './tools/exec.js';
import { handleSshExecMany, sshExecManySchema } from './tools/exec-many.js';
import { handleSshUpload, sshUploadSchema } from './tools/upload.js';
import { handleSshDownload, sshDownloadSchema } from './tools/download.js';
import { handleSshLs, sshLsSchema } from './tools/ls.js';
import { handleSshLogTail, sshLogTailSchema } from './tools/log-tail.js';

// ── Infrastructure tools ───────────────────────────────────────────
import { handleDockerManage, dockerManageSchema } from './tools/docker-manage.js';
import { handleMqttPub, mqttPubSchema, handleMqttSub, mqttSubSchema } from './tools/mqtt-ops.js';
import { handleSystemInfo, systemInfoSchema } from './tools/system-info.js';

// ── Arduino / ARMIC tools ──────────────────────────────────────────
import { handleBoardSetup, boardSetupSchema } from './tools/board-setup.js';
import { handleArmicDeployBundle, armicDeployBundleSchema } from './tools/armic-deploy.js';
import {
  handleRehabDryRun,
  rehabDryRunSchema,
  handleRehabListRoutes,
  rehabListRoutesSchema,
} from './tools/rehab-ops.js';
import {
  handleArduinoListBoards,
  arduinoListBoardsSchema,
  handleArduinoCompileUpload,
  arduinoCompileUploadSchema,
} from './tools/arduino-ops.js';

const server = new McpServer({
  name: 'claude-ssh',
  version: '0.3.0',
});

// ── Core SSH (3 original + 3 new) ──────────────────────────────────

server.tool(
  'ssh_exec',
  'Run a shell command on a remote host via SSH. Returns stdout, stderr, and exit code. ' +
    'Hostnames are looked up in ssh-hosts.json (project-local) first, then ~/.ssh/config.',
  sshExecSchema,
  handleSshExec,
);

server.tool(
  'ssh_exec_many',
  'Run the same shell command on multiple hosts in parallel via SSH. ' +
    'Useful for fleet-wide checks. Returns one result per host; per-host failures are reported in the result.',
  sshExecManySchema,
  handleSshExecMany,
);

server.tool(
  'ssh_upload',
  'Write string contents to a file on a remote host via SFTP. ' +
    'Use this for editing config files like /etc/config/network on OpenWRT before restarting services.',
  sshUploadSchema,
  handleSshUpload,
);

server.tool(
  'ssh_download',
  'Download a file from a remote host to the agent via SFTP. Returns file content as utf8 text or base64 (for binaries). ' +
    'Use this to pull logs, calibration files, telemetry CSVs, or build artifacts from the board to your laptop. ' +
    'Max file size is configurable via download_max_bytes in ~/.claude-ssh.json (default 5MB).',
  sshDownloadSchema,
  handleSshDownload,
);

server.tool(
  'ssh_ls',
  'List the contents of a remote directory via SFTP. Returns structured JSON with file names, types, sizes, and modification times. ' +
    'Optional recursive mode with depth control. Much more reliable than parsing `ls -la` output from ssh_exec.',
  sshLsSchema,
  handleSshLs,
);

server.tool(
  'ssh_log_tail',
  'Non-blocking tail of logs from a remote host. Supports three source types:\n' +
    '• File path: "/var/log/syslog"\n' +
    '• Journalctl unit: "journalctl:pipewire"\n' +
    '• Docker container: "docker:armic-mosquitto"\n' +
    'Returns the last N lines (default 50, max 500) with a timeout guard to prevent hanging.',
  sshLogTailSchema,
  handleSshLogTail,
);

// ── Infrastructure ─────────────────────────────────────────────────

server.tool(
  'docker_manage',
  'Manage Docker containers on a remote host. Actions: ps (list all), start, stop, restart, logs (tail), ' +
    'compose_up, compose_down. No destructive operations (rm/rmi) are exposed. ' +
    'For the Arduino UNO Q, use this to manage armic-mosquitto and other App Lab containers.',
  dockerManageSchema,
  handleDockerManage,
);

server.tool(
  'mqtt_pub',
  'Publish a message to the MQTT broker on a remote host. Uses the armic-mosquitto Docker container by default, ' +
    'falling back to host-level mosquitto_pub. Essential for testing ARMIC M5 wearable MQTT envelope, ' +
    'joint state topics, and E-STOP signals.',
  mqttPubSchema,
  handleMqttPub,
);

server.tool(
  'mqtt_sub',
  'Subscribe to an MQTT topic on a remote host and capture messages. Returns after receiving the specified number ' +
    'of messages (default 1) or timing out. Supports MQTT wildcards (# and +). ' +
    'Uses the armic-mosquitto Docker container by default.',
  mqttSubSchema,
  handleMqttSub,
);

server.tool(
  'system_info',
  'One-shot board health dashboard. Returns kernel version, uptime, disk usage, memory, CPU temperature, ' +
    'network interfaces, Docker container status, serial ports, and arduino-cli version — all in a single SSH round-trip. ' +
    'Use this as the first diagnostic when connecting to a new board.',
  systemInfoSchema,
  handleSystemInfo,
);

// ── Arduino / ARMIC ────────────────────────────────────────────────

server.tool(
  'board_setup',
  'Arduino / SBC bring-up helper. For `board_family=uno-q` this runs the App Lab ARMIC preflight check ' +
    '(workdir, python, containers, mosquitto clients, calibration SSoT path). For `board_family=generic` ' +
    'it installs arduino-cli + avr/esp32/mbed_nano cores on any SSH-reachable Linux host. Good first step before coding.',
  boardSetupSchema,
  handleBoardSetup,
);

server.tool(
  'armic_deploy_bundle',
  'ARMIC-specific: copy the local `AI Skills/` bundle (31 skills + 3 locked rules) from your local ARMIC repo ' +
    'up to the SSH target via recursive SFTP write. Optionally seed calibration.json ONLY if the remote ' +
    '/data/armic/calibration.json does NOT already exist (never overwrites — SSoT guard baked in). ' +
    'Use this after board_setup to turn any SSH board into an ARMIC-agentic dev board.',
  armicDeployBundleSchema,
  handleArmicDeployBundle,
);

server.tool(
  'rehab_dry_run',
  'ARMIC UNO Q only: POST to the on-device FastAPI agent endpoint to run a protocol through the 4-tool ' +
    'LLM brick contract with dry_run=true. Does NOT send live PWM (dry_run gate still applies). ' +
    'Great for validating adaptation rules and kinematics from your laptop without walking over to the bench.',
  rehabDryRunSchema,
  handleRehabDryRun,
);

server.tool(
  'rehab_list_routes',
  'ARMIC UNO Q only: fetch the list_rehab_routes() payload from the on-device FastAPI agent endpoint. ' +
    'Same 9-preset list the on-device agent sees internally.',
  rehabListRoutesSchema,
  handleRehabListRoutes,
);

server.tool(
  'arduino_list_boards',
  'Discover Arduino boards and serial ports on a remote host. Runs arduino-cli board list, scans /dev/tty{ACM,USB,HS,AMA}*, ' +
    'and lists installed cores. Use this before arduino_compile_upload to find the right FQBN and port.',
  arduinoListBoardsSchema,
  handleArduinoListBoards,
);

server.tool(
  'arduino_compile_upload',
  'Compile (and optionally upload) an Arduino sketch on a remote host using arduino-cli. ' +
    'Supports custom build flags (-DARMIC_DRY_RUN, -DDEBUG_LEVEL=2, etc). ' +
    'Returns structured compiler output including errors, warnings, and binary size. ' +
    'For UNO Q: use fqbn "arduino:mbed_nano:stm32u585xx". For generic: "arduino:avr:uno", "esp32:esp32:m5stack_core2", etc.',
  arduinoCompileUploadSchema,
  handleArduinoCompileUpload,
);

// ── Transport + shutdown ───────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    drainPool();
    process.exit(0);
  });
}