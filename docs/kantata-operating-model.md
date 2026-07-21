# How AGP runs on Kantata — and exactly where this application fits

Date: 2026-07-20. Sources: AGP's live tenant as observed through our
/api/mirror pulls (not speculation — real counts and conventions), the
Kantata OX (Mavenlink) API v1 surface, SPEC v2_1's mirror design, and the
2026-07-20 internal review. Items we have NOT directly observed are marked
**[verify]** — confirm against a Kantata admin login or the API docs.

---

## 1. What Kantata is

Kantata OX (formerly Mavenlink) is **professional-services automation**: a
system of record for agencies that combines project management, resource
management, financials, and reporting. Its object model, in the shape the
API exposes it:

| Object (API) | What it is | AGP relevance |
|---|---|---|
| `workspaces` | A **project/engagement** — title, status (key/color/message), start/due dates, archived flag, price & budget fields (cents), participants | The atom of AGP delivery. 422 active in the live tenant |
| `stories` | The work breakdown, typed by `story_type`: **milestone**, **task**, deliverable, issue; hierarchical (`parent_id`); `state` (not started / started / completed); start/due dates; per-story time budgets | ~600 dated milestones (in-home dates, launches) + ~1000 tasks observed |
| `participations` | Person ↔ workspace membership | Our per-project team roster (37 staff resolved live) |
| `assignments` | Person ↔ **story**, with scheduled hours | The unit the resource tool must write to **[verify AGP usage]** |
| `story_allocation_days` | An assignment's hours spread across specific days | The day-level calendarization of scheduled work **[verify]** |
| `time_entries` | Actuals: minutes, `date_performed`, user, story, billable, bill/cost rates | ~2000 recent entries pulled (minutes/dates only — rates stripped) |
| `expenses` | Pass-through costs with categories (print, postage, media) | AGP's direct-mail COGS live here **[verify categories]** |
| `invoices` | Billing against workspaces | Excluded until the financial grounding doc |
| `rate_cards` | Role/person bill & cost rates | Excluded (financial) |
| `workspace_groups` | Arbitrary grouping of workspaces | **AGP uses these as SERVICE CATEGORIES ("Direct Mail"), not clients** — proven on live data |
| `custom_field_values` | Tenant-specific fields on any object | AGP: "Service Line Detail" + vertical taxonomy (pulled live) |
| `posts` | Per-workspace activity feed / comments — Kantata's own collaboration | The thing Kara finds insufficient; scattered per-project, no client roll-up, no guests-per-client model **[verify their usage]** |
| `users` | Staff (and client "buyer" users) | Resolved via `include=participants` side-loading |
| Subscribed Events | A change-feed API: entity-change events, ~9-day retention | The right basis for near-real-time sync instead of polling **[needs scope grant]** |

**API mechanics** (all observed working against the live tenant): REST
`/api/v1`, bearer token, numbered pagination (`page`/`per_page`, 200 max),
side-loading with `include=` (e.g. `workspaces?include=participants`
returns a `users` side-bucket), type filters (`stories?story_type=task`),
JSON envelopes keyed by collection name. Writes are standard
`POST`/`PUT` on the same resources — e.g. `PUT /api/v1/stories/:id` to
change a task's state or due date. **[verify: write scopes on AGP's token
— our current token has proven read scopes only for the five families we
pull.]**

---

## 2. How AGP actually uses it (observed, not assumed)

These are facts from the live pulls, several of which contradicted our
initial assumptions and reshaped the product:

1. **~422 active projects, out of a 1000-company HubSpot book.** A few
   hundred engagements in flight; the rest of the book is prospects or
   dormant. Archived workspaces exist and are excluded from our pull.
2. **The client is encoded in the project TITLE, not in structure.**
   Titles lead with the client abbreviation — "ARMS: Support 25-26
   (Aug25-Jul26)", "PATNC: Ongoing Support" — matching HubSpot's
   `client_abbreviation__c`. There is **no native client container**:
   `workspace_groups` are categories ("Direct Mail"), so "show me
   everything for this client" is not a first-class Kantata view in AGP's
   tenant. This is a structural gap the collaboration workspace fills.
3. **Milestones carry the dates that matter** — in-home dates, launches,
   drops — as `story_type=milestone` with due dates (~600 of them).
   Hard/immovable dates are a real AGP concept (SPEC domain rule).
4. **Tasks (~1000) carry state** (started/not started/completed) — the
   raw material for "what's actually moving".
5. **Time entries are actively logged** — recent entries across projects
   let us compute a delivery pulse (hours/30d, people, last entry) per
   project. Where that's zero on an active project, delivery is quiet.
6. **Custom fields carry AGP's taxonomy** (Service Line Detail, vertical),
   not the standard fields.
