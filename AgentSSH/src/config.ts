import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface AppConfig {
  max_output_bytes: number;
  default_timeout_seconds: number;
  max_timeout_seconds: number;
  pool_idle_timeout_ms: number;
  pool_max_connections: number;
  download_max_bytes: number;
}

const DEFAULTS: AppConfig = {
  max_output_bytes: 50 * 1024,
  default_timeout_seconds: 30,
  max_timeout_seconds: 300,
  pool_idle_timeout_ms: 60_000,
  pool_max_connections: 5,
  download_max_bytes: 5 * 1024 * 1024,
};

let cached: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (cached) return cached;

  const path = join(homedir(), '.claude-ssh.json');
  if (!existsSync(path)) {
    cached = { ...DEFAULTS };
    return cached;
  }

  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<AppConfig>;
    cached = {
      max_output_bytes: clampInt(raw.max_output_bytes, DEFAULTS.max_output_bytes, 1024, 10 * 1024 * 1024),
      default_timeout_seconds: clampInt(raw.default_timeout_seconds, DEFAULTS.default_timeout_seconds, 1, 3600),
      max_timeout_seconds: clampInt(raw.max_timeout_seconds, DEFAULTS.max_timeout_seconds, 1, 3600),
      pool_idle_timeout_ms: clampInt(raw.pool_idle_timeout_ms, DEFAULTS.pool_idle_timeout_ms, 5_000, 300_000),
      pool_max_connections: clampInt(raw.pool_max_connections, DEFAULTS.pool_max_connections, 1, 20),
      download_max_bytes: clampInt(raw.download_max_bytes, DEFAULTS.download_max_bytes, 1024, 50 * 1024 * 1024),
    };
    return cached;
  } catch (err) {
    console.error(`[claude-ssh] failed to parse ${path}, using defaults:`, err);
    cached = { ...DEFAULTS };
    return cached;
  }
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}