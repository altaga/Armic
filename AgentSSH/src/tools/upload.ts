import { z } from 'zod';
import { sftpUpload } from '../ssh-client.js';

export const sshUploadSchema = {
  host: z.string().min(1).describe('Hostname alias from ~/.ssh/config'),
  contents: z.string().describe('String contents to write to the file'),
  path: z
    .string()
    .min(1)
    .describe('Absolute remote path, e.g. "/etc/config/network"'),
  permissions: z
    .string()
    .regex(/^0?[0-7]{3,4}$/, 'must be octal like "0644"')
    .optional()
    .describe('File mode in octal, default 0644'),
};

export async function handleSshUpload(args: {
  host: string;
  contents: string;
  path: string;
  permissions?: string;
}) {
  if (args.path.includes('..')) {
    return {
      isError: true,
      content: [
        { type: 'text' as const, text: `ssh_upload rejected: path "${args.path}" contains ".."` },
      ],
    };
  }
  if (!args.path.startsWith('/')) {
    return {
      isError: true,
      content: [
        { type: 'text' as const, text: `ssh_upload rejected: path "${args.path}" must be absolute` },
      ],
    };
  }

  try {
    const result = await sftpUpload(args.host, args.contents, args.path, args.permissions);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: 'text' as const, text: `ssh_upload failed: ${message}` }],
    };
  }
}