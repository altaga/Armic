# SPDX-FileCopyrightText: Armic project
#
# SPDX-License-Identifier: MPL-2.0
"""LLM warmup, keep-alive, and streaming chat for the arm agent."""

from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.request
from typing import TYPE_CHECKING, Iterator

from arduino.app_bricks.llm import LargeLanguageModel

from agent.adaptation import AdaptationDecision
from agent.tools import build_agent_tools
from config import (
    AGENT_SYSTEM_PROMPT,
    LLM_KEEPALIVE_INTERVAL_S,
    LLM_MAX_TOKENS,
    LLM_MODEL_ID,
    LLM_REQUEST_TIMEOUT_S,
    LLM_RUNNER_CHAT_URL,
    LLM_WARMUP_TIMEOUT_S,
)

if TYPE_CHECKING:
    from arduino.app_bricks.web_ui import WebUI
    from arduino.app_utils import Logger
    from armic import Armic
    from route_runner import RouteRunner


class LlmAgent:
    """Wraps the arduino:llm brick with warmup, thread-safe streaming, and memory."""

    def __init__(self, arm: Armic, ui: WebUI, log: Logger, routes: RouteRunner) -> None:
        self._ui = ui
        self._log = log
        self._lock = threading.Lock()
        self._ready = threading.Event()
        self._warming = False
        self._started = False
        self._chat_sid: str | None = None
        self._llm = LargeLanguageModel(
            system_prompt=AGENT_SYSTEM_PROMPT,
            tools=build_agent_tools(arm, ui, lambda: self._chat_sid),
            max_tokens=LLM_MAX_TOKENS,
            timeout=LLM_REQUEST_TIMEOUT_S,
        ).with_memory(max_messages=24)

    @property
    def is_ready(self) -> bool:
        return self._ready.is_set()

    @property
    def is_warming(self) -> bool:
        return self._warming

    def start(self) -> None:
        """Begin background warmup as soon as the app boots."""
        if self._started:
            return
        self._started = True
        self._warming = True
        self.publish_status()
        threading.Thread(target=self._warmup, name="llm-warmup", daemon=True).start()
        threading.Thread(target=self._keepalive_loop, name="llm-keepalive", daemon=True).start()

    def wait_until_ready(self, timeout: float = LLM_WARMUP_TIMEOUT_S) -> bool:
        return self._ready.wait(timeout=timeout)

    def stream_reply(
        self, message: str, sid: str | None = None, *, context: str = ""
    ) -> Iterator[str]:
        self._chat_sid = sid
        prompt = message
        if context.strip():
            prompt = f"{context.strip()}\n\nCurrent message: {message}"
        try:
            with self._lock:
                yield from self._llm.chat_stream(prompt)
        finally:
            self._chat_sid = None

    def clear_memory(self) -> None:
        with self._lock:
            self._llm.clear_memory()

    def stop_stream(self) -> None:
        with self._lock:
            self._llm.stop_stream()

    def publish_status(self, sid: str | None = None, *, warming: bool | None = None) -> None:
        if warming is None:
            warming = self._warming and not self.is_ready
        payload = {
            "ready": self.is_ready,
            "warming": bool(warming and not self.is_ready),
            "model": LLM_MODEL_ID,
        }
        self._send("agent_status", payload, sid)

    def enqueue_adaptation(self, decision: AdaptationDecision) -> None:
        """Notify UI + logs after wearable rep_end adaptation (mqtt_bridge fan-in)."""
        payload = {
            "action": decision.action,
            "exercise": decision.exercise,
            "quality": decision.quality,
            "rom_deg": decision.rom_deg,
            "rom_delta_deg": decision.rom_delta_deg,
            "speed_delta_deg_s": decision.speed_delta_deg_s,
            "streak": decision.streak,
            "reason": decision.reason,
        }
        self._log.info(f"adaptation_decision {decision.action} ex={decision.exercise}: {decision.reason}")
        self._ui.send_message("agent_adaptation", payload)

    def _warmup(self) -> None:
        try:
            self._log.info("agent LLM warmup starting")
            self._wait_for_runner()
            with self._lock:
                for _ in self._llm.chat_stream("ok"):
                    pass
            self._ready.set()
            self._log.info("agent LLM warmup complete")
        except Exception as exc:
            self._log.warning(f"agent LLM warmup failed: {exc}")
            self._send("agent_status", {"ready": False, "warming": False, "error": str(exc)})
        finally:
            self._warming = False
            if self.is_ready:
                self.publish_status()

    def _wait_for_runner(self) -> None:
        deadline = time.monotonic() + LLM_WARMUP_TIMEOUT_S
        delay_s = 2.0
        while time.monotonic() < deadline:
            try:
                self._ping_runner()
                return
            except (urllib.error.URLError, TimeoutError, OSError) as exc:
                self._log.debug(f"LLM runner not ready yet: {exc}")
                time.sleep(delay_s)
        raise TimeoutError("LLM runner not reachable during warmup")

    def _keepalive_loop(self) -> None:
        self._ready.wait()
        while True:
            time.sleep(LLM_KEEPALIVE_INTERVAL_S)
            try:
                self._ping_runner()
            except (urllib.error.URLError, TimeoutError, OSError) as exc:
                self._log.debug(f"agent LLM keepalive ping failed: {exc}")

    def _ping_runner(self) -> None:
        body = json.dumps(
            {
                "model": LLM_MODEL_ID,
                "messages": [{"role": "user", "content": "hi"}],
                "max_tokens": 1,
            }
        ).encode()
        request = urllib.request.Request(
            LLM_RUNNER_CHAT_URL,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=LLM_WARMUP_TIMEOUT_S) as response:
            response.read()

    def _send(self, event: str, payload: dict, sid: str | None) -> None:
        if sid:
            self._ui.send_message(event, payload, sid)
        else:
            self._ui.send_message(event, payload)
