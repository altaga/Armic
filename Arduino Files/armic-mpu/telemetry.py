# SPDX-FileCopyrightText: Armic project
#
# SPDX-License-Identifier: MPL-2.0
"""Fan-out MCU telemetry to every connected browser."""

from armic import Armic

from context import AppContext


def register_telemetry(ctx: AppContext) -> None:
    def on_state(state: dict) -> None:
        payload = dict(state)
        payload["line"] = Armic.state_line(state)
        ctx.ui.send_message("state", payload)

    ctx.arm.on_state(on_state)
