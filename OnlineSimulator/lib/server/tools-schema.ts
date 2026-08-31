// SPDX-FileCopyrightText: Armic project
// SPDX-License-Identifier: MPL-2.0
// 4-tool LLM brick contract as OpenAI-compatible `tools` array.
// Same EXACT names, argument schemas, and semantic contracts as:
//   Arduino Files/armic-mpu/agent/tools.py   (on-device llama.cpp)
// 4-tool LLM brick contract (same names + args as on-device agent/tools.py)
// Zero hardware references.

export const TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'run_arm_protocol',
      description:
        'Run a single pre-programmed motion on the Expo server-function simulator (always dry_run=true — no hardware, no servos, no tunnel). ' +
        'Protocols: home, cpose, transport, snake, cobra, gimmefive, orbital, htl, pendulum, ' +
        'bicep-set, lateral-set, elbowflex-set.',
      parameters: {
        type: 'object',
        properties: {
          protocol_name: {
            type: 'string',
            description: 'Protocol id. One of: home, cpose, transport, snake, cobra, gimmefive, orbital, htl, pendulum, bicep-set, lateral-set, elbowflex-set.',
          },
          reps: { type: 'number', description: 'Reps per exercise set (clamped 1-6). Default 3.' },
          speed: { type: 'number', description: 'Joint rate °/s (clamped 6-30). Default 18. Rehab cap = 18.' },
        },
        required: ['protocol_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_rehab_routes',
      description: 'List preset rehab routes (3 presets: light, medium, heavy) using Bicep Curl, Lateral Raise, Elbow Flexion. Returns route cards. Pure simulator, no hardware.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'suggest_rehab_intent',
      description: 'Given a natural-language rehab goal / patient context, pick the best preset route. Pure simulator intent matcher (no hardware). Returns route(s) + rationale.',
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'Natural-language rehab goal or patient context. E.g. "patient 2 weeks post elbow fracture mild pain — start gentle"' },
        },
        required: ['description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'show_rehab_route',
      description: 'Show one rehab route by id (light | medium | heavy — aliases: intro, standard, acute, shoulder, elbow, …). Returns steps + exercises. Pure simulator.',
      parameters: {
        type: 'object',
        properties: {
          route_id: { type: 'string', description: 'light | medium | heavy or any alias (intro, acute, standard, shoulder, elbow …).' },
        },
        required: ['route_id'],
      },
    },
  },
] as const;

export type ToolName = typeof TOOL_SCHEMAS[number]['function']['name'];
