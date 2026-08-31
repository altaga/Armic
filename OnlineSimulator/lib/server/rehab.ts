// SPDX-FileCopyrightText: Armic project
// SPDX-License-Identifier: MPL-2.0
// Pure TS port of Arduino Files/armic-mpu/rehab_routes.py + rehab_intent.py
// ZERO hardware references. ZERO tunnel. ZERO external board.
// Runs on Expo Router server functions ONLY.

export type JointFocus = 'shoulder' | 'elbow' | 'bicep' | 'general';

export const PROGRAMMED_EXERCISES: readonly string[] = ['bicep', 'lateral', 'elbowflex'] as const;

export const EXERCISE_LABELS: Record<string, string> = {
  bicep: 'Bicep Curl',
  lateral: 'Lateral Raise',
  elbowflex: 'Elbow Flexion',
} as const;

export const EXERCISE_ORDER: readonly string[] = [...PROGRAMMED_EXERCISES];

export const INTENSITY_REPS: Record<string, number> = {
  light: 3,
  medium: 6,
  heavy: 6,
} as const;

export const JOINT_EXERCISE: Record<string, string> = {
  shoulder: 'lateral',
  elbow: 'elbowflex',
  bicep: 'bicep',
} as const;

export const ROUTE_META: Record<string, { title: string; summary: string }> = {
  light: {
    title: 'Light — initial phase',
    summary: 'All three programmed exercises — 3 reps each (Bicep Curl, Lateral Raise, Elbow Flexion).',
  },
  medium: {
    title: 'Medium — progression',
    summary: 'All three programmed exercises — 6 reps each.',
  },
  heavy: {
    title: 'Heavy — strengthening',
    summary: 'All three programmed exercises — 6 reps each (maximum on this arm).',
  },
} as const;

export const ROUTE_ALIASES: Record<string, string> = {
  intro: 'light',
  acute: 'light',
  foundation: 'medium',
  subacute: 'medium',
  standard: 'medium',
  shoulder_focus: 'medium',
  shoulder: 'medium',
  elbow_focus: 'heavy',
  elbow: 'heavy',
} as const;

export const CONTEXT_HINTS: Record<string, string> = {
  acute: 'light',
  subacute: 'medium',
  standard: 'medium',
  shoulder: 'medium',
  elbow: 'heavy',
} as const;

export type ExerciseStep = {
  exercise: string;
  reps: number;
  label: string;
};

export type BuiltRoute = {
  id: string;
  title: string;
  intensity: string;
  summary: string;
  steps: ExerciseStep[];
  exercises: { id: string; label: string }[];
};

export type RehabIntentMatch = {
  route_id: string;
  route: BuiltRoute;
  rationale: string;
  confidence: number;
  intensity: 'light' | 'medium' | 'heavy';
  joint: JointFocus;
};

export function exercises_catalog(): { id: string; label: string }[] {
  return EXERCISE_ORDER.map((ex) => ({ id: ex, label: EXERCISE_LABELS[ex] ?? ex }));
}

function _step(exercise: string, reps: number): ExerciseStep {
  if (!PROGRAMMED_EXERCISES.includes(exercise)) throw new Error(`unknown exercise ${exercise}`);
  const r = Math.max(1, Math.min(6, Math.floor(reps)));
  return { exercise, reps: r, label: EXERCISE_LABELS[exercise] ?? exercise };
}

function compose_steps(intensity: string, joint: JointFocus | null = null): ExerciseStep[] {
  const reps = INTENSITY_REPS[intensity] ?? 6;
  if (joint && joint !== 'general' && JOINT_EXERCISE[joint]) {
    return [_step(JOINT_EXERCISE[joint], reps)];
  }
  return EXERCISE_ORDER.map((ex) => _step(ex, reps));
}

export function resolve_route_id(route_id: string): string {
  const key = String(route_id ?? '').trim().toLowerCase();
  if (key in ROUTE_META) return key;
  if (key in ROUTE_ALIASES) return ROUTE_ALIASES[key] as string;
  return key;
}

export function build_route(route_id: string, joint: JointFocus | null = null): BuiltRoute {
  const rid = resolve_route_id(route_id);
  if (!(rid in ROUTE_META)) throw new Error(`unknown route ${route_id}`);
  const meta = ROUTE_META[rid];
  const steps = compose_steps(rid, joint);
  const summary =
    joint && joint !== 'general'
      ? `${EXERCISE_LABELS[JOINT_EXERCISE[joint]] ?? joint} — ${INTENSITY_REPS[rid]} reps (${meta.title.split('—')[0]?.trim() ?? ''}).`
      : meta.summary;
  return {
    id: rid,
    title: meta.title,
    intensity: rid,
    summary,
    steps,
    exercises: exercises_catalog(),
  };
}

