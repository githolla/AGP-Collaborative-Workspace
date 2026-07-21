# Kantata data for collaboration — audit & gap analysis (2026-07)

The question: for a team to actually **collaborate on a project**, what does
Kantata hold, and is all of it flowing into the workspace? This audits the
live pull against what collaboration needs, and records what shipped.

## What a team needs to collaborate on a project

1. The project (workspace) — name, status, dates
2. Who's on it (team / participants)
3. What needs doing (tasks / deliverables)
4. **Who owns each task** (assignments)
5. When it's due (milestones + dates)
6. **The conversation** (comments / posts)
7. Progress (state, % complete)
8. Effort (time logged)
9. Structure (task hierarchy, dependencies)
10. Artifacts (files / attachments)

## Inventory — pulled vs. available (tenant census)

| Kantata object | In tenant | Pulled? | Feeds |
| --- | --- | --- | --- |
| workspaces (roster) | 420 | ✅ | projects, dates, status, team |
| stories — milestones | 160k stories | ✅ (windowed) | milestone dates |
| stories — tasks/deliverables | ↑ | ✅ (all types) | the shared plan |
| **assignments** | 201k | ✅ **(new)** | **task OWNER** |
| **posts** | 2,732 | ✅ **(new)** | **project conversation** |
| time_entries | 617k | ✅ (aggregated) | hours pulse (rates stripped) |
| workspace_groups | 688 | ✅ | client↔project join |
| custom_field_values | — | ✅ | service line, vertical |
| users (via includes) | 197 | ✅ | names for team/owner/author |
| percentage_complete | — | ✅ **(new)** | task progress |
| workspace_allocations | 158k | ❌ | resourcing (Kelly surface) |
| **account_memberships** | 296 | ✅ **(new)** | **the AGP team roster** |
| attachments / documents | — | ❌ | Files tab (still local) |
| story dependencies / sub-stories | — | ❌ | plan structure |
| expenses / invoices / rate_cards | 8.6k / 16k / 291 | ❌ (by design) | financials → internal Portfolio only, never the collaboration surface (no-financials rule) |
| skills / time_offs | 17 / — | ❌ | staffing / availability |

## Shipped — the collaboration essentials

1. **Task owners (assignments).** The task tree now pulls `include=assignees`
   (tenant-wide AND the per-workspace deepen), resolves assignee ids → names,
   and the imported task carries `ownerName`. A plan with no owners isn't
   collaboration; now every Kantata task lands accountable. `percent` rides
   along for progress.
2. **The project conversation (posts).** Recent Kantata posts (workspace &
   story comments) are pulled, attributed to their author, and surfaced in the
   client workspace's **Discussions** tab as a read-only "Project conversation
   · from Kantata" feed. The team's real back-and-forth now lives beside the
   local thread. (Two-way posting waits on the write-back layer.)

3. **The AGP team roster (account_memberships).** The people you can add to
   an account are now the *live AGP Kantata account* — every member, by name
   and title, pulled from `account_memberships?include=user`. Kantata is
   authoritative: the bundled demo roster only stands in when the pull is
   offline, so a real team list never shows fictional names. Add-a-teammate,
   everywhere in the client, draws from this.

## Recommended next (ranked by collaboration value)

1. **Files / attachments** → feed the Files tab from Kantata attachments.
2. **Task hierarchy** (parent/sub-stories + dependencies) → structure the plan.
3. **Allocations / availability** → the Resource surface (Kelly), not the
   client-facing collaboration view.

Financials stay out of collaboration surfaces by design (guest-safety rule);
they belong only on the internal Portfolio view.
