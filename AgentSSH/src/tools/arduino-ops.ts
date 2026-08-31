import { z } from 'zod';
import { exec } from '../ssh-client.js';

// ── arduino_list_boards ────────────────────────────────────────────

export const arduinoListBoardsSchema = {
  host: z.string().min(1).describe('Hostname alias from ssh-hosts.json or ~/.ssh/config'),
  timeout: z.number().int().min(5).max(60).default(30).describe('Timeout in seconds (default 30)'),
};

export async function handleArduinoListBoards(args: {
  host: string;
  timeout: number;
}) {
  const cmd = [
    'echo "=== ARDUINO-CLI VERSION ==="',
    'arduino-cli version 2>/dev/null || echo "arduino-cli not installed"',
    'echo "=== BOARDS ==="',
    'arduino-cli board list --format json 2>/dev/null || echo "[]"',
    'echo "=== SERIAL PORTS ==="',
    'ls -la /dev/ttyACM* /dev/ttyUSB* /dev/ttyHS* /dev/ttyAMA* 2>/dev/null || echo "no serial ports found"',
    'echo "=== INSTALLED CORES ==="',
    'arduino-cli core list --format json 2>/dev/null || echo "[]"',
  ].join(' && ');

  try {
    const result = await exec(args.host, cmd, args.timeout);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          exit_code: result.exit_code,
          duration_ms: result.duration_ms,
          output: result.stdout.trim(),
          errors: result.stderr.trim() || null,
        }, null, 2),
      }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: 'text' as const, text: `arduino_list_boards failed: ${message}` }],
    };
  }
}

// ── arduino_compile_upload ─────────────────────────────────────────

export const arduinoCompileUploadSchema = {
  host: z.string().min(1).describe('Hostname alias from ssh-hosts.json or ~/.ssh/config'),
  sketch_path: z
    .string()
    .min(1)
    .describe('Absolute path to the sketch directory on the remote host, e.g. "/home/arduino/ArduinoApps/armic/sketch"'),
  fqbn: z
    .string()
    .min(1)
    .describe('Fully Qualified Board Name, e.g. "arduino:mbed_nano:stm32u585xx" or "arduino:avr:uno" or "esp32:esp32:m5stack_core2"'),
  port: z
    .string()
    .optional()
    .describe('Serial port for upload, e.g. "/dev/ttyACM0". Required if upload=true'),
  upload: z
    .boolean()
    .default(false)
    .describe('If true, upload the compiled binary to the board after compiling. Default false (compile only)'),
  build_flags: z
    .string()
    .optional()
    .describe('Additional build flags, e.g. "-DARMIC_DRY_RUN -DDEBUG_LEVEL=2"'),
  timeout: z
    .number()
    .int()
    .min(30)
    .max(600)
    .default(120)
    .describe('Timeout in seconds (default 120, max 600 — compilation can be slow on SBCs)'),
};

export async function handleArduinoCompileUpload(args: {
  host: string;
  sketch_path: string;
  fqbn: string;
  port?: string;
  upload: boolean;
  build_flags?: string;
  timeout: number;
}) {
  if (args.upload && !args.port) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: `arduino_compile_upload: "port" is required when upload=true. Run arduino_list_boards first to discover available ports.` }],
    };
  }

  const parts: string[] = [];

  // Compile step
  let compileCmd = `arduino-cli compile --fqbn "${args.fqbn}" "${args.sketch_path}" --format json`;
  if (args.build_flags) {
    compileCmd += ` --build-property "build.extra_flags=${args.build_flags}"`;
  }
  parts.push(`echo "=== COMPILE ===" && ${compileCmd}`);

  // Upload step (conditional)
  if (args.upload && args.port) {
    parts.push(`echo "=== UPLOAD ===" && arduino-cli upload -p "${args.port}" --fqbn "${args.fqbn}" "${args.sketch_path}" 2>&1`);
  }

  const cmd = parts.join(' && ');

  try {
    const result = await exec(args.host, cmd, args.timeout);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          sketch_path: args.sketch_path,
          fqbn: args.fqbn,
          port: args.port ?? null,
          upload: args.upload,
          exit_code: result.exit_code,
          duration_ms: result.duration_ms,
          output: result.stdout.trim(),
          errors: result.stderr.trim() || null,
        }, null, 2),
      }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: 'text' as const, text: `arduino_compile_upload failed: ${message}` }],
    };
  }
}
