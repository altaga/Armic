# Heavy Tucked Lift (HTL)

Demo of the loaded **C-curve**: pull the payload in toward the base before lifting/carrying so gravity torque on the shoulder drops.

## Why

Industrial arms rate payload by **mass × CoG offset** — a far tip is “heavier” for the motors than the same mass near the column.

Planner behavior (loaded, distance > ~50 mm): tuck toward a compact carry radius, rotate, then extend.

Ideal tuck targets are not always reachable with elbow ≥ 140° on this 4DOF; the practical **carry** pose is the **Transport** family.

## Sequence (locked)

| Phase | Joints `{b, sh, el, wr}` | Tip (approx) |
|-------|--------------------------|--------------|
| Reach | `90, 160, 100, 90` | Wide out, high torque |
| Fold in | `90, 110, 170, 170` | Radius coming in |
| Carry | `90, 90, 180, 180` | Transport — compact |
| Home | stable home | Elbow 95° |

Serial: `protocol htl`

## Wrong

Poses that stay at a large tip radius never really tuck — they contradict the planner intent and the UI copy.
