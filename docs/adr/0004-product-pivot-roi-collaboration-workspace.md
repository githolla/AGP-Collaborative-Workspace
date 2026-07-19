# ADR 0004 — Product pivot: AI collaboration workspace with embedded ROI engine

**Status:** accepted · **Date:** 2026-07-19

## Context

The original direction (SPEC.md — AGP Project Command: Teams-embedded delivery
workspace orchestrating Kantata + HubSpot) was redirected by the product owner.
The workspace's actual job: **collaborating on product initiatives** — new
product builds and AI-added-to-existing-product iterations — with people and AI
agents working together, and the **Impact OS ROI calculator running in the
background of every initiative** (docs/roi-calculator-spec.md), displaying and
adjusting scenarios live.

## Decision

1. `packages/roi` hosts the ROI engine. `roiEngine.ts` and `roiModel.ts` are
   **verbatim copies** of the reference implementation from `githolla/AIROI`
   (branch `main`, commit e4618471) per the spec's reuse instruction. The
   12-factor template and a `WorkspaceFactor` metadata extension (evidence,
   gather owner — spec §2 "stored alongside") live beside them; the engine
   files themselves are never modified. Spec-derived tests pin the acceptance
   invariant ($0 / grade ≤ C / correct gather count on an empty project); the
   verbatim engine passed all of them unchanged — no divergence to record.
2. `apps/tab` is the collaboration workspace: portfolio rollup → initiative
   cards → per-initiative workspace (factor editor with spec §9 UI rules, exec
   decision card, breakdown, realism-dial scenarios, gather list, snapshot
   audit trail) plus a collaboration thread of humans + AI agents.
3. **AI agents are never faked.** The ROI Analyst agent is live today — its
   messages are computed deterministically from the shared engine. LLM-backed
   agents (Product Strategist, Brief Drafter) are shown as inactive until the
   Anthropic API key is configured server-side (BLOCKERS #8); AI calls remain
   server-side only.
4. Persistence is localStorage for this increment; the Supabase tables from
   spec §10 (projects / factors / roi_snapshots) are the follow-up, reusing
   the existing Supabase foundation. Snapshots are already written on every
   factor change client-side, so the audit-trail shape is in place.
5. The Kantata/HubSpot sync foundation, Teams shell plans, and delivery-ops
   layers (M1–M8 in MILESTONES.md) are **deprioritized, not deleted** — the
   sync/mirror work remains useful if delivery data later feeds initiative
   evidence (e.g. citing timesheet actuals as factor evidence).

## Consequences

- MILESTONES.md M3–M8 no longer reflect the active roadmap; the near-term
  roadmap is: Supabase persistence + multi-user → server-side agent runtime
  (Anthropic) → Teams/SSO if still desired.
- packages/shared's finance module and services/sync stay tested but dormant.
