# SPDX-FileCopyrightText: Armic project
#
# SPDX-License-Identifier: MPL-2.0
"""Run multi-exercise rehab routes sequentially on the arm.

Flow per exercise (after Execute):
  1. Arm demos the full set (all reps) with S-curve motion, then returns home.
  2. Patient performs the same number of reps (wearable MQTT rep_end).
  3. When the final patient rep is detected, advance to the next exercise.

After the last exercise:
  4. Patient completes their final reps.
  5. Arm performs gimme-five, then the agent congratulates the patient.
"""

from __future__ import annotations

import threading
import time
from typing import TYPE_CHECKING, Any

from config import REHAB_PATIENT_REP_TIMEOUT_S
from rehab_routes import EXERCISE_LABELS, get_route, list_routes

if TYPE_CHECKING:
    from context import AppContext
    from mqtt_bridge import WearableMqttBridge

EXERCISE_MODES = frozenset({"bicep", "lateral", "elbowflex"})
MOTION_MODES = EXERCISE_MODES | frozenset({"home", "gimmefive", "cobra", "goto"})

CONGRATS: dict[str, str] = {
    "light": (
        "Good job! You finished the light routine — all three exercises with "
        "steady form. Nice work today; rest up and hydrate."
    ),
    "medium": (
        "Great work! Medium complete — six reps on each movement is real "
        "progression. You showed up and followed through. Well done."
    ),
    "heavy": (
        "Amazing — you powered through the heavy session! Maximum load on "
        "every exercise. That takes focus. Celebrate this one."
    ),
}


