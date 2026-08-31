# SPDX-FileCopyrightText: Armic project
#
# SPDX-License-Identifier: MPL-2.0
"""Bridge and MQTT sanity broadcast for the dashboard."""

from __future__ import annotations

import threading
import time

from context import AppContext
from mqtt_bridge import WearableMqttBridge


def sanity_payload(ctx: AppContext) -> dict:
    mqtt = ctx.mqtt
    return {
        "bridge": ctx.arm.bridge_sanity(),
        "mqtt": mqtt.mqtt_sanity() if isinstance(mqtt, WearableMqttBridge) else {
            "status": "err",
            "detail": "MQTT bridge unavailable",
            "broker": "",
            "subscribed": False,
            "wearable_age_s": None,
            "wearable_device": None,
        },
    }


def register_sanity(ctx: AppContext) -> None:
    """Push bridge/MQTT health to every browser, periodically and on change."""

    def broadcast(sid: str | None = None) -> None:
        payload = sanity_payload(ctx)
        if sid:
            ctx.ui.send_message("system_sanity", payload, sid)
        else:
            ctx.ui.send_message("system_sanity", payload)

    mqtt = ctx.mqtt
    if isinstance(mqtt, WearableMqttBridge):
        mqtt.set_sanity_listener(lambda: broadcast())

    def tick() -> None:
        while True:
            time.sleep(2.0)
            broadcast()

    threading.Thread(target=tick, name="sanity-broadcast", daemon=True).start()
