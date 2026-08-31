# SPDX-FileCopyrightText: Armic project
#
# SPDX-License-Identifier: MPL-2.0
"""LLM clinical commentary for rehab previews — opinion without repeating the card."""

from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request
from typing import TYPE_CHECKING, Any, Callable, Iterator

from config import LLM_MODEL_ID, LLM_REQUEST_TIMEOUT_S, LLM_RUNNER_CHAT_URL

if TYPE_CHECKING:
    from arduino.app_bricks.web_ui import WebUI
    from arduino.app_utils import Logger
    from agent.llm_agent import LlmAgent

    from rehab_intent import RehabIntentMatch

COMMENTARY_SYSTEM = """You are Armic, a rehab arm assistant. A routine card will appear AFTER your message.

Reply in 1–2 short sentences only (under 35 words).
- One clinical opinion: why this intensity fits OR what to watch for.
- If dry-run is on, note motors are gated.
- Do NOT list exercises or reps (the card shows them). No bullet points."""


def _format_steps(route: dict[str, Any]) -> str:
    steps = route.get("steps") or []
    return ", ".join(
        f"{s.get('label') or s.get('exercise')} ({s.get('reps')} reps)" for s in steps
    )


def build_commentary_prompt(
    user_message: str,
    routes: list[dict[str, Any]],
    *,
    dry_run: bool,
    match: RehabIntentMatch | None = None,
    list_all: bool = False,
    session_context: str = "",
) -> str:
    lines = [f'Clinician message: "{user_message.strip()}"', ""]
    if session_context.strip():
        lines.append(session_context.strip())
        lines.append("")
    if list_all or len(routes) > 1:
        lines.append("Showing all preset routines (light, medium, heavy):")
        for r in routes:
            lines.append(f"  • {r.get('title')}: {r.get('summary', '')}")
        lines.append("Opinion: pick the right intensity for today.")
    else:
        r = routes[0]
        lines.append(f"Routine: {r.get('title')}")
        lines.append(f"Summary: {r.get('summary', '')}")
        lines.append(f"Steps (context only): {_format_steps(r)}")
        if match and match.joint != "general":
            lines.append(f"Joint focus: {match.joint}")
    lines.append(f"Dry-run: {dry_run}")
    return "\n".join(lines)


def _fetch_commentary(prompt: str) -> str:
    body = json.dumps(
        {
            "model": LLM_MODEL_ID,
            "messages": [
                {"role": "system", "content": COMMENTARY_SYSTEM},
                {"role": "user", "content": prompt},
            ],
            "max_tokens": 64,
            "temperature": 0.5,
            "stream": False,
        }
    ).encode()
    request = urllib.request.Request(
        LLM_RUNNER_CHAT_URL,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=LLM_REQUEST_TIMEOUT_S) as response:
        data = json.loads(response.read().decode())
    return str(data["choices"][0]["message"]["content"]).strip()


def stream_commentary_chunks(text: str) -> Iterator[str]:
    words = text.split()
    buf: list[str] = []
    for word in words:
        buf.append(word)
        if len(buf) >= 3:
            yield " ".join(buf) + " "
            buf = []
    if buf:
        yield " ".join(buf)


def schedule_rehab_commentary(
    agent: LlmAgent,
    ui: WebUI,
    sid: str,
    user_message: str,
    routes: list[dict[str, Any]],
    log: Logger,
    *,
    dry_run: bool,
    match: RehabIntentMatch | None = None,
    list_all: bool = False,
    fallback_text: str,
    session_context: str = "",
    on_complete: Callable[[str], None] | None = None,
    send_routes_after: Callable[[], None] | None = None,
) -> None:
    """Background: stream short opinion first, then route card(s)."""

    def _run() -> None:
        prompt = build_commentary_prompt(
            user_message,
            routes,
            dry_run=dry_run,
            match=match,
            list_all=list_all,
            session_context=session_context,
        )
        text = ""
        try:
            if agent.wait_until_ready(timeout=45):
                text = _fetch_commentary(prompt)
            else:
                log.warning("rehab commentary: LLM not ready, using fallback")
                text = fallback_text
        except (urllib.error.URLError, TimeoutError, OSError, KeyError, IndexError) as exc:
            log.warning(f"rehab commentary failed: {exc}")
            text = fallback_text

        if not text:
            text = fallback_text

        try:
            for chunk in stream_commentary_chunks(text):
                ui.send_message("agent_response", {"text": chunk}, sid)
            if on_complete:
                on_complete(text)
            if send_routes_after:
                send_routes_after()
        finally:
            ui.send_message("agent_stream_end", {}, sid)

    threading.Thread(target=_run, name="rehab-commentary", daemon=True).start()
