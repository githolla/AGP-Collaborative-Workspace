# ADR 0009 — Teams provisioning: one Team per project workspace, channels per workstream, folders per task

Date: 2026-08-10 · Status: **superseded by ADR 0010** (2026-08-13)

> **Superseded.** External collaborators are still Entra B2B guests — that part
> did not change — but the Team now sits at the client level (not per project) and
> is created by AGP's M365 admin (not the app), and a milestone grant now has two
> effects: an app-side `access_grant` row scoping tasks/discussions/plan, plus the
> same SharePoint item-grant/invite this ADR already proposed for files. See
> `docs/adr/0010-external-collaboration-and-provisioning.md` for what changed and
> why, and `docs/teams-provisioning-plan.md` for the current build.
>
> Kept because its verified-constraints section is still accurate and still worth
> reading — those Microsoft behaviours are why the per-project Team model (not the
> guest model) was abandoned.

Step-by-step build order: `docs/teams-provisioning-plan.md`.

## Context

The workspace needs a real Microsoft home for two things it currently only
models locally: **file sharing** (`ClientFileLink.url` is optional and usually
absent) and **project membership** (`ClientAccount.members` / `externals` are
rows in a JSON document with no counterpart in Entra or SharePoint).

The starting requirement was: *a Team at the project-workspace level, users may
only have access to the main channel and certain other channels, and a folder
**and channel** for each task.*

The folder-per-task half is sound. The channel-per-task half does not survive
contact with Microsoft's limits:

| Constraint | Value | Consequence for channel-per-task |
|---|---|---|
| Private channels per team | **30** | Hard wall. `docs/kantata-operating-model.md` records **~1000 tasks** observed across AGP's Kantata instance. |
| Channels per team (any type) | 1,000 (incl. deleted, 30-day tail) | Survivable, unusable as a list. |
| Standard channel visibility | **every team member** | A standard channel *cannot* be access-restricted. "Only certain channels" therefore forces **private** — which is what caps at 30. |
| Private/shared channel storage | **its own SharePoint site collection** | Under `Sites.Selected` each one needs its own admin grant (`POST /sites/{id}/permissions` requires `Sites.FullControl.All`). Channel-per-task ⇒ **an AGP IT grant per task**. |

That last row is decisive: channel-per-task would retract the least-privilege
promise already made to AGP IT in `docs/what-agp-needs-to-connect.md` §2d.

Folders carry no such cost. Thousands live in one library under one grant, and a
folder grant **cascades to descendants, including items added later** — so one
call can cover a whole workstream for a year.

## Decision

### 1. Team ↔ project workspace

