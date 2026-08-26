# Bill of materials (draft)

Contest-oriented BOM. Quantities assume one demo station.

## Core compute

| Qty | Item | Notes |
|-----|------|--------|
| 1 | **Arduino UNO Q** (4 GB) | MCU arm brain + MPU App Lab / Edge AI |

## Motion

| Qty | Item | Notes |
|-----|------|--------|
| 1 | 4-DOF robotic arm (OWI-class or equivalent) | Base / shoulder / elbow / wrist |
| 1 | Gripper / claw servo | PCA9685 ch4 |
| 2 | MG90D (or equiv.) | Shoulder + elbow (gravity) |
| 2 | MG90S (or equiv.) | Base + wrist |
| 1 | PCA9685 16-ch PWM driver | 50 Hz servos, I2C |
| 1 | Adequate DC supply for servos | Size for stall current; logic vs motor rails as designed |

## Interconnect

| Qty | Item | Notes |
|-----|------|--------|
| — | Qwiic / Dupont / header wiring | UNO Q ↔ PCA9685 I2C + OE |
| — | USB-C cable / PD supply | UNO Q power + serial |

## Sensing (planned)

| Qty | Item | Notes |
|-----|------|--------|
| 1 | IMU breakout (Qwiic preferred) | Patient exercise ML on MPU |
| optional | Extra Arduino-compatible sensors | Only if needed for demo |

## Software (no cost)

| Item | Role |
|------|------|
| Arduino App Lab / Arduino IDE 2.x | UNO Q development |
| Edge Impulse | On-device exercise classification |
| This repo’s docs + firmware | Conventions + MCU brain |

Update this table when the UNO Q port freezes the exact shield/carrier and IMU SKU.
