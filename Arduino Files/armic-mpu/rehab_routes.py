# SPDX-FileCopyrightText: Armic project
#
# SPDX-License-Identifier: MPL-2.0
"""Preset rehab routes built from the app's programmed exercises only."""

from __future__ import annotations

from typing import Any, Literal

# Must stay in sync with armic.EXERCISES and sketch/ProtocolRunner.
PROGRAMMED_EXERCISES: tuple[str, ...] = ("bicep", "lateral", "elbowflex")
EXERCISE_LABELS: dict[str, str] = {
    "bicep": "Bicep Curl",
    "lateral": "Lateral Raise",
    "elbowflex": "Elbow Flexion",
}

EXERCISE_ORDER: tuple[str, ...] = PROGRAMMED_EXERCISES

INTENSITY_REPS: dict[str, int] = {
    "light": 3,
    "medium": 6,
    "heavy": 6,
}

JointFocus = Literal["shoulder", "elbow", "bicep", "general"]

# Joint utterances map to one programmed exercise each.
JOINT_EXERCISE: dict[str, str] = {
    "shoulder": "lateral",
    "elbow": "elbowflex",
    "bicep": "bicep",
}

ROUTE_META: dict[str, dict[str, str]] = {
    "light": {
        "title": "Light — initial phase",
        "summary": "All three programmed exercises — 3 reps each (Bicep Curl, Lateral Raise, Elbow Flexion).",
    },
    "medium": {
        "title": "Medium — progression",
        "summary": "All three programmed exercises — 6 reps each.",
    },
    "heavy": {
        "title": "Heavy — strengthening",
        "summary": "All three programmed exercises — 6 reps each (maximum on this arm).",
    },
}

# Backward-compatible aliases from older route ids / chat hints.
ROUTE_ALIASES: dict[str, str] = {
    "intro": "light",
    "acute": "light",
    "foundation": "medium",
    "subacute": "medium",
    "standard": "medium",
    "shoulder_focus": "medium",
    "shoulder": "medium",
    "elbow_focus": "heavy",
    "elbow": "heavy",
}

CONTEXT_HINTS: dict[str, str] = {
    "acute": "light",
    "subacute": "medium",
    "standard": "medium",
    "shoulder": "medium",
    "elbow": "heavy",
}


def exercises_catalog() -> list[dict[str, str]]:
    return [{"id": ex, "label": EXERCISE_LABELS.get(ex, ex)} for ex in EXERCISE_ORDER]


def _step(exercise: str, reps: int) -> dict[str, Any]:
    if exercise not in PROGRAMMED_EXERCISES:
        raise ValueError(f"unknown exercise {exercise!r}")
    reps = max(1, min(6, int(reps)))
    return {
        "exercise": exercise,
        "reps": reps,
        "label": EXERCISE_LABELS.get(exercise, exercise),
    }


def compose_steps(intensity: str, joint: JointFocus | None = None) -> list[dict[str, Any]]:
    """Build route steps from programmed exercises only."""
    reps = INTENSITY_REPS.get(intensity, 6)
    if joint and joint != "general" and joint in JOINT_EXERCISE:
        return [_step(JOINT_EXERCISE[joint], reps)]
    return [_step(ex, reps) for ex in EXERCISE_ORDER]


def resolve_route_id(route_id: str) -> str:
    key = str(route_id or "").strip().lower()
    if key in ROUTE_META:
        return key
    return ROUTE_ALIASES.get(key, key)


def build_route(route_id: str, joint: JointFocus | None = None) -> dict[str, Any]:
    rid = resolve_route_id(route_id)
    if rid not in ROUTE_META:
        raise KeyError(rid)
    meta = ROUTE_META[rid]
    steps = compose_steps(rid, joint)
    if joint and joint != "general":
        label = EXERCISE_LABELS.get(JOINT_EXERCISE[joint], joint)
        summary = f"{label} — {INTENSITY_REPS[rid]} reps ({meta['title'].split('—')[0].strip()})."
    else:
        summary = meta["summary"]
    return {
        "id": rid,
        "title": meta["title"],
        "intensity": rid,
        "summary": summary,
        "steps": steps,
        "exercises": exercises_catalog(),
    }


def list_routes() -> list[dict[str, Any]]:
    return [build_route(rid) for rid in ("light", "medium", "heavy")]


def get_route(route_id: str) -> dict[str, Any] | None:
    rid = resolve_route_id(route_id)
    if rid not in ROUTE_META:
        return None
    return build_route(rid)


def suggest_route(context: str) -> str | None:
    key = str(context or "").strip().lower()
    if key in ROUTE_META:
        return key
    if key in ROUTE_ALIASES:
        return ROUTE_ALIASES[key]
    return CONTEXT_HINTS.get(key)


def routes_for_chat_query(message: str) -> list[dict[str, Any]] | None:
    """Return rehab routes to display in chat, or None if not a route listing request."""
    from rehab_intent import routes_for_chat_query as intent_routes

    result = intent_routes(message)
    if result is None:
        return None
    routes, _note = result
    return routes


def routes_for_chat_query_with_note(message: str) -> tuple[list[dict[str, Any]], str | None] | None:
    """Like routes_for_chat_query but includes an intent rationale for the chat reply."""
    from rehab_intent import routes_for_chat_query as intent_routes

    return intent_routes(message)
