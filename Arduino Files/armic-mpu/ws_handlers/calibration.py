# SPDX-FileCopyrightText: Armic project
#
# SPDX-License-Identifier: MPL-2.0
"""Calibration WebSocket handlers."""

from context import AppContext
from ws_handlers.common import ack, calibration_payload


def register(ctx: AppContext) -> None:
    def on_cal_get(sid, _data):
        ctx.ui.send_message("calibration", calibration_payload(ctx), sid)

    def on_cal_stage(sid, data):
        d = data or {}
        joint = str(d.get("joint", ""))
        fields = {k: v for k, v in d.items() if k != "joint"}
        if not fields:
            return ack(ctx, sid, "cal_stage", False, joint=joint, reason="no fields given")
        ok = ctx.arm.stage(joint, **fields)
        ack(ctx, sid, "cal_stage", ok, joint=joint)
        on_cal_get(sid, None)

    def on_cal_commit(sid, _data):
        ok, msg = ctx.arm.commit()
        ctx.log.info(f"calibration commit -> ok={ok} ({msg})")
        ack(ctx, sid, "cal_commit", ok, reason=msg)
        on_cal_get(sid, None)

    def on_cal_revert(sid, _data):
        ack(ctx, sid, "cal_revert", ctx.arm.revert())
        on_cal_get(sid, None)

    def on_cal_defaults(sid, _data):
        ack(ctx, sid, "cal_defaults", ctx.arm.restore_defaults())
        on_cal_get(sid, None)

    for name, handler in (
        ("cal_get", on_cal_get),
        ("cal_stage", on_cal_stage),
        ("cal_commit", on_cal_commit),
        ("cal_revert", on_cal_revert),
        ("cal_defaults", on_cal_defaults),
    ):
        ctx.ui.on_message(name, handler)
