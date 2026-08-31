# ARMIC documentation

Proof-of-concept rehab robotics on **Arduino UNO Q**. Not medical advice — see [disclaimer](../README.md).

## Start here

| I want to… | Go to |
|------------|--------|
| Build the hardware | [bom.md](bom.md) → [hardware.md](hardware.md) → [setup.md](setup.md) |
| Try it without a board | [Online Simulator](https://onlinesimulator.expo.app) · source in [`OnlineSimulator/`](../OnlineSimulator/) |
| Understand the architecture | [architecture.md](architecture.md) → [control-stack.md](control-stack.md) |
| Run rehab exercises | [exercises.md](exercises.md) |
| Integrate the wearable / AI Node | [MQTT contract](../Arduino%20Files/armic-ai-node/MQTT_CONTRACT.md) · [armic-ai-node/](../Arduino%20Files/armic-ai-node/) |
| Work with the LLM agent | [agent.md](agent.md) · judge spec [AGENTS.md](../AGENTS.md) |
| Extend or review code with an agent | [AgentSSH/](../AgentSSH/) · [AI Skills/](../AI%20Skills/) |

## Technical reference

| Topic | Document |
|-------|----------|
| Dual-brain architecture | [architecture.md](architecture.md) |
| FK / IK, PWM maps | [kinematics.md](kinematics.md) |
| S-curves, jerk limits | [motion-planning.md](motion-planning.md) |
| Torque + velocity derating | [dynamics.md](dynamics.md) |
| Control stack layers | [control-stack.md](control-stack.md) |
| HTL tucked carry | [htl-reference.md](htl-reference.md) |
| Serial / Bridge commands | [serial-protocol.md](serial-protocol.md) |
| Bill of materials | [bom.md](bom.md) |
| Power + wiring | [hardware.md](hardware.md) |
| Bring-up checklist | [setup.md](setup.md) |

## Product & project context

| Topic | Document |
|-------|----------|
| Problem, vision, session loop | [overview.md](overview.md) |
| Rehab + demo motion | [demos-and-exercises.md](demos-and-exercises.md) |
| Web UI + App Lab screens | [interface.md](interface.md) |
| Edge LLM agent + prompt examples | [agent.md](agent.md) |
| Project token ($ARMIC) | [project-token.md](project-token.md) |
| Team, contest, roadmap | [project.md](project.md) |

## Repository map

| Path | Role |
|------|------|
| [`Arduino Files/armic-firmware/`](../Arduino%20Files/armic-firmware/) | MCU sketch — IK, safety, protocols, 100 Hz |
| [`Arduino Files/armic-mpu/`](../Arduino%20Files/armic-mpu/) | FastAPI, WebSocket, LLM agent, MQTT bridge |
| [`Arduino Files/armic-webui/`](../Arduino%20Files/armic-webui/) | Browser UI — twin, calibration, wearable HUD |
| [`Arduino Files/armic-brick/`](../Arduino%20Files/armic-brick/) | `calibration.json` SSoT, compose root |
| [`OnlineSimulator/`](../OnlineSimulator/) | Hosted browser twin |
