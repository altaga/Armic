import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, type ConnectConfig, type SFTPWrapper } from 'ssh2';
import { parse } from 'ssh-config';
import type { ExecResult, ResolvedHost, UploadResult, DownloadResult, DirEntry, DirListResult } from './types.js';
import { loadConfig } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── SSH Config Resolution ──────────────────────────────────────────

let cachedConfigText: string | null = null;

function readSshConfig(): string {
  if (cachedConfigText !== null) return cachedConfigText;
  const path = join(homedir(), '.ssh', 'config');
  if (!existsSync(path)) {
    cachedConfigText = '';
    return cachedConfigText;
  }
  cachedConfigText = readFileSync(path, 'utf8');
  return cachedConfigText;
}

function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

interface ProjectHost {
  HostName?: string;
  User?: string;
  Port?: number;
  IdentityFile?: string;
  Password?: string;
}

function loadProjectHosts(): Record<string, ProjectHost> {
  const projectPath = join(__dirname, '..', 'ssh-hosts.json');
  if (!existsSync(projectPath)) return {};
  try {
    const raw: unknown = JSON.parse(readFileSync(projectPath, 'utf8'));
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return raw as Record<string, ProjectHost>;
  } catch (err) {
    console.error('[claude-ssh] failed to parse ssh-hosts.json:', err);
    return {};
  }
}

export function resolveHost(alias: string): ResolvedHost {
  const projectHosts = loadProjectHosts();
  if (alias in projectHosts) {
    const ph = projectHosts[alias];
    if (!ph || typeof ph !== 'object') {
      throw new Error(`Host "${alias}" in ssh-hosts.json is malformed`);
    }
    return {
      host: alias,
      hostname: ph.HostName ?? alias,
      port: typeof ph.Port === 'number' ? ph.Port : 22,
      username: ph.User ?? process.env.USER ?? process.env.USERNAME ?? 'root',
      identityFile: ph.IdentityFile ? expandHome(ph.IdentityFile) : null,
      password: typeof ph.Password === 'string' ? ph.Password : null,
    };
  }

  const text = readSshConfig();
  if (!text) {
    throw new Error(
      `Host "${alias}" not found: neither ssh-hosts.json (in the project root) nor ~/.ssh/config has an entry for it.`,
    );
  }
  const parsed = parse(text);
  const computed = parsed.compute(alias);

  const hostname = (computed.HostName as string | undefined) ?? alias;
  const portRaw = computed.Port;
  const port = typeof portRaw === 'number' ? portRaw : typeof portRaw === 'string' ? parseInt(portRaw, 10) : 22;
  const username = (computed.User as string | undefined) ?? process.env.USER ?? process.env.USERNAME ?? 'root';

  const identityFiles = (computed.IdentityFile as string[] | string | undefined) ?? [];
  const firstId = Array.isArray(identityFiles) ? identityFiles[0] : identityFiles;
  const identityFile = typeof firstId === 'string' ? expandHome(firstId) : null;

  return { host: alias, hostname, port, username, identityFile, password: null };
}

function buildConnectConfig(host: ResolvedHost): ConnectConfig {
  const cfg: ConnectConfig = {
    host: host.hostname,
    port: host.port,
    username: host.username,
    readyTimeout: 15_000,
  };

  if (host.identityFile) {
    if (existsSync(host.identityFile)) {
      cfg.privateKey = readFileSync(host.identityFile);
    } else {
      throw new Error(
        `IdentityFile "${host.identityFile}" for host "${host.host}" does not exist. ` +
        `Check the path or add the key to ssh-agent (ssh-add ${host.identityFile}).`,
      );
    }
  }

  if (host.password) {
    cfg.password = host.password;
  }

  return cfg;
}

// ── Connection Pool ────────────────────────────────────────────────

interface PooledConnection {
  client: Client;
  host: ResolvedHost;
  lastUsed: number;
  idleTimer: ReturnType<typeof setTimeout>;
  ready: boolean;
}

const pool = new Map<string, PooledConnection>();

function poolKey(host: ResolvedHost): string {
  return `${host.username}@${host.hostname}:${host.port}`;
}

function evictFromPool(key: string): void {
  const entry = pool.get(key);
  if (entry) {
    clearTimeout(entry.idleTimer);
    try { entry.client.end(); } catch { /* ignore */ }
    pool.delete(key);
  }
}

