# Rehab exercise reference poses

Source of truth for photo-matched exercises. Cursor rule: [`.cursor/rules/arm-rehab-exercises.mdc`](../.cursor/rules/arm-rehab-exercises.mdc).

## Shared rules

- Links: L0=30, L1=90, L2=70, L3=50 mm; floor offset 60 mm.
- Tip must stay **≥ 15 mm** above floor (`fk_solve` Z).
- Elbow band **[90°, 180°]** only.
- Serial: `exercise bicep|lateral|elbowflex`
- Each exercise: synced multi-waypoint S-curve, brief hold at peak, **3 reps → stable home**.

---

## 1 — Bicep curl

Do **not** confuse with lateral or elbow flexion.

| Pose | Angles `{b, sh, el, wr}` | Visual |
|------|--------------------------|--------|
| Bottom | `90, 120, 170, 180` | Tip **down** |
| Top | `90, 120, 170, 25` | Tip **up** |

Motion: shoulder **120°** + elbow **170°** locked; **wrist only** curls 180→25.

---

## 2 — Lateral raise

Photos: [`refs/lateral-tip-out.png`](refs/lateral-tip-out.png), [`refs/lateral-tip-down.png`](refs/lateral-tip-down.png)

| Pose | Angles `{b, sh, el, wr}` | Visual |
|------|--------------------------|--------|
| Tip out | `90, 90, 180, 90` | Tip horizontal out |
| Tip down | `90, 90, 180, 180` | Tip down |

Motion: shoulder **90°** + elbow **180°** locked; **wrist only** 90↔180. Sequence `0→1→0` × 3.

**Wrong:** invented mid-waypoints; shoulder lead; any pose not in the two photos.

---

## 3 — Elbow flexion

| Pose | Angles `{b, sh, el, wr}` | Visual |
|------|--------------------------|--------|
| Extended | `90, 0, 95, 90` | Upper arm horizontal **left** (`sh 0`, not 180) |
| Peak (C-fold) | `90, 0, 180, 180` | Tip back toward base |

Motion: shoulder **fixed 0°**; elbow + wrist flex together.

**Wrong:** `shoulder 180` — folds toward the floor.