class RouteRunner:
    def __init__(self, ctx: AppContext) -> None:
        self._ctx = ctx
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._route_sid: str | None = None
        self._status: dict[str, Any] = {
            "running": False,
            "route_id": None,
            "route_title": None,
            "step_index": 0,
            "step_total": 0,
            "exercise": None,
            "reps": 0,
            "phase": "idle",
            "message": "idle",
        }

    def status(self) -> dict[str, Any]:
        with self._lock:
            return dict(self._status)

    def routes_payload(self) -> list[dict[str, Any]]:
        return list_routes()

    def is_running(self) -> bool:
        with self._lock:
            return bool(self._status.get("running"))

    def start(self, route_id: str, sid: str | None = None) -> tuple[bool, str]:
        route = get_route(route_id)
        if not route:
            return False, f"unknown route {route_id!r}"

        with self._lock:
            prev_alive = self._thread is not None and self._thread.is_alive()
        if prev_alive:
            self._ctx.log.info(
                f"route: stopping previous session before starting {route_id!r}"
            )
            self.stop()
            if self._thread:
                self._thread.join(timeout=5.0)
            with self._lock:
                still_alive = self._thread is not None and self._thread.is_alive()
            if still_alive:
                return False, "could not stop previous route — press Stop route and retry"

        self._route_sid = sid
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._run,
            args=(route,),
            name=f"rehab-route-{route['id']}",
            daemon=True,
        )
        self._thread.start()
        return True, f"started route {route['title']}"

    def stop(self) -> None:
        self._stop.set()
        self._ctx.arm.halt()
        self._set_status(message="stopping…", phase="stopping")

    def _set_status(self, **fields: Any) -> None:
        with self._lock:
            self._status.update(fields)
        self._ctx.ui.send_message("route_status", self.status())

    def _arm_state(self) -> dict[str, Any]:
        return self._ctx.arm.last_state or {}

    def _wait_motion_idle(self, timeout: float = 600.0) -> bool:
        """Wait until arm motion finishes and mode returns to idle."""
        deadline = time.monotonic() + timeout
        activate_by = time.monotonic() + 3.0
        seen_active = False
        while time.monotonic() < deadline:
            if self._stop.is_set():
                return False
            mode = str(self._arm_state().get("mode", "idle"))
            if mode in MOTION_MODES:
                seen_active = True
            elif not seen_active and time.monotonic() >= activate_by:
                self._ctx.log.warning(
                    f"route: arm never started motion (mode={mode!r})"
                )
                return False
            if seen_active and mode == "idle":
                return True
            time.sleep(0.05)
        self._ctx.log.warning("route: timed out waiting for arm motion to finish")
        return False

    def _mqtt(self) -> WearableMqttBridge | None:
        bridge = self._ctx.mqtt
        if bridge is None:
            return None
        return bridge  # type: ignore[return-value]

    def _exercise_label(self, exercise: str) -> str:
        return EXERCISE_LABELS.get(exercise, exercise.replace("_", " ").title())

    def _wait_patient_reps(self, exercise: str, reps: int) -> bool:
        """Wait until wearable reports the final patient rep (rep_end)."""
        mqtt = self._mqtt()
        label = self._exercise_label(exercise)
        self._set_status(
            phase="patient_turn",
            message=f"Your turn — complete {reps} reps of {label}",
        )
        if mqtt is None:
            self._ctx.log.warning(
                f"route: no MQTT bridge — cannot detect patient reps for {exercise}"
            )
            time.sleep(2.0)
            return True

        mqtt.publish_cmd({
            "cmd": "start_exercise",
            "exercise": exercise,
            "reps": reps,
        })
        mqtt.reset_patient_reps(exercise)
        if mqtt.wait_for_patient_reps(
            exercise,
            reps,
            timeout=REHAB_PATIENT_REP_TIMEOUT_S,
            stop_event=self._stop,
        ):
            return True
        if self._stop.is_set():
            return False

        self._ctx.log.warning(
            f"route: patient rep {reps} not detected for {exercise} "
            f"within {REHAB_PATIENT_REP_TIMEOUT_S}s — continuing"
        )
        return True

    def _arm_demo_exercise(self, exercise: str, reps: int) -> bool:
        """Arm performs the full guided set, then animated home."""
        label = self._exercise_label(exercise)
        self._set_status(
            phase="arm_demo",
            message=f"Watch the arm — {label} ×{reps}",
        )
        ok = self._ctx.arm.exercise(exercise, reps, gated=False)
        if not ok:
            self._ctx.log.warning(f"route: exercise_start failed for {exercise!r}")
            return False
        return self._wait_motion_idle(timeout=600.0)

    def _celebrate(self, route: dict[str, Any]) -> None:
        rid = str(route.get("id") or "")
        title = str(route.get("title") or rid)
        msg = CONGRATS.get(
            rid,
            f"Good job! {title} complete — excellent effort today.",
        )

        self._set_status(phase="celebration", message="Gimme five!")
        self._ctx.log.info(f"route {rid!r}: gimme five")
        self._ctx.arm.protocol("gimmefive")
        self._wait_motion_idle(timeout=120.0)

        payload = {"message": msg, "route_id": rid, "route_title": title}
        if self._route_sid:
            self._ctx.ui.send_message("route_congrats", payload, self._route_sid)
        else:
            self._ctx.ui.send_message("route_congrats", payload)

        self._set_status(phase="complete", message="Routine complete — great job!")

    def _run(self, route: dict[str, Any]) -> None:
        steps = route["steps"]
        rid = route["id"]
        title = route["title"]
        self._set_status(
            running=True,
            route_id=rid,
            route_title=title,
            step_index=0,
            step_total=len(steps),
            exercise=None,
            reps=0,
            steps=steps,
            phase="starting",
            message="starting",
        )
        self._ctx.log.info(f"route {rid!r} start ({len(steps)} steps)")

        try:
            for idx, step in enumerate(steps):
                if self._stop.is_set():
                    break

                exercise = str(step["exercise"])
                reps = int(step["reps"])
                is_last = idx == len(steps) - 1

                self._set_status(
                    step_index=idx + 1,
                    exercise=exercise,
                    reps=reps,
                )

                if not self._arm_demo_exercise(exercise, reps):
                    self._ctx.log.warning(f"route {rid}: arm demo failed on {exercise}")
                    break
                if self._stop.is_set():
                    break

                if not self._wait_patient_reps(exercise, reps):
                    self._ctx.log.warning(f"route {rid}: stopped during patient {exercise}")
                    break
                if self._stop.is_set():
                    break

                if is_last:
                    self._celebrate(route)
                else:
                    time.sleep(0.5)

        finally:
            self._set_status(
                running=False,
                route_id=None,
                route_title=None,
                step_index=0,
                step_total=0,
                exercise=None,
                reps=0,
                steps=[],
                phase="idle",
                message="idle",
            )
            self._route_sid = None
            self._ctx.log.info(f"route {rid!r} finished")
