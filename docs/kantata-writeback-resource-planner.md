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

## Current state

- **Read side is LIVE.** `api/mirror.ts` pulls stories, assignees,
  participants, posts, and the staff roster every 5 min; the workspace mirrors
  Kantata today.
- **Write side is BUILT** (2026-08-04, once write scopes were granted):

  | Piece | Where |
  | --- | --- |
  | Kantata story id on every imported task | `Task.kantataStoryId` — threaded `api/mirror.ts` → `MirrorTask` → `LiveTask` → `TaskCandidate` → `Task` |
  | Diff against the live mirror | `pendingWrites()` in `apps/tab/src/workspace/kantataWrite.ts` |
  | Review-and-send UI | "Send these changes to Kantata" panel in `ClientWorkspace` |
  | Server executor (holds the token) | `api/kantata-write.ts`, routed in `server.mts` |
  | Sync stamp / provenance | `Task.kantataSyncedAt`, `store.markTasksSynced()` |

  The story id was the missing prerequisite: without it the only possible write
  is `POST /stories`, which duplicates work Kantata already has. Imported tasks
  now carry the id they came from, so an edit becomes `PUT /stories/{id}`.

## How a write happens

1. Someone edits a task in the workspace — owner, due date, status.
2. `pendingWrites()` compares the workspace's tasks against what the mirror
   last read from Kantata and produces a from → to list. **Only tasks carrying
   a `kantataStoryId` are considered**, and only when the mirror still has that
   story — a story deleted in Kantata is never resurrected.
3. The workspace shows the list. A person ticks what should go.
4. `POST /api/kantata-write` with the ticked intents. The endpoint re-validates
   every one server-side (the browser is not trusted), then issues the calls
   one at a time, reporting each result separately — a batch where one intent
   fails still applies the rest.
5. Applied refs are stamped `kantataSyncedAt` and logged to the account's
   activity feed with who sent them.

## Turning writes on

The endpoint is **dry-run by default**. Without `KANTATA_WRITE_ENABLED=true`
it validates the intents and describes the exact calls it would make, and
sends nothing. That is deliberate: writing to a customer's system of record
should not start happening because something was deployed.

To go live:

```
KANTATA_API_TOKEN=<token with story + allocation write scope>   # already set, now write-scoped
KANTATA_WRITE_ENABLED=true
```

Both are server-only — never `VITE_`-prefixed, never in the browser bundle.
Recommended sequence: deploy with the flag OFF, exercise the panel on a real
workspace and read the previewed calls, then set the flag.

## Safety properties, and where each is enforced

- **Never silent.** No timer, no auto-sync. `pushIntents()` is called from one
  button. (`kantataWrite.ts`, `ClientWorkspace.tsx`)
- **Never a guess at people.** An owner name resolves to a Kantata user id only
  on an unambiguous match; two people with the same name, or a client contact
  with no Kantata seat, produce no assignee write at all. (`resolveStaffId`)
- **Never a downgrade.** Kantata's `accepted` already reads as done, so marking
  a task complete here does not overwrite it with `completed`. (`statusMatches`)
- **Narrow surface.** The endpoint accepts three intent kinds and a fixed field
  list; anything else is rejected before a request is built. (`planCall`)
- **Bounded.** 50 intents per request, hours capped at 168/week, 10s per call.
- **Attributable.** Every response records the signed-in caller and timestamp;
  applied changes land in the account activity feed.

## Weekly capacity reservations

`allocationIntent()` builds the `workspace_allocations` write — person,
project, Monday–Sunday week, hours. This is the row the resource planner is
actually built on. The intent and its validation are in place; the surface that
chooses which weeks to publish is the next piece of UI, and it writes through
the same endpoint and the same review gate.

## Why this is the right shape

- **One integration point.** The planner never needs a direct feed — Kantata is
  the hub. Write once, both Kantata and the planner are correct.
- **Reuses the read contract.** The same story/allocation objects the mirror
  reads are the ones we write; no new data model.
- **Safety holds.** Financials stay internal (allocations carry hours, not
  rates on any guest surface); write-back is gated and reviewed.
