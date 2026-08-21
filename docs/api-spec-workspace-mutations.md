# API spec — workspace reads and mutations

The endpoint surface that replaces `/api/state`'s whole-document read and write for
the collaboration model. Companion to `docs/teams-provisioning-plan.md` B6; this is
the "implement this list" half.

Derived from `apps/tab/src/workspace/store.ts` as it stands — 85 `useCallback`
mutations. Every one is accounted for at the end, including the ones that become no
endpoint at all.

> **Implementation notes, read before using this as a live reference:**
> 1. **Route paths below are operation notation, not literal URLs.** The actual
>    deployment is Vercel file-based routing with flat, hyphenated single-file
>    endpoints — `/api/account/:id/team` in this doc is `POST /api/account-team` in
>    the real code, `/api/task/:taskId/assignments` is `PUT /api/task-assignments`,
>    and so on. Ids travel in the request body for writes and the query string for
>    reads; there are no `[id].ts` dynamic-segment files anywhere in `api/`. Every
>    implementation file ended up re-explaining this mapping in its own header
>    comment because this doc never states it once, centrally.
> 2. **This surface coexists alongside `/api/state`; it has not replaced it.** The
>    "What this means for `store.ts`" refactor at the bottom of this doc has not
>    happened — `store.ts` still edits one JSON document and pushes it to
>    `/api/state` for accounts, campaigns and tasks, exactly as it did before this
>    spec was written. The `collab`-schema endpoints below are live and used by
>    `ClientAdminPanel.tsx` (the "Admin" tab inside `ClientWorkspace.tsx`) and
>    `ExternalWorkspace.tsx` — not by `store.ts`. The two account models are only
>    ever bridged by matching `clientName` at render time (never by a shared id);
>    `store.ts`'s own JSON-document world remains untouched by this schema.
> 3. Some rows are already stale on their own merits (levels, optional fields) —
>    flagged inline below where found.

---

## Rules every endpoint follows

1. **The caller's JWT, never the service key.** Each handler builds its Supabase
   client from the `Authorization: Bearer` token so row-level security applies.
   `SUPABASE_SERVICE_ROLE_KEY` appears only in migrations and the two admin
   operations that deliberately cross user boundaries (`/api/admin/*`).
2. **Graph calls carry the caller's own delegated token**, forwarded as
   `X-Graph-Token`. There is no application credential anywhere in this surface: a
   handler acts strictly as the signed-in person and stores the token nowhere. An
   endpoint that cannot get one returns `graph_token_required` rather than falling
   back to anything.
3. **The API decides, the UI displays.** Every endpoint re-checks role and grant.
   Nothing trusts a field, an id or a path from the request body to establish
   authority.
4. **Least surface.** A mutation takes the ids it needs and the fields it changes.
   No endpoint accepts a whole entity, and none accepts a folder path.
5. **Idempotent where it can be.** Import, provisioning and folder creation are
   safe to re-run and report what they actually did.
6. **Partial failure is returned, never swallowed.** Anything with two effects — a
   grant, a multi-recipient share — returns per-effect outcomes.

### Envelope

```
200  { data: … }
4xx  { error: { code, message, detail? } }
```

Codes: `unauthenticated` · `forbidden` · `not_found` · `conflict` ·
`validation_failed` · `graph_token_required` · `graph_failed` · `partial` ·
`internal_error` (a genuine infrastructure failure — a bad connection, a query
bug. Never what a denied RLS read looks like: that just returns fewer rows,
it never throws).

### Concurrency

Mutations are narrow field writes, so last-write-wins per field is the default and
the 409-and-adopt dance disappears with the whole-document POST. Two exceptions carry
an `expectedUpdatedAt` and return `conflict` if it has moved: task edits and thread
message edits, where two people typing over each other is real.

### Roles

`app_admin` · `workspace_admin` · `member` (internal) · `external`. Where a table
says **member**, an admin of either kind also passes.

---

## Reads

| Route | Returns | Role |
|---|---|---|
| `GET /api/workspace` | The caller's scoped payload: accounts they may see, with tasks, campaigns, members, externals, grants, thread. Internal and external differ only by what the policies return | any |
| `GET /api/workspace/:accountId` | One account, same projection | any |
| `GET /api/files?accountId&kantataId` | Graph listing of that folder, fetched with the caller's own delegated token | member, or external holding a grant covering it |
| `GET /api/files/versions?itemId` | Version history — who changed what, when | member |

