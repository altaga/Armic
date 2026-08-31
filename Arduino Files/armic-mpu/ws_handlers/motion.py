# SPDX-FileCopyrightText: Armic project
#
# SPDX-License-Identifier: MPL-2.0
"""Motion, safety, and hello WebSocket handlers."""

from armic import EXERCISES, JOINT_NAMES, PROTOCOLS

from agent.llm_agent import LlmAgent
from config import GRIPPER_WORDS
from context import AppContext
from sanity import sanity_payload
from rehab_routes import exercises_catalog
from ws_handlers.common import ack, calibration_payload


def register(ctx: AppContext, agent: LlmAgent) -> None:
    def on_hello(sid, _data):
        ctx.log.info(f"WS <- hello from {sid}")
        ctx.ui.send_message(
            "hello",
            {
                "protocols": list(PROTOCOLS),
                "exercises": list(EXERCISES),
                "exercise_catalog": exercises_catalog(),
                "routes": ctx.route_runner.routes_payload() if ctx.route_runner else [],
                "joints": list(JOINT_NAMES),
                "dry_run": ctx.arm.is_dry_run(),
                "state": ctx.arm.last_state,
                "calibration": calibration_payload(ctx),
                "agent_ready": agent.is_ready,
                "agent_warming": agent.is_warming,
                "sanity": sanity_payload(ctx),
                "route_status": (
                    ctx.route_runner.status()
                    if ctx.route_runner
                    else {"running": False}
                ),
            },
            sid,
        )

    def on_client_error(sid, data):
        d = data or {}
        ctx.log.warning(
            f"BROWSER JS ERROR: {d.get('message')} "
            f"@ {d.get('source')}:{d.get('line')}:{d.get('col')}"
        )
        if d.get("stack"):
            ctx.log.warning(f"  stack: {d['stack']}")

    def on_protocol(sid, data):
        name = str((data or {}).get("name", "")).strip()
        if name not in PROTOCOLS:
            ctx.log.warning(f"rejected unknown protocol {name!r}")
            return ack(ctx, sid, "protocol", False, name=name, reason="unknown protocol")
        ack(ctx, sid, "protocol", ctx.arm.protocol(name), name=name)

    def on_exercise(sid, data):
        name = str((data or {}).get("name", "")).strip()
        if name not in EXERCISES:
            ctx.log.warning(f"rejected unknown exercise {name!r}")
            return ack(ctx, sid, "exercise", False, name=name, reason="unknown exercise")
        try:
            reps = int((data or {}).get("reps", 6))
        except (TypeError, ValueError):
            reps = 6
        reps = max(1, min(6, reps))
        ack(ctx, sid, "exercise", ctx.arm.exercise(name, reps), name=name, reps=reps)

    def on_route_start(sid, data):
        rid = str((data or {}).get("id", "")).strip()
        runner = ctx.route_runner
        if not runner:
            return ack(ctx, sid, "route", False, reason="route runner unavailable")
        ok, msg = runner.start(rid, sid=sid)
        ack(ctx, sid, "route", ok, id=rid, message=msg)
        if ok:
            ctx.ui.send_message("route_status", runner.status(), sid)

    def on_route_stop(sid, _data):
        runner = ctx.route_runner
        if runner:
            runner.stop()
        ack(ctx, sid, "route_stop", True)

    def on_target(sid, data):
        d = data or {}
        try:
            x, y, z = float(d["x"]), float(d["y"]), float(d["z"])
            pitch = float(d.get("pitch", 90.0))
        except (KeyError, TypeError, ValueError) as exc:
            return ack(ctx, sid, "target", False, reason=f"bad args: {exc}")
        ack(ctx, sid, "target", ctx.arm.target(x, y, z, pitch), x=x, y=y, z=z, pitch=pitch)

    def on_joints(sid, data):
        d = data or {}
        try:
            b, sh = float(d["b"]), float(d["sh"])
            el, wr = float(d["el"]), float(d["wr"])
        except (KeyError, TypeError, ValueError) as exc:
            return ack(ctx, sid, "joints", False, reason=f"bad args: {exc}")
        ack(ctx, sid, "joints", ctx.arm.joints(b, sh, el, wr), b=b, sh=sh, el=el, wr=wr)

    def on_gripper(sid, data):
        raw = (data or {}).get("pct", 100)
        if isinstance(raw, str) and raw.strip().lower() in GRIPPER_WORDS:
            pct = GRIPPER_WORDS[raw.strip().lower()]
        else:
            try:
                pct = float(raw)
            except (TypeError, ValueError):
                return ack(ctx, sid, "gripper", False, reason=f"bad pct {raw!r}")
        ack(ctx, sid, "gripper", ctx.arm.gripper(pct), pct=pct)

    def on_payload(sid, data):
        try:
            kg = float((data or {}).get("kg", 0.0))
        except (TypeError, ValueError):
            return ack(ctx, sid, "payload", False, reason="bad kg")
        ack(ctx, sid, "payload", ctx.arm.payload(kg), kg=kg)

    def on_dry_run(sid, data):
        on = bool((data or {}).get("on", True))
        ack(ctx, sid, "dry_run", ctx.arm.dry_run(on), on=on)

    def on_park(sid, data):
        ack(ctx, sid, "park", ctx.arm.park())

    def on_halt(sid, data):
        ack(ctx, sid, "halt", ctx.arm.halt())

    def on_estop(sid, data):
        ctx.log.warning("E-STOP requested from UI")
        ack(ctx, sid, "estop", ctx.arm.estop())

    def on_release(sid, data):
        ctx.log.warning("torque release requested from UI — the arm will go limp")
        ack(ctx, sid, "release", ctx.arm.release())

    handlers = (
        ("hello", on_hello),
        ("client_error", on_client_error),
        ("protocol", on_protocol),
        ("exercise", on_exercise),
        ("route_start", on_route_start),
        ("route_stop", on_route_stop),
        ("target", on_target),
        ("joints", on_joints),
        ("gripper", on_gripper),
        ("payload", on_payload),
        ("dry_run", on_dry_run),
        ("park", on_park),
        ("halt", on_halt),
        ("estop", on_estop),
        ("release", on_release),
    )
    for name, handler in handlers:
        ctx.ui.on_message(name, handler)
