import { z } from 'zod';
import { sftpReaddir } from '../ssh-client.js';
import type { DirEntry } from '../types.js';

export const sshLsSchema = {
  host: z.string().min(1).describe('Hostname alias from ssh-hosts.json or ~/.ssh/config'),
  path: z
    .string()
    .min(1)
    .describe('Absolute path of the directory to list on the remote host'),
  recursive: z
    .boolean()
    .default(false)
    .describe('If true, list subdirectories recursively up to max_depth'),
  max_depth: z
    .number()
    .int()
    .min(1)
    .max(5)
    .default(2)
    .describe('Maximum recursion depth when recursive=true (default 2, max 5)'),
};

interface TreeEntry extends DirEntry {
  children?: TreeEntry[];
}

async function listRecursive(
  host: string,
  basePath: string,
  currentDepth: number,
  maxDepth: number,
): Promise<TreeEntry[]> {
  const result = await sftpReaddir(host, basePath);
  const out: TreeEntry[] = [];

  for (const entry of result.entries) {
    const childPath = basePath.endsWith('/') ? basePath + entry.name : basePath + '/' + entry.name;
    if (entry.type === 'directory' && currentDepth < maxDepth) {
      try {
        const children = await listRecursive(host, childPath, currentDepth + 1, maxDepth);
        out.push({ ...entry, children });
      } catch {
        // Permission denied or broken symlink — include the directory entry without children
        out.push({ ...entry, children: [] });
      }
    } else {
      out.push(entry);
    }
  }

  return out;
}

export async function handleSshLs(args: {
  host: string;
  path: string;
  recursive: boolean;
  max_depth: number;
}) {
  if (!args.path.startsWith('/') && !args.path.startsWith('~')) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: `ssh_ls rejected: path "${args.path}" must be absolute or start with ~` }],
    };
  }

  try {
    if (args.recursive) {
      const tree = await listRecursive(args.host, args.path, 1, args.max_depth);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ path: args.path, entries: tree }, null, 2) }],
      };
    }

    const result = await sftpReaddir(args.host, args.path);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: 'text' as const, text: `ssh_ls failed: ${message}` }],
    };
  }
}
