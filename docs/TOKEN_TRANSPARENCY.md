# $ARMIC token transparency

> This document holds **all** detailed tokenomics, custody history, and onchain policy for $ARMIC. The main [README](../README.md) keeps this to a short pointer — the rehabilitation robot, safety stack, and edge agent are the project's actual technical work, and the token is a separate funding/coordination layer bolted on beside it.

## Why it exists

**$ARMIC** is a project-funding and community-coordination layer. It funds hardware (UNO Q boards, arm kits, wearables, bench time) and is being kept alive as infrastructure for possible future robotics / x402-style machine-payment experiments. It is:

- **Not** the rehabilitation therapy loop.
- **Not** a patient reward or clinical incentive mechanism.
- **Not** required to read, build, or evaluate the ARMIC hardware and software.

| Layer | Role |
|-------|------|
| **Product** | UNO Q robot · edge agent · human-motion-intelligence pipeline · safety stack · wearable · calibration SSoT |
| **$ARMIC** | Fund the build · ship kits · keep an onchain coordination layer alive for future robotics/x402 utility — **not** the therapy loop |

## Why we launched it

1. **We can launch** — liquidity, graduated fees, transparent routing to a rehab-hardware fund (more UNO Q stations, arms, wearables for pilots).
2. **We can build audience** — [@projectarmic](https://x.com/projectarmic) and demo traction for clinic and partner conversations.
3. **We failed once and changed custody** — see below.

## The wallet we lost — why custody changed

ARMIC did not start with a clean ledger.

On a **prior token launch**, the **hot wallet tied to the LP** was **hacked**. That wallet was how we were supposed to **collect creator commissions** — the buy/sell fees on every trade meant to fund hardware, kits, and bench time. The key controlling those fee flows was compromised, and we **lost the ability to capture that commission stream**. Every swap that should have been reinvesting into the build went somewhere else. We reported it and chased traces. We could not rewind the LP fee wallet.

That failure is why the current $ARMIC contract is structured differently:

- The **LP / fee wallet is not a single hot key on a dev laptop** — multisig and custody hardening came **before** this launch.
- **Freeze authority is removed** — no address can be frozen from transferring.
- **100% of creator fees** on buys and sells route to a dedicated rehab-hardware-fund wallet with rules set **before** liquidity mattered.
- **No patient rep rewards** wired into the therapy loop — ROM adaptation runs on rep quality alone; the token funds builds, not clinical incentives we are not qualified to run yet.

This Easya launch (**2026-08-30**) is our second public attempt to fund rehabilitation hardware, with the commission wallet treated as seriously as the robot itself.

## What it is not

- **Not** a rep-quality reward for patients completing therapy.
- **Not** a substitute for clinical evidence, IRB review, or regulated care.
- **Not** wired into on-device adaptation — ROM widen/narrow runs on rep quality alone ([agent.md](agent.md)).

Session telemetry (`rep_end`, WebSocket history) is for measurement and care-team review. Any future onchain session proofs would be audit infrastructure, not pay-for-reps.

## Token facts

| Field | Value |
|-------|--------|
| Network | Solana SPL |
| Contract | `DcTVUogWykX1JeBmTq48Fzj2Lc3Y7zwHQS1CyZ9SHnXf` |
| **Freeze authority** | **Removed** |
| **Mint authority** | **Active — intentionally retained.** ARMIC is still an experimental research project; mint authority is kept in case future issuance is needed for robotics/x402-related utility. This is a deliberate policy choice, not an oversight. |
| Creator fees | 100% → rehab hardware fund wallet |
| Launch | Easya.io Kickstart · 2026-08-30 |

**Onchain verification:** [Solscan — token overview](https://solscan.io/token/DcTVUogWykX1JeBmTq48Fzj2Lc3Y7zwHQS1CyZ9SHnXf) · [Solana Explorer](https://explorer.solana.com/address/DcTVUogWykX1JeBmTq48Fzj2Lc3Y7zwHQS1CyZ9SHnXf). Verify authority flags directly onchain rather than trusting this doc alone — mint/freeze status is a queryable account property, not a claim we ask you to take on faith.

> ⚠️ Because mint authority is active, total supply is **not** fixed. Any future mint would be disclosed here and on [@projectarmic](https://x.com/projectarmic) before it happens.

Merkle-rooted session records for insurer-grade evidence remain **planned** — separate from token economics and patient-facing incentives.
