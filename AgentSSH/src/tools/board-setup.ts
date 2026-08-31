import { z } from 'zod';
import { exec } from '../ssh-client.js';

export const boardSetupSchema = {
  host: z.string().min(1).describe('Host alias for the SSH-reachable Arduino board host (see ssh-hosts.json / ~/.ssh/config)'),
  board_family: z
    .enum(['uno-q', 'generic'])
    .describe(
      'uno-q = Arduino UNO Q dual-brain SoC with App Lab containers (brick compose). generic = any Linux SSH host with arduino-cli / apt.',
    ),
  timeout: z.number().int().min(1).max(600).optional().describe('Per-step timeout in seconds (default 120, max 600)'),
};

export async function handleBoardSetup(args: {
  host: string;
  board_family: 'uno-q' | 'generic';
  timeout?: number;
}) {
  const t = args.timeout ?? 120;
  const steps: Array<{ name: string; cmd: string }> = [];

  if (args.board_family === 'uno-q') {
    steps.push(
      { name: 'Sanity — uname + brick CLI present', cmd: 'uname -a && (brick --version || (which docker && docker --version) || echo no_brick_found)' },
      { name: 'Verify App Lab python container reachable', cmd: 'brick compose ps 2>/dev/null || (which docker >/dev/null 2>&1 && docker ps --format "table {{.Names}}\\t{{.Status}}")' },
      { name: 'Create ARMIC shared workdir if missing', cmd: 'mkdir -p /data/armic && ls -la /data/armic' },
      { name: 'Python3 + pip + venv sanity', cmd: 'python3 --version && (python3 -m pip --version || echo pip_missing) && (python3 -m venv --help >/dev/null 2>&1 || echo venv_missing)' },
      { name: 'Install mosquitto-clients (MQTT envelope testing) if apt exists', cmd: 'if command -v apt-get >/dev/null 2>&1; then sudo apt-get update -y && sudo apt-get install -y mosquitto-clients curl wget ca-certificates; else echo "no_apt_skip"; fi' },
      { name: 'List calibration SSoT path if present', cmd: 'ls -la /data/armic/calibration.json 2>/dev/null || echo calibration_not_yet_present' },
    );
  } else {
    steps.push(
      { name: 'Sanity — OS + arch', cmd: 'uname -a' },
      { name: 'Ensure base utilities', cmd: 'if command -v apt-get >/dev/null 2>&1; then sudo apt-get update -y && sudo apt-get install -y curl wget ca-certificates python3 python3-pip python3-venv; elif command -v apk >/dev/null 2>&1; then sudo apk add curl wget ca-certificates python3 py3-pip; else echo no_pkg_manager_detected; fi' },
      { name: 'Install arduino-cli if missing (curl official installer)', cmd: 'if ! command -v arduino-cli >/dev/null 2>&1; then curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | sh; fi && arduino-cli version' },
      { name: 'arduino-cli core install for common cores', cmd: 'arduino-cli core install arduino:avr arduino:mbed_nano arduino:esp32 || true' },
    );
  }

  const results: Array<{ step: string; ok: boolean; out: string; err?: string }> = [];
  for (const s of steps) {
    try {
      const r = await exec(args.host, s.cmd, t);
      results.push({ step: s.name, ok: (r.exit_code ?? 0) === 0, out: (r.stdout + r.stderr).trim().slice(0, 4000) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ step: s.name, ok: false, out: '', err: msg });
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  const header = `board_setup [${args.board_family}] on "${args.host}" → ${okCount}/${results.length} steps ok\n`;
  return {
    content: [{ type: 'text' as const, text: header + JSON.stringify(results, null, 2) }],
  };
}
