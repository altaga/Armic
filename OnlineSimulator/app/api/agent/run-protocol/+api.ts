// POST /api/agent/run-protocol  —  run one protocol on the pure software simulator
// ALWAYS dry_run=true. Zero hardware. Zero tunnel. Zero servos.
// Body JSON: { protocol_name: string, reps?: number, speed?: number }

import { ExpoResponse } from 'expo-router/server';
import { run_protocol, PROTOCOLS } from '../../../../lib/server/rehab';
import { z } from 'zod';

const BodySchema = z.object({
  protocol_name: z.string().min(1).max(64),
  reps: z.number().int().min(1).max(6).optional().default(3),
  speed: z.number().int().min(6).max(30).optional().default(18),
});

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return ExpoResponse.json({ ok: false, error: 'Invalid JSON body. Expected {"protocol_name":"...", "reps":3, "speed":18}' }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return ExpoResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
  }
  const { protocol_name, reps, speed } = parsed.data;
  const result = run_protocol(protocol_name, reps, speed);
  return ExpoResponse.json({
    ok: result.ok,
    source: 'expo-server-fn/simulator',
    hardware: false,
    dry_run: true,
    available_protocols: PROTOCOLS,
    result,
  }, { status: result.ok ? 200 : 404 });
}
