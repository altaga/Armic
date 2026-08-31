import { z } from 'zod';
import { exec } from '../ssh-client.js';

export const sshLogTailSchema = {
  host: z.string().min(1).describe('Hostname alias from ssh-hosts.json or ~/.ssh/config'),
  source: z
    .string()
    .min(1)
    .describe(
      'Log source. Can be:\n' +
      '• A file path: "/var/log/syslog"\n' +
      '• A journalctl unit: "journalctl:pipewire"\n' +
      '• A docker container: "docker:armic-mosquitto"',
    ),
  lines: z
    .number()
    .int()
    .min(1)
    .max(500)
    .default(50)
    .describe('Number of lines to tail (default 50, max 500)'),
  timeout: z
    .number()
    .int()
    .min(5)
    .max(60)
    .default(15)
    .describe('Timeout in seconds (default 15)'),
};

function buildTailCommand(source: string, lines: number): string {
  if (source.startsWith('docker:')) {
    const container = source.slice('docker:'.length).trim();
    return `docker logs --tail ${lines} "${container}" 2>&1`;
  }

  if (source.startsWith('journalctl:')) {
    const unit = source.slice('journalctl:'.length).trim();
    return `journalctl --user -u "${unit}" -n ${lines} --no-pager 2>&1 || journalctl -u "${unit}" -n ${lines} --no-pager 2>&1`;
  }

  // File path
  return `tail -n ${lines} "${source}" 2>&1`;
}

export async function handleSshLogTail(args: {
  host: string;
  source: string;
  lines: number;
  timeout: number;
}) {
  const cmd = buildTailCommand(args.source, args.lines);

  try {
    const result = await exec(args.host, cmd, args.timeout);
    const output = (result.stdout + (result.stderr ? `\n[stderr] ${result.stderr}` : '')).trim();
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          source: args.source,
          lines_requested: args.lines,
          exit_code: result.exit_code,
          duration_ms: result.duration_ms,
          output,
        }, null, 2),
      }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: 'text' as const, text: `ssh_log_tail failed: ${message}` }],
    };
  }
}
