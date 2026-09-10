// POST /api/agent/suggest-intent  —  intent match → route + rationale
// Expo Router server function. Zero hardware references. Pure simulator.
// Body JSON: { description: string }

import { routes_for_chat_query, match_rehab_intent, list_routes, is_list_all_request } from '../../../../lib/server/rehab';
import { z } from 'zod';

const BodySchema = z.object({
  description: z.string().min(1).max(4000),
});

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body. Expected {"description":"..."}' }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
  }
  const { description } = parsed.data;
  const matched = match_rehab_intent(description);
  const direct = routes_for_chat_query(description);
  const listAll = is_list_all_request(description);
  return Response.json({
    ok: true,
    source: 'expo-server-fn/simulator',
    hardware: false,
    description,
    match: matched
      ? {
          route_id: matched.route_id,
          intensity: matched.intensity,
          joint: matched.joint,
          confidence: matched.confidence,
          rationale: matched.rationale,
          route: matched.route,
        }
      : null,
    list_all: listAll,
    suggested_routes: direct?.routes ?? list_routes(),
    note: direct?.note ?? 'Here are preset rehab routes that may fit.',
  }, { status: 200, headers: { 'Cache-Control': 'max-age=60' } });
}
