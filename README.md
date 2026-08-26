# Armic

<img src="./Images/Armic Logo.png" alt="Armic logo" width="280">

**ARMIC** — autonomous rehabilitation powered by edge AI and assistive robotics.

This repository is a **clean starting point** for the next generation of Armic, built around the **Arduino UNO Q** (Qualcomm Dragonwing MPU + STM32 MCU) and Arduino App Lab.

---

## Vision

Turn physical therapy into a closed loop:

1. Patient performs an exercise  
2. On-device ML verifies the motion (Edge Impulse)  
3. The system coaches or assists in real time (App Lab + MCU control)  
4. Sessions become measurable, consistent, and motivating  

**Contest focus:** Social Impact & Robotics — Arduino UNO Q + App Lab.

---

## Planned stack

| Layer | Role |
|--------|------|
| **UNO Q MCU (STM32)** | Real-time sensing / motor assist |
| **UNO Q MPU (Linux)** | Edge Impulse / App Lab apps, dashboard |
| **Sensors** | IMU (and optional biosignals) |
| **Actuation** | Robotic arm assist |
| **Connectivity** | Wi-Fi, MQTT or Bridge RPC |

---

## Status

Greenfield. Firmware, App Lab app, and docs will land here as the UNO Q build takes shape.

Legacy Armic (ESP32 / agents / web) is preserved offline in a local backup — not in this history.

---

## Team

- [Victor Alonso Altamirano](https://www.linkedin.com/in/victor-alonso-altamirano-izquierdo-311437137/)
- [Alejandro Sanchez Gutierrez](https://www.linkedin.com/in/alejandro-sanchez-gutierrez-11105a157/)
- [Luis Eduardo Arevalo Oliver](https://www.linkedin.com/in/luis-eduardo-arevalo-oliver-989703122/)

---

*ARMIC — programmable, intelligent rehabilitation.*
