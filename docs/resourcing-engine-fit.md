# Resourcing Engine × Collaborative Workspace — how they fit

Status: integration contract (2026-07-20). The resourcing engine — budget →
expected hours by role → weekly Kantata reservations — is a **separate
project**. This document maps its nine-step pipeline onto what this workspace
already provides, and pins the contract both sides build against.

## The pipeline, step by step

| # | Resourcing-engine step | What this workspace provides today | Owned by |
|---|---|---|---|
| 0 | Project created, team members assigned | Sandbox → promote: an `Initiative` with an AI-drafted team (`plan.packages`, one per person, with `personId`, `title`, role, `viaManager`) | **Workspace** ✅ |
| 1 | A project plan is created | `makePlan()`: dated phases (Discovery/Build/Pilot/Rollout with ISO `start`/`end`) + per-person work packages, each already carrying an `hours` estimate and `phaseKey` | **Workspace** ✅ |
| 2 | Budget is entered | Not stored yet. Natural home: `Initiative.budget` (internal build workspace only — the client-safety wall keeps it off guest surfaces automatically). One field + one input when the engine needs it | Workspace (small add) |
| 3 | Scope/complexity selected or inferred from the plan | All inference inputs exist on the plan: total package hours, team size, phase count/span, plus `classification` (service line × vertical). Selection UI = one field like budget | **Engine** (consumes plan) |
| 4 | Engine calculates expected hours by role/resource | Consumes `plan.packages` — `personId` + `title` map to role; package `hours` are the base estimate to scale | **Engine** |
| 5 | Hours distributed across project tasks | `tasksFromPlan()` derives tasks 1:1 from packages with **deterministic IDs** (`task-<personId>`), so the engine can attach hours to tasks without any ID mapping table. "The plan IS the source" (no double entry) is already the rule here | **Engine** (rides workspace IDs) |
| 6 | Task hours roll up into weekly allocations | Phases carry real ISO date windows — calendarization is pure math over `phase.start..end` per package | **Engine** |
| 7 | Weekly reservations created in Kantata | `services/sync` already owns the Kantata client shape (rate-limited HTTP, provenance, fixtures shaped like the real API). The reservations adapter is one more endpoint in that same service. **Blocked on Kantata API credentials** (BLOCKERS) | **Engine** via `services/sync` |
| 8 | Plans stay synchronized workspace ⇄ Kantata | Read side exists: the sync mirror (Kantata → workspace) feeds the Copilot today. Write side rides the same service. The Layer 0.3 pattern (flagged tasks mirror to the client plan and **status flows back**) is the exact shape task-level Kantata sync needs — same code path, different adapter | Shared |
| 9 | Reservations recalculated as plans change | Every plan mutation in this workspace goes through **one choke point**: `replanPreservingStatus()` (team change, basis change, chat refinement). That is the single hook where a plan-changed event gets published to the engine when the backend lands | **Workspace** (emits) → **Engine** (recalcs) |

## The contract this workspace guarantees

1. **Stable, serializable plan schema** — `ProjectPlan { phases[{key,label,goal,start,end}], packages[{personId,name,title,part,phaseKey,hours,status}] }`. ISO dates, no derived state. The engine can consume it as-is.
2. **Deterministic IDs** — `task-<personId>`, `phaseKey`, `personId` are stable across replans, so engine-side diffs (which reservations changed?) are cheap and exact.
3. **One mutation choke point** — all plan changes flow through `replanPreservingStatus()` / store actions. When Supabase lands, that point publishes `plan.changed` events (webhook or queue) — the engine's trigger for step 9. No polling.
4. **Statuses round-trip** — package `status` (proposed/invited/part_added) and task status already flow both directions internally (plan ⇄ tasks ⇄ client-shared plan). Kantata task/assignment sync attaches to the same flow.
5. **Financial firewall** — budget, rates, and hour economics live on the internal `Initiative` only. The build-time client-safety test (`clientSafety.test.ts`) makes it structurally impossible for engine data to reach client surfaces.

## What the engine project should NOT rebuild

- The plan model, task derivation, or replan logic — consume them.
- The Kantata HTTP client / rate limiting / provenance in `services/sync` — extend it with the reservations adapter.
- Team assignment — the Copilot casts the team here; the engine prices and schedules it.

## Open items (tracked in BLOCKERS)

- Kantata API credentials — blocks steps 7–9 for real; everything upstream is buildable/testable against the fixture mirror.
- Supabase persistence — blocks the event publication in step 9 (today the recalc trigger exists only in-browser).
- Where "budget entered" lives in the UI (build workspace Resourcing section) — trivial once the engine's input contract is final.
