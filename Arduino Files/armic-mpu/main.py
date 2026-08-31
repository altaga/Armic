# SPDX-FileCopyrightText: Armic project
#
# SPDX-License-Identifier: MPL-2.0
"""Armic application entry point.

Browser --WebSocket--> python service --Bridge--> MCU sketch --I2C--> servos
"""

import os

from mqtt_bridge import board_mdns_host

# web_ui uses HOST_IP for the "Network URL" Cursor / App Lab opens on Run.
_lan_ip = os.getenv("HOST_IP", "").strip()
os.environ["HOST_IP"] = board_mdns_host()
# MQTT uses the board LAN IP injected by arduino-app-cli (saved before override).
if _lan_ip:
    os.environ["MQTT_BROKER_HOST"] = _lan_ip

from arduino.app_bricks.web_ui import WebUI
from arduino.app_utils import App, Logger

from agent.llm_agent import LlmAgent
from armic import Armic
from context import AppContext
from mqtt_bridge import WearableMqttBridge
from route_runner import RouteRunner
from sanity import register_sanity
from telemetry import register_telemetry
from ws_handlers.registry import register_all

log = Logger("armic-app")
arm = Armic()
ui = WebUI()
log = Logger("armic-app")
ctx = AppContext(arm=arm, ui=ui, log=log)
routes = RouteRunner(ctx)
ctx.route_runner = routes
agent = LlmAgent(arm=arm, ui=ui, log=log, routes=routes)
ctx.agent = agent
agent.start()

register_telemetry(ctx)
register_all(ctx, agent)

mqtt_bridge = WearableMqttBridge(ctx, log)
ctx.mqtt = mqtt_bridge
register_sanity(ctx)
mqtt_bridge.start()
host = board_mdns_host()
log.info(f"Wearable MQTT expected at mqtt://{host}:1883")
log.info(f"Armic UI: http://{host}:7000/arm-simulator.html")

App.run()
