import { z } from 'zod';
import { exec } from '../ssh-client.js';

export const dockerManageSchema = {
  host: z.string().min(1).describe('Hostname alias from ssh-hosts.json or ~/.ssh/config'),
  action: z
    .enum(['ps', 'start', 'stop', 'restart', 'logs', 'compose_up', 'compose_down'])
    .describe(
      'Container lifecycle action:\n' +
      '• ps — list all containers with status\n' +
      '• start/stop/restart — manage a specific container\n' +
      '• logs — tail recent logs from a container\n' +
      '• compose_up/compose_down — docker compose lifecycle',
    ),
  container: z
    .string()
    .min(1)
    .optional()
    .describe('Container name (required for start/stop/restart/logs)'),
  compose_dir: z
    .string()
    .optional()
    .describe('Directory containing docker-compose.yml (required for compose_up/compose_down)'),
  tail_lines: z
    .number()
    .int()
    .min(10)
    .max(500)
    .default(100)
    .describe('Number of log lines to return for the "logs" action (default 100)'),
  timeout: z
    .number()
    .int()
    .min(5)
    .max(300)
    .default(60)
    .describe('Timeout in seconds (default 60)'),
};

export async function handleDockerManage(args: {
  host: string;
  action: 'ps' | 'start' | 'stop' | 'restart' | 'logs' | 'compose_up' | 'compose_down';
  container?: string;
  compose_dir?: string;
  tail_lines: number;
  timeout: number;
}) {
  let cmd: string;

  switch (args.action) {
    case 'ps':
      cmd = 'docker ps -a --format "table {{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}"';
      break;

    case 'start':
    case 'stop':
    case 'restart':
      if (!args.container) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `docker_manage: "container" is required for action "${args.action}"` }],
        };
      }
      cmd = `docker ${args.action} "${args.container}"`;
      break;

    case 'logs':
      if (!args.container) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `docker_manage: "container" is required for action "logs"` }],
        };
      }
      cmd = `docker logs --tail ${args.tail_lines} "${args.container}" 2>&1`;
      break;

    case 'compose_up':
      if (!args.compose_dir) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `docker_manage: "compose_dir" is required for action "compose_up"` }],
        };
      }
      cmd = `cd "${args.compose_dir}" && docker compose up -d 2>&1`;
      break;

    case 'compose_down':
      if (!args.compose_dir) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `docker_manage: "compose_dir" is required for action "compose_down"` }],
        };
      }
      cmd = `cd "${args.compose_dir}" && docker compose down 2>&1`;
      break;
  }

  try {
    const result = await exec(args.host, cmd, args.timeout);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          action: args.action,
          container: args.container ?? null,
          exit_code: result.exit_code,
          duration_ms: result.duration_ms,
          output: (result.stdout + result.stderr).trim(),
        }, null, 2),
      }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: 'text' as const, text: `docker_manage failed: ${message}` }],
    };
  }
}
