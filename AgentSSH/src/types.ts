export interface ExecResult {
  stdout: string;
  stderr: string;
  exit_code: number | null;
  signal: string | null;
  duration_ms: number;
  truncated: { stdout: number; stderr: number };
}

export interface ExecManyEntry {
  host: string;
  stdout: string;
  stderr: string;
  exit_code: number | null;
  signal: string | null;
  duration_ms: number;
  error: string | null;
}

export interface UploadResult {
  success: boolean;
  path: string;
  bytes_written: number;
  error: string | null;
}

export interface ResolvedHost {
  host: string;
  hostname: string;
  port: number;
  username: string;
  identityFile: string | null;
  password: string | null;
}

// ── New types for v0.3.0 ──────────────────────────────────────────

export interface DownloadResult {
  success: boolean;
  path: string;
  bytes_read: number;
  content: string;
  encoding: 'utf8' | 'base64';
  error: string | null;
}

export interface DirEntry {
  name: string;
  type: 'file' | 'directory' | 'symlink' | 'other';
  size: number;
  modified: string; // ISO 8601
}

export interface DirListResult {
  path: string;
  entries: DirEntry[];
  error: string | null;
}

export interface DockerContainer {
  name: string;
  status: string;
  ports: string;
  image: string;
}

export interface MqttResult {
  success: boolean;
  topic: string;
  payload: string;
  error: string | null;
}

export interface SerialPortInfo {
  path: string;
  description: string;
}

export interface ArduinoBoardInfo {
  fqbn: string;
  port: string;
  name: string;
}

export interface SystemInfoResult {
  kernel: string;
  uptime: string;
  disk: string;
  memory: string;
  cpu_temp: string | null;
  network: string;
  docker_containers: string;
  serial_ports: string[];
  arduino_cli_version: string | null;
}