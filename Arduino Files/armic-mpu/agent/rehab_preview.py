# SPDX-FileCopyrightText: Armic project
#
# SPDX-License-Identifier: MPL-2.0
"""Single-path rehab route preview for chat — card + agent commentary, no duplicates."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Callable

from agent.rehab_commentary import schedule_rehab_commentary
from agent.session import ChatSessionStore
from rehab_intent import RehabIntentMatch, is_list_all_request, is_rehab_intent, match_rehab_intent
from rehab_routes import get_route, list_routes, resolve_route_id

if TYPE_CHECKING:
    from arduino.app_bricks.web_ui import WebUI
    from arduino.app_utils import Logger
    from agent.llm_agent import LlmAgent

# Shared across agent WS handlers for this app process.
CHAT_SESSIONS = ChatSessionStore(max_turns=12)


def build_guidance(
    routes: list[dict[str, Any]],
    *,
    dry_run: bool,
    match: RehabIntentMatch | None = None,
    list_all: bool = False,
) -> str:
    """Fallback opinion when the LLM is unavailable — still clinical, not a duplicate list."""
    dry = (
        " Dry-run is on — disable it in the sidebar before Execute if you want motor assist."
        if dry_run
        else ""
    )

    if list_all or len(routes) > 1:
        return (
            "Start Light if tolerance is unknown; Medium for regular sessions; Heavy only with clean form. "
            f"Pick a card below.{dry}"
        )

    if not routes:
        return f"Try Light, Medium, or Heavy below.{dry}"

    route = routes[0]
    rid = str(route.get("id") or "light")

    if match and match.joint != "general" and match.route.get("steps"):
        label = match.route["steps"][0].get("label") or "this movement"
        return f"{rid.title()} focus on {label} — good when pain is localized. Card below.{dry}"

    opinions = {
        "light": "Light is a safe opener — low volume, good for warm-up or fragile days.",
        "medium": "Medium is your steady progression — watch lateral raise form.",
        "heavy": "Heavy is max load on this arm — stop if reps get sloppy.",
    }
    base = opinions.get(rid, "Routine ready.")
    return f"{base} Card below — Execute when set.{dry}"


def resolve_preview(
    message: str | None = None,
    route_id: str | None = None,
) -> tuple[list[dict[str, Any]], RehabIntentMatch | None, bool] | None:
    """Return (routes, match, list_all) or None if not a rehab preview request."""
    if route_id:
        rid = resolve_route_id(str(route_id).strip())
        route = get_route(rid)
        if not route:
            return None
        match = match_rehab_intent(rid) or match_rehab_intent(f"{rid} rehab routine")
        return [route], match, False

    if not message:
        return None

    if not is_rehab_intent(message):
        return None

    match = match_rehab_intent(message)
    if match:
        return [match.route], match, False

    if is_list_all_request(message):
        return list_routes(), None, True

    return list_routes(), None, False


def emit_rehab_preview(
    ui: WebUI,
    sid: str,
    routes: list[dict[str, Any]],
    *,
    agent: LlmAgent | None = None,
    log: Logger | None = None,
    user_message: str = "",
    dry_run: bool = False,
    match: RehabIntentMatch | None = None,
    list_all: bool = False,
    end_stream: bool = True,
    commentary: bool = True,
    session_context: str = "",
    on_commentary: Callable[[str], None] | None = None,
) -> str:
    """Stream short opinion first, then route card(s)."""
    fallback = build_guidance(
        routes, dry_run=dry_run, match=match, list_all=list_all
    )

    def _send_routes() -> None:
        ui.send_message(
            "agent_routes",
            {"routes": routes, "preview": True},
            sid,
        )

    if commentary and agent is not None and log is not None:
        schedule_rehab_commentary(
            agent,
            ui,
            sid,
            user_message or "rehab routine",
            routes,
            log,
            dry_run=dry_run,
            match=match,
            list_all=list_all,
            fallback_text=fallback,
            session_context=session_context,
            on_complete=on_commentary,
            send_routes_after=_send_routes,
        )
        return fallback

    _send_routes()
    if end_stream:
        ui.send_message("agent_stream_end", {}, sid)
    return fallback


def preview_from_route_id(
    ui: WebUI,
    sid: str,
    route_id: str,
    *,
    agent: LlmAgent,
    log: Logger,
    dry_run: bool,
    user_message: str | None = None,
) -> bool:
    """Show one preset route (Light/Medium/Heavy buttons)."""
    resolved = resolve_preview(route_id=route_id)
    if resolved is None:
        return False
    routes, match, list_all = resolved
    if not user_message:
        label = route_id.replace("_", " ").title()
        user_message = f"{label} routine"

    def _record(reply: str) -> None:
        CHAT_SESSIONS.add_turn(sid, user_message, reply)
        CHAT_SESSIONS.mark_context_sync(sid)

    emit_rehab_preview(
        ui,
        sid,
        routes,
        agent=agent,
        log=log,
        user_message=user_message,
        dry_run=dry_run,
        match=match,
        list_all=list_all,
        session_context=CHAT_SESSIONS.context_block(sid),
        on_commentary=_record,
    )
    return True
