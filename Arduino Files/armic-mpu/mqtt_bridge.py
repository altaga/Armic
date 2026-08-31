# SPDX-FileCopyrightText: Armic project
#
# SPDX-License-Identifier: MPL-2.0
"""MQTT subscriber for M5 Core2 wearable Edge Impulse results."""

from __future__ import annotations

import json
import os
import socket
import threading
import time
from typing import TYPE_CHECKING, Any, Callable

import paho.mqtt.client as mqtt

from agent.adaptation import RepAdaptationTracker, adaptation_decision
from config import (
    MQTT_BOARD_MDNS,
    MQTT_BROKER_HOST,
    MQTT_BROKER_PORT,
    MQTT_SCHEMA_VERSION,
    MQTT_TOPIC_ORCHESTRATOR_CMD,
    MQTT_TOPIC_WEARABLE_PUBLISH,
)

if TYPE_CHECKING:
    from arduino.app_utils import Logger

    from context import AppContext


def board_mdns_host() -> str:
    """Return the board's .local hostname for external MQTT clients."""
    override = os.getenv("ARMIC_MDNS_HOST", "").strip().lower()
    if override:
        return override
    for key in ("BOARD_MDNS", "MDNS_HOST", "BOARD_HOSTNAME"):
        val = os.getenv(key, "").strip().lower()
        if val:
            return val if val.endswith(".local") else f"{val}.local"
    # Docker reports the container id as hostname, not the UNO Q mDNS name.
    if os.path.exists("/.dockerenv"):
        return MQTT_BOARD_MDNS
    short = socket.gethostname().split(".", 1)[0].lower()
    if short:
        return f"{short}.local"
    return MQTT_BOARD_MDNS


def broker_host() -> str:
    val = os.getenv("MQTT_BROKER_HOST", "").strip()
    if val:
        return val
    return MQTT_BROKER_HOST


def _parse_payload(raw: bytes) -> dict[str, Any] | None:
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def normalize_wearable_exercise(name: str) -> str:
    """Map wearable exercise ids to route ids (bicep, lateral, elbowflex)."""
    key = str(name or "").strip().lower().replace(" ", "").replace("-", "").replace("_", "")
    aliases = {
        "bicep": "bicep",
        "bicepcurl": "bicep",
        "lateral": "lateral",
        "lateralraise": "lateral",
        "elbowflex": "elbowflex",
        "elbowflexion": "elbowflex",
        "elbow": "elbowflex",
    }
    return aliases.get(key, key)


def _rep_fields(data: dict[str, Any]) -> tuple[str, int, float, float]:
    """Extract exercise, rep index, quality, rom from flat or nested MQTT envelope."""
    inner = data.get("payload")
    src = inner if isinstance(inner, dict) else data
    ex_raw = str(src.get("exercise", data.get("exercise", ""))).strip()
    try:
        rep_num = int(src.get("rep_index", src.get("rep", data.get("rep", 0))))
    except (TypeError, ValueError):
        rep_num = 0
    try:
        quality = float(
            src.get("quality_0_1", src.get("quality_score", data.get("quality_score", 0)))
        )
    except (TypeError, ValueError):
        quality = 0.0
    try:
        rom = float(src.get("actual_rom_deg", src.get("rom_deg", data.get("rom_deg", 0))))
    except (TypeError, ValueError):
        rom = 0.0
    return ex_raw, rep_num, quality, rom


def _validate_common(data: dict[str, Any]) -> str | None:
    if data.get("schema") != MQTT_SCHEMA_VERSION:
        return f"unsupported schema {data.get('schema')!r}"
    msg_type = str(data.get("msg_type", "")).strip()
    if not msg_type:
        return "missing msg_type"
    device_id = str(data.get("device_id", "")).strip()
    if not device_id:
        return "missing device_id"
    return None


