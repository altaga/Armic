# SPDX-FileCopyrightText: Armic project
#
# SPDX-License-Identifier: MPL-2.0
"""Bench / PWM WebSocket handlers (bypass stored calibration)."""

from context import AppContext
from ws_handlers.common import ack


def register(ctx: AppContext) -> None:
    def on_pwm_write(sid, data):
        d = data or {}
        try:
            ch, value = int(d["ch"]), int(d["value"])
        except (KeyError, TypeError, ValueError) as exc:
            return ack(ctx, sid, "pwm_write", False, reason=f"bad args: {exc}")
        ok = ctx.arm.pwm_write(ch, value)
        ack(
            ctx,
            sid,
            "pwm_write",
            ok,
            ch=ch,
            value=value,
            reason="" if ok else "refused (dry run on, or out of range)",
        )

    def on_sweep(sid, data):
        d = data or {}
        try:
            ch = int(d["ch"])
            start, end = int(d["from"]), int(d["to"])
            ms = int(d.get("ms", 2000))
        except (KeyError, TypeError, ValueError) as exc:
            return ack(ctx, sid, "sweep", False, reason=f"bad args: {exc}")
        ok = ctx.arm.sweep(ch, start, end, ms)
        ack(
            ctx,
            sid,
            "sweep",
            ok,
            ch=ch,
            reason="" if ok else "refused (dry run on, or out of range)",
        )

    def on_sweep_active(sid, _data):
        ctx.ui.send_message("sweep_active", {"active": ctx.arm.sweep_active()}, sid)

    def on_release_channel(sid, data):
        try:
            ch = int((data or {}).get("ch"))
        except (TypeError, ValueError):
            return ack(ctx, sid, "release_channel", False, reason="bad channel")
        ack(ctx, sid, "release_channel", ctx.arm.release_channel(ch), ch=ch)

    for name, handler in (
        ("pwm_write", on_pwm_write),
        ("sweep", on_sweep),
        ("sweep_active", on_sweep_active),
        ("release_channel", on_release_channel),
    ):
        ctx.ui.on_message(name, handler)
