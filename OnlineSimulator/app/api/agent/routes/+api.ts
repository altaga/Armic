// GET /api/agent/routes  —  3 preset rehab routes
// Expo Router server function. Zero hardware references. Pure simulator.

import { ExpoResponse } from 'expo-router/server';
import { list_routes } from '../../../../lib/server/rehab';

export function GET(_req: Request): Response {
  return ExpoResponse.json({
    ok: true,
    source: 'expo-server-fn/simulator',
    hardware: false,
    routes: list_routes(),
  }, { status: 200, headers: { 'Cache-Control': 'max-age=300' } });
}