class WearableMqttBridge:
    """Subscribe to wearable MQTT topics and fan out to the Web UI."""

    def __init__(self, ctx: AppContext, log: Logger) -> None:
        self._ctx = ctx
        self._log = log
        self._client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=f"armic-orchestrator-{socket.gethostname()}",
        )
        self._client.on_connect = self._on_connect
        self._client.on_message = self._on_message
        self._thread: threading.Thread | None = None
        self._last_heartbeat: dict[str, Any] | None = None
        self._last_inference: dict[str, Any] | None = None
        self._mqtt_connected = False
        self._last_wearable_at = 0.0
        self._last_wearable_device: str | None = None
        self._sanity_listener: Callable[[], None] | None = None
        self._rep_cv = threading.Condition()
        self._patient_rep_max: dict[str, int] = {}
        self._patient_rep_end_count: dict[str, int] = {}
        self._adapt_tracker = RepAdaptationTracker()

    def set_sanity_listener(self, listener: Callable[[], None] | None) -> None:
        self._sanity_listener = listener

    def _notify_sanity(self) -> None:
        if self._sanity_listener:
            try:
                self._sanity_listener()
            except Exception as exc:
                self._log.warning(f"sanity listener failed: {exc}")

    def mqtt_sanity(self) -> dict:
        now = time.monotonic()
        broker = f"{board_mdns_host()}:{MQTT_BROKER_PORT}"
        if not self._mqtt_connected:
            return {
                "status": "err",
                "detail": "Broker not connected",
                "broker": broker,
                "subscribed": False,
                "wearable_age_s": None,
                "wearable_device": self._last_wearable_device,
            }

        wearable_age = now - self._last_wearable_at if self._last_wearable_at else None
        if wearable_age is not None and wearable_age < 90.0:
            status = "ok"
            detail = "Subscribed · wearable online"
            if self._last_wearable_device:
                detail += f" ({self._last_wearable_device})"
        else:
            status = "warn"
            detail = "Subscribed · waiting for wearable"

        return {
            "status": status,
            "detail": detail,
            "broker": broker,
            "subscribed": True,
            "wearable_age_s": round(wearable_age, 1) if wearable_age is not None else None,
            "wearable_device": self._last_wearable_device,
        }

    def start(self) -> None:
        if self._thread:
            return
        self._thread = threading.Thread(target=self._run, name="mqtt-wearable", daemon=True)
        self._thread.start()

    def publish_cmd(self, payload: dict[str, Any]) -> None:
        body = dict(payload)
        body.setdefault("schema", MQTT_SCHEMA_VERSION)
        body.setdefault("msg_type", "session_cmd")
        body.setdefault("ts_ms", int(time.time() * 1000))
        self._client.publish(MQTT_TOPIC_ORCHESTRATOR_CMD, json.dumps(body), qos=1)

    def reset_patient_reps(self, exercise: str) -> None:
        """Clear counted reps before a patient turn."""
        ex = normalize_wearable_exercise(exercise)
        with self._rep_cv:
            self._patient_rep_max.pop(ex, None)
            self._patient_rep_end_count.pop(ex, None)

    def _note_patient_rep(self, exercise: str, rep: int, source: str) -> None:
        ex = normalize_wearable_exercise(exercise)
        if not ex:
            return
        with self._rep_cv:
            if source == "rep_end" and rep >= 0:
                count = self._patient_rep_end_count.get(ex, 0) + 1
                self._patient_rep_end_count[ex] = count
                if rep > 0:
                    self._patient_rep_max[ex] = max(self._patient_rep_max.get(ex, 0), rep)
                self._log.info(
                    f"wearable rep_end {ex} rep={rep} count={count} (display max={self._patient_rep_max.get(ex, 0)})"
                )
            elif source == "rep_start" and rep > 0:
                # Display hint only — rep_start marks the beginning of a rep, not completion.
                self._patient_rep_max[ex] = max(self._patient_rep_max.get(ex, 0), rep)
            self._rep_cv.notify_all()

    def wait_for_patient_reps(
        self,
        exercise: str,
        target_reps: int,
        *,
        timeout: float = 600.0,
        stop_event: threading.Event | None = None,
    ) -> bool:
        """Block until wearable publishes enough rep_end events (authoritative)."""
        ex = normalize_wearable_exercise(exercise)
        target = int(target_reps)
        deadline = time.monotonic() + max(0.1, float(timeout))
        with self._rep_cv:
            while time.monotonic() < deadline:
                if stop_event is not None and stop_event.is_set():
                    return False
                end_count = self._patient_rep_end_count.get(ex, 0)
                rep_max = self._patient_rep_max.get(ex, 0)
                # Primary: N completed reps = N rep_end events.
                if end_count >= target:
                    self._log.info(
                        f"wearable patient complete {ex} "
                        f"({end_count} rep_end, last rep={rep_max}, target={target})"
                    )
                    return True
                # Fallback: 1-indexed rep field on final rep_end (some firmware).
                if end_count >= target - 1 and rep_max >= target:
                    self._log.info(
                        f"wearable patient complete {ex} "
                        f"rep_max={rep_max} target={target} ({end_count} rep_end)"
                    )
                    return True
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                self._rep_cv.wait(timeout=min(0.25, remaining))
        got = self._patient_rep_end_count.get(ex, 0)
        rep_max = self._patient_rep_max.get(ex, 0)
        self._log.warning(
            f"wearable patient timeout {ex}: {got} rep_end, last rep={rep_max}, need {target}"
        )
        return False

    def wait_for_rep_end(
        self, exercise: str, rep: int, *, timeout: float = 120.0
    ) -> bool:
        """Backward-compatible alias — waits until patient reaches rep count."""
        self.reset_patient_reps(exercise)
        return self.wait_for_patient_reps(exercise, rep, timeout=timeout)

    def _run(self) -> None:
        host = broker_host()
        port = int(os.getenv("MQTT_BROKER_PORT", MQTT_BROKER_PORT))
        self._log.info(f"MQTT connecting to {host}:{port} (wearable subscribe)")
        while True:
            try:
                self._mqtt_connected = False
                self._notify_sanity()
                self._client.connect(host, port, keepalive=30)
                self._client.loop_forever()
            except Exception as exc:
                self._mqtt_connected = False
                self._notify_sanity()
                self._log.warning(f"MQTT disconnected: {exc}; retry in 3s")
                time.sleep(3)

    def _on_connect(self, client, _userdata, _flags, reason_code, _properties) -> None:
        if reason_code != 0:
            self._mqtt_connected = False
            self._log.warning(f"MQTT connect failed: {reason_code}")
            self._notify_sanity()
            return
        self._mqtt_connected = True
        client.subscribe(MQTT_TOPIC_WEARABLE_PUBLISH, qos=1)
        self._log.info(f"MQTT subscribed to {MQTT_TOPIC_WEARABLE_PUBLISH}")
        self._ctx.ui.send_message(
            "wearable_mqtt",
            {
                "connected": True,
                "broker": f"{board_mdns_host()}:{MQTT_BROKER_PORT}",
            },
        )
        self._notify_sanity()

    def _on_message(self, _client, _userdata, msg) -> None:
        data = _parse_payload(msg.payload)
        if not data:
            self._log.warning(f"MQTT bad JSON on {msg.topic}")
            return

        err = _validate_common(data)
        if err:
            self._log.warning(f"MQTT reject {msg.topic}: {err}")
            return

        msg_type = str(data["msg_type"])
        self._last_wearable_at = time.monotonic()
        self._last_wearable_device = str(data.get("device_id", "")).strip() or None
        if msg_type == "heartbeat":
            self._last_heartbeat = data
            self._notify_sanity()
        elif msg_type in ("rep_start", "rep_end"):
            ex_raw, rep_num, quality, rom = _rep_fields(data)
            self._log.info(
                f"wearable {msg_type} ex={ex_raw!r} rep={rep_num} q={quality:.2f} rom={rom:.1f}"
            )
            if ex_raw and rep_num >= 0:
                self._note_patient_rep(ex_raw, rep_num, msg_type)
            if msg_type == "rep_end" and ex_raw:
                decision = adaptation_decision(
                    normalize_wearable_exercise(ex_raw),
                    quality,
                    rom,
                    tracker=self._adapt_tracker,
                )
                if decision.action != "none":
                    agent = getattr(self._ctx, "agent", None)
                    if agent is not None:
                        agent.enqueue_adaptation(decision)
        elif msg_type == "inference":
            self._last_inference = data
            self._log.info(
                f"wearable inference {data.get('label')!r} "
                f"({float(data.get('confidence', 0)):.2f}) "
                f"ex={data.get('exercise')!r} rep={data.get('rep')}"
            )
            # Per MQTT spec: do not count reps from inference for route completion.
        elif msg_type == "session_change":
            self._log.info(
                f"wearable session_change ex={data.get('exercise')!r} rep={data.get('rep')}"
            )
        else:
            self._log.debug(f"MQTT {msg_type} from {data.get('device_id')}")

        envelope = {
            "topic": msg.topic,
            "received_at_ms": int(time.time() * 1000),
            "payload": data,
        }
        self._ctx.ui.send_message("wearable_mqtt", envelope)
