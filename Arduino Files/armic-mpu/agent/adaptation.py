# SPDX-FileCopyrightText: Armic project
#
# SPDX-License-Identifier: MPL-2.0
"""Wearable rep quality → protocol adaptation (AGENTS.md §7).

3 consecutive rep_end with quality ≥ 0.75 → widen ROM 5° and/or ease speed cap.
3 consecutive rep_end with quality < 0.40 → narrow ROM 5° and/or reduce speed.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

HIGH_QUALITY = 0.75
LOW_QUALITY = 0.40
STREAK_REQUIRED = 3
ROM_STEP_DEG = 5.0
SPEED_STEP_DEG_S = 2.0


@dataclass(frozen=True, slots=True)
class AdaptationDecision:
    """Outcome of adaptation_decision for one rep_end event."""

    action: Literal["progress", "regress", "none"]
    rom_delta_deg: float
    speed_delta_deg_s: float
    quality: float
    rom_deg: float
    exercise: str
    streak: int
    reason: str


class RepAdaptationTracker:
    """Per-exercise consecutive high/low quality streaks."""

    def __init__(self) -> None:
        self._hi: dict[str, int] = {}
        self._lo: dict[str, int] = {}

    def reset(self, exercise: str) -> None:
        key = exercise.strip().lower()
        self._hi.pop(key, None)
        self._lo.pop(key, None)


def adaptation_decision(
    exercise: str,
    quality: float,
    rom_deg: float,
    *,
    tracker: RepAdaptationTracker,
) -> AdaptationDecision:
    """Evaluate one rep_end and return whether to progress or regress difficulty."""
    ex = exercise.strip().lower() or "unknown"
    q = max(0.0, min(1.0, float(quality)))

    if q >= HIGH_QUALITY:
        tracker._lo[ex] = 0
        streak = tracker._hi.get(ex, 0) + 1
        tracker._hi[ex] = streak
        if streak >= STREAK_REQUIRED:
            tracker._hi[ex] = 0
            return AdaptationDecision(
                action="progress",
                rom_delta_deg=ROM_STEP_DEG,
                speed_delta_deg_s=0.0,
                quality=q,
                rom_deg=rom_deg,
                exercise=ex,
                streak=streak,
                reason=(
                    f"{STREAK_REQUIRED} consecutive reps ≥ {HIGH_QUALITY:.2f} quality — "
                    f"widen ROM +{ROM_STEP_DEG:.0f}° for next set."
                ),
            )
        return AdaptationDecision(
            action="none",
            rom_delta_deg=0.0,
            speed_delta_deg_s=0.0,
            quality=q,
            rom_deg=rom_deg,
            exercise=ex,
            streak=streak,
            reason=f"High-quality rep ({q:.2f}); streak {streak}/{STREAK_REQUIRED}.",
        )

    if q < LOW_QUALITY:
        tracker._hi[ex] = 0
        streak = tracker._lo.get(ex, 0) + 1
        tracker._lo[ex] = streak
        if streak >= STREAK_REQUIRED:
            tracker._lo[ex] = 0
            return AdaptationDecision(
                action="regress",
                rom_delta_deg=-ROM_STEP_DEG,
                speed_delta_deg_s=-SPEED_STEP_DEG_S,
                quality=q,
                rom_deg=rom_deg,
                exercise=ex,
                streak=streak,
                reason=(
                    f"{STREAK_REQUIRED} consecutive reps < {LOW_QUALITY:.2f} quality — "
                    f"narrow ROM −{ROM_STEP_DEG:.0f}° and cap speed −{SPEED_STEP_DEG_S:.0f}°/s."
                ),
            )
        return AdaptationDecision(
            action="none",
            rom_delta_deg=0.0,
            speed_delta_deg_s=0.0,
            quality=q,
            rom_deg=rom_deg,
            exercise=ex,
            streak=streak,
            reason=f"Low-quality rep ({q:.2f}); streak {streak}/{STREAK_REQUIRED}.",
        )

    tracker._hi[ex] = 0
    tracker._lo[ex] = 0
    return AdaptationDecision(
        action="none",
        rom_delta_deg=0.0,
        speed_delta_deg_s=0.0,
        quality=q,
        rom_deg=rom_deg,
        exercise=ex,
        streak=0,
        reason=f"Mid-band quality ({q:.2f}) — hold current ROM and speed.",
    )