An external's payload is filtered by their grants first and the audience flag
second, and contains no files: those come from `/api/files`, which SharePoint
enforces directly against their guest permission.

---

## Workspace lifecycle

| Route | Body | Role | Replaces |
|---|---|---|---|
| `POST /api/account` | `{ clientName, fromMirror?: boolean }` | workspace_admin | `createAccount`, `createAccountFromMirror` |
| `PATCH /api/account/:id` | `{ clientName? , archived? }` | workspace_admin | `renameAccount`, `setAccountArchived` |
| `PUT /api/account/:id/scope` | `{ kantataProjectIds: string[], scoped: boolean }` | workspace_admin | `setProjectScope` |
| `POST /api/account/:id/projects` | `{ kantataProjectIds: string[] }` | workspace_admin | `linkProjects` |

`archiveAllAccounts` and `clearWorkspace` are **app-admin only** and move to
`/api/admin` (below). Both are destructive across every client and neither belongs on
a workspace route.

---

## Kantata import

Idempotent, and each returns what it actually changed rather than a bare success.

| Route | Body | Returns | Replaces |
|---|---|---|---|
| `POST /api/account/:id/import` | `{ scope: "all" \| "campaigns" \| "tasks", selected?: […] }` | `{ campaignsAdded, tasksAdded }` | `importAllFromKantata`, `importCampaigns`, `importTasks`, `ensureAutoPopulated` |
| `POST /api/account/:id/deepen` | — | `{ storiesFetched }` | `ensureDeepened` |
| `POST /api/account/:id/tasks/synced` | `{ applied: { ref, createdId? }[] }` | `{ updated }` | `markTasksSynced` |
| `DELETE /api/account/:id/campaigns/:campaignId` | — | — | `removeCampaign` |
| `DELETE /api/account/:id/campaigns` | — | `{ removed }` | `clearCampaigns` |

**Fix `populateFromKantata`'s title-only dedupe on the way through** — dedupe on
`kantataStoryId`, falling back to title only when there is no id. Every other import
path already does; this one silently collapses identical child titles across
milestones.

---

## Tasks

All **member**, except the two visibility toggles which are also member — flagging
something shareable is not granting access (plan D1).

| Route | Body | Replaces |
|---|---|---|
| `POST /api/account/:id/tasks` | `{ title, ownerName?, due?, label? }` | `addAccountTask` |
| `PATCH /api/task/:taskId` | `{ status?, due?, estimatedHours?, startDate?, dependsOn?, expectedUpdatedAt }` | `setAccountTaskStatus`, `setAccountTaskHours`, `setAccountTaskDependencies`, `setSharedTaskStatus` |
| `PUT /api/task/:taskId/assignments` | `{ names: string[] }` | `setAccountTaskAssignments` |
| `PATCH /api/task/:taskId/assignment/:name` | `{ hours?, done?, primary?, order? }` | `setAccountAssignmentHours`, `toggleAccountAssignmentDone`, `setAccountAssignmentPrimary`, `setAccountAssignmentOrder` |
| `PATCH /api/task/:taskId/visibility` | `{ clientVisible?, contractorVisible? }` | `toggleAccountTaskClientVisible`, `toggleAccountTaskContractorVisible` |
| `POST /api/account/:id/template` | `{ templateKey, startDate }` | `applyTemplate` |

The toggles become explicit `PATCH` with a value rather than a toggle, so two people
clicking at once converge instead of flipping past each other.

---

## Discussions

| Route | Body | Role | Replaces |
|---|---|---|---|
| `POST /api/account/:id/messages` | `{ body, topic?, kantataId?, kantataLevel?, clientVisible?, contractorVisible? }` | member; **external** may post into a milestone they hold | `postAccountMessage` |
| `PATCH /api/message/:messageId` | `{ body, expectedUpdatedAt }` | author only | `editAccountPost` |
| `DELETE /api/message/:messageId` | — | author only | `deleteAccountPost` |
| `PATCH /api/message/:messageId/visibility` | `{ clientVisible?, contractorVisible? }` | member | `toggleAccountMessageContractorVisible`, plus the new client flag |