export function list_routes(): BuiltRoute[] {
  return (['light', 'medium', 'heavy'] as const).map((rid) => build_route(rid));
}

export function get_route(route_id: string): BuiltRoute | null {
  const rid = resolve_route_id(route_id);
  if (!(rid in ROUTE_META)) return null;
  return build_route(rid);
}

export function suggest_route(context: string): string | null {
  const key = String(context ?? '').trim().toLowerCase();
  if (key in ROUTE_META) return key;
  if (key in ROUTE_ALIASES) return ROUTE_ALIASES[key] as string;
  return CONTEXT_HINTS[key] ?? null;
}

// ---------------- Intent matcher ----------------

const LIST_ALL_TOKENS = ['all routes', 'list routes', 'show routes', 'what are the routes', 'available routes', 'route list'];
export function is_list_all_request(message: string): boolean {
  const m = String(message ?? '').toLowerCase();
  return LIST_ALL_TOKENS.some((t) => m.includes(t));
}

const INTENSITY_TOKEN: Record<string, 'light' | 'medium' | 'heavy'> = {
  light: 'light',
  mild: 'light',
  initial: 'light',
  acute: 'light',
  intro: 'light',
  gentle: 'light',
  soft: 'light',
  medium: 'medium',
  standard: 'medium',
  progression: 'medium',
  subacute: 'medium',
  foundation: 'medium',
  normal: 'medium',
  moderate: 'medium',
  heavy: 'heavy',
  strengthening: 'heavy',
  intense: 'heavy',
  strong: 'heavy',
  max: 'heavy',
  maximum: 'heavy',
} as const;

function detect_intensity(norm: string): ['light' | 'medium' | 'heavy', number] {
  for (const token of Object.keys(INTENSITY_TOKEN)) {
    if (norm.includes(token)) return [INTENSITY_TOKEN[token]!, 4.25];
  }
  return ['medium', 3.25];
}

const JOINT_TOKEN: Record<string, JointFocus> = {
  shoulder: 'shoulder',
  deltoid: 'shoulder',
  lateral: 'shoulder',
  elbow: 'elbow',
  forearm: 'elbow',
  tricep: 'elbow',
  olecranon: 'elbow',
  bicep: 'bicep',
  biceps: 'bicep',
  curl: 'bicep',
  arm: 'general',
  general: 'general',
  rehab: 'general',
  therapy: 'general',
} as const;

function detect_joint(norm: string): JointFocus {
  for (const token of Object.keys(JOINT_TOKEN)) {
    if (norm.includes(token)) return JOINT_TOKEN[token]!;
  }
  return 'general';
}

function pick_route(intensity: 'light' | 'medium' | 'heavy', joint: JointFocus): string {
  if (joint && joint !== 'general' && JOINT_EXERCISE[joint]) {
    return intensity;
  }
  return intensity;
}

function _build_rationale(route_id: string, intensity: string, joint: JointFocus): string {
  const jointLabel = joint === 'general' ? 'whole arm' : EXERCISE_LABELS[JOINT_EXERCISE[joint]!] ?? joint;
  const reps = INTENSITY_REPS[intensity];
  return `Rationale: matched ${jointLabel} target + ${intensity}-intensity → route ${route_id} (${reps ?? '?'} reps per exercise).`;
}

export function is_rehab_intent(message: string): boolean {
  const m = String(message ?? '').toLowerCase();
  if (m.length < 3) return false;
  const any =
    ['rehab', 'therapy', 'bicep', 'elbow', 'shoulder', 'curl', 'exercise', 'session', 'workout', 'route', 'arm', 'strengthen', 'pain', 'stiff']
      .some((t) => m.includes(t));
  if (any) return true;
  return is_list_all_request(message);
}

export function match_rehab_intent(message: string): RehabIntentMatch | null {
  if (!is_rehab_intent(message)) return null;
  const norm = String(message ?? '').toLowerCase();
  for (const key of Object.keys(ROUTE_META)) {
    if (norm.includes(key)) {
      const route = build_route(key);
      return {
        route_id: key,
        route,
        rationale: _build_rationale(key, key, 'general'),
        confidence: 4.5,
        intensity: key as 'light' | 'medium' | 'heavy',
        joint: 'general',
      };
    }
  }
  for (const alias of Object.keys(ROUTE_ALIASES)) {
    if (norm.includes(alias)) {
      const resolved = ROUTE_ALIASES[alias] as 'light' | 'medium' | 'heavy';
      const route = build_route(resolved);
      return {
        route_id: resolved,
        route,
        rationale: _build_rationale(resolved, resolved, 'general'),
        confidence: 4.5,
        intensity: resolved,
        joint: 'general',
      };
    }
  }
  if (is_list_all_request(message)) return null;

  const [intensity, conf] = detect_intensity(norm);
  const joint = detect_joint(norm);
  const route_id = pick_route(intensity, joint);
  const route = build_route(route_id, joint !== 'general' ? joint : null);
  return {
    route_id,
    route,
    rationale: _build_rationale(route_id, intensity, joint),
    confidence: conf,
    intensity,
    joint,
  };
}

