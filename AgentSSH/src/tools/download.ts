import { z } from 'zod';
import { sftpDownload } from '../ssh-client.js';

export const sshDownloadSchema = {
  host: z.string().min(1).describe('Hostname alias from ssh-hosts.json or ~/.ssh/config'),
  remote_path: z
    .string()
    .min(1)
    .describe('Absolute path of the file to download from the remote host, e.g. "/data/armic/calibration.json"'),
  encoding: z
    .enum(['utf8', 'base64'])
    .default('utf8')
    .describe('utf8 for text files, base64 for binaries. Default utf8'),
};

export async function handleSshDownload(args: {
  host: string;
  remote_path: string;
  encoding: 'utf8' | 'base64';
}) {
  if (args.remote_path.includes('..')) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: `ssh_download rejected: path "${args.remote_path}" contains ".."` }],
    };
  }
  if (!args.remote_path.startsWith('/') && !args.remote_path.startsWith('~')) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: `ssh_download rejected: path "${args.remote_path}" must be absolute or start with ~` }],
    };
  }

  try {
    const result = await sftpDownload(args.host, args.remote_path, args.encoding);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: 'text' as const, text: `ssh_download failed: ${message}` }],
    };
  }
}
