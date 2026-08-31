# SPDX-FileCopyrightText: Armic project
#
# SPDX-License-Identifier: MPL-2.0
"""Shared runtime objects passed to WebSocket handler modules."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from arduino.app_bricks.web_ui import WebUI
from arduino.app_utils import Logger

from armic import Armic

if TYPE_CHECKING:
    from agent.llm_agent import LlmAgent
    from route_runner import RouteRunner


@dataclass(slots=True)
class AppContext:
    """Dependencies required by every WebSocket handler."""

    arm: Armic
    ui: WebUI
    log: Logger
    mqtt: object | None = None
    route_runner: RouteRunner | None = None
    agent: LlmAgent | None = None
