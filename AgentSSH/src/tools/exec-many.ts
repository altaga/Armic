import { z } from 'zod';
import { exec } from '../ssh-client.js';
import type { ExecManyEntry } from '../types.js';

export const sshExecManySchema = {
  hosts: z
    .array(z.string().min(1))
    .min(1)
    .max(50)
    .describe('Array of hostname aliases from ~/.ssh/config'),
  command: z.string().min(1).describe('Shell command to execute on every host'),
  timeout: z
    .number()
    .int()
    .min(1)
    .max(300)
    .optional()
    .describe('Per-host timeout in seconds (default 30, max 300)'),
};

export async function handleSshExecMany(args: {
  hosts: string[];
  command: string;
  timeout?: number;
}) {
  const settled = await Promise.allSettled(
    args.hosts.map(async (hostAlias): Promise<ExecManyEntry> => {
      const result = await exec(hostAlias, args.command, args.timeout);
      return {
        host: hostAlias,
        stdout: result.stdout,
        stderr: result.stderr,
        exit_code: result.exit_code,
        signal: result.signal,
        duration_ms: result.duration_ms,
        error: null,
      };
    }),
  );

  const out: ExecManyEntry[] = settled.map((s, i) => {
    const hostAlias = args.hosts[i] ?? '<unknown>';
    if (s.status === 'fulfilled') return s.value;
    const reason = s.reason instanceof Error ? s.reason.message : String(s.reason);
    return {
      host: hostAlias,
      stdout: '',
      stderr: '',
      exit_code: null,
      signal: null,
      duration_ms: 0,
      error: reason,
    };
  });

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(out, null, 2) }],
  };
}