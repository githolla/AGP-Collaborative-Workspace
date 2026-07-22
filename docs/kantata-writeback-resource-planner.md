# Collaborative Workspace → Kantata → Resource capacity planner

The loop the manager wants: changes made in the Collaborative Workspace flow
**back to Kantata**, and because the Resource capacity planner reads Kantata,
they land there automatically. This pins that write-back path.

```
Collaborative Workspace ──write──▶ Kantata ──read──▶ Resource capacity planner
        (tasks, owners,            (stories,           (bookings / weekly
         dates, hours)              allocations)        reservations by person)
```

Kantata is the **single source of truth in the middle**. We never write to the
resource planner directly — we write to Kantata, and the planner picks it up on
its own pull. One write target, no second integration.

## What the workspace writes, and where it lands in Kantata

| Change in the workspace | Kantata write | Planner sees |
| --- | --- | --- |
| Task added | `POST /stories` (story_type=task) | new work to staff |
| Task owner set/changed | `PUT /stories/{id}` → `assignee_ids` | who's booked |
| Task due date changed | `PUT /stories/{id}` → `due_date` | when the work sits |
| Task status / % complete | `PUT /stories/{id}` → `state` / `percentage_complete` | progress, remaining effort |
| Weekly reserved hours (from the plan) | `POST/PUT /workspace_allocations` | **the capacity reservations the planner is built on** |

The planner's currency is **allocations/bookings by person by week**. The plan
already calendarizes package hours across ISO phase windows (see
`resourcing-engine-fit.md` steps 6–7), so the weekly numbers exist — write-back
turns them into Kantata `workspace_allocations`, which is exactly what the
planner reads.

## Current state (honest)

- **Read side is LIVE.** `api/mirror.ts` pulls stories, assignees,
  participants, posts, and the staff roster every 5 min; the workspace mirrors
  Kantata today.
- **Write side is not wired yet.** Everything the write-back needs already
  exists in the data model — tasks carry `ownerName`, `due`, `status`; the plan
  carries per-person `hours` on dated phases; task IDs are deterministic
  (`task-<personId>`) so a Kantata story id maps 1:1 with no lookup table.

## What closing the loop requires

1. **A write-scoped Kantata token** (server-only, never `VITE_`-exposed). The
   current `KANTATA_API_TOKEN` is used read-only; write-back needs create/update
   scope on stories and allocations. Confirm the tenant allows it.
2. **A server write endpoint** — `api/writeback.ts`, same self-contained shape
   as `api/mirror.ts` (auth-gated, rate-limited). It takes a small diff
   {taskId, field, value} or a weekly-allocation set and issues the Kantata
   call above.
3. **Human-confirmed, never silent.** Writes fire only on an explicit action
   (save a task, publish reservations) — the workspace never auto-mutates the
   client's live Kantata. Same principle as import: nothing lands without
   review, in either direction.
4. **Idempotency + provenance.** Each write records the Kantata id it touched so
   a re-pull reconciles instead of duplicating (the mirror already tags
   Kantata-sourced rows).

## Why this is the right shape

- **One integration point.** The planner never needs a direct feed — Kantata is
  the hub. Write once, both Kantata and the planner are correct.
- **Reuses the read contract.** The same story/allocation objects the mirror
  reads are the ones we write; no new data model.
- **Safety holds.** Financials stay internal (allocations carry hours, not
  rates on any guest surface); write-back is gated and reviewed.

Blocked only on item 1 (write-scoped credentials). Everything upstream —
the tasks, owners, dates, and weekly hours to write — is already in the
workspace.
