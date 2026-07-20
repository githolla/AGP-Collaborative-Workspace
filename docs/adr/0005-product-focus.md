# ADR 0005 — Product focus: the Hub, the Sandbox, and the AI tools

**Status:** accepted · **Date:** 2026-07-20

## Context

The repo accumulated three generations of scope: the original AGP Project
Command delivery-ops vision (SPEC layers 1–4), the ROI collaboration pivot,
and the manager's Collaboration Hub. The product owner asked directly: do we
want all of it, or focus on what the manager specified plus the sandbox and
AI tools?

## Decision

The product is **three surfaces on one data layer**:

1. **Client Collaboration Hub** (the manager's spec, SPEC v2_1 Layer 0) —
   client-account workspaces, guest-safe by tested construction.
2. **Sandbox** — where anyone starts anything: AI-drafted or blank
   collaboration, promote when it earns it.
3. **Builds** — internal initiative workspaces with the ROI engine, plans,
   parts, and the Copilot.

**Kept deliberately although "delivery-ops heritage":**
- `services/sync` + `supabase/migrations` — NOT dead weight: the Copilot's AGP
  grounding (clients, projects, campaigns) reads the mirror today (fixtures),
  and the manager's own requirements (Kantata ⇄ Planner sync, email bridge)
  ride it when credentials land. It is the data layer of the AI tools.
- `packages/shared` — the HTTP client and correlation IDs power sync; the
  autonomy gate is the safety substrate the server-side agents will pass
  through; the finance module stays as tested, dormant domain math.
- `packages/roi` — core.

**Cut now (restorable from git):**
- `services/signals`, `services/assembly`, `apps/bot` — empty scaffolds whose
  concepts moved into the app (Copilot flags ≈ signals; planner/cast ≈
  assembly). The Teams bot package returns when notification work actually
  starts (manager's @mentions Must), as real code, not a placeholder.

**Parked, explicitly not active scope:** SPEC v2_1 Layers 2–4 (Needs-You
feed, artifact studio, auto-assembly at org scale) — a future intelligence
backlog that reuses the same data layer; nothing in the current product
depends on them. MILESTONES.md is marked superseded.

## Consequences

- Next investments go to the focused product's real gaps in order: Supabase
  persistence (multi-user), server-side agent runtime (Anthropic key), Teams
  shell + Graph provisioning for the Hub (Entra/Graph blockers).
- Anyone reading the repo sees one product, not three eras.
