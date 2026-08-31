import { z } from 'zod';
import { exec } from '../ssh-client.js';

const UNO_Q_ENDPOINT = 'http://localhost:8000';

export const rehabDryRunSchema = {
  host: z.string().min(1).describe('Host alias (typically the "uno-q" entry in ssh-hosts.json)'),
  protocol: z.enum(['bicep-set', 'lateral-set', 'elbowflex-set', 'htl', 'home', 'park']).describe('ARMIC rehab protocol or route preset'),
  reps: z.number().int().min(1).max(12).default(3).describe('Reps per set (REHAB_REPS_PER_SET = 3 by default)'),
  speed: z.number().int().min(2).max(18).default(18).describe('Joint rate cap in deg/s. Rehab cap = 18'),
  timeout: z.number().int().min(15).max(600).default(180).describe('Call timeout in seconds (longer for HTL multi-phase)'),
};

export async function handleRehabDryRun(args: {
  host: string;
  protocol: 'bicep-set' | 'lateral-set' | 'elbowflex-set' | 'htl' | 'home' | 'park';
  reps: number;
  speed: number;
  timeout?: number;
}) {
  const body = JSON.stringify({ protocol: args.protocol, reps: args.reps, speed: args.speed, dry_run: true });
  const cmd = `curl -sS -X POST '${UNO_Q_ENDPOINT}/agent/run-protocol' -H 'Content-Type: application/json' -d '${body.replace(/'/g, `'\\''`)}' --max-time ${(args.timeout ?? 180) - 5} || (echo NO_AGENT_ENDPOINT; echo; echo 'Try: board_setup uno-q first, then confirm FastAPI running via brick compose logs python')`;
  try {
    const r = await exec(args.host, cmd, args.timeout ?? 180);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ exit_code: r.exit_code, stdout: r.stdout.slice(0, 12000), stderr: r.stderr.slice(0, 4000), duration_ms: r.duration_ms }, null, 2) }],
    };
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: 'text' as const, text: `rehab_dry_run failed: ${m}` }] };
  }
}

export const rehabListRoutesSchema = {
  host: z.string().min(1).describe('Host alias of UNO Q'),
  timeout: z.number().int().min(5).max(60).optional(),
};

export async function handleRehabListRoutes(args: { host: string; timeout?: number }) {
  const cmd = `curl -sS '${UNO_Q_ENDPOINT}/agent/routes' --max-time ${(args.timeout ?? 30) - 3} || echo NO_LIST_ROUTES_ENDPOINT`;
  try {
    const r = await exec(args.host, cmd, args.timeout ?? 30);
    return { content: [{ type: 'text' as const, text: r.stdout.slice(0, 12000) + (r.stderr ? `\n[stderr] ${r.stderr.slice(0, 1000)}` : '') }] };
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: 'text' as const, text: `rehab_list_routes failed: ${m}` }] };
  }
}
