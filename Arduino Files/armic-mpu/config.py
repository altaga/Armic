# SPDX-FileCopyrightText: Armic project
#
# SPDX-License-Identifier: MPL-2.0
"""Application-wide constants for the Armic MPU service."""

# LLM (arduino:llm brick → llamacpp-models-runner)
LLM_RUNNER_CHAT_URL = "http://llamacpp-models-runner:9999/v1/chat/completions"
LLM_MODEL_ID = "Qwen3.5-0.8B-Q4_0"
LLM_WARMUP_TIMEOUT_S = 120
LLM_KEEPALIVE_INTERVAL_S = 600
LLM_MAX_TOKENS = 120
LLM_REQUEST_TIMEOUT_S = 120

AGENT_SYSTEM_PROMPT = (
    "You are Armic, assistant for a 4DOF rehab arm on Arduino UNO Q. "
    "Keep every reply SHORT: 1–3 sentences unless the clinician asks for detail. "
    "For demo moves (home, cpose, transport, snake, cobra, gimmefive, orbital, htl, pendulum), "
    "call run_arm_protocol. "
    "For rehab, NEVER start motion from chat. Use suggest_rehab_intent or show_rehab_route — "
    "they show a routine card after your message. Give a brief clinical opinion only; "
    "do not list exercises or reps. You can follow up across the conversation. "
    "Tell them to press Execute on the card when ready."
)

# Gripper WebSocket accepts legacy words as well as percentages.
GRIPPER_WORDS = {
    "open": 100.0,
    "close": 0.0,
    "closed": 0.0,
    "mid": 50.0,
    "center": 50.0,
}

# Natural-language shortcuts mapped to firmware protocol names.
PROTOCOL_ALIASES = {
    "c pose": "cpose",
    "c-pose": "cpose",
    "gimme five": "gimmefive",
    "give me five": "gimmefive",
    "heavy tucked lift": "htl",
}

# MQTT — M5 Core2 wearable → UNO Q orchestrator (see bricks/armic/mqtt/M5CORE2_AGENT_SPEC.md)
MQTT_BROKER_HOST = "host.docker.internal"  # Mosquitto on host :1883; nodes use uno-q.local
MQTT_BROKER_PORT = 1883
MQTT_TOPIC_WEARABLE_PUBLISH = "armic/wearable/v1/#"
MQTT_TOPIC_ORCHESTRATOR_CMD = "armic/orchestrator/v1/cmd"
MQTT_SCHEMA_VERSION = 1
# Board mDNS hostname (lowercase). Override with ARMIC_MDNS_HOST env if needed.
MQTT_BOARD_MDNS = "uno-q.local"

# Rehab route: max seconds to wait for patient rep_end after arm demo (per exercise).
REHAB_PATIENT_REP_TIMEOUT_S = 600
