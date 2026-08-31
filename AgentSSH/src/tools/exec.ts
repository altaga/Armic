import { z } from 'zod';
import { exec } from '../ssh-client.js';

export const sshExecSchema = {
  host: z.string().min(1).describe('Hostname alias from ~/.ssh/config'),
  command: z.string().min(1).describe('Shell command to execute on the remote host'),
  timeout: z
    .number()
    .int()
    .min(1)
    .max(300)
    .optional()
    .describe('Timeout in seconds (default 30, max 300)'),
};

export async function handleSshExec(args: {
  host: string;
  command: string;
  timeout?: number;
}) {
  try {
    const result = await exec(args.host, args.command, args.timeout);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: 'text' as const, text: `ssh_exec failed: ${message}` }],
    };
  }
}