7. **Kelly's change management is manual** (internal review): when a
   client holds or a print window slips, re-planning hours, dates, and
   people happens by hand across multiple Kantata screens. She herself
   doubted it could be automated. That workflow — detect drift → propose
   fix → apply — is the resource tool's entire reason to exist.
8. **Some Kantata features work well for them** and must not be recreated
   (Kelly said so; the specific list is an open validation question).

---

## 3. Where this application fits — precisely

**Kantata remains the system of record.** Projects, tasks, hours, budgets,
invoices: created and stored there. We do not fork that data; we mirror it
read-only today.

The collaboration workspace adds the three things Kantata structurally
lacks in AGP's tenant:

1. **The client-level view.** Kantata's unit is the project; AGP's
   relationship is the client, spanning several projects plus HubSpot-only
   context. Our matcher (workspace-group ownership → abbreviation prefix →
   name evidence) assembles per-client delivery: all projects, milestone
   schedule, task tree, team, hours pulse — review-gated, so a human
   approves what attaches.
2. **The room.** Per-client discussions with @mention notifications,
   files-as-links (SharePoint stays the file truth), client/contractor
   guest access with immediate revoke and audit — replacing scattered
   Teams chats and per-project Kantata posts. Client-safe by build-time
   rule: internal financials cannot render on guest surfaces.
3. **The narrative layer.** AI-drafted weekly client updates from real
   delivery state (draft → human approves → posts); service-line templates
   that seed dated plans; a sandbox for pre-project scenario work that
   doesn't belong in the system of record at all.

The resource & task tool (separate project, shared mirror) adds the
**change engine**: parameters → drift detection → notification →
AI-proposed reallocation with budget impact → approval → write-back.

What we deliberately do NOT do: rebuild Kantata's plan editing, time
tracking, invoicing, or resource-management screens; hold any data Kantata
should own; or show HubSpot CRM intelligence on delivery surfaces
(ADR 0008 — HubSpot is the client directory only).

---

## 4. The write-back map (the "updates back" part, in detail)

Today the integration is **read-only** (five GET families, 5-minute
server cache, schema-versioned client cache, per-endpoint failure notes).
Write-back is the goal state, staged so every write is approved by a human
first and rehearsed on the **Kelly test project** before touching real
work.

Phased, endpoint by endpoint:

| Phase | Write | Endpoint (v1) | Trigger in our app | Prereq |
|---|---|---|---|---|
| W1 | Task **status** round-trip | `PUT /stories/:id` (`state`) | A "from Kantata" task moved on the Project Plan board | Keep `kantataStoryId` on imported tasks (today we import by title — small schema add); write scope on token |
| W2 | Task/milestone **date** changes | `PUT /stories/:id` (`due_date`, `start_date`) | Approved timeline shift (resource tool fix, or plan edit here) | Same + conflict guard on `updated_at` |
| W3 | **New tasks** created here | `POST /stories` (`workspace_id`, `story_type:"task"`, title, dates) | Task added on a linked client's plan, flagged "push to Kantata" (review-gated, like imports in reverse) | Write scope |
| W4 | **Assignments** (people ↔ stories) | `POST /assignments` / `PUT /assignments/:id` | The resource tool's "add Aries to strategy" one-click fix | Assignments read first **[verify AGP uses them]** |
| W5 | **Weekly reservations** (Kara's step 7) | `story_allocation_days` / allocations | The resourcing engine's calendarized hours after approval | Engine project; grounding doc for rate semantics |
| W6 | **Posts** (optional) | `POST /posts` | Mirror major workspace decisions into the Kantata project feed so Kantata-only users see the trail | Decide if wanted — may be noise |
| — | **Reactive sync** | Subscribed Events (poller) | Replaces interval polling; 9-day retention means the poller must run reliably once granted | Events scope + deployed backend (Azure) |

**Safety rails for every phase** (already the pattern in `services/sync`):
provenance on every write (who approved, when, from what state), dry-run
mode, idempotent retries, rate-limit respect, and optimistic concurrency —
read `updated_at`, refuse to clobber a Kantata-side change, surface the
conflict for a human. The test project is the permanent staging ground:
every write path demos there first (this is exactly the "day in the life"
demo, docs/demo-day-in-the-life.md).

---

## 5. Open questions for the Kantata admin login / Kara & Kelly

1. Does AGP use **assignments + allocations** (resource management module)
   or plan capacity outside Kantata? (Determines W4/W5 shape.)
2. Which Kantata features "work well" that we must not recreate (Kelly)?
3. Does the token have (or can it get) **write scopes** and **Subscribed
   Events**? Current token: read on workspaces/stories/groups/custom
   fields/time entries — proven; everything else unproven.
4. Are story-level **time budgets** (estimated hours per task) populated?
   If yes, actuals-vs-estimate becomes computable per task, not just per
   project.
5. Budget/rate semantics (hard vs soft allocation, GL-coded expense
   categories) — the standing financial grounding doc ask; blocks only
   money math, nothing else.
