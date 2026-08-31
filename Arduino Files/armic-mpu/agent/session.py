# SPDX-FileCopyrightText: Armic project
#
# SPDX-License-Identifier: MPL-2.0
"""Per-browser chat session history for multi-turn agent follow-up."""

from __future__ import annotations

from threading import Lock


class ChatSessionStore:
    """Keeps recent user/assistant turns per WebSocket client id."""

    def __init__(self, max_turns: int = 12) -> None:
        self._max_turns = max_turns
        self._turns: dict[str, list[tuple[str, str]]] = {}
        self._needs_sync: set[str] = set()
        self._lock = Lock()

    def add_turn(self, sid: str, user: str, assistant: str) -> None:
        user = (user or "").strip()
        assistant = (assistant or "").strip()
        if not sid or not user:
            return
        with self._lock:
            bucket = self._turns.setdefault(sid, [])
            bucket.append((user, assistant))
            if len(bucket) > self._max_turns:
                self._turns[sid] = bucket[-self._max_turns :]

    def mark_context_sync(self, sid: str) -> None:
        """Next LLM turn should prepend session history (e.g. after a preset card)."""
        if sid:
            with self._lock:
                self._needs_sync.add(sid)

    def pop_context_for_sync(self, sid: str) -> str:
        with self._lock:
            if sid not in self._needs_sync:
                return ""
            self._needs_sync.discard(sid)
        return self.context_block(sid)

    def clear(self, sid: str) -> None:
        with self._lock:
            self._turns.pop(sid, None)
            self._needs_sync.discard(sid)

    def has_history(self, sid: str) -> bool:
        with self._lock:
            return bool(self._turns.get(sid))

    def context_block(self, sid: str, *, max_turns: int = 5) -> str:
        with self._lock:
            turns = list(self._turns.get(sid, []))
        if not turns:
            return ""
        lines = ["Recent conversation on this session:"]
        for user, assistant in turns[-max_turns:]:
            lines.append(f"Clinician: {user}")
            if assistant:
                lines.append(f"Armic: {assistant}")
        lines.append("")
        return "\n".join(lines)
