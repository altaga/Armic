# SPDX-FileCopyrightText: Armic project
#
# SPDX-License-Identifier: MPL-2.0
"""LLM tool definitions for arm motion and rehab routes."""

from typing import Callable

from arduino.app_bricks.llm import tool
from arduino.app_bricks.web_ui import WebUI

from armic import PROTOCOLS, Armic

from agent.protocol import (
    format_protocol_result,
    resolve_protocol_name,
    unknown_protocol_message,
)
from agent.rehab_preview import emit_rehab_preview, resolve_preview
from rehab_routes import exercises_catalog, get_route, list_routes, suggest_route, resolve_route_id


def _route_payload(route: dict) -> dict:
    return {
        "id": route["id"],
        "title": route["title"],
        "intensity": route.get("intensity"),
        "summary": route.get("summary"),
        "steps": route.get("steps", []),
        "exercises": route.get("exercises", exercises_catalog()),
    }


def build_agent_tools(
    arm: Armic,
    ui: WebUI,
    get_chat_sid: Callable[[], str | None],
):
    """Create LLM tools bound to live arm + chat UI."""

    def _emit(routes: list[dict], *, match=None, list_all: bool = False) -> None:
        sid = get_chat_sid()
        if sid and routes:
            emit_rehab_preview(
                ui,
                sid,
                routes,
                dry_run=arm.is_dry_run(),
                match=match,
                list_all=list_all,
                end_stream=False,
                commentary=False,
            )

    @tool
    def run_arm_protocol(protocol: str) -> str:
        """Run a single pre-programmed motion (not a full rehab route).

        Protocols: home, cpose, transport, snake, cobra, gimmefive, orbital, htl, pendulum.
        """
        name = resolve_protocol_name(protocol)
        if name not in PROTOCOLS:
            return unknown_protocol_message(protocol)
        ok = arm.protocol(name)
        return format_protocol_result(name, ok, dry_run=arm.is_dry_run())

    @tool
    def list_rehab_routes() -> str:
        """List preset rehab routes for display in chat (does not run the arm).

        Three presets (light, medium, heavy) using Bicep Curl, Lateral Raise, Elbow Flexion.
        """
        routes = list_routes()
        _emit(routes, list_all=True)
        return "Cards will appear after your reply. One or two short sentences only — no exercise list."

    @tool
    def suggest_rehab_intent(description: str) -> str:
        """Match natural-language rehab goals to a preset route (display only)."""
        resolved = resolve_preview(message=description)
        if not resolved:
            _emit(list_routes(), list_all=True)
            return "Cards will appear after your reply. One or two short sentences only — no exercise list."
        routes, match, list_all = resolved
        _emit(routes, match=match, list_all=list_all)
        return "Card will appear after your reply. One or two short sentences only — no exercise list."

    @tool
    def show_rehab_route(route_id: str) -> str:
        """Show one rehab route in chat (does not run the arm).

        route_id: light | medium | heavy (aliases: intro, standard, acute, …)
        """
        rid = suggest_route(route_id) or resolve_route_id(route_id)
        route = get_route(rid)
        if not route:
            return f"Unknown route {route_id!r}. Use light, medium, or heavy."
        payload = _route_payload(route)
        _emit([payload])
        return "Card will appear after your reply. One or two short sentences only — no route details."

    return [run_arm_protocol, list_rehab_routes, suggest_rehab_intent, show_rehab_route]
