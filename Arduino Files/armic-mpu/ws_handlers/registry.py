# SPDX-FileCopyrightText: Armic project
#
# SPDX-License-Identifier: MPL-2.0
"""Register every WebSocket route on the WebUI brick."""

from agent.llm_agent import LlmAgent
from context import AppContext
from sanity import sanity_payload
from ws_handlers import agent, bench, calibration, motion
from ws_handlers.common import calibration_payload


def register_all(ctx: AppContext, agent_runtime: LlmAgent) -> None:
    motion.register(ctx, agent_runtime)
    calibration.register(ctx)
    bench.register(ctx)
    agent.register(ctx, agent_runtime)

    ctx.ui.expose_api("GET", "/calibration", lambda: calibration_payload(ctx))

    def on_browser_connect(sid: str) -> None:
        ctx.log.info(f"browser {sid} connected")
        agent_runtime.publish_status(sid)
        ctx.ui.send_message("system_sanity", sanity_payload(ctx), sid)

    ctx.ui.on_connect(on_browser_connect)
    ctx.ui.on_disconnect(lambda sid: ctx.log.info(f"browser {sid} disconnected"))
