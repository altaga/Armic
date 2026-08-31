import { z } from 'zod';
import { exec } from '../ssh-client.js';

export const systemInfoSchema = {
  host: z.string().min(1).describe('Hostname alias from ssh-hosts.json or ~/.ssh/config'),
  timeout: z.number().int().min(10).max(60).default(30).describe('Timeout in seconds (default 30)'),
};

export async function handleSystemInfo(args: {
  host: string;
  timeout: number;
}) {
  // Single compound command — one SSH round-trip for everything
  const cmd = [
    'echo "===KERNEL==="',
    'uname -a',
    'echo "===UPTIME==="',
    'uptime',
    'echo "===DISK==="',
    'df -h 2>/dev/null | head -15',
    'echo "===MEMORY==="',
    'free -h 2>/dev/null || cat /proc/meminfo 2>/dev/null | head -10',
    'echo "===CPU_TEMP==="',
    'cat /sys/class/thermal/thermal_zone*/temp 2>/dev/null | head -5 || echo "unavailable"',
    'echo "===NETWORK==="',
    'ip -br addr 2>/dev/null || ifconfig 2>/dev/null | head -30',
    'echo "===DOCKER==="',
    'docker ps -a --format "table {{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}" 2>/dev/null || echo "docker not available"',
    'echo "===SERIAL==="',
    'ls -la /dev/ttyACM* /dev/ttyUSB* /dev/ttyHS* /dev/ttyAMA* 2>/dev/null || echo "none"',
    'echo "===ARDUINO_CLI==="',
    'arduino-cli version 2>/dev/null || echo "not installed"',
    'echo "===END==="',
  ].join(' && ');

  try {
    const result = await exec(args.host, cmd, args.timeout);
    const raw = result.stdout;

    // Parse each section
    const sections: Record<string, string> = {};
    const sectionNames = ['KERNEL', 'UPTIME', 'DISK', 'MEMORY', 'CPU_TEMP', 'NETWORK', 'DOCKER', 'SERIAL', 'ARDUINO_CLI'];

    for (let i = 0; i < sectionNames.length; i++) {
      const name = sectionNames[i]!;
      const start = raw.indexOf(`===${name}===`);
      const nextName = sectionNames[i + 1];
      const end = nextName ? raw.indexOf(`===${nextName}===`) : raw.indexOf('===END===');

      if (start !== -1 && end !== -1) {
        sections[name] = raw.slice(start + name.length + 6, end).trim();
      } else if (start !== -1) {
        sections[name] = raw.slice(start + name.length + 6).trim();
      }
    }

    // Parse CPU temp if available (millidegrees → °C)
    let cpuTemp: string | null = null;
    const tempRaw = sections['CPU_TEMP'] ?? '';
    if (tempRaw && tempRaw !== 'unavailable') {
      const temps = tempRaw
        .split('\n')
        .map((l) => parseInt(l.trim(), 10))
        .filter((n) => Number.isFinite(n))
        .map((n) => `${(n / 1000).toFixed(1)}°C`);
      cpuTemp = temps.length > 0 ? temps.join(', ') : null;
    }

    // Parse serial ports
    const serialRaw = sections['SERIAL'] ?? '';
    const serialPorts = serialRaw === 'none'
      ? []
      : serialRaw.split('\n').filter((l) => l.includes('/dev/tty')).map((l) => {
          const parts = l.trim().split(/\s+/);
          return parts[parts.length - 1] ?? l.trim();
        });

    const dashboard = {
      kernel: sections['KERNEL'] ?? 'unknown',
      uptime: sections['UPTIME'] ?? 'unknown',
      disk: sections['DISK'] ?? 'unknown',
      memory: sections['MEMORY'] ?? 'unknown',
      cpu_temp: cpuTemp,
      network: sections['NETWORK'] ?? 'unknown',
      docker_containers: sections['DOCKER'] ?? 'unavailable',
      serial_ports: serialPorts,
      arduino_cli_version: sections['ARDUINO_CLI'] === 'not installed' ? null : (sections['ARDUINO_CLI'] ?? null),
      duration_ms: result.duration_ms,
    };

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(dashboard, null, 2) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: 'text' as const, text: `system_info failed: ${message}` }],
    };
  }
}
