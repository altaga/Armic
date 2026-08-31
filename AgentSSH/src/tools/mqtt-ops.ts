import { z } from 'zod';
import { exec } from '../ssh-client.js';

// ── mqtt_pub ───────────────────────────────────────────────────────

export const mqttPubSchema = {
  host: z.string().min(1).describe('Hostname alias from ssh-hosts.json or ~/.ssh/config'),
  topic: z.string().min(1).describe('MQTT topic to publish to, e.g. "armic/joint/state" or "test/ping"'),
  payload: z.string().describe('Message payload to publish'),
  qos: z.number().int().min(0).max(2).default(0).describe('MQTT QoS level (0, 1, or 2). Default 0'),
  timeout: z.number().int().min(5).max(30).default(10).describe('Timeout in seconds (default 10)'),
};

export async function handleMqttPub(args: {
  host: string;
  topic: string;
  payload: string;
  qos: number;
  timeout: number;
}) {
  // Escape single quotes in the payload for safe shell embedding
  const safePayload = args.payload.replace(/'/g, `'\\''`);
  const cmd = `docker exec armic-mosquitto mosquitto_pub -t '${args.topic}' -m '${safePayload}' -q ${args.qos} 2>&1 || mosquitto_pub -h localhost -t '${args.topic}' -m '${safePayload}' -q ${args.qos} 2>&1`;

  try {
    const result = await exec(args.host, cmd, args.timeout);
    const output = (result.stdout + result.stderr).trim();
    const success = result.exit_code === 0;
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          success,
          action: 'publish',
          topic: args.topic,
          payload_length: args.payload.length,
          qos: args.qos,
          exit_code: result.exit_code,
          output: output || (success ? 'published' : 'failed'),
          duration_ms: result.duration_ms,
        }, null, 2),
      }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: 'text' as const, text: `mqtt_pub failed: ${message}` }],
    };
  }
}

// ── mqtt_sub ───────────────────────────────────────────────────────

export const mqttSubSchema = {
  host: z.string().min(1).describe('Hostname alias from ssh-hosts.json or ~/.ssh/config'),
  topic: z.string().min(1).describe('MQTT topic to subscribe to. Supports wildcards: "armic/#" or "armic/joint/+"'),
  count: z.number().int().min(1).max(50).default(1).describe('Number of messages to capture before returning (default 1)'),
  timeout: z.number().int().min(5).max(60).default(10).describe('Timeout in seconds — returns whatever was captured if no messages arrive (default 10)'),
};

export async function handleMqttSub(args: {
  host: string;
  topic: string;
  count: number;
  timeout: number;
}) {
  const cmd = `docker exec armic-mosquitto mosquitto_sub -t '${args.topic}' -C ${args.count} -W ${args.timeout} -v 2>&1 || mosquitto_sub -h localhost -t '${args.topic}' -C ${args.count} -W ${args.timeout} -v 2>&1`;

  try {
    const result = await exec(args.host, cmd, args.timeout + 5); // +5s buffer for SSH overhead
    const output = (result.stdout + result.stderr).trim();
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          action: 'subscribe',
          topic: args.topic,
          count_requested: args.count,
          exit_code: result.exit_code,
          messages: output,
          duration_ms: result.duration_ms,
        }, null, 2),
      }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: 'text' as const, text: `mqtt_sub failed: ${message}` }],
    };
  }
}
