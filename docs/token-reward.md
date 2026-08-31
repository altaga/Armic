# Token and reward layer

> The rehabilitation robot, safety stack, and edge agent are the **product**. The token is an **engagement and proof-of-concept launch layer** — not a substitute for clinical evidence.

## What it proves

1. **Launch discipline** — contract review, fee routing, community accountability (pilot dry-run).
2. **Audience** — [@projectarmic](https://x.com/projectarmic) and demo traction for clinic conversations.
3. **Lessons learned** — prior wallet compromise drove multisig / custody hardening before any clinical token pilot.

## Reward math (on-device)

Mint only when **both** are true:

1. A **3-rep rehab set completes** (`set_completed` from FastAPI).
2. **Average rep quality ≥ 0.70** (0.00–1.00 scale).

**Reward = `10 + 90 × min(1.0, average_rep_quality)`**

| Avg quality | Reward |
|-------------|--------|
| 0.70 | 73 $ARMIC |
| 0.88 | 89.2 $ARMIC |
| 1.00 | 100 $ARMIC (cap) |
| 0.32 | **None** — adaptation narrows/slows instead |

Runs alongside adaptation rules in [agent.md](agent.md).

## Token facts

| Field | Value |
|-------|--------|
| Network | Solana SPL |
| Contract | `DcTVUogWykX1JeBmTq48Fzj2Lc3Y7zwHQS1CyZ9SHnXf` |
| Mint authority | **Disabled** |
| Freeze authority | **Disabled** |
| Creator fees | 100% to rehab hardware fund |
| Launch | Easya.io Kickstart, 2026-08-30 |

Merkle-rooted session records are **planned** for insurer-grade evidence; current deployment focuses on on-device quality gating and adaptation.
