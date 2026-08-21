# ADR 0010 — External collaboration: Entra guests, granted milestones, and hand-created Teams

**Status:** accepted · **Date:** 2026-08-13 · **Supersedes:** ADR 0009

Implementation detail: `docs/teams-provisioning-plan.md`. Admin steps:
`docs/m365-admin-runbook.md`.

## Context

ADR 0009 had the app create Teams, put a channel on every milestone, and manage
external access through SharePoint item grants — with the app running entirely
delegated and `Sites.Selected` deliberately off the consent ask.

Three things about AGP's real instance broke that. A fiscal-year Kantata contract
carries ~31 milestones, so channel-per-milestone is unusable. A `ClientAccount`
covers a whole client rather than one project, so the folder tree needs a level
above the milestone. And the app has no authorization layer of its own: `/api/state`
returns every client's data to any authorized caller, with password hashes inside
the payload.

An intermediate design gave externals app accounts and served their files with an
app-only token. It was rejected: SharePoint would have had no per-person record of
external access, and Microsoft-side attribution matters more than avoiding guests in
the directory.

## Decision

**1. One Team per client, created by hand.** A `ClientAccount` covers a whole client,
and its Team is created by AGP's M365 admin, who adds the application admins as
owners. The app never calls `POST /teams`; `Team.Create` is not requested.

**2. Folders: project automatic, milestones chosen.**
`Documents/<project>/<milestone>/[<phase>/]<task>`. Every matched Kantata project
gets a folder on sync; a milestone gets one when someone picks it from the project's
folder list, or when it is granted. Phases and tasks follow on demand. The folder set
comes from the Kantata mirror, never from the lossy workspace import. An admin can
also browse the live drive directly and grant a folder with no Kantata
correspondence at all, identified by a synthetic id rather than a Kantata one — see
`docs/teams-provisioning-plan.md` B4 §8.

**3. The folder is the file list.** No app-side inventory of files. Approvals key on
the SharePoint item id. AGP staff upload through the app, delegated as themselves.

**4. Externals are Entra B2B guests, and sign in with Microsoft.** Clients and
contractors are invited by email, become guests in AGP's tenant, and authenticate
through the same Supabase Azure provider as staff. One identity per person: no
passwords for AGP to manage, and no second identity to reconcile.

**5. Everything runs delegated.** There is no app-only path and no client secret. A
PM already has write on their own Team's site, so creating folders, granting a guest
a folder, and listing files all run as the signed-in person — the app can never
exceed what that person could do by hand, and the audit log names them. `Sites.Selected`
is not requested, and no per-site admin grant is needed.

**6. A milestone grant is one action with two effects.** It writes a row in
`access_grant` — which scopes the app's own screens: tasks, discussions, the plan,
the dashboard — and issues a SharePoint invite on that milestone's folder, whose
permission id is stored on the row. SharePoint enforces files; the app enforces its
own data. Revoking reverses both, and a partial failure is shown rather than
swallowed. The row's `user_id` is nullable: a grant can target a person who hasn't
signed in yet (by their `external_link_id` instead), so the real SharePoint invite
still fires off their email alone, before any sign-in exists — "Resolve sign-in"
later backfills `user_id` without re-inviting.

**7. Postgres with row-level security.** The single JSON document moves to Supabase
Postgres. The browser calls `/api`, and each handler builds its Supabase client from
the caller's JWT so policies apply; the service-role key bypasses RLS and is reserved
for migrations and admin operations.

## Consequences

- **No per-client admin action.** Folder grants are delegated, so nothing waits on IT
  after the one-time consent pass. This is the largest operational difference from the
  app-account alternative.
- **The tenant accumulates guests** — one per external contact — and offboarding
  becomes a directory operation, not a row delete.
- **Guest prerequisites are required, not optional:** external sharing on the team
  sites, SharePoint/OneDrive integration with Entra B2B, and email one-time passcode
  so contractors need no Microsoft account.
- **Guests co-granted a folder see each other's names** in Manage Access. Accepted: a
  client and a vendor on the same job may see one another. Two people holding the same
  milestone share whatever is flagged in it — separate them by grant, not by flag.
- **Each item grant breaks inheritance and consumes a unique security scope**, so the
  milestone stays the grant unit and per-task grants remain the exception.
- **Co-authoring in Office on the web works** as a by-product, though externals mostly
  work on a file and send it back.
- **Two systems of record for one decision.** `access_grant` and the SharePoint ACL
  must agree; keeping them in step is the standing cost of this model.
- **Per-person file opens come from the app's own click record, or from Purview.**
  `analytics/allTime` gives counts without names; the Office 365 Management Activity
  API gives attribution at the cost of a separate integration and minutes-to-hours of
  lag. Start with the click record.

## What this changes in ADR 0009

| 0009 | Now |
|---|---|
| Team per project workspace | Team per client (§1) |
| A standard channel per milestone | A small hand-picked set — ~31 milestones per contract makes per-milestone channels unusable |
| App creates the Team | The M365 admin does (§1) |
| Folder per task, eagerly | Project automatic, milestone picked, phase and task on demand (§2) |
| `Sites.Selected` off the ask, and a per-site grant if it were ever needed | Neither: all file work is delegated (§5) |
| Never co-grant a client and a contractor | Allowed, with the co-visibility accepted (§6) |
| Per-person opens deferred to Purview | The app's click record first; Purview only if attribution is required |

Unchanged from 0009: folders beat channels because a folder grant cascades to items
added later, and `retainInheritedPermissions` stays pinned `true` on every invite.
