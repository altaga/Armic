# SPDX-FileCopyrightText: Armic project
#
# SPDX-License-Identifier: MPL-2.0
"""Shared WebSocket helpers."""

from armic import (
    DEFAULT_CALIBRATION,
    JOINT_NAMES,
    PWM_CEIL_HARD,
    PWM_FLOOR_HARD,
)

from context import AppContext


def ack(ctx: AppContext, sid: str, cmd: str, ok: bool, **extra) -> None:
    ctx.log.info(f"WS <- {cmd} {extra if extra else ''} -> ok={bool(ok)}")
    ctx.ui.send_message("ack", {"cmd": cmd, "ok": bool(ok), **extra}, sid)


def calibration_payload(ctx: AppContext) -> dict:
    return {
        "committed": ctx.arm.get_calibration(),
        "staged": ctx.arm.get_staged(),
        "firmware": ctx.arm.firmware_calibration(),
        "dirty": ctx.arm.is_dirty(),
        "defaults": DEFAULT_CALIBRATION,
        "joints": list(JOINT_NAMES),
        "envelope": {"pwm_min": PWM_FLOOR_HARD, "pwm_max": PWM_CEIL_HARD},
    }
