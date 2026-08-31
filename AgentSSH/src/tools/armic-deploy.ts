import { z } from 'zod';
import { exec, sftpUpload } from '../ssh-client.js';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, posix } from 'node:path';

export const armicDeployBundleSchema = {
  host: z.string().min(1).describe('Host alias of the board / SSH target'),
  local_armic_repo: z
    .string()
    .min(1)
    .describe(
      'Absolute path to the local ARMIC repo whose AI Skills bundle to deploy, e.g. "C:/Users/VAI/Github/Armic". The AI Skills/ folder will be uploaded recursively.',
    ),
  remote_target_dir: z
    .string()
    .startsWith('/')
    .describe('Absolute path on the remote host where AI Skills bundle gets written, e.g. "/data/armic/AI Skills" or "~/armic-bundle/AI Skills"'),
  deploy_calibration_ssot: z
    .enum(['never', 'only_if_missing'])
    .default('never')
    .describe(
      'never = do NOT touch calibration.json. only_if_missing = upload the repo copy ONLY if remote /data/armic/calibration.json is absent. NEVER overwrite an existing calibration SSoT.',
    ),
};

function* walk(dir: string, root = dir): Generator<string> {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full, root);
    else if (e.isFile()) yield full;
  }
}

export async function handleArmicDeployBundle(args: {
  host: string;
  local_armic_repo: string;
  remote_target_dir: string;
  deploy_calibration_ssot: 'never' | 'only_if_missing';
}) {
  const localRepo = args.local_armic_repo.replace(/\\/g, '/');
  const localBundle = join(localRepo, 'AI Skills');
  if (!existsSync(localBundle) || !statSync(localBundle).isDirectory()) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: `armic_deploy_bundle failed: AI Skills/ not found under ${localRepo}` }],
    };
  }

  const mkdirCmd = `mkdir -p '${args.remote_target_dir}' && ls -la '${args.remote_target_dir}'`;
  try {
    await exec(args.host, mkdirCmd, 60);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { isError: true, content: [{ type: 'text' as const, text: `mkdir on remote failed: ${msg}` }] };
  }

  const files = Array.from(walk(localBundle, localBundle));
  const uploads: Array<{ path: string; bytes: number; ok: boolean; err?: string }> = [];

  for (const abs of files) {
    const rel = relative(localBundle, abs).split('\\').join('/');
    const remote = posix.join(args.remote_target_dir, rel);
    try {
      const parentDir = posix.dirname(remote);
      if (parentDir !== args.remote_target_dir) {
        await exec(args.host, `mkdir -p '${parentDir}'`, 30);
      }
      const contents = readFileSync(abs, 'utf8');
      const r = await sftpUpload(args.host, contents, remote, '0644');
      uploads.push({ path: rel, bytes: r.bytes_written, ok: r.success });
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      uploads.push({ path: rel, bytes: 0, ok: false, err: m });
    }
  }

  let calibNote = '';
  if (args.deploy_calibration_ssot === 'only_if_missing') {
    const localCalib = join(localRepo, 'Arduino Files', 'armic-brick', 'calibration.json');
    const remoteCalib = '/data/armic/calibration.json';
    try {
      const check = await exec(args.host, `if [ -f '${remoteCalib}' ]; then echo EXISTS; else echo MISSING; fi`, 15);
      if (check.stdout.trim() === 'MISSING' && existsSync(localCalib)) {
        const calibContent = readFileSync(localCalib, 'utf8');
        await sftpUpload(args.host, calibContent, remoteCalib, '0600');
        calibNote = `\ncalibration.json: uploaded (was missing on remote → ${remoteCalib}).`;
      } else if (check.stdout.trim() === 'EXISTS') {
        calibNote = '\ncalibration.json: SKIPPED (SSoT already present on remote — never overwrite).';
      } else {
        calibNote = '\ncalibration.json: SKIPPED (local copy missing in repo Arduino Files/armic-brick/).';
      }
    } catch (e) {
      calibNote = `\ncalibration.json step error: ${e instanceof Error ? e.message : String(e)}`;
    }
  } else {
    calibNote = '\ncalibration.json: untouched (deploy_calibration_ssot = never).';
  }

  const okCount = uploads.filter((u) => u.ok).length;
  return {
    content: [
      {
        type: 'text' as const,
        text:
          `armic_deploy_bundle "${args.host}": ${okCount}/${uploads.length} files ok → ${args.remote_target_dir}` +
          calibNote +
          '\n\n' +
          JSON.stringify(uploads, null, 2),
      },
    ],
  };
}