**An external's post is server-stamped**: author from the token, `kantataId` inherited
from the thread they are posting in, and the audience flag set to their own role only.
None of those three is taken from the body when the caller is external — that is what
stops a contractor's reply reaching the client.

---

## Files and approvals

Graph-backed and delegated. There is no app-side file inventory.

| Route | Body | Role | Replaces |
|---|---|---|---|
| `POST /api/files/upload-session` | `{ accountId, kantataId, name, size }` | member; external with a `write` grant | new (B5a, B7) |
| `POST /api/files/approval` | `{ accountId, msItemId, name, purpose: "fyi" \| "approval" }` | member | `shareFileWithClient` |
| `DELETE /api/files/approval/:approvalId` | — | member | `unshareFileFromClient` |
| `POST /api/files/approval/:approvalId/decision` | `{ decision: "approved" \| "changes", note? }` | external (client) holding the grant | `recordClientDecision` |
| `POST /api/files/opened` | `{ accountId, msItemId, shareId? }` | any | `recordShareOpened`, `recordItemOpened` |

`addAccountLink`, `setAccountLinkUrl`, `removeAccountLink` and
`toggleAccountFileContractorAccessible` get **no endpoint** — `ClientFileLink` and its
per-file flags are retired with the folder model.

---

## Provisioning

Delegated, runs as a Team owner or member per the plan's B3/B4.

| Route | Body | Role | Replaces |
|---|---|---|---|
| `POST /api/account/:id/team` | `{ teamUrlOrId, channelNames? }` | workspace_admin | new — connect the admin-created Team (UI: "Connect Team"), also captures its real `displayName` |
| `POST /api/account/:id/folders/sync` | — | workspace_admin | new — project folders and renames |
| `POST /api/account/:id/folders` | `{ kantataIds: string[] }` | workspace_admin | new — the milestone picker |
| `GET /api/account/:id/provisioning-plan` | — | workspace_admin | new — `plannedProvisioning` preview |
| `GET /api/account/:id/folder-children?folderId?` | — | workspace_admin | new (B4 §8) — lists one live SharePoint folder's direct children (omit `folderId` for the drive root), for browsing/granting a folder with no Kantata correspondence. Lazy, one level per call, never a whole-tree walk |

---

## People, grants and access

| Route | Body | Role | Replaces |
|---|---|---|---|
| `POST /api/account/:id/members` | `{ personId? , name?, title? }` | workspace_admin | `addAccountMember`, `addAccountMemberNamed`, `addTeamMember` |
| `POST /api/account/:id/externals` | `{ name, org, email, role: "client" \| "contractor", userId? }` | workspace_admin | `addExternal`. `userId` is set only by the tenant-wide "pick an existing person" search (app-admin only, see Admin below) — an already-resolved `collab.app_user` id, so the row is born resolved instead of starting in the pending state |
| `DELETE /api/account/:id/externals/:externalId` | — | workspace_admin | `removeExternal` |
| `POST /api/grant` | `{ accountId, userId?, externalLinkId?, kantataId, level: "project" \| "milestone" \| "phase" \| "task" \| "folder", role: "read" \| "write" }` | workspace_admin | new — the milestone grant. Exactly one of `userId`/`externalLinkId` is required — `externalLinkId` targets a person who hasn't signed in yet (the invite still fires off their email alone); `level: "folder"` requires a synthetic `"graph:"`-prefixed `kantataId` from the live folder browser, not a Kantata id |
| `DELETE /api/grant/:grantId` | — | workspace_admin | new |
| `POST /api/grant/revoke-all` | `{ accountId, userId }` | workspace_admin | `revokeAllForPerson` |
| `POST /api/account/:id/share` | `{ personName, items: ShareableItem[] }` | workspace_admin | `shareWithPerson` |
| `DELETE /api/share/:shareId` | — | workspace_admin | `revokeShare` |
| `PATCH /api/account/:id/notify/:personName` | `{ pref: "teams" \| "email" \| "both" }` | member | `setNotifyPref` |
| `POST /api/account/:id/remind` | `{ taskId }` | member | `remindClientDeliverable` |

### `POST /api/grant` has two effects