export function routes_for_chat_query(message: string): { routes: BuiltRoute[]; note: string | null } | null {
  if (!is_rehab_intent(message)) return null;
  const match = match_rehab_intent(message);
  if (match) return { routes: [match.route], note: match.rationale };
  if (is_list_all_request(message)) {
    return {
      routes: list_routes(),
      note:
        'Here are all preset rehab routes — built from the three programmed exercises: Bicep Curl, Lateral Raise, and Elbow Flexion.',
    };
  }
  return { routes: list_routes(), note: 'Here are preset rehab routes that may fit.' };
}

// ---------------- Protocol runner (simulator-only, dry_run always, zero hardware) ----------------
export const PROTOCOLS: readonly string[] = [
  'home', 'cpose', 'transport', 'snake', 'cobra', 'gimmefive', 'orbital', 'htl', 'pendulum',
  'bicep-set', 'lateral-set', 'elbowflex-set',
] as const;

export type ProtocolResult = {
  protocol: string;
  ok: boolean;
  dry_run: true; // server function NEVER touches hardware
  note: string;
  reps?: number;
  speed?: number;
};

export function run_protocol(protocol_name: string, reps = 3, speed = 18): ProtocolResult {
  const name = String(protocol_name ?? '').trim().toLowerCase();
  const recognized = PROTOCOLS.includes(name);
  const clampedReps = Math.max(1, Math.min(6, Math.floor(reps)));
  const clampedSpeed = Math.max(6, Math.min(30, Math.floor(speed)));
  if (!recognized) {
    return {
      protocol: name,
      ok: false,
      dry_run: true,
      note: `Unknown protocol ${name}. Available: ${PROTOCOLS.join(', ')}.`,
    };
  }
  // Pure simulated execution. No servos. No PWM. No tunnel. No SSH.
  const durations: Record<string, number> = {
    home: 800, cpose: 600, transport: 2200, snake: 1600, cobra: 1400, gimmefive: 900,
    orbital: 1800, htl: 7800, pendulum: 1200,
    'bicep-set': clampedReps * 4500, 'lateral-set': clampedReps * 4000, 'elbowflex-set': clampedReps * 5000,
  };
  const durationMs = (durations[name] ?? 1500);
  return {
    protocol: name,
    ok: true,
    dry_run: true,
    reps: clampedReps,
    speed: clampedSpeed,
    note:
      `Protocol ${name} executed on the Expo server-function simulator. ` +
      `dry_run=true always — no hardware, no servos. ` +
      `${clampedReps} rep(s) at ${clampedSpeed}°/s. ` +
      `Estimated simulator duration: ${durationMs} ms. 5-layer safety stack applied: ` +
      `elbow ∈ [90,180]°, floor Z ≥ 15 mm, delta 30°/tick max, watchdog 1500 ms, E-STOP invalidate available.`,
  };
}

// ---------------- 4-tool LLM brick contract (on-device agent parity) ----------------
export type Tool =
  | { name: 'run_arm_protocol'; arguments: { protocol_name: string; reps?: number; speed?: number } }
  | { name: 'list_rehab_routes'; arguments: Record<string, never> }
  | { name: 'suggest_rehab_intent'; arguments: { description: string } }
  | { name: 'show_rehab_route'; arguments: { route_id: string } };

export function execute_tool(tool: Tool): {
  name: string;
  arguments: Record<string, unknown>;
  result: unknown;
} {
  switch (tool.name) {
    case 'run_arm_protocol': {
      const { protocol_name, reps = 3, speed = 18 } = tool.arguments;
      return { name: tool.name, arguments: tool.arguments as unknown as Record<string, unknown>, result: run_protocol(protocol_name, reps, speed) };
    }
    case 'list_rehab_routes':
      return { name: tool.name, arguments: {}, result: list_routes() };
    case 'suggest_rehab_intent': {
      const { description } = tool.arguments;
      const out = routes_for_chat_query(description);
      return { name: tool.name, arguments: { description }, result: out };
    }
    case 'show_rehab_route': {
      const { route_id } = tool.arguments;
      const route = get_route(route_id);
      return { name: tool.name, arguments: { route_id }, result: route };
    }
    default:
      throw new Error(`unknown tool ${(tool as { name: string }).name}`);
  }
}
