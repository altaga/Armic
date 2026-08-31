// POST /api/agent/chat  —  deterministic 4-tool brick agent, Expo Router server function.
// ALWAYS: dry_run=true, zero hardware, zero tunnel, zero API keys, zero cloud.
// Body JSON: { message: string, stream?: boolean }
// stream=true: NDJSON, 1 event per line. Default=false: full JSON envelope.

import { ExpoResponse } from 'expo-router/server';
import { z } from 'zod';
import { run_llm_chat } from '../../../../lib/server/llm';

const BodySchema = z.object({
  message: z.string().min(1).max(6000),
  stream: z.boolean().optional().default(false),
});

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return ExpoResponse.json({ ok: false, error: 'Invalid JSON body. Expected {"message":"...", "stream":false}' }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return ExpoResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
  }
  const { message, stream } = parsed.data;
  const response = await run_llm_chat(message);

  const envelope = {
    ok: true,
    source: 'expo-server-fn/simulator',
    hardware: false,
    dry_run: true,
    mode: response.mode,
    model: response.model,
    trace: response.trace,
    final_answer: response.final_answer,
  };

  if (stream) {
    const encoder = new TextEncoder();
    let pos = 0;
    const stream2 = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const ev of response.trace) {
          controller.enqueue(encoder.encode(JSON.stringify({ type: 'event', event: ev }) + '\n'));
          pos++;
        }
        controller.enqueue(encoder.encode(JSON.stringify({
          type: 'final',
          mode: response.mode,
          model: response.model,
          final_answer: response.final_answer,
          events_count: pos,
        }) + '\n'));
        controller.close();
      },
    });
    return new ExpoResponse(stream2 as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    }) as unknown as Response;
  }

  return ExpoResponse.json(envelope, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}