One Microsoft Team per `ClientAccount`. That already means "project workspace"
rather than "whole client": accounts are scoped to selected Kantata projects by
default (`scopedToProjects`, from Cara's 2026-07-30 note that comingling a
client's separate project teams "is not ideal"). The mapping is **stored, never
inferred** — `ClientAccount.msTeam = { groupId, teamId, siteId, driveId, … }`.

### 2. Channels per workstream, not per task

- **General** — every member. The main channel.
- **A standard channel per Kantata milestone / workstream** — a handful, named
  from `Task.projectLabel`. Visible to all team members by design.
- **Private channels only where restriction is genuinely required**, with a live
  counter against the 30 cap in the UI. Provisioning refuses at 30 rather than
  failing opaquely.
- **A task channel is never automatic.** If one task earns a channel, a human
  opens it; the folder exists either way.

### 3. A folder per task, in the team's one document library

`Documents/<workstream>/<task>` in the team site's default drive — one site, one
drive, and (per §5) no site grant at all, because folders are created as the
signed-in PM who owns the Team. Folder identity is stored on the task
(`Task.msFolderId`) so a rename never orphans it.

The tree is laid out **permission-first**, because a grant cascades down and
cannot be cleanly subtracted from a child:

```
Documents/
├─ Direct Mail/             ← grantable: a whole workstream, incl. future tasks
│  ├─ T-1042 Segment file/  ← grantable: one task
│  └─ T-1043 Draft copy/
├─ Digital/
└─ _Internal/               ← never granted; budgets, margin, internal review
```

Provisioning is **lazy and retried**, per SPEC §Non-Negotiable Constraints #4:
`GET /teams/{id}/channels/{id}/filesFolder` 404s until SharePoint catches up, so
the saga backs off and the UI shows "workspace preparing".

### 4. Membership: internal via the Team, external via item grants

- **Internal AGP staff** are Team members (`POST /teams/{id}/members`) and see
  General, every standard channel, and every task folder. That is the intent.
- **Clients and contractors are never Team members.** They are Entra B2B guests
  (`POST /invitations`; `entraStatus: none|invited|active`) who receive
  **item grants** at the level chosen per person:

  | Grant at | They get | Typical case |
  |---|---|---|
  | One task folder | That task's files | A one-off deliverable |
  | A workstream folder | Every task in it, present and future | A contractor embedded on Direct Mail all year |
  | `Documents` root | The whole project | Rare — a true partner agency |

  `POST /drives/{driveId}/items/{itemId}/invite`, `roles: ["read"]` or
  `["write"]` for the "drop finished work here" folders. Revoke is
  `DELETE …/permissions/{permId}`; the `Share` row survives with `revokedAt`,
  per `handover.ts`.
- **Never grant a client and a contractor the same folder.** Microsoft's
  external-sharing docs are explicit: "When users share a folder with multiple
  guests, the guests can see each other's names in the Manage Access panel for
  the folder (and any items within it)." Co-granting would breach the
  no-cross-visibility rule via a Microsoft surface we do not control, so the
  folder tree separates them and provisioning refuses a grant that would put an
  external from one org onto a folder already granted to another.
- External discussion stays in the app thread via `contractorVisible` — a
  projection over the single internal thread, not a second store
  (`contractorScope.ts`). Externals get no Teams chat surface: accepted.

**The access rule, stated once:** *internal restriction is at the channel/site
level; external restriction is at the item level.*

Graph *can* break inheritance — `invite` accepts
`retainInheritedPermissions: false` — but it strips **all** inherited grants on
first share, internal staff included, so using it to hide one task folder from
one internal member means explicitly re-granting everyone else on that folder.
Available, deliberately unused by default, and never used silently.

### 5. Two auth modes: app-only provisions, the signed-in user shares

This is the finding that reshaped the ADR, verified against Microsoft's docs on
2026-08-11 (see "Verified constraints" below). Two hard facts:

1. **`Sites.Selected` cannot send sharing invitations.** `driveItem: invite`
   lists only `Files.ReadWrite.All` / `Sites.ReadWrite.All` as *Application*
   permissions.
2. **"*New* guests can't be invited using app-only access."** A daemon token
   cannot share with anyone who is not already a guest in the tenant.

App-only sharing would therefore cost `Sites.ReadWrite.All` — tenant-wide write —
which is precisely the consent AGP was nervous about.

**Pursuing that led to a better answer: run the whole flow delegated.** Microsoft
is unambiguous that this is the preferred mode — "the application can never exceed
the current user's existing permissions… Delegated is preferred when possible."
Concretely, a PM who owns the project Team already has write access to its
SharePoint site, so **acting as that PM needs no site grant at all**:

| Operation | Delegated permission | What it replaces |
|---|---|---|
| Create the Team | `Team.Create` | App-only `Team.Create` + a resolved owner + `User.Read.All` |
| Create channels | `Channel.Create` | same, app-only |
| Create task folders | `Files.ReadWrite` | **`Sites.Selected` + a per-site admin grant** |
| Invite a guest | `User.Invite.All` | app-only, which **cannot invite new guests** |
| Grant/revoke a folder | `Files.ReadWrite.All` | `Sites.ReadWrite.All` (tenant-wide) |

**Everything `Sites.Selected` was for disappears, and so does the per-site
runbook.** The owner requirement disappears too — a delegated `POST /teams` makes
the signed-in PM the owner implicitly, so no `User.Read.All` lookup is needed to
create a team.

**The cost, stated plainly:** every provisioning and sharing action requires a
signed-in AGP user in the browser. There is no background provisioning — new
Kantata tasks get their folders the next time a human opens the workspace, not
overnight. Given the saga is browser-polled and sharing is human-reviewed by
design, this costs approximately nothing today. It would need revisiting if
scheduled provisioning is ever wanted.

**What still needs app-only** — and the only thing that does: reading item
`analytics` for open-tracking on a schedule (`Sites.Read.All`), or the Purview
audit log instead. Fine as read-only.

**Recommendation:** build delegated-first, and leave `Sites.Selected` **off the
consent ask entirely** — an unassigned scope is still a scope an auditor has to
ask about, and it buys nothing until a background worker exists. Add it then, with
the per-site grant runbook, as a deliberate second decision.

**Open question, and now the first task of the build:** where the delegated Graph
token comes from. Sign-in is brokered by Supabase Auth (ADR 0007), which is not
obviously a Graph token source — either it returns a `provider_token` carrying the
Graph scopes, or the browser acquires one separately (MSAL.js, or the Teams SSO
token via on-behalf-of). This is unverified, and the whole delegated-first design
rests on it. Spike it before anything else.

## Rejected

- **Channel per task (private).** 30-channel cap vs ~1000 tasks; one admin grant
  per task; retracts the `Sites.Selected` promise.
- **Channel per task (standard).** Unrestrictable, so it cannot satisfy "only
  certain channels", and drowns the channel list.
- **Guests as Team members.** A standard channel cannot be restricted, so every
  workstream channel would have to be private (back to the 30 cap), and guests
  become visible to one another — a client and a contractor should not see each
  other's presence.
- **Shared channel per external org.** Requires Entra **B2B Direct Connect** per
  partner tenant and **does not work with email one-time-passcode guests** —
  which `what-agp-needs-to-connect.md` §2e already promised so contractors would
  not need a Microsoft account.
- **`Sites.ReadWrite.All`.** Removes the per-site grant step at the cost of
  tenant-wide write. Kept as a documented fallback if the per-site runbook proves
  unworkable; not the ask.

## Graph permissions this adds to the BLOCKERS #5 consent pass

**All delegated**, all needing admin consent for the organization (user consent is
normally disabled, and nobody should click a consent prompt per person):

| Permission | For |
|---|---|
| **`Team.Create`** | Create the Team. The documented *least-privileged* option for `POST /teams` — **not** `Group.ReadWrite.All`, which grants read/write over every group in the tenant and is explicitly the "higher privileged" alternative. |
| `Channel.Create` | Workstream channels |
| `TeamMember.ReadWrite.All` | Internal staff on/off the Team |
| `User.ReadBasic.All` | Resolve a colleague's email → user id. **No member can be added without it** |
| `User.Invite.All` | Guest invitations for clients/contractors |
| `Files.ReadWrite.All` | Create task folders; grant/revoke external folder access. Bounded by what the signed-in user can already reach — **not** tenant-wide |

Plus one platform change that is easy to miss and blocks everything: the app
registration currently declares a **Web** redirect URI (Supabase's callback). A
browser-delegated flow needs a **Single-page application** platform entry added.

Deliberately **not** requested:

- `Sites.Selected` — needs a per-site admin grant *and* cannot send sharing
  invitations. Kept only as a documented fallback if a background worker is ever
  built.
- `Sites.ReadWrite.All` / application `Files.ReadWrite.All` — tenant-wide write.
- `Group.ReadWrite.All`, `Directory.ReadWrite.All` — far broader than `Team.Create`.
- `User.Read.All` — `User.ReadBasic.All` is enough for email → id.
- `ChannelMember.ReadWrite.All` — only needed for private channels, deferred.

Unchanged from the existing ask: external sharing enabled on the relevant sites
and the guest policy. **Added:** SharePoint/OneDrive integration with **Entra B2B
must be enabled**, or external sharing uses SharePoint external authentication and
creates no guest account — leaving nothing for `entraStatus` to track and no
directory object to grant. **Dropped from the critical path:** the Purview audit
log, now needed only for per-person open tracking, which is deferred.

## Verified constraints (checked against Microsoft docs 2026-08-11)

Recorded because each one invalidated an earlier assumption, and because the next
person to read this will otherwise re-derive them:

- **Folder-level guest access is fully supported.** A folder is a `driveItem`;
  `invite` takes it; a grant cascades to descendants including items added later.
  Microsoft's own guidance for controlling guest access is to share each subfolder
  individually.
- **Permissions only add.** Sharing a parent folder never reduces unique
  permissions already set on a child.
- **`Sites.Selected` cannot send sharing invitations** (application mode).
- **New guests cannot be invited app-only**; existing guests can.
- **Guests co-granted a folder see each other's names** in Manage Access.
- **`retainInheritedPermissions: false`** does break inheritance, but only on
  first share and it strips *all* inherited grants, internal staff included.
- **Since June 2024**, legacy SharePoint Invitation Manager invitations no longer
  grant access; items must be re-shared to produce a valid invitation. Any
  migration of pre-existing extranet shares must re-share, not re-point.
- **`Team.Create` is the least-privileged permission for `POST /teams`** in both
  delegated and application mode. `Group.ReadWrite.All` and
  `Directory.ReadWrite.All` are the documented *higher-privileged* alternatives
  and are not needed.
- **App-only team creation requires an owner** — a real user in the `members`
  collection with `roles: ["owner"]`. There is no ownerless app-created team.
- **`POST /teams` returns `202 Accepted`** with a `Location` header pointing at a
  `teamsAsyncOperation` and an empty body. Team creation is asynchronous by
  design, which is why provisioning is a saga.
- **The General channel's SharePoint site can fail to provision.** Microsoft's own
  guidance: if it has not appeared after 5 minutes, call `GET .../filesFolder` to
  *trigger* provisioning. This is not a workaround — it is the documented remedy,
  and it is what SPEC constraint #4 already anticipated.
- **Creating a team *from an existing group* can 404 if the group is under 15
  minutes old** (retry 3× at 10s). Creating from the `standard` template in one
  call avoids this entirely, and additionally allows `firstChannelName` — which
  the from-group path does not support.
- **Granting `Sites.Selected` on a site requires `Sites.FullControl.All`**, so only
  an admin can do it, and the site does not exist until the Team is created. The
  grant is therefore inherently *after* team creation — it can never be
  pre-authorized, and there is no way to grant access to a site that does not yet
  exist or to a broader container covering future sites.
- **Delegated access is the intersection of app and user permissions** — "the
  application can never exceed the user's permissions." This is why delegated-first
  is stronger than `Sites.Selected`, not a shortcut around it.
- **Per-endpoint permission tables omit the `*.Selected` scopes.** `Sites.Selected`
  is not listed on create-folder or `invite`, while the Selected overview states
  folders and files *are* supported. For `invite` the exclusion is real
  (confirmed separately); for folder creation it is likely a documentation gap.
  Since the design no longer depends on it, this is recorded rather than resolved.
- **Item-level grants break inheritance and consume unique security scopes.**
  Microsoft warns to "be mindful of service limits for unique permissions." A
  per-task grant costs a scope per folder, so on a library heading toward ~1000
  task folders, **prefer workstream-level grants** and treat per-task grants as
  the exception. This is a second, independent reason the folder tree is laid out
  permission-first.

## Consequences

- The channel list stays legible: General plus a handful of workstreams, however
  many tasks the project has.
- Per-task access control still exists and is **finer** than a channel could be —
  read vs. write, per person, per folder, revocable, with a surviving record.
- `Share.openedAt` / `openSource: "sharepoint"` stops being unreachable code.
- File features are **per-account gated** on the site grant. A new project Team
  works for discussion immediately and for files once an admin runs one grant.
- **No server-side Graph layer, and no `/api` route.** Because delegated auth
  carries no secret, the browser calls Graph directly with the signed-in user's
  token. This deliberately departs from the `api/kantata-write.ts` pattern, which
  exists only because Kantata's token *is* a secret; a server hop here would add a
  moving part without adding safety. It also removes the 30s `vercel.json` ceiling
  from the design, so provisioning is a resumable async function whose resume point
  is the stored ids — not a persisted job saga.
- **No dry-run switch.** `plannedProvisioning()` is a pure function over the
  account, so the preview costs nothing and needs no `GRAPH_ENABLED` equivalent.
  The `KANTATA_WRITE_ENABLED` pattern is not copied here because there is no
  secret-holding endpoint to gate.
- **Less is buildable before consent than it first appeared.** Only the data model
  and pure helpers. The earlier app-only draft looked like it had a long
  pre-consent runway, but that was a whole server layer tested against a stubbed
  `fetch` — busywork that the delegated design deletes along with the illusion of
  progress.
- **Deferred on purpose:** private channels and the 30-cap machinery, per-task
  channels, Purview per-person open tracking, member removal, whole-project grants,
  and background provisioning. Each is additive; none is load-bearing for "get off
  the extranet, share one folder securely, see who edited it."
