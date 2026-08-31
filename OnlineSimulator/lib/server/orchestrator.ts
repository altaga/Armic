// SPDX-FileCopyrightText: Armic project
// SPDX-License-Identifier: MPL-2.0
// Deterministic 4-tool orchestrator used as the default engine.
// Produces a tool trace + final answer with the EXACT same JSON shape as a real LLM chat-completions
// run with tool_choice="auto". Zero hardware, zero external calls.

import {
  execute_tool,
  is_list_all_request,
  is_rehab_intent,
  match_rehab_intent,
  PROTOCOLS,
  Tool,
} from './rehab';

export type TraceEvent =
  | { type: 'user'; content: string }
  | { type: 'assistant_thought'; content: string }
  | { type: 'tool_call'; id: string; name: string; arguments: Record<string, unknown> }
  | { type: 'tool_result'; id: string; name: string; result: unknown }
  | { type: 'assistant'; content: string }
  | { type: 'error'; message: string };

export type ChatResponse = {
  mode: 'deterministic' | 'openai' | 'anthropic';
  model: string;
  trace: TraceEvent[];
  final_answer: string;
};

const PROTOCOL_HINTS: Record<string, string[]> = {
  home: ['home', 'park', 'go home', 'rest position', 'return home'],
  transport: ['transport', 'reach carry', 'pick and place', 'carry', 'pick-and-place', 'reach-carry'],
  cobra: ['cobra', 'strike', 'reach fast'],
  orbital: ['orbital', 'circle', 'circular sweep', 'orbit'],
  htl: ['htl', 'heavy tuck', 'tucked lift', 'heavy lift', 'tuck lift', 'heavy-tucked-lift'],
  pendulum: ['pendulum', 'sway', 'swing'],
  gimmefive: ['high five', 'gimme five', 'hi-five', 'gimmefive', 'high-five'],
  snake: ['snake', 'serpent', 'wiggle'],
  cpose: ['c-pose', 'cpose', 'demo c', 'letter c'],
  'bicep-set': ['bicep set', 'bicep curl set', 'bicep session', 'biceps set'],
  'lateral-set': ['lateral set', 'lateral raise set', 'shoulder set'],
  'elbowflex-set': ['elbow set', 'elbow flexion set', 'elbowflex set'],
};

function detect_protocol(message: string): { name: string; reps?: number; speed?: number } | null {
  const m = String(message ?? '').toLowerCase();
  const repMatch = m.match(/(\d+)\s*(rep|set|reps)/);
  const speedMatch = m.match(/(\d+)\s*(°\/s|deg\/s|degrees per second|degrees\/s)/);
  for (const name of Object.keys(PROTOCOL_HINTS)) {
    const hints = PROTOCOL_HINTS[name] as string[];
    if (hints.some((h) => m.includes(h))) {
      return {
        name,
        reps: repMatch ? Number(repMatch[1]) : undefined,
        speed: speedMatch ? Number(speedMatch[1]) : undefined,
      };
    }
  }
  return null;
}