It writes the `access_grant` row **and** issues the SharePoint invite on that
milestone's folder, creating the folder first if it does not exist. It returns both
outcomes:

```json
{ "data": { "grantId": "…",
            "row": "created",
            "sharePoint": "granted" | "failed",
            "msPermissionId": "…",
            "detail": "…" } }
```

A `failed` SharePoint half is **not** an error response — the grant partially exists
and the UI must show it as a half-grant, with a retry. Revoke reverses both and
reports the same way.

---

## Admin

`/api/admin/*`, app admin only. The two destructive operations and the offboarding
view live here, away from workspace routes.

| Route | Body | Replaces |
|---|---|---|
| `GET /api/admin/externals` | — | new — every external across every workspace, each row joined with its `clientName`. Powers the "pick an existing person" search in the external-add form (above) |
| `POST /api/admin/externals/:userId/offboard` | — | `offboardEverywhere` |
| `GET` / `POST` / `DELETE /api/admin/users` | `{ email, role }` | `addSignInAccount`, `removeSignInAccount` — now role assignment, not password creation |
| `POST /api/admin/accounts/archive-all` | — | `archiveAllAccounts` |
| `POST /api/admin/workspace/clear` | `{ confirm: true }` | `clearWorkspace` |

---

## What gets no endpoint

| Mutation | Why |
|---|---|
| `adopt`, `pushRemote`, `mutate`, `mutateAccount`, `mutateIdea` | Internal store plumbing for the whole-document model. They disappear with it |
| `signInWithPassword` | Supabase Auth; `localAuth.ts` is deleted |
| `sharedTasksFor` | A selector, not a mutation. Stays client-side over the scoped payload |
| `addAccountLink`, `setAccountLinkUrl`, `removeAccountLink`, `toggleAccountFileContractorAccessible` | Retired with `ClientFileLink` |
| `createInitiative`, `createIdea`, `updateIdea`, `removeIdea`, `claimIdea`, `promoteIdea`, `updateFactor`, `setSummary`, `setPackageStatus`, `acceptDraftReview`, `inviteCopilotIn`, `askRoiAnalyst`, `askIdeaAnalyst`, `setArchived`, `addTeamMember` | The ROI side stays in the JSON document on `/api/state` |
| `addTask`, `setTaskStatus`, `postMessage`, `postIdeaMessage`, `setClientAccount`, `toggleTaskClientVisible` | Also ROI side — these act on an **initiative or idea**, not a client workspace, despite names that read like the account equivalents. Easy to mis-map; see the bridge rule below |
| `addPageFeedback`, `recordFeedback` | Same — document-backed, internal only |

---

## The one place the two stores meet

`sharedTasksFor(accountId)` projects **initiative** tasks flagged `clientVisible`
into a client workspace's plan, and `setSharedTaskStatus` writes their status back.
Initiatives stay in the JSON document; the workspace moves to Postgres. So a live
projection would put document content on a surface an external can see, breaking the
rule that anything an external reaches lives in Postgres.

**Resolve it by copying at share time, not projecting live.** Marking an initiative
task client-visible creates a real `task` row on the account, stamped with its origin
— the same rule `Share` already follows in capturing `itemName` at send time. From
then on it is an ordinary workspace task: it appears in the plan, an external sees it
if flagged and in scope, and its status writes to Postgres like any other.

Without this, the boundary has a hole in exactly the place nobody would look for one.

## What this means for `store.ts`

The file is 2,254 lines and every mutation currently edits one in-memory document
and pushes the whole thing. The refactor is mechanical but wide:

1. **Keep the hook shape.** Components call `ws.setAccountTaskStatus(...)` today;
   they should still call it after. Only the body changes — from a local mutation
   plus a debounced whole-document POST, to a fetch and a targeted state update.
2. **One transport helper**, so error envelopes, auth headers and conflict handling
   live in one place rather than 60.
3. **Optimistic update where it reads better**, reconciled from the response. Task
   status and toggles want it; imports and provisioning do not — they should show
   progress and land once.
4. **Delete `adopt`/`pushRemote` last**, once no caller writes the document.

Sequenced that way, each group of endpoints can land and be used before the next one
exists, and the document keeps working underneath for everything not yet moved.