function resetIdleTimer(key: string, entry: PooledConnection): void {
  clearTimeout(entry.idleTimer);
  const cfg = loadConfig();
  entry.idleTimer = setTimeout(() => evictFromPool(key), cfg.pool_idle_timeout_ms);
  entry.lastUsed = Date.now();
}

async function getConnection(hostAlias: string): Promise<{ client: Client; host: ResolvedHost }> {
  const host = resolveHost(hostAlias);
  const key = poolKey(host);

  const existing = pool.get(key);
  if (existing && existing.ready) {
    resetIdleTimer(key, existing);
    return { client: existing.client, host };
  }

  // Evict stale entry if it exists
  if (existing) {
    evictFromPool(key);
  }

  // Enforce max pool size — evict oldest
  const cfg = loadConfig();
  if (pool.size >= cfg.pool_max_connections) {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [k, v] of pool) {
      if (v.lastUsed < oldestTime) {
        oldestTime = v.lastUsed;
        oldestKey = k;
      }
    }
    if (oldestKey) evictFromPool(oldestKey);
  }

  const connect = buildConnectConfig(host);

  return new Promise((resolve, reject) => {
    const client = new Client();

    client.on('error', (err) => {
      evictFromPool(key);
      reject(new Error(`SSH connection to "${hostAlias}" failed: ${err.message}`));
    });

    client.on('end', () => {
      const entry = pool.get(key);
      if (entry && entry.client === client) {
        entry.ready = false;
        evictFromPool(key);
      }
    });

    client.on('close', () => {
      const entry = pool.get(key);
      if (entry && entry.client === client) {
        entry.ready = false;
        evictFromPool(key);
      }
    });

    client.on('ready', () => {
      const entry: PooledConnection = {
        client,
        host,
        lastUsed: Date.now(),
        idleTimer: setTimeout(() => evictFromPool(key), cfg.pool_idle_timeout_ms),
        ready: true,
      };
      pool.set(key, entry);
      resolve({ client, host });
    });

    client.connect(connect);
  });
}

/**
 * Drain all pooled connections. Call on process exit.
 */
export function drainPool(): void {
  for (const key of [...pool.keys()]) {
    evictFromPool(key);
  }
}

// ── Truncation Helper ──────────────────────────────────────────────

function truncate(s: string, cap: number): { text: string; dropped: number } {
  if (s.length <= cap) return { text: s, dropped: 0 };
  const dropped = s.length - cap;
  return { text: s.slice(0, cap) + `\n[truncated, ${dropped} bytes omitted]`, dropped };
}

// ── exec ───────────────────────────────────────────────────────────

