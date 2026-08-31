# SPDX-FileCopyrightText: Armic project
#
# SPDX-License-Identifier: MPL-2.0
"""LLM agent WebSocket handlers."""

from agent.llm_agent import LlmAgent
from agent.protocol import format_protocol_result, match_protocol_command
from agent.rehab_preview import CHAT_SESSIONS, preview_from_route_id
from context import AppContext


def register(ctx: AppContext, agent: LlmAgent) -> None:
    def on_agent_show_route(sid, data):
        route_id = str((data or {}).get("route_id", "")).strip()
        if not route_id:
            ctx.ui.send_message("agent_error", {"error": "missing route_id"}, sid)
            return
        user_message = str((data or {}).get("message", "")).strip() or None
        ctx.log.info(f"agent show_route <- {route_id!r}")
        if not preview_from_route_id(
            ctx.ui,
            sid,
            route_id,
            agent=agent,
            log=ctx.log,
            dry_run=ctx.arm.is_dry_run(),
            user_message=user_message,
        ):
            ctx.ui.send_message(
                "agent_error", {"error": f"unknown route {route_id!r}"}, sid
            )

    def on_agent_clear(sid, _data):
        CHAT_SESSIONS.clear(sid)
        agent.clear_memory()
        ctx.ui.send_message("agent_chat_cleared", {}, sid)
        ctx.log.info(f"agent chat cleared for {sid}")

    def on_agent_prompt(sid, data):
        message = str((data or {}).get("message", "")).strip()
        if not message:
            ctx.ui.send_message("agent_error", {"error": "empty message"}, sid)
            return

        ctx.log.info(f"agent chat <- {message[:80]!r}")

        if not agent.is_ready:
            agent.publish_status(sid, warming=True)
            if not agent.wait_until_ready():
                ctx.ui.send_message("agent_error", {"error": "LLM warmup timed out"}, sid)
                return

        proto = match_protocol_command(message)
        if proto:
            reply = format_protocol_result(
                proto,
                ctx.arm.protocol(proto),
                dry_run=ctx.arm.is_dry_run(),
            )
            ctx.log.info(f"agent direct protocol {proto!r} -> {reply}")
            ctx.ui.send_message("agent_response", {"text": reply}, sid)
            ctx.ui.send_message("agent_stream_end", {}, sid)
            CHAT_SESSIONS.add_turn(sid, message, reply)
            return

        context = CHAT_SESSIONS.pop_context_for_sync(sid)
        reply_parts: list[str] = []
        try:
            for chunk in agent.stream_reply(message, sid, context=context):
                reply_parts.append(chunk)
                ctx.ui.send_message("agent_response", {"text": chunk}, sid)
            ctx.ui.send_message("agent_stream_end", {}, sid)
            if reply_parts:
                CHAT_SESSIONS.add_turn(sid, message, "".join(reply_parts))
        except Exception as exc:
            ctx.log.warning(f"agent chat failed: {exc}")
            ctx.ui.send_message("agent_error", {"error": str(exc)}, sid)

    def on_agent_stop(sid, _data):
        try:
            agent.stop_stream()
            ctx.ui.send_message("agent_stream_end", {}, sid)
        except Exception as exc:
            ctx.ui.send_message("agent_error", {"error": str(exc)}, sid)

    def on_disconnect(sid):
        CHAT_SESSIONS.clear(sid)

    ctx.ui.on_message("agent_prompt", on_agent_prompt)
    ctx.ui.on_message("agent_show_route", on_agent_show_route)
    ctx.ui.on_message("agent_clear", on_agent_clear)
    ctx.ui.on_message("agent_stop", on_agent_stop)
    ctx.ui.on_disconnect(on_disconnect)
