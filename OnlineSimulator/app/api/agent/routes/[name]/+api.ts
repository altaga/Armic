// GET /api/agent/routes/[name]  —  show one route by id / alias
// Expo Router server function. Zero hardware references. Pure simulator.

import { get_route } from '../../../../../lib/server/rehab';

export function GET(_req: Request, ctx: { params: { name: string } }): Response {
  const name = String(ctx.params?.name ?? '').trim();
  const route = get_route(name);
  if (!route) {
    return Response.json({
      ok: false,
      source: 'expo-server-fn/simulator',
      hardware: false,
      error: `Unknown route ${name}. Try: light, medium, heavy, intro, standard, shoulder, elbow, bicep.`,
      available: ['light', 'medium', 'heavy'],
    }, { status: 404 });
  }
  return Response.json({
    ok: true,
    source: 'expo-server-fn/simulator',
    hardware: false,
    route_id: route.id,
    route,
  }, { status: 200, headers: { 'Cache-Control': 'max-age=300' } });
}