export async function exec(
  hostAlias: string,
  command: string,
  timeoutSeconds?: number,
): Promise<ExecResult> {
  const cfg = loadConfig();
  const timeoutMs = Math.max(
    1000,
    Math.min(cfg.max_timeout_seconds, timeoutSeconds ?? cfg.default_timeout_seconds) * 1000,
  );

  const { client } = await getConnection(hostAlias);
  const start = Date.now();

  return new Promise<ExecResult>((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`Command on "${hostAlias}" timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    client.exec(command, (err, stream) => {
      if (err) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(`exec failed on "${hostAlias}": ${err.message}`));
        return;
      }

      let stdout = '';
      let stderr = '';

      stream.on('close', (code: number | null, signal: string | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        const stdOutTrunc = truncate(stdout, cfg.max_output_bytes);
        const stdErrTrunc = truncate(stderr, cfg.max_output_bytes);

        resolve({
          stdout: stdOutTrunc.text,
          stderr: stdErrTrunc.text,
          exit_code: code,
          signal: signal ?? null,
          duration_ms: Date.now() - start,
          truncated: { stdout: stdOutTrunc.dropped, stderr: stdErrTrunc.dropped },
        });
      });

      stream.on('data', (data: Buffer) => {
        stdout += data.toString('utf8');
      });
      stream.stderr.on('data', (data: Buffer) => {
        stderr += data.toString('utf8');
      });
    });
  });
}

// ── SFTP Upload ────────────────────────────────────────────────────

export async function sftpUpload(
  hostAlias: string,
  contents: string,
  remotePath: string,
  permissionsOctal: string | undefined,
): Promise<UploadResult> {
  const { client } = await getConnection(hostAlias);

  const mode = parseMode(permissionsOctal);
  const buffer = Buffer.from(contents, 'utf8');
  const bytes = buffer.length;

  return new Promise<UploadResult>((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) {
        reject(new Error(`SFTP subsystem failed on "${hostAlias}": ${err.message}`));
        return;
      }

      const ws = sftp.createWriteStream(remotePath, { mode });
      ws.on('error', (e: Error) => {
        sftp.end();
        reject(new Error(`SFTP write to ${remotePath} on "${hostAlias}" failed: ${e.message}`));
      });
      ws.on('close', () => {
        sftp.end();
        resolve({ success: true, path: remotePath, bytes_written: bytes, error: null });
      });
      ws.end(buffer);
    });
  });
}

// ── SFTP Download ──────────────────────────────────────────────────

export async function sftpDownload(
  hostAlias: string,
  remotePath: string,
  encoding: 'utf8' | 'base64' = 'utf8',
): Promise<DownloadResult> {
  const cfg = loadConfig();
  const { client } = await getConnection(hostAlias);

  return new Promise<DownloadResult>((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) {
        reject(new Error(`SFTP subsystem failed on "${hostAlias}": ${err.message}`));
        return;
      }

      // Stat first to check size
      sftp.stat(remotePath, (statErr, stats) => {
        if (statErr) {
          sftp.end();
          reject(new Error(`SFTP stat "${remotePath}" on "${hostAlias}" failed: ${statErr.message}`));
          return;
        }

        if (stats.size > cfg.download_max_bytes) {
          sftp.end();
          reject(
            new Error(
              `File "${remotePath}" is ${stats.size} bytes, exceeds download_max_bytes limit of ${cfg.download_max_bytes}. ` +
              `Increase limit in ~/.claude-ssh.json if needed.`,
            ),
          );
          return;
        }

        const chunks: Buffer[] = [];
        const rs = sftp.createReadStream(remotePath);

        rs.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });

        rs.on('error', (e: Error) => {
          sftp.end();
          reject(new Error(`SFTP read "${remotePath}" on "${hostAlias}" failed: ${e.message}`));
        });

        rs.on('end', () => {
          sftp.end();
          const full = Buffer.concat(chunks);
          resolve({
            success: true,
            path: remotePath,
            bytes_read: full.length,
            content: encoding === 'base64' ? full.toString('base64') : full.toString('utf8'),
            encoding,
            error: null,
          });
        });
      });
    });
  });
}

// ── SFTP Readdir ───────────────────────────────────────────────────

export async function sftpReaddir(
  hostAlias: string,
  remotePath: string,
): Promise<DirListResult> {
  const { client } = await getConnection(hostAlias);

  return new Promise<DirListResult>((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) {
        reject(new Error(`SFTP subsystem failed on "${hostAlias}": ${err.message}`));
        return;
      }

      sftp.readdir(remotePath, (rdErr, list) => {
        sftp.end();
        if (rdErr) {
          reject(new Error(`SFTP readdir "${remotePath}" on "${hostAlias}" failed: ${rdErr.message}`));
          return;
        }

        const entries: DirEntry[] = list.map((item) => {
          let type: DirEntry['type'] = 'other';
          if (item.attrs.isDirectory()) type = 'directory';
          else if (item.attrs.isFile()) type = 'file';
          else if (item.attrs.isSymbolicLink()) type = 'symlink';

          return {
            name: item.filename,
            type,
            size: item.attrs.size,
            modified: new Date((item.attrs.mtime ?? 0) * 1000).toISOString(),
          };
        });

        // Sort: directories first, then alphabetical
        entries.sort((a, b) => {
          if (a.type === 'directory' && b.type !== 'directory') return -1;
          if (a.type !== 'directory' && b.type === 'directory') return 1;
          return a.name.localeCompare(b.name);
        });

        resolve({ path: remotePath, entries, error: null });
      });
    });
  });
}

// ── Helpers ────────────────────────────────────────────────────────

function parseMode(s: string | undefined): number {
  if (!s) return 0o644;
  const parsed = parseInt(s, 8);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 0o7777) {
    throw new Error(`Invalid permissions "${s}" — expected octal like "0644"`);
  }
  return parsed;
}