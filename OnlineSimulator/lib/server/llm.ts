// SPDX-FileCopyrightText: Armic project
// SPDX-License-Identifier: MPL-2.0
// Standalone deterministic agent — runs on the Expo Router server function.
// ZERO external API keys. ZERO network calls outside localhost. ZERO hardware. ZERO tunnel.
// 4-tool brick contract (same names + args as on-device agent/tools.py)
//   run_arm_protocol, list_rehab_routes, suggest_rehab_intent, show_rehab_route
// Produces tool trace + final answer with the same JSON shape as a real LLM tool-calling
// run, so the client UI never needs to know the difference.

import { run_deterministic_chat } from './orchestrator';

export async function run_llm_chat(userMessage: string) {
  return run_deterministic_chat(userMessage);
}