export function run_deterministic_chat(message: string): ChatResponse {
  const trace: TraceEvent[] = [];
  trace.push({ type: 'user', content: message });

  const norm = String(message ?? '').trim();
  if (!norm) {
    const emptyAnswer = 'Ask me anything about rehab routes, protocols, or your arm.';
    trace.push({ type: 'assistant', content: emptyAnswer });
    return { mode: 'deterministic', model: 'simulator-4tool-orchestrator/v1', trace, final_answer: emptyAnswer };
  }

  // --- Route 1: list rehab routes ---
  if (is_list_all_request(norm)) {
    trace.push({ type: 'assistant_thought', content: 'User asked to list all rehab routes. Calling list_rehab_routes().' });
    const tool: Tool = { name: 'list_rehab_routes', arguments: {} };
    const id = 'call_' + Math.random().toString(36).slice(2, 10);
    trace.push({ type: 'tool_call', id, name: tool.name, arguments: tool.arguments as unknown as Record<string, unknown> });
    const executed = execute_tool(tool);
    trace.push({ type: 'tool_result', id, name: executed.name, result: executed.result });
    const answer =
      'I loaded 3 preset rehab routines. All three are built from the programmed exercises: Bicep Curl, Lateral Raise, and Elbow Flexion. ' +
      'Tap any route card to expand — then ask me to "run lateral-set" to dry-run it on the simulator (no hardware, always safe).';
    trace.push({ type: 'assistant', content: answer });
    return { mode: 'deterministic', model: 'simulator-4tool-orchestrator/v1', trace, final_answer: answer };
  }

  // --- Route 2: show one rehab route by id / alias ---
  const routeWords = norm.match(/(?:route|preset|plan)\s+(\w+)/i);
  const routeKeyword = routeWords?.[1]?.toLowerCase();
  if (routeKeyword) {
    trace.push({ type: 'assistant_thought', content: `User wants a specific route. Calling show_rehab_route("${routeKeyword}").` });
    const tool: Tool = { name: 'show_rehab_route', arguments: { route_id: routeKeyword } };
    const id = 'call_' + Math.random().toString(36).slice(2, 10);
    trace.push({ type: 'tool_call', id, name: tool.name, arguments: tool.arguments as unknown as Record<string, unknown> });
    const executed = execute_tool(tool);
    trace.push({ type: 'tool_result', id, name: executed.name, result: executed.result });
    const route = executed.result as { id: string; title: string; steps: { label: string; reps: number }[] } | null;
    const answer = route
      ? `Loaded route ${route.id} (${route.title}). ${route.steps.length} exercise(s): ${route.steps.map((s) => `${s.label} × ${s.reps}`).join(', ')}. Ask me to dry-run it on the simulator.`
      : `I couldn't find a route named "${routeKeyword}". Try: light, medium, heavy, intro, standard, shoulder, elbow, or bicep.`;
    trace.push({ type: 'assistant', content: answer });
    return { mode: 'deterministic', model: 'simulator-4tool-orchestrator/v1', trace, final_answer: answer };
  }

  // --- Route 3: run a protocol ---
  const proto = detect_protocol(norm);
  if (proto) {
    trace.push({
      type: 'assistant_thought',
      content: `Matched protocol ${proto.name}. Calling run_arm_protocol(protocol_name="${proto.name}", reps=${proto.reps ?? 3}, speed=${proto.speed ?? 18}). Always dry_run=true on simulator.`,
    });
    const tool: Tool = { name: 'run_arm_protocol', arguments: { protocol_name: proto.name, reps: proto.reps ?? 3, speed: proto.speed ?? 18 } };
    const id = 'call_' + Math.random().toString(36).slice(2, 10);
    trace.push({ type: 'tool_call', id, name: tool.name, arguments: tool.arguments as unknown as Record<string, unknown> });
    const executed = execute_tool(tool);
    trace.push({ type: 'tool_result', id, name: executed.name, result: executed.result });
    const res = executed.result as { ok: boolean; note: string; reps?: number; protocol: string };
    const answer = res.ok
      ? `✅ Protocol ${res.protocol} finished on the Expo server simulator. dry_run=true (always — no hardware, no PWM, no servos). ${res.reps ?? 3} rep(s). ${res.note}`
      : `⚠️ ${res.note}`;
    trace.push({ type: 'assistant', content: answer });
    return { mode: 'deterministic', model: 'simulator-4tool-orchestrator/v1', trace, final_answer: answer };
  }

  // --- Route 4: rehab intent suggestion (default for any rehab-ish query) ---
  if (is_rehab_intent(norm)) {
    trace.push({ type: 'assistant_thought', content: `Rehab intent detected. Calling suggest_rehab_intent(description).` });
    const tool: Tool = { name: 'suggest_rehab_intent', arguments: { description: norm } };
    const id = 'call_' + Math.random().toString(36).slice(2, 10);
    trace.push({ type: 'tool_call', id, name: tool.name, arguments: tool.arguments as unknown as Record<string, unknown> });
    const executed = execute_tool(tool);
    trace.push({ type: 'tool_result', id, name: executed.name, result: executed.result });
    const match = match_rehab_intent(norm);
    const answer = match
      ? `Suggested route ${match.route.id} (${match.route.title}). ${match.rationale} Want me to dry-run it on the simulator?`
      : 'I loaded the 3 presets. Tell me the joint (shoulder / elbow / bicep) and intensity (light / medium / heavy) and I will pick the right one.';
    trace.push({ type: 'assistant', content: answer });
    return { mode: 'deterministic', model: 'simulator-4tool-orchestrator/v1', trace, final_answer: answer };
  }

  // --- Route 5: non-rehab greeting / misc ---
  trace.push({ type: 'assistant_thought', content: 'Non-rehab query. Answering without tool calls.' });
  const answer =
    "I'm the ARMIC simulator agent. I run inside the Expo Router server (pure software, no hardware, no tunnel). " +
    `Try: (1) "list routes" → see 3 presets, (2) "run bicep-set" → dry-run protocol, (3) "I'm 2 weeks post elbow fracture" → intent match, (4) "show route standard" → card.`;
  trace.push({ type: 'assistant', content: answer });
  return { mode: 'deterministic', model: 'simulator-4tool-orchestrator/v1', trace, final_answer: answer };
}
