# SPDX-FileCopyrightText: Armic project
#
# SPDX-License-Identifier: MPL-2.0
"""Natural-language protocol matching for the arm agent."""

import re

from armic import PROTOCOLS

from config import PROTOCOL_ALIASES


def normalize_message(message: str) -> str:
    """Collapse punctuation and whitespace for fuzzy matching."""
    norm = re.sub(r"[^\w\s]", " ", message.lower())
    return " ".join(norm.split())


def match_protocol_command(message: str) -> str | None:
    """Return a protocol name if the user message is a known motion phrase."""
    norm = normalize_message(message)
    if "heavy tucked lift" in norm or re.search(r"\bhtl\b", norm):
        return "htl"
    if "gimme five" in norm or "give me five" in norm or norm in ("gimmefive", "gimme 5"):
        return "gimmefive"
    if "c pose" in norm or norm in ("cpose", "move to cpose", "go to cpose"):
        return "cpose"
    return None


def resolve_protocol_name(raw: str) -> str:
    """Map user or tool text to a canonical protocol id."""
    key = raw.strip().lower()
    return PROTOCOL_ALIASES.get(key, key)


def format_protocol_result(name: str, ok: bool, *, dry_run: bool) -> str:
    """Human-readable outcome for protocol start attempts."""
    if ok:
        extra = (
            " Dry run is ON — turn it off in the UI if servos should move."
            if dry_run
            else ""
        )
        return f"Started {name!r}.{extra}"
    return (
        f"Could not start {name!r} — the arm may be busy or the firmware declined the command."
    )


def unknown_protocol_message(raw: str) -> str:
    return f"Unknown protocol {raw!r}. Choose from: {', '.join(PROTOCOLS)}."
