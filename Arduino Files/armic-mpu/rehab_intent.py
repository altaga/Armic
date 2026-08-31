# SPDX-FileCopyrightText: Armic project
#
# SPDX-License-Identifier: MPL-2.0
"""Natural-language intent matching for preset rehab routes.

Maps clinician utterances to light / medium / heavy routes composed from the
three programmed exercises: Bicep Curl, Lateral Raise, Elbow Flexion.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Literal

from rehab_routes import (
    EXERCISE_LABELS,
    INTENSITY_REPS,
    JOINT_EXERCISE,
    ROUTE_META,
    build_route,
    list_routes,
    resolve_route_id,
)

Intensity = Literal["light", "medium", "heavy"]
JointFocus = Literal["shoulder", "elbow", "general"]

REHAB_TRIGGERS = (
    "rehab",
    "rehabilitation",
    "therapy",
    "therapeutic",
    "routine",
    "routines",
    "program",
    "session",
    "plan",
    "exercise",
    "exercises",
    "lifting",
    "flexion",
    "mobility",
    "range of motion",
    "rom",
    "patient",
    "clinician",
    "strengthening",
    "generate",
    "create",
    "design",
    "put together",
)

LIST_TRIGGERS = (
    "all routes",
    "all routines",
    "list routes",
    "list routines",
    "show all",
    "what routes",
    "which routes",
    "available routes",
    "preset routes",
)

# @intensity_level entity — light / medium / heavy (+ synonyms from training set)
INTENSITY_TERMS: dict[Intensity, tuple[str, ...]] = {
    "light": (
        "light",
        "lite",
        "gentle",
        "very light",
        "low impact",
        "low-impact",
        "very low impact",
        "very low",
        "low impact",
        "minimal",
        "introductory",
        "introduction",
        "initial",
        "first week",
        "first session",
        "starting out",
        "just starting",
        "conservative",
        "few repetitions",
        "very few repetitions",
        "very few",
        "few reps",
        "reduced mobility",
        "pain",
        "elderly",
        "recent surgery",
        "after surgery",
        "post surgery",
        "postoperative",
        "acute",
        "early phase",
        "without straining",
        "restore mobility",
        "simple",
        "easy",
    ),
    "medium": (
        "medium",
        "moderate",
        "intermediate",
        "second stage",
        "second phase",
        "second week",
        "progression",
        "progression phase",
        "passed the initial",
        "initial phase",
        "building strength",
        "moderate resistance",
        "moderate weight",
        "medium intensity",
        "medium-intensity",
        "medium weight",
        "no longer acute",
        "no acute pain",
        "subacute",
        "standard lifting",
    ),
    "heavy": (
        "heavy",
        "intense",
        "high intensity",
        "high-intensity",
        "demanding",
        "advanced",
        "final stage",
        "finalize",
        "finalizing",
        "strengthening",
        "hypertrophy",
        "high volume",
        "high-volume",
        "clinically cleared",
        "cleared",
        "muscle mass",
        "fully recover",
        "full strength",
        "arm strength",
        "resistance exercise",
        "aggressive",
    ),
}

JOINT_TERMS: dict[JointFocus, tuple[str, ...]] = {
    "shoulder": (
        "shoulder",
        "shoulder joint",
        "deltoid",
        "lateral raise",
        "lateral",
        "abduction",
        "overhead",
    ),
    "elbow": (
        "elbow",
        "elbow joint",
        "elbow flexion",
        "elbow surgery",
        "forearm",
        "immobilization",
        "cast",
        "splint",
    ),
}

INTENSITY_REP_NOTE: dict[Intensity, str] = {
    "light": f"~{INTENSITY_REPS['light']} reps per programmed exercise",
    "medium": f"~{INTENSITY_REPS['medium']} reps per programmed exercise",
    "heavy": f"maximum on this arm ({INTENSITY_REPS['heavy']} reps per programmed exercise)",
}


@dataclass(frozen=True)
class RehabIntentMatch:
    route_id: str
    route: dict[str, Any]
    rationale: str
    confidence: float
    intensity: Intensity | None = None
    joint: JointFocus | None = None


def normalize_message(message: str) -> str:
    norm = re.sub(r"[^\w\s]", " ", str(message or "").lower())
    return " ".join(norm.split())


def _has_term(norm: str, term: str) -> bool:
    if " " in term:
        return term in norm
    return re.search(rf"\b{re.escape(term)}\b", norm) is not None


def detect_intensity(norm: str) -> tuple[Intensity, float]:
    scores: dict[Intensity, float] = {"light": 0.0, "medium": 0.0, "heavy": 0.0}

    # Patient past acute phase → medium (training set).
    if "no longer" in norm or "no acute" in norm or "without acute" in norm:
        scores["medium"] += 3.0

    for level, terms in INTENSITY_TERMS.items():
        for term in terms:
            if not _has_term(norm, term):
                continue
            if level == "light" and term == "acute":
                if "no longer" in norm or "no acute" in norm:
                    continue
            weight = (
                2.0
                if level == "light" and term in ("light", "gentle", "very light", "few repetitions")
                else 1.5
            )
            scores[level] += weight

    if _has_term(norm, "standard") and scores["light"] <= scores["medium"]:
        scores["medium"] += 1.5

    best = max(scores, key=scores.get)
    if scores[best] <= 0:
        return "medium", 0.5
    return best, scores[best]


def detect_joint(norm: str) -> JointFocus:
    shoulder = sum(1.5 for t in JOINT_TERMS["shoulder"] if _has_term(norm, t))
    elbow = sum(1.5 for t in JOINT_TERMS["elbow"] if _has_term(norm, t))
    if shoulder > elbow and shoulder >= 1.5:
        return "shoulder"
    if elbow > shoulder and elbow >= 1.5:
        return "elbow"
    return "general"


def pick_route(intensity: Intensity, _joint: JointFocus) -> str:
    """Intensity maps 1:1 to programmed route presets."""
    return intensity


def _build_rationale(route_id: str, intensity: Intensity, joint: JointFocus) -> str:
    route = build_route(route_id, joint if joint != "general" else None)
    level_label = {"light": "Light", "medium": "Medium", "heavy": "Heavy"}[intensity]
    if joint != "general":
        ex = JOINT_EXERCISE[joint]
        name = EXERCISE_LABELS.get(ex, ex)
        joint_label = f"{name} only"
    else:
        joint_label = "Bicep Curl + Lateral Raise + Elbow Flexion"
    rep_note = INTENSITY_REP_NOTE[intensity]
    step_text = " → ".join(f"{s['label']}×{s['reps']}" for s in route["steps"])
    return (
        f"{level_label} level · {joint_label} · {rep_note} — "
        f"{route['title']}: {step_text}."
    )


def is_rehab_intent(message: str) -> bool:
    norm = normalize_message(message)
    if not norm:
        return False
    if any(t in norm for t in LIST_TRIGGERS):
        return True
    if any(t in norm for t in REHAB_TRIGGERS):
        return True
    joint_words = ("elbow", "shoulder", "bicep", "wrist", "joint", "arm")
    activity_words = ("lifting", "flexion", "curl", "raise", "mobility", "rom", "exercise")
    return any(_has_term(norm, j) for j in joint_words) and any(
        _has_term(norm, a) for a in activity_words
    )


def is_list_all_request(message: str) -> bool:
    norm = normalize_message(message)
    if any(_has_term(norm, rid) for rid in ROUTE_META):
        return False
    if any(t in norm for t in LIST_TRIGGERS):
        return True
    # "all programmed exercises" is not a list-routes request.
    if "all programmed" in norm or "all exercises" in norm:
        return False
    has_list_word = any(_has_term(norm, w) for w in ("list", "available", "preset"))
    has_all_routes = (
        _has_term(norm, "all")
        and any(_has_term(norm, w) for w in ("routes", "routines", "programs", "presets"))
    )
    return (
        has_list_word
        and any(_has_term(norm, w) for w in ("route", "routine", "program"))
    ) or has_all_routes


def match_rehab_intent(message: str) -> RehabIntentMatch | None:
    """Map natural-language rehab goals to the closest preset route."""
    norm = normalize_message(message)
    if not norm or not is_rehab_intent(message):
        return None

    # Explicit preset name first — beats "list all" heuristics (e.g. "all programmed exercises").
    for rid in ROUTE_META:
        phrase = rid.replace("_", " ")
        if " " in phrase:
            matched = phrase in norm
        else:
            matched = _has_term(norm, rid)
        if not matched:
            continue
        intensity, conf = detect_intensity(norm)
        resolved = resolve_route_id(rid)
        route = build_route(resolved, None)
        return RehabIntentMatch(
            route_id=resolved,
            route=route,
            rationale=_build_rationale(resolved, intensity, "general"),
            confidence=5.0,
            intensity=intensity,
            joint="general",
        )
    for alias, resolved in (("intro", "light"), ("standard", "medium"), ("foundation", "medium")):
        if _has_term(norm, alias):
            intensity, conf = detect_intensity(norm)
            route = build_route(resolved, None)
            return RehabIntentMatch(
                route_id=resolved,
                route=route,
                rationale=_build_rationale(resolved, intensity, "general"),
                confidence=4.5,
                intensity=intensity,
                joint="general",
            )

    if is_list_all_request(message):
        return None

    intensity, conf = detect_intensity(norm)
    joint = detect_joint(norm)
    route_id = pick_route(intensity, joint)
    route = build_route(route_id, joint if joint != "general" else None)

    return RehabIntentMatch(
        route_id=route_id,
        route=route,
        rationale=_build_rationale(route_id, intensity, joint),
        confidence=conf,
        intensity=intensity,
        joint=joint,
    )


def routes_for_chat_query(message: str) -> tuple[list[dict[str, Any]], str | None] | None:
    """Return (routes, intent_note) for chat display, or None if not a rehab query."""
    if not is_rehab_intent(message):
        return None

    match = match_rehab_intent(message)
    if match:
        return [match.route], match.rationale

    if is_list_all_request(message):
        return list_routes(), (
            "Here are all preset rehab routines — built from the three programmed exercises: "
            "Bicep Curl, Lateral Raise, and Elbow Flexion."
        )

    return list_routes(), "Here are preset rehab routines that may fit."
