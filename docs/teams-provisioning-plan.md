# Teams provisioning & external access — implementation plan

Decision record: `docs/adr/0010-external-collaboration-and-provisioning.md`
(supersedes ADR 0009). Steps to hand AGP's M365 admin:
`docs/m365-admin-runbook.md`.

## What we are building

1. **A Microsoft Team per client.** Each of the client's Kantata projects gets a
   folder in the team's document library automatically; folders for the milestones
   inside are created when someone picks them. This is where AGP staff work. The
   folder tree isn't limited to what Kantata knows about, either — an admin can
   browse the live SharePoint drive directly and grant any real folder, Kantata-linked
   or not (a `"graph:"`-prefixed synthetic id stands in for a folder with no Kantata
   correspondence; see B4 §8 and B7).
2. **External collaborators — clients and contractors — as Entra B2B guests** who
   sign in with Microsoft, like staff. An admin adds a person to a client account,
   marks them client or contractor, and grants them specific milestones. Both get the
   files under those milestones; a client also gets a dashboard, the shared plan,
   discussions and approvals, while a contractor's screen stays narrow (C2).
3. **A record of who was given what, when, and whether they used it**, surviving
   revocation.

**Architecture in one line.** Everything runs **as the signed-in person** — creating
folders, uploading, granting a guest a folder, listing files. There is no app-only
path and no client secret: a PM already has write on their own Team's site, so the app
can never exceed what that person could do by hand, and SharePoint's audit log names
the real human. Some of those calls leave the browser directly; the ones that also
write to our own database go through `/api` with the person's Graph token forwarded,
so a single action lands as a single unit (B6).

> **Why this departs from the `kantata-write` pattern.** That endpoint exists because
> Kantata's token is a secret that must never reach the browser. Delegated Graph has
> no secret (SPA + PKCE) and the user's own permissions bound every call, so a server
> hop would add a moving part without adding safety.

---

## Part A — What AGP IT does

### A1. Entra app registration

Same registration as BLOCKERS #5 — additive. The step-by-step version to hand an
admin is `docs/m365-admin-runbook.md`; this section is the reasoning.

**① Add a Single-page application redirect URI.** The app currently registers a
**Web** platform pointing at Supabase's callback. MSAL.js requires its own SPA
platform entry with the app's URL. Nothing in the delegated path works without it.

**② Add these delegated permissions, then Grant admin consent for the
organization:**

| Scope | For |
|---|---|
| `Channel.Create` | Channels |
| `TeamMember.ReadWrite.All` | Internal staff on and off the Team |
| `User.ReadBasic.All` | Resolve a colleague's email to a user id. **No member can be added without it** |
| `Files.ReadWrite.All` | Create the folder tree and upload, as the signed-in person. Bounded by that user — not tenant-wide |

| `User.Invite.All` | Inviting a client or contractor as a guest |
| `Team.ReadBasic.All` | Confirm an admin-supplied Team id is real (`GET /teams/{id}`) before adopting it. The narrowest read-only option Graph offers for this call — `Group.Read.All`/`Directory.Read.All` also work but are broader than one lookup needs |

**`Team.Create` is not requested.** The M365 admin creates each Team by hand (A2),
so the app never creates one.

**Also expose `access_as_user`** on the registration, with the Teams client
applications pre-authorized. A tab pointed at the app otherwise hits interactive
Microsoft sign-in *inside an iframe*, which is where third-party cookie and popup
blocking break it (BLOCKERS #5, #6).

User consent is normally disabled tenant-wide, and nobody should be clicking a
consent prompt per person, so these need organization consent even though they are
delegated.

**No application permissions, and no client secret.** Everything the app does runs as
a signed-in person, so there is nothing for a daemon identity to do. This is a
narrower ask than an app-only design would need.

**Not requested, deliberately:**

- `Sites.ReadWrite.All`, or `Files.ReadWrite.All` / `Sites.Read.All` as *application*
  permissions — tenant-wide access, and unnecessary when every call is delegated.
- `Sites.Selected` — needed only by an app-only design. There isn't one.
- `Group.ReadWrite.All`, `Directory.ReadWrite.All`, `Team.Create` — the app creates
  no Teams and manages no groups.
- `User.Read.All` — `User.ReadBasic.All` covers email → id.
- `ChannelMember.ReadWrite.All` — private channels only, not in v1.

If an admin offers any of these instead, decline.

No admin has to grant the app on any site: a PM's own access to their Team's site is
what authorizes folder work, so `Sites.Selected` and `Sites.FullControl.All` are both
absent from this design.

### A1a. The paragraph for the admin

The app acts as the signed-in AGP user for everything it does — creating folders,
uploading, adding members, and sharing a folder with a client or contractor. It can
never exceed what that person could do by hand, and SharePoint's audit log records the
real human rather than a daemon. There are no application permissions, no client
secret, and no site the app can reach that its user could not. External collaborators
become guests in the tenant and are given access one folder at a time.

### A2. Teams are created by hand, owned by the app admins

**The M365 admin creates each Team** and hands back its URL; someone pastes it into
the client's workspace and the app resolves the group, site and drive for itself.
The app never calls `POST /teams`, which removes the `202`-plus-polling dance, the
under-15-minutes-old 404, and `Team.Create` from the consent ask.

**The application admins (D1) are added as Team owners** — several of them, so no
Team is orphaned when one person leaves.

That has a consequence worth stating, because it decides who can press the button:

- **Provisioning runs as a Team owner**, so the first actions on a new Team —
  creating channels, adding members — are taken by an **app admin**.
- Once staff are members, a **workspace admin** can create folders and upload:
  standard Team members have edit rights on the document library. They cannot create
  channels or add members.

### A3. Guest settings — required

External collaborators are Entra B2B guests, so these three are prerequisites, not
options:

- **External sharing on the team sites.** SharePoint admin center → Policies →
  Sharing → at least **"New and existing guests"**. A site can only be as permissive
  as the org setting — the more restrictive value wins — and new sites do not all allow
  external sharing by default, so each client Team's site is checked rather than
  assumed.
- **SharePoint/OneDrive integration with Entra B2B.** Load-bearing: without it,
  external sharing creates no guest account, Entra policies do not apply, and there is
  no directory object to track or revoke.
- **Guest policy — email one-time passcode.** Entra → External Identities, so a
  contractor on a personal address needs no Microsoft account.

**Two chained assumptions to test the day this is enabled**, both load-bearing:

1. **An OTP guest can sign into the app.** Guests authenticate through the same Azure
   provider as staff, but an identity that has no Microsoft account and redeems with an
   emailed code still has to complete an OIDC sign-in to AGP's own registration.
2. **That guest can then acquire a delegated Graph token and read the folder shared
   with them.** This is what makes the Files view work at all. Admin consent covers the
   tenant's users and guests are in the tenant, so it should hold — but "should" is not
   a plan.

If the first fails, externals without a Microsoft account cannot use the app. If the
second fails, they can sign in and see tasks and discussions but no files, and there
is no fallback that does not reintroduce an application credential. Test both with one
Gmail address before anything depends on them.

---

## Working agreement for implementers

Whoever picks up a section — person or agent — inherits these, because the codebase
already holds to them and a change that breaks one will fail review or a test:

- **Pure functions first.** Anything derivable is a pure function with a colocated
  `*.test.ts`, no network. `plannedProvisioning`, `folderTreeOf` and the sanitizer are
  specified that way on purpose: they are the parts worth testing hard.
- **Never guess a person.** Unresolved names are reported, not matched by
  approximation — `handover.ts`'s `samePerson` exists because names arrive from
  Kantata, from typing and from Microsoft and disagree.
- **Never delete what a human might have filled.** Folders, `Share` rows and externals
  are marked, reported or stamped `revokedAt`; reconcile creates and renames and
  nothing else.
- **Fail closed and say so.** A missing token, an ungranted milestone, a SharePoint
  invite that did not complete: refuse with a stated reason. No silent empty state and
  no silent half-grant.
- **Guest-visible means the import graph, not the intent.** `clientSafety.test.ts`
  walks it; if a module must not be reachable from an external surface, the test is the
  arbiter, and its denylist is not to be edited to make a build pass.
- **Secrets never reach the browser.** `SUPABASE_SERVICE_ROLE_KEY` and
  `KANTATA_API_TOKEN` are server-only. Nothing secret carries a `VITE_` prefix — and
  the Graph path has no secret at all, because it is delegated.
- **Each section ships alone.** Every one below has a Test and an Acceptance line; if a
  change cannot satisfy them without a later section, the sequencing is wrong and
  should be raised rather than worked around.

---

## Part B — Build order

Two tracks. The **Microsoft track** (B1–B5a, B10) provisions Teams and folders and
gives internal staff their files. The **access track** (B6–B8) gives externals a way
in. They run independently and join at **B7**, which needs a folder tree to serve and
an authorization layer to serve it through. B9 draws on both. Part C is the surfaces
each one needs.

---

## Microsoft track

### B1. Prove the delegated token

Nothing else on this track is worth writing until this works, because it decides
the shape. Sign-in is brokered by Supabase Auth (ADR 0007), which is not obviously
a Graph token source.

1. **Supabase `provider_token`** — request Graph scopes at sign-in and read the
   provider token off the session. Cheapest if it works; verify it is returned *and*
   refreshable, since Supabase does not always surface provider refresh tokens.
2. **MSAL.js** (`@azure/msal-browser`) acquiring Graph tokens directly, alongside
   the existing Supabase session. Well-trodden, needs A1①, costs a second token
   surface.

Spike (1), expect to land on (2).

**Acceptance:** the signed-in AGP user's own profile, fetched from Graph, in the
browser.

If neither works there is no fallback that preserves this consent ask: everything the
app does with Graph — folders, uploads, guest invites — runs delegated. An app-only
design would need `Sites.Selected` plus a per-site admin grant per client, or
tenant-wide write. Establish this first.

---

### B2. Data model and pure helpers

**Files:** `apps/tab/src/workspace/types.ts`, new `apps/tab/src/workspace/msTeams.ts`.

```ts
// on ClientAccount
msTeam?: {
  teamId: string;
  groupId: string;
  /** The team site — carried for links and diagnostics. */
  siteId: string;
  driveId: string;
  webUrl: string;
  /** Channels created, keyed by name — idempotency by stored id. */
  channels: { key: string; channelId: string }[];
  /** Every folder provisioned, keyed by the Kantata id it stands for: a
   *  workspace id at "project" level, a story id below. Names change; ids
   *  do not, so this is what makes a rename a move rather than a duplicate. */
  folders: {
    kantataId: string;
    folderId: string;
    /** Parent folder id — the chain an access check walks. Ids survive renames;
     *  paths do not, so nothing compares stored paths. */
    parentFolderId?: string;
    name: string;
    level: "project" | "milestone" | "phase" | "task";
  }[];
  provisionedAt?: string;
};
```

**Every other model change, in one place** — these are referenced from later
sections and are listed here so nothing is discovered mid-build:

| Type | Change | Used by |
|---|---|---|
| `Task` | `+ msFolderId?: string` | B4 |
| `Share` | `+ msItemId?: string`, `+ grantLevel?: "project" \| "milestone" \| "phase" \| "task"`, and `"folder"` added to `itemKind` | B7 |
| `ThreadMessage` | `+ clientVisible?: boolean` beside the existing `contractorVisible` | C2, C4 |
| `ThreadMessage` | `+ kantataId?: string`, `+ kantataLevel?: "project" \| "milestone" \| "phase" \| "task"` — what the message is about, as a real reference. `topic` stays as the human label; free text cannot be matched against a grant | C2 |
| `ExternalMember` | `role: "client" \| "contractor"` becomes load-bearing — it selects the external shell | C2 |
| `ExternalMember` | `− access` (`"workspace" \| "files-only" \| "tasks-only"`) — removed; it gates nothing | B7 |
| `ExternalMember` | `entraStatus` (`none \| invited \| active`) and `+ entraUserId?: string` — the guest lifecycle, set from the invite response | B7 |
| `ClientFileLink` | `− contractorAccessible`, `− contractorWritable`; the type survives only for `clientShare`, which gains an item id | B7 |
| `LiveMilestone` | `+ id`, `+ parentId` (`campaignImport.ts`) | B4 |

Additions are optional, so workspaces saved before this load unchanged. The three
removals are a separate, deliberate pass — see the sequencing table.

Helpers — pure, unit-testable, no network:

- `teamDisplayName(account)` — deterministic and collision-safe.
- `folderTreeOf(liveCtx)` — the planned tree: every Kantata project the account
  covers, each with its milestones and nested phases.
- `folderNameFor(node)` / `folderPathFor(task)` — `<project>/<milestone>/[<phase>/]<task>`,
  sanitized by the deterministic rule in **B4 §2** (illegal character → space,
  collapse whitespace, trim; internal periods survive; leaf-only truncation at the
  path ceiling).
- `plannedProvisioning(account, liveCtx)` — the diff against `msTeam`: project
  folders to create, folders at any level to rename, and Kantata ids no longer
  present. This is the preview, and being pure it needs no dry-run mode anywhere.
- `milestoneFolderOptions(account, liveCtx, projectId)` — every milestone of one
  project with whether it already has a folder. This is what the picker renders
  (B4 §5).

**Test:** sanitization; `plannedProvisioning` empty for an already-provisioned,
unchanged account.

---

### B3. Provisioning

**File:** `apps/tab/src/workspace/msProvision.ts`, plus a delegated Graph fetch
helper (token injection, `Retry-After` on 429/503, 404-tolerance for `filesFolder`).

A resumable async function whose resume point is the stored ids — no job record, no
server route, no 30s ceiling. It starts from an existing Team, so there is no
minutes-long creation to wait out.

| # | Step | Call | Notes |
|---|---|---|---|
| 1 | connect (UI: "Connect Team") | Paste the Team URL or id; `GET /teams/{id}` to confirm | The admin created it (A2). No `POST /teams`, so no `202` polling and no under-15-minutes 404. Also captures `displayName` into `client_account.ms_team_name`, so the panel can show the real Team name rather than its GUID |
| 2 | `resolveIds` | `GET /groups/{groupId}/sites/root`, `GET /groups/{groupId}/drive` | Store `siteId` (A2's unit) and `driveId` |
| 3 | `createChannels` | `POST /teams/{teamId}/channels`, `membershipType: "standard"` | Runs as a Team **owner**, so an app admin. Throttles readily; honour `Retry-After` |
| 4 | `createFolders` | `GET /drives/{driveId}/root:/{path}` → on 404 `POST /items/{parent}/children` `{ folder: {} }` | Get-by-path first, so it never duplicates. Creates **one folder per matched Kantata project**. Milestone folders come from the picker (B4 §5), not from here. Store each in `msTeam.folders` |

The admin names the first channel when creating the Team; it need not be "General",
and it is the one channel every member sees.

**Channels are a small hand-picked set, never one per milestone.** A client spans
several contracts of ~31 milestones each; a channel per milestone would run to
hundreds. Standard channels are visible to every member and cannot be restricted,
so they are for conversation, not access control.

Channel *files folders* provision lazily: if a channel folder 404s, `GET
/teams/{id}/channels/{id}/filesFolder` triggers provisioning. This is Microsoft's
documented remedy after five minutes, not a workaround.

**UI:** an internal-only "Client Admin" panel (`ClientAdminPanel.tsx`) — the
`plannedProvisioning` preview, a field for the admin-supplied Team URL, a
Connect Team button, and per-step progress. It lives inside `ClientWorkspace.tsx`,
as that client's own "Admin" tab (scoped automatically to the client being
viewed, via a `clientName` match against `collab.client_account` — see
`ClientAdminTab` in that file) rather than a separate route with its own client
picker, which is how it originally shipped. `ClientWorkspace.tsx` is one of
`clientSafety.test.ts`'s guest-entry-point-denylist targets, but by the time this
moved, C2 (`ExternalWorkspace.tsx`) already owned all external routing via
`App.tsx`'s `IdentityGate`, so no guest ever reaches `ClientWorkspace.tsx` — and
none of the newly-imported modules touch a denylisted pattern regardless.

**Test:** step sequence; resume from each partial state; 404-then-success on a
folder path.

**Acceptance:** pasting an admin-created Team's URL into a workspace resolves its
site and drive, creates its channels and one folder per matched Kantata project.
Re-running creates nothing.

---

### B4. The folder tree

> **Implementation note:** this section's design language (`folderTreeOf`,
> `msTeam.folders`, `plannedProvisioning`, `ClientAccount`) describes the original
> client-side plan. The shipped implementation moved this server-side into the
> `collab` Postgres schema instead: `collab.client_account` (not the old JSON
> `ClientAccount`), `collab.ms_folder` (not `msTeam.folders`), and
> `api/_lib/msFolder.ts`'s `desiredFolderTree()`/`ensureFolderChain()` compute and
> persist the tree the server actually creates — the admin UI is
> `ClientAdminPanel.tsx`'s folder tree/milestone picker, not a client-side
> `plannedProvisioning` preview. The reasoning below (why project-then-milestone,
> why get-by-path-first, why sanitize this way) still holds; the concrete
> function/field names are historical.

One Team per `ClientAccount` — the client, covering every Kantata project matched
to it.

**Project folders are automatic; milestone folders are chosen.** Every matched
Kantata project gets its folder on sync, so the library always has a place for each
contract. Inside a project, a milestone gets a folder only when someone picks it —
a button at the project level opens the milestone list and creates folders for the
ones ticked. Phases and tasks follow on demand beneath a milestone that exists.

Nobody wants 31 empty folders per contract by default, and a milestone with no files
and no external on it does not need one. This also blunts a matching error: a wrongly
matched project produces one empty folder, not a tree.

```
Documents/
├─ CWS FY27/                                  ← Kantata project (the contract)
│  ├─ 44061.01 - Strategy & Consultation/      ← milestone — the grant unit
│  ├─ 44061.09 - August Upgrade Appeal DM/
│  │  ├─ Phase 2 - Production/                 ← phase, only when Kantata has one
│  │  │  └─ Copywriting (Base)/                ← task
│  │  └─ Segment file/                         ← task hanging straight off the milestone
│  └─ 44061.10 - August Appeal DM/
└─ CWS FY26/                                  ← last year's contract, same shape
```

(A dedicated internal-only, never-granted folder like `_Internal/` was part of the
original design but nothing in the shipped code creates one or refuses to grant
under one — there is no enforced internal-only area today. Flagged as a real gap,
not implemented, not just a naming difference.)

The project level keeps two contracts' milestones from interleaving and keeps
`44061.xx` numbering homogeneous within its own folder. It also makes fiscal-year
rollover free: FY28 appears as a sibling folder on the next reconcile, with no new
Team, no re-invite, and last year's files one level away.

A phase folder appears only where Kantata has a nested milestone; a task hanging
straight off its milestone sits one level down, not two. `projectPhaseResolver`
already returns exactly this as `{ project, phase }`.

**1. The folder set comes from the mirror, not from imported tasks.** The workspace
import is lossy — `populateFromKantata` dedupes by title, so identical child titles
across the monthly appeals collapse; completed tasks never import; and it runs once
per workspace. Deriving folders from imported tasks would provision six folders for
a contract with 31 milestones. Read `LiveProject` and `LiveProject.milestones`,
which `accountLiveContext` already carries complete via the focus deepen.

**Prerequisite:** `LiveMilestone` drops the story id today (`campaignImport.ts` maps
milestones to `{title, dueDate, state, hard}`). Add `id` and `parentId` — identity
is keyed on the Kantata id, and `parentId` is what separates a phase from a
top-level milestone.

**2. Naming and identity.** Names are the Kantata title verbatim, so the WBS prefix
sorts the library the way Kantata sorts the tracker. Sanitize only what SharePoint
refuses: illegal characters (`" * : < > ? / \ |`), leading and trailing dots and
spaces, the per-name ceiling. Internal periods (`44061.01`) are legal and must
survive; never re-number and never re-format.

This bites at the project level: AGP titles follow the `Client: FY27` convention
and the colon is illegal. The rule is deterministic — replace each illegal
character with a space, collapse runs of whitespace, trim — so `CWS: FY27` becomes
`CWS FY27` on every run. The true title is never lost, because identity lives in
`msTeam.folders[].kantataId`.

That id is also what makes a rename a `PATCH` of the existing folder rather than a
second folder.

**3. Depth and the path ceiling.** Four levels plus long AGP titles can reach the
~400-character path limit. `folderPathFor` truncates the **leaf** name and never an
ancestor, so a long task title can never orphan its milestone folder or fork the
tree.

**4. What sync does, and what it does not.** On every open, `plannedProvisioning`
diffs `folderTreeOf(liveCtx)` against `msTeam.folders` and:

- **creates** a folder for any matched Kantata project that has none;
- **renames** (`PATCH`) any existing folder whose Kantata title changed, at any
  level — a milestone folder created last month follows its title;
- **reports** anything gone from Kantata, and deletes nothing. Files may be in it.

It never creates a milestone, phase or task folder. Those come from the picker
(§5) or from a grant (§6).

**5. The milestone picker.** A button on the project — "Create folders" — lists
every milestone Kantata has for that contract, showing which already have one, and
creates folders for the ticked rows. Multi-select, idempotent, and re-openable: a
milestone added in Kantata next month shows up unticked in the same list.

Phase and task folders are created on demand beneath a milestone that already has a
folder: when someone uploads into one, when one is granted, or when someone asks.
The path is deterministic either way, so this decides when a folder exists, not
where it goes.

**6. A grant creates the folder it needs.** Granting a milestone that has no folder
yet creates it as part of the grant, rather than refusing or offering an empty
list — the picker is the bulk path, and a grant is the single-item path to the same
place.

**7. Confirm the project list before the first provision.** An unscoped client-level
account takes every Kantata project the name matcher attributes to it, and that
matcher has produced large false positives before — the guards in
`campaignImport.ts` exist because "CDW Direct" once claimed 147 unrelated projects.
A wrong match creates real SharePoint folders that reconcile refuses to delete —
one per project rather than a whole tree, now that milestones are picked, but still
permanent. So provisioning **requires a confirmed preview**: `plannedProvisioning`
lists the projects it is about to create folders for, and a human accepts that list.
A workspace that matched more projects than expected is scoped in the Project Finder
first.

**8. Any real folder can be granted, not just a Kantata-matched one.** The picker
above only ever shows folders Kantata knows about. `ClientAdminPanel.tsx`'s folder
tree picker separately browses the live SharePoint drive directly
(`api/account-folder-children.ts`, lazy, one level at a time) and lets an admin
grant a folder with no Kantata correspondence at all — identified by a synthetic
`"graph:" + <Graph item id>` string standing in for `kantata_id`, with `level:
'folder'` (`supabase/migrations/0017_folder_level_grants.sql`). `holds_grant()`'s
flat string match treats this exactly like a real Kantata id, so no RLS policy
needed to change for this to work.

**Test:** sanitization (`CWS: FY27` → `CWS FY27`, periods survive, stable across
runs); sync creating project folders and **no** milestone folders; the picker
listing milestones a lossy import dropped, and marking the ones already created;
picking the same milestone twice creating one folder; granting an unfoldered
milestone creating it; two contracts producing sibling project folders rather than
interleaved milestones; phase folder only where a phase exists; rename → `PATCH` on
a milestone folder created earlier; milestone absent from Kantata → reported, not
deleted; leaf-only truncation at the ceiling; re-run creates nothing; a browsed,
non-Kantata folder can be granted and later re-browsed without duplication.

**Acceptance:** a client with two Kantata contracts syncs to two project folders and
nothing inside them. Opening the picker on FY27 lists all 31 milestones, including
those with no open tasks and those whose tasks never imported; ticking four creates
four folders. Renaming one of those in Kantata renames the folder on the next open.
An FY28 contract adds one sibling project folder, empty, with no new Team.

---

### B5. Internal membership

Resolve `ClientAccount.members` to user ids via
`GET /users?$filter=mail eq '{email}'` (`User.ReadBasic.All`), then
`POST /teams/{teamId}/members`. Unresolved names are **reported, never guessed** —
`handover.ts`'s `samePerson` exists because names arrive from Kantata, from typing,
and from Microsoft, and do not match exactly.

Review-gated: a from → to list, only ticked rows sent. Adding someone to a Team
emails them and changes what they can see; that is not a background effect.

**A client-level Team unions the delivery teams of every contract.** Internal
restriction is at the channel and site level, so every member sees every project
folder. Where a contract genuinely needs a separate internal team, it gets its own
workspace — scoped via the Project Finder — and therefore its own Team.

**Externals are never added to the Team.** A guest belongs to the tenant, not to the
Team, and adding one would hand them every channel and every project folder in a
single click — undoing the entire grant model. Membership is AGP staff only, and the
member panel must not list externals as candidates. This is worth an assertion in the
test, because the mistake is one plausible click by someone being helpful.

**v1 adds only.** Removal (`DELETE /teams/{teamId}/members/{id}`) lands with the
same panel once adding is proven.

**Test:** an email that resolves to no Microsoft user reported rather than skipped
or approximated; only ticked rows sent; a re-run adding nobody twice; **an external
never offered as a member candidate, and refused if one is submitted directly**.

**Acceptance:** the AGP staff on a workspace appear as members of its Team, and the
people whose emails did not resolve are named on screen.

---

### B5a. Files in the app — internal upload and listing

AGP staff work with files **in the app**, not only in Teams. The Files tab becomes
the folder tree — project, then milestone, then phase and task — with a Graph
listing at whichever level is open, and upload into the folder in view. It replaces
today's flat list of hand-typed names.

Delegated, as the signed-in PM, so it needs no permission check beyond what that
person already has in SharePoint.

- `PUT /drives/{driveId}/items/{parentId}:/{name}:/content` for small files,
  `createUploadSession` above the inline limit.
- The upload returns the item id, so anything sent for client approval records a
  real reference without anyone pasting a link.
- It also replaces the current `addAccountLink` flow, whose rows are names with
  usually-empty URLs.

**The four seeded documents move to the project folder, and stay.**
`Project Brief & Strategy`, `Creative Guidelines`, `Client Intake Form` and
`Team Contact List` are seeded once per workspace today and rendered under "Core
Documentation". They become **per Kantata project** instead — each contract has its
own brief, its own guidelines, its own contact list, and FY27's are not FY26's.

They keep their placeholder behaviour: the four are always listed for a project
whether or not a file exists, so the standard set is visible as an expectation rather
than appearing only once someone remembers it. Each row resolves against the project
folder's contents — present, with a link, or missing, with an upload. The names are
the contract; the files are what fills it.

**Test:** upload landing in the correct milestone folder; the returned item id
stored on the approval record; a listing that matches what SharePoint shows.

**Acceptance:** a PM uploads a proof from the workspace, sees it in the milestone's
Files view, sends it to the client for approval, and finds the same file in Teams.

---

## Access track

### B6. Foundations — Postgres, auth, roles and grants

**This blocks every external feature, needs nothing from Microsoft, and is the
largest single piece of work in the plan. Start here.**

The app stores everything as one JSON document in a Supabase Storage bucket
(`agp-workspace/state.json`): every read returns every client, every write rewrites
the whole document, and `team` carries password salts and hashes inside the payload
handed to any authorized caller. It moves to **Supabase Postgres, hosted on Supabase
cloud** — the same project as today, already provisioned, no new infrastructure and
no self-hosting decision outstanding (BLOCKERS #7).

#### Access is enforced by row-level security, not by application code

**The browser talks to `/api`, and `/api` talks to Postgres.** The client never
holds a database connection; every read and write is an endpoint. That keeps
validation and business rules server-side, keeps the client uncoupled from the
schema, and matches the shape the app already has.

**RLS is still the enforcement, not a decoration — but only if the JWT is
forwarded.** Each handler builds its Supabase client from the caller's `Bearer`
token, which the browser already attaches, and policies key on `auth.uid()`. A
handler that reaches for `SUPABASE_SERVICE_ROLE_KEY` instead becomes the only gate
and silently turns the policy off. Service-role is for migrations and deliberate
admin operations, and every use is justified where it appears.

Two gates in series is the point: the handler decides what the operation means, the
database decides whether this user may touch these rows.

#### Endpoints, replacing the whole-document read and write

The single `GET`/`POST /api/state` becomes per-entity operations, which is also what
ends the 409 contention — two people editing different clients no longer touch the
same row, let alone the same document.

| Route | For |
|---|---|
| `GET /api/workspace` | The caller's scoped payload: accounts, tasks, members, grants. Internal and external differ by what the policies return, not by a branch |
| `POST` / `PATCH /api/account` | Create and update a workspace |
| `POST` / `PATCH` / `DELETE /api/task` | Task mutations, including the share flags |
| `POST` / `DELETE /api/grant` | Grant and revoke a milestone |
| `POST /api/external` | Invite a person and link them to an account |
| `GET` / `POST /api/files` | Folder listing and upload sessions — Graph, called with the caller's own forwarded token (below) |
| `/api/admin/*` | App-admin operations (D5) |

**The full surface — every route, body, role and the store mutation it replaces — is
`docs/api-spec-workspace-mutations.md`.** All 85 of `store.ts`'s callbacks are
accounted for there, including the ones that become no endpoint.

**How `/api` reaches Graph, now that there is no secret.** Endpoints that touch Graph
take the caller's **delegated Graph access token**, forwarded from the browser in an
`X-Graph-Token` header alongside the Supabase `Bearer`. The handler acts strictly as
that person — it cannot exceed them, and it stores the token nowhere.

The alternative, calling Graph straight from the browser, is simpler for a read but
breaks the operations with two effects: granting a milestone has to write a row *and*
issue an invite, and splitting that across the client makes a half-grant the normal
case rather than the exception. So Graph reads that stand alone (a folder listing) may
go either way; anything that also writes to Postgres goes through `/api`.

Existing Kantata routes are unchanged in shape: they live server-side because they
hold a secret. These do not — they live there for atomicity.

One policy set covers both audiences: externals authenticate through Supabase Auth
too, so they carry a JWT like everyone else. Internal and external access stop being
two mechanisms.

#### Schema

Real columns for the collaboration model — accounts, tasks, members, externals,
grants, shares, audit. **Anything a policy reads must be a real column**, or the
policy cannot see it. `jsonb` is for per-row extras
whose shape is genuinely open and that no access decision touches — used sparingly,
since a wide `jsonb` column is the JSON document again with extra steps.

| Table | Holds |
|---|---|
| `app_user` | One row per Supabase Auth user: display name, title, internal or external |
| `user_role` | App admin, workspace admin — per user, and per account where scoped |
| `client_account` | The workspace, plus the Team ids (`team_id`, `group_id`, `site_id`, `drive_id`) and `team_name` (the Team's real Graph `displayName`, captured at connect time so the admin panel never has to show the raw GUID) |
| `account_member` | Internal staff on an account |
| `external_link` | An external's membership of an account, with `role: client \| contractor` |
| `access_grant` | `(account_id, user_id?, external_link_id?, kantata_id, level, role, ms_permission_id)` — the app's own permission record, and the id of the SharePoint invite it issued. Exactly one of `user_id`/`external_link_id` is set: a grant can target a person who hasn't signed in yet (by `external_link_id` alone, so the real Microsoft invite can fire off their email address before any sign-in exists), and "Resolve sign-in" backfills `user_id` once they do. `level` includes `'folder'` for a browsed, non-Kantata folder (B4 §8), alongside `project \| milestone \| phase \| task`. **Not** `grant`, a reserved word in SQL |
| `task` | Workspace content. `client_visible`, `contractor_visible` and `kantata_milestone_id` are **real columns** — the external projection filters on them |
| `thread_message` | Workspace content. `client_visible`, `contractor_visible`, `kantata_id` and `kantata_level` are **real columns**, for the same reason |
| `campaign`, `activity` | Workspace content |
| `ms_folder` | One row per provisioned folder: `(account_id, kantata_id, folder_id, parent_folder_id, name, level)`. A table rather than `jsonb` on the account, because a grant joins to it, the picker reads it, and reconcile rewrites names in it. `kantata_id` is a real Kantata id for a synced folder, or a synthetic `"graph:"`-prefixed one for a folder browsed and granted directly (B4 §8) — either way it's the stable key everything else joins on |
| `share` | What was handed to whom, when, opened, revoked |
| `access_audit` | Grant changes, downloads, uploads — including revocations, which delete the grant row |

**The ROI side does not move.** `initiatives`, `ideas` and `feedback` stay in the JSON
document. They are internal-only, no external ever reaches them, and no access
decision reads them — so they gain nothing from tables and would cost a migration.
`/api/state` survives for exactly that content, reduced to it.

The boundary to hold: **anything an external can reach lives in Postgres; the ROI
document is internal-only, always.**

One place already tests it. `sharedTasksFor` projects initiative tasks flagged
`clientVisible` into a client workspace's plan — document content on a surface an
external can see. It is resolved by **copying at share time**: flagging an initiative
task creates a real `task` row on the account, stamped with its origin, and from then
on it is an ordinary workspace task. See `docs/api-spec-workspace-mutations.md`.

#### Reconciling with the migrations already in the repo

`supabase/migrations/` holds six migrations from 2026-07-22 defining five schemas —
`mirror`, `registry`, `app`, `intel`, `sync` — for the pre-pivot architecture. They
are **not dead weight** (ADR 0005): the mirror is the data layer the Copilot's AGP
grounding and the future Kantata sync ride on. Nothing in the running app reads
Postgres today, so none of it is load-bearing yet either.

**They have never been applied.** Production has no application tables: the only
schema in use is Supabase's own `auth`, which the live Microsoft sign-in already
populates. So this is not a schema migration in the database sense — it is a first
schema in a database that is already running, plus a *data* move out of the JSON
document. Three consequences, all of them good:

- **No legacy identity to bridge.** Key on `auth.uid()` from the first line.
- **No live policies to preserve.** `0006_rls.sql`'s helpers were never enforcing
  anything, so nothing regresses by replacing them.
- **No collision risk** in choosing a schema name.

**No new infrastructure is involved.** A Supabase project *is* a Postgres database —
Auth stores its users there — so B6 adds tables to something already provisioned,
paid for and running in production. There is nothing to stand up and no datastore to
adopt.

Leave the migration files in place — they belong to the sync layer ADR 0005 keeps
deliberately — but treat them as **unapplied design**, not as the state of a
database. Worth confirming the dev project matches; if it has them applied, nothing
reads them there either, so it can be reset or left alone.

**The identity model in those files would not have worked here anyway.**
`0006_rls.sql` resolves the caller like this:

```sql
create or replace function app.current_person_id()
returns bigint language sql stable security definer as $$
  select id from registry.people where entra_id = (auth.jwt() ->> 'oid');
$$;
```

Identity is a `registry.people` row matched on the **Entra object id**. That cannot
serve this design:

- **It does not cover externals reliably.** Guests are Entra objects, so an `oid` may
  exist — but identity has to resolve for every caller by the same rule, and matching
  on a provider claim that lands in metadata rather than a top-level claim is a
  fragile way to do it.
- **It may never have resolved at all.** Sign-in is Supabase Auth with the Azure
  provider (ADR 0007), and provider claims usually land in user metadata rather than
  as top-level JWT claims. Since these policies were never applied, nobody has found
  out — which is a reason to key on `auth.uid()` rather than to go and investigate.
- **`auth.uid()` is present for every authenticated user**, whichever provider signed
  them in. It is the only key that spans both audiences, which is the whole point of
  one policy set.

**`registry.people` is not `app_user`.** It carries org-chart concerns —
`reports_to`, `routing_mode`, `entity_tag`, capabilities — and external
collaborators do not belong in AGP's org registry. Keep them separate: `app_user`
keyed on `auth.uid()` is the identity spine, with an optional link to a
`registry.people` row for internal staff who are also in the org chart.

**Decision:** the collaboration model gets its own schema — **`collab`** — its own
identity spine on `auth.uid()`, and its own helpers. A named schema rather than
`public` so that the day the sync layer's `mirror`/`registry` tables are applied,
nothing collides and every policy reads unambiguously. The existing schemas are left alone for
the sync layer they belong to. `app.current_person_id()` and `app.is_admin()` are
not reused — the new set is:

| Helper | Answers |
|---|---|
| `current_app_user()` | `auth.uid()` → the `app_user` row |
| `is_app_admin()` | D1's app admin |
| `is_workspace_admin(account_id)` | D1's per-account admin |
| `can_read_account(account_id)` | Internal member, or external with a link |
| `holds_grant(account_id, kantata_id)` | The grant check, cascade included — the one every external policy calls |

**Policies that read other tables need `security definer` helpers.** "Can this user
see this account?" is a membership lookup, and expressing it inline invites either
infinite recursion (a policy on `account_member` that queries `account_member`) or a
sequential scan per row. Write the membership and grant checks as `security definer`
functions and call them from the policies.

**Identity is one person across accounts.** `ExternalMember` is a row on each
`ClientAccount` today, so the same contractor on two clients is two unrelated rows.
Identity becomes the auth user, and those rows become `external_link` records.
Every `user_id` is the auth user id, never a row id.

**A grant covers everything under the granted folder, present and future** — twice
over, and by two different mechanisms. For **files**, SharePoint's own inheritance
does it: an item grant on a milestone folder reaches whatever is added beneath it. For
**tasks and messages**, the app does it, by matching their `kantata_id` against the
grant's and walking the Kantata parent chain. The two must agree on what "beneath"
means, which is why both read the same folder tree.

#### What each caller gets

- **Internal:** the accounts they are a member of, in full.
- **External:** the accounts they are linked to, **filtered by their grants first,
  then by the audience flag for their role**. Nothing outside a granted milestone
  reaches them, whatever it is flagged. Files are absent from the payload — a guest
  reads the folder from SharePoint with their own token (B7).

| | Contractor | Client |
|---|---|---|
| Tasks | under granted milestones, flagged `contractorVisible` | under granted milestones, flagged `clientVisible` |
| Messages | under granted milestones, flagged `contractorVisible` | under granted milestones, flagged `clientVisible` |
| Campaigns, plan, dashboard, approvals | — | limited to granted milestones |

The role comes from `external_link`, so **the projection is chosen server-side**; a
client shell requesting a contractor payload, or the reverse, changes nothing.

#### Authentication

`apps/tab/src/auth/localAuth.ts` verifies passwords in the browser against hashes
stored in the shared document. It is **deleted**, not replaced: everyone — staff and
external guests alike — signs in with Microsoft through the existing Supabase Azure
provider (ADR 0007). Guests are directory objects in AGP's tenant, so the single-tenant
registration accepts them, and `auth.uid()` is present for every caller regardless.

AGP therefore manages no passwords, no resets and no lockouts for outside people. What
it does manage is the guest lifecycle in Entra.

#### Roles, and closing what is open

Roles resolve server-side and travel with the identity (Part D). The three surfaces
open to any signed-in user close in this step, not after it — the `#admin` route,
the team manager that creates and removes sign-in accounts, and `clearWorkspace`,
which wipes shared state for everyone. Harmless while every user is AGP staff behind
an internal URL; privilege escalation the moment an external can sign in against the
same login page.

#### Migration

1. Create the schema and policies. Nothing reads them yet.
2. **Delete `team` from the document and retire `localAuth.ts`.** Staff already sign
   in with Microsoft through Supabase Auth, so there is no identity to move — only
   password hashes to remove from a payload the API hands out. Do this first.
3. Backfill **accounts and their content** into the tables — not the ROI side, which
   stays. The document remains the source of truth meanwhile, and **writes go to both**
   from this point; without the dual write the tables drift from the moment the
   backfill finishes.
4. Switch reads to Postgres under RLS. The dual write continues, so a problem is one
   config flag away from being reverted.
5. Stop writing accounts to the document. `/api/state` stays, holding `initiatives`,
   `ideas` and `feedback` only — and `team` is already gone from step 2.

Each step ships on its own and the app works between them.

**Test:** a policy denying a second account to an internal member who is not on it;
an external's read returning only granted milestones; a task or message flagged for
their audience but sitting under a milestone they do not hold, absent; a message
flagged for their audience with no Kantata id attached, absent; a request with a valid JWT but
no grant, refused by the database rather than by the handler; service-role absent
from every request path except migrations and admin operations; a grant whose SharePoint invite
never completed showing as a half-grant rather than as working.

---

### B7. External access — guests and folder grants

**File:** `apps/tab/src/workspace/msShare.ts`. All delegated; no server route holds a
credential for this.

**The folder is the file list.** An external's Files view is a Graph listing of the
folders under the milestones they hold, fetched **as them** — they are a guest with
SharePoint permission on those folders, so their own token is what reads it. The app
displays; SharePoint enforces.

`ClientFileLink` and its `contractorAccessible` / `contractorWritable` flags are
removed, along with `contractorScope.ts` itself — its `contractorFiles()` /
`contractorUploadTargets()` / `contractorTasks()` were a second, decorative access
mechanism beside the real one (a client-side preview of what a contractor "should"
see, rendered in the now-removed Contractor Access tab). The real projection lives
server-side in `externalWorkspaceApi.ts`, keyed on the actual grants. **Client
approvals key on the SharePoint item id** rather than an app file row;
`clientApproval.ts` is otherwise unchanged.

#### Inviting a guest

With A3's B2B integration on, `invite` creates the guest itself and returns its
identity, so a separate `POST /invitations` is not needed:

```
POST /drives/{driveId}/items/{itemId}/invite
  { recipients: [{ email }], roles: ["read"] | ["write"],
    requireSignIn: true, sendInvitation: true,
    retainInheritedPermissions: true }
```

Read `entraUserId` from `grantedToV2.user.id`, set `entraStatus`, and store the
permission id on the `access_grant` row.

- **`retainInheritedPermissions` is pinned `true`.** False strips every inherited
  grant on first share, internal staff included.
- **Handle `207 Multi-Status`** — with several recipients, some grants succeed and
  others fail. Record per-recipient outcomes, the rule `api/kantata-write.ts` follows.
- **The invitation goes to the email on the person's record**, never re-typed, so the
  guest identity and the app identity are the same by construction.

#### One action, two effects

Granting a milestone writes an `access_grant` row **and** issues the invite above on
that milestone's folder. The row scopes the app's own screens — tasks, discussions,
plan, dashboard — because SharePoint cannot enforce those. The invite scopes files.

- **Both or neither, visibly.** If the row is written and the invite fails, the person
  sees tasks and no files, and the UI must say so. Never a silent half-grant.
- **Revoke reverses both:** `DELETE /drives/{driveId}/items/{itemId}/permissions/{permId}`,
  then delete the row, then write `access_audit`. `revokeAllForPerson` and removing an
  external do this for every grant they hold, with partial failure recorded per grant
  and the person still shown as holding whatever did not revoke.
- **Removing someone from the workspace does not remove the guest from the tenant.**
  That is a directory operation and belongs to the app admin's offboarding view (D5),
  which is where "this vendor is gone, remove them everywhere" lives.
- **The folder must exist before it can be granted**, so granting an unfoldered
  milestone creates the folder first (B4 §6).

#### Granting before sign-in, and reusing an existing person

The invite above only ever needed an email address — but the original design still
required a real `access_grant.user_id`, which only exists after someone has signed
in, which for a Gmail-only person requires them to already be a real Entra guest,
which the invite itself is what creates. That circularity meant a person with no
Microsoft account could never be granted anything.

`access_grant.user_id` is now nullable; a grant can instead target `external_link_id`
directly (the row that exists the moment an admin adds the person, no sign-in
required). The real Microsoft invite still fires immediately, off email alone.
Once the person signs in and an admin runs "Resolve sign-in," the pending grant's
`user_id` is backfilled and `external_link_id` cleared — it becomes an ordinary
resolved grant, connecting the app's own RLS-gated screens (tasks, discussions) to
their now-real session. Nothing is re-invited at that point; the SharePoint side
was already live.

Separately, adding an external no longer always starts from a blank, unresolved
row: an app admin can search every external already added to any account
(`GET /api/admin/externals`, tenant-wide, app-admin only) and pick an existing,
already-resolved person directly — the new row is created with `user_id` set
immediately, skipping the pending state entirely, for the "add this contractor to
a second client" case.

#### Two audiences, one mechanism

| | Contractor / vendor | Client |
|---|---|---|
| Task-side flag | `Task.contractorVisible` | `Task.clientVisible` (independent) |
| Grant role | `read`, plus `write` where they drop finished work | **`read` always** |
| Approval | n/a | Stays in the app, keyed on the SharePoint item id. `clientApproval.ts` is the system of record; the file layer has no equivalent and must never be read as one |

A client grant is read-only regardless of approval state. Requesting an approval
changes what the app asks for, never what SharePoint allows.

#### The rest of the contract

- **The milestone folder is the usual grant unit**, though any folder can be the
  unit now — a browsed, non-Kantata folder (B4 §8) grants exactly the same way.
  Each item grant breaks inheritance and consumes a unique security scope, and
  Microsoft warns about the per-library limit — so per-task grants are the
  exception, for a milestone too broad to hand over whole. A project-level grant
  hands over an entire contract and the dialog should say so.
- **The grant dialog shows what the folder currently holds, and who already holds
  it** — including holders inherited from an ancestor folder. Guests co-granted a
  folder see each other's names in Manage Access, so those are the names this person
  will see, and the ones already there will see theirs.
- **A client and a vendor may hold the same milestone.** Accepted, with the
  co-visibility disclosed at grant time rather than refused.
- **Several externals on one client, each on their own milestone, needs nothing
  extra.** Grants are per person per Kantata id, so they get disjoint files, tasks and
  discussions.

  **What a grant does not separate is two people holding the *same* milestone.** The
  audience flags are per item, not per person, so co-holders see the same flagged
  messages and tasks, each other's names, and each other's uploads. Separate them by
  **grant** — different milestones, or a per-task grant — never by flag. Flags choose
  what is shared; grants choose with whom.
- **`ExternalMember.access`** (`"workspace" | "files-only" | "tasks-only"`) is
  removed: the role decides the shell and the grants decide the files, so a third
  free-floating scope switch has nothing left to control.

**Test:** role mapping both audiences (client read-only even for an approval);
`retainInheritedPermissions` pinned true; `207` partial recording; a grant whose
invite fails leaving a visible half-state, not a silent one; revoke removing the
SharePoint permission *and* the row; revoke-all across levels with one `DELETE`
failing; the `Share` record surviving revoke; granting a not-yet-signed-in person by
`external_link_id` still firing the real invite; "Resolve sign-in" backfilling a
pending grant without re-inviting; the co-holder list including an ancestor's
grantees.

**Acceptance:** a contractor invited by email — including on a personal address via
OTP — signs in with Microsoft, sees one client account and one milestone, opens its
brief from SharePoint, uploads a deliverable to the folder their grant allows, and can
reach no sibling milestone. A client granted the same milestone reads it and cannot
write, and both were shown the other's name before either grant was sent. Removing
either revokes the SharePoint permission and the row together.

---

### B8. Co-authoring — free, and not a feature

Guests are real Microsoft identities, so opening a document in Office on the web works
without anything being built. Nothing to specify and nothing to gate.

Worth knowing rather than promoting: externals mostly work on a file and send it back
for review, so `clientApproval.ts` remains the workflow the product leads with. If
co-authoring turns out to be how people actually collaborate, the surfaces to invest
in are approvals and version history (B9), not a second file mechanism.

---

### B9. Activity — edits and opens

- **Edits, per person, free:** `GET /drives/{driveId}/items/{itemId}/versions` → who
  changed what, when. Delegated, and it covers guests as well as staff.
- **Opens, from the app's own record:** the app shows the file list, so a click in the
  workspace is an observed event and sets `Share.openedAt` with `openSource:
  "workspace"`. Instant and free. It does not see someone who goes straight to
  SharePoint, and it is not proof the file was read — so it is reported as what it is.
- **Opens, aggregate:** `GET .../analytics/allTime` gives counts with no names, and
  must never be rendered as per-person attribution.
- **Opens, authoritative per person: Purview, deferred.** Guest file activity
  (`FileAccessed`, `FileDownloaded`, `FilePreviewed`) is in the unified audit log,
  attributed to the guest UPN. Reaching it programmatically means the Office 365
  Management Activity API — `ActivityFeed.Read`, its own admin consent, a subscription,
  and a poller over content blobs. It lags minutes to hours, and retention depends on
  AGP's licence (commonly 90–180 days on E3). Build it only if someone needs
  attribution the click record cannot give, and treat it as its own integration.

`Share.openedAt` is set only from an observed event; absent stays absent, per
`handover.ts`.

**Test:** `openedAt` set from a click and never inferred from a listing; an analytics
count never rendered against a name.

**Acceptance:** the handover view shows, for one external, what was sent, when they
opened it from the workspace, and who has edited it since.

### B10. Teams tab context

`apps/tab/src/teams/teamsHost.ts` already reads `ctx.team?.displayName`. Use
`msTeam.teamId` to resolve the Teams context to the right `ClientAccount` and deep
link, so a tab in a client's Team opens that client's workspace.

**Test:** an unrecognised team id landing on the directory rather than on a wrong
client.

**Acceptance:** a tab added in a client's Team opens that client's workspace, signed
in silently (`access_as_user`, A1).

---

## Part C — Surfaces

### C1. Sign-in — one page, one method

Everyone signs in with Microsoft: staff with their AGP account, externals as guests in
AGP's tenant. The email/password path is deleted along with `localAuth.ts`.

**Identity class decides the shell after authentication** — internal app, or the
external screens (C2) — resolved from `app_user` and `external_link`, not from the
account's domain. The client routes for convenience; **the API classifies
independently and refuses on its own.** An external who authenticates and then calls
an internal endpoint by hand must be refused server-side, not by the absence of a link.

**Test:** an external's valid token refused on every internal endpoint; an internal
identity landing on the internal app and an external on the external shell, decided
from the record rather than from a stored preference; an OTP guest completing sign-in
(A3).

### C2. The external screens — one shell, two roles

A **separate route and component subtree**, not a conditional branch inside
`ClientWorkspace.tsx`. One tree with role checks means every future edit risks
leaking internal data through a missed conditional.

**An external is a client or a contractor, and the role decides the views.** It
lives on the account link (`external_link.role`, `ExternalMember.role` today), so it
is per account: the same person could be a client contact on one and a vendor on
another, and each link stands alone.

| View | Client | Contractor |
|---|:-:|:-:|
| **Account list** — only when linked to more than one | ✓ | ✓ |
| **Files** — under the milestones they hold; upload where the grant is write | ✓ | ✓ |
| **Client dashboard** — campaigns, upcoming milestones, what shipped, what needs them | ✓ | — |
| **Plan** — the client-visible slice of the work, dates and status | ✓ | — |
| **Discussions** — per milestone they hold, messages flagged for them, and a reply box | ✓ | ✓ |
| **Approvals** — approve or request changes, per `clientApproval.ts` | ✓ | — |
| **Tasks** — their own work, due dates and status | — | ✓ |

Plan and Tasks both open with a **Milestones** summary — every milestone/phase-level
grant the person holds, by name, regardless of whether any individual task under it
is flagged visible yet. Without it, a milestone grant with no visible tasks showed
up nowhere at all; Discussions already had the equivalent (a heading per granted
milestone). This does not change the flags-vs-grants invariant below — it only
means the *milestone itself* is always visible once granted, the same way its
folder already was.

A contractor's screen stays narrow: the job they were hired for, its folder, and the
conversation about it. A client's is the relationship — what is happening, what is
coming, what needs a decision from them.

**Everything an external sees is filtered by their grants first, then by the audience
flag.** One invariant, applied to every view: files, tasks, plan, dashboard and
discussions alike. A grant is the boundary; a flag decides what inside it is shared.
Neither alone is enough.

**Two audiences, one thread, and they never meet.** Both discussion views are
projections over the single internal thread, so the full internal history is
preserved and nothing is copied into a second store. A contractor sees messages
flagged `contractorVisible`; a client, `clientVisible`.

**Discussions are scoped to the milestones they hold.** A message carries the
Kantata id it is about, in the same vocabulary as a grant — project, milestone,
phase or task — and reaches an external only when one of their grants covers it. The
grant cascades, so a message about a task appears to someone holding its milestone.

A message with **no** Kantata id attached never reaches an external at all,
regardless of its flags. That keeps the rule fail-closed: general internal chatter
cannot leak by being flagged in passing, and sharing something broadly is a
deliberate act of attaching it to a project or milestone the person already holds.

**Present it per milestone, not as one filtered list.** The external's Discussions
view is a thread per milestone they hold, which makes the boundary self-evident and
means a reply cannot be posted without a milestone to inherit. Internally this is
the pattern `Thread.tsx` already has — clicking "Discuss" on something scopes both
the composer and the history to it — so the external view is that behaviour with the
milestone fixed rather than chosen.

**An external's own reply is flagged for their audience alone.** A contractor's
message lands in the internal thread, visible to AGP staff and back to that
contractor, and **not** to the client — and the reverse. Anything crossing between
them is an internal person deliberately flagging it. Without this rule the two
projections quietly merge the first time either of them replies.

Neither ever sees: resourcing, hours, any money, another client, the internal
thread, or the internal plan.

**The client dashboard is built, not borrowed.** `ClientDashboard` in
`ClientWorkspace.tsx` is an internal component and must not be reused here. Compose
the external one from client-safe primitives the way `clientDigest.ts` already does
— its docstring states the rule: "reachable from guest surfaces and must never
import internal modules." Campaigns, milestones, client-visible tasks, and shared
files are all it needs.

**Three model additions:**

- `ThreadMessage.clientVisible` — the thread carries `contractorVisible` only, so
  there is no way today to flag a message for a client. Two flags, matching `Task`,
  rather than one audience field: explicit, and symmetrical with what exists.
- `ThreadMessage.kantataId` + level — what the message is about, as a real
  reference. `topic` is free text ("a project/campaign name, a task title, or a
  phase") and cannot be matched against a grant. Keep `topic` as the human label it
  already is; add the id for scoping. An external's reply inherits the id of the
  discussion they are replying in.
- `external_link.role` drives the shell, server-side. The client asks for its shell;
  the API decides which payload it gets.

Three independent layers keep it that way, and none of them is the UI being
careful:

1. The server-side projection never puts anything else in the payload (B6), and it
   is built from the role, not from what the screen asked for.
2. The subtree cannot import internal modules — point `clientSafety.test.ts` at
   this entry point, which is the door it was written to guard.
3. The API refuses any request outside the caller's grants, and **SharePoint refuses
   any file they were not granted** — the guest's own permission, not our check (B7).

**Test:** a contractor payload containing no client-flagged item and no message
outside their grants; a client payload with no contractor-flagged item; a message
flagged for an audience with no `kantataId`, absent from both; an external's reply
carrying its milestone and its own audience flag only; the external subtree
importing no module on the `clientSafety.test.ts` denylist.

**Acceptance:** two contractors on the same client, holding different milestones,
each see only their own files, tasks and discussions and never each other. A client
on that account sees a dashboard, the shared plan, discussions and approvals for the
milestones they hold, and no hours, money or internal thread. Each of the three
proves it against the API directly, not by the absence of a link.

### C3. Internal surfaces

| Surface | State | What it becomes |
|---|---|---|
| **Contractor Access tab** | Person cards, add-person form, handover history | Removed. Replaced outright by the Admin tab (below) — the real grant UI, not a view pointing at it |
| **Grant dialog** | — | New. Milestones and role, showing what the folder currently holds and that the grant covers items added later |
| **Contractor View preview** | Driven by item flags | Driven by the real grants, or it shows the PM something different from what the contractor gets |
| **Task share toggles** | `contractorVisible`, `clientVisible` | Kept, as inputs to the server-side projection. The **file** toggles go: access to files is the milestone grant, and per-file flags would be a second, conflicting control |
| **Message share toggle** | `contractorVisible` on a thread message | Gains a **client** toggle beside it (C4) — the input to the client's Discussions view |
| **Client dashboard** | An internal tab | Gains an external twin in the C2 subtree, composed only from client-safe data — never the internal component |
| **Files tab (internal)** | A list of hand-typed names, URLs mostly absent | The folder tree with a listing and upload (B5a) |
| **Milestone folder picker** | — | New. A "Create folders" button on each project, listing its milestones with those already created marked (B4 §5) |
| **Handover view** | Sent / opened / revoked / chase, from `handover.ts` | Same logic, real data — the app now observes every open |
| **Invite state** | An `entraStatus` chip with nothing behind it | Real guest lifecycle: invited, active — set from the invite response |
| **Grant health** | — | New, per person: grants whose SharePoint invite did not complete, so a half-grant is visible rather than silent |
| **Guest offboarding** | — | New, on the existing `#admin` route: every external across every workspace, with one action to revoke all their grants (D5) |
| **Client Admin panel** (`ClientAdminPanel.tsx`, formerly the standalone `MsWorkspacePanel.tsx`) | — | New (B3): provisioning preview/progress, folder tree, internal membership, and external access/grants — internal-only, now the "Admin" tab inside `ClientWorkspace.tsx`, scoped to the client being viewed, rather than a separate route with its own client picker |

**Test:** the grant dialog listing a folder's current contents; the milestone picker
marking already-created folders; a grant whose invite failed shown as a half-grant.

### C4. The thread's two audiences

`Thread.tsx` already has a per-message contractor toggle
(`contractorVisible`), and it stays exactly as it is. Clients need the
same: a **client** toggle beside it and a `clientMessages()` selector beside the
existing one, both following the projection rule stated above already
states.

Internally the composer therefore has two independent audience flags per message,
the same pair `Task` carries. Neither implies the other, and a message flagged for
both is a deliberate choice rather than a default.

The composer also has to **attach the message to a project, milestone, phase or
task** for either flag to mean anything (C2). Today it captures a free-text `topic`;
that stays as the label, with the Kantata id beside it. A message flagged for an
audience but attached to nothing reaches no one, and the composer should say so at
the moment of flagging rather than after posting.

---

## Part D — Roles and administration

### D1. Four roles

- **App admin** — manages people and roles, sees every workspace, holds the site
  grant work list and provisioning status.
- **Workspace admin** — per `ClientAccount`: **adds external members**, grants and
  revokes their milestones, provisions the Team, adds internal members, and
  promotes other workspace admins.
- **Internal member** — works in the account. Can flag tasks and thread messages as
  shareable to a client or a contractor; cannot give anyone access.
- **External** — client or contractor. Never holds an administrative right on
  anything.

The line that matters is between **flagging something shareable** — any internal
member, low stakes, reversible — and **giving a person access**, which is a
workspace admin's call. They are different actions and the UI must not conflate
them.

An external's **client-or-contractor role is set when they are added** and decides
which screens they get (C2). It is not a permission level: neither role can reach
anything the other's grants would not also reach.

### D2. How a role is assigned

**App admin: bootstrapped from a server-side allowlist,** `APP_ADMIN_EMAILS`. It
solves the chicken-and-egg problem, cannot be edited from the UI, and survives a
bad state write — the same reasoning that keeps `KANTATA_API_TOKEN` in env. Once
seeded, app admins promote others in the app.

*Alternative for later:* drive app admin from an Entra group membership
(`GroupMember.Read.All`), so AGP offboarding removes the right automatically.
Cleaner lifecycle, at the cost of another Graph permission and an IT dependency.
Swap to it if role drift becomes a problem; do not start there.

**Workspace admin: whoever creates the workspace is its first one**, and they
promote others. Never inferred from Kantata participation or CRM ownership —
reported, never guessed.

**App admins are also the Microsoft Team owners** (A2), which is what lets them run
the first provisioning actions on a new Team — creating channels and adding members.
A workspace admin who is a Team member can create folders and upload, because
members have edit rights on the document library, but cannot create channels or add
members. So the two role systems line up rather than competing, and the app-admin
list should be kept in step with the owners an admin adds at Team creation.

**External: never**, by construction. `ExternalMember.role` stays
`client | contractor` and confers nothing.

### D3. Enforcement

Role is resolved server-side with the identity (B6) and checked by every mutation
endpoint. Client-side gating is presentation only: a hidden button is not a
permission, and an external who authenticates and calls an endpoint by hand must be
refused by the API.

### D4. Who can do what

| Action | App admin | Workspace admin | Internal member | External |
|---|:-:|:-:|:-:|:-:|
| Flag a task or message shareable | ✓ | ✓ | ✓ | — |
| **Add an external member, as client or contractor** | ✓ | ✓ | — | — |
| Grant / revoke a milestone | ✓ | ✓ | — | — |
| Provision the Team, add internal members | ✓ | ✓ | — | — |
| Promote a workspace admin | ✓ | ✓ | — | — |
| Manage users, set app admins, clear the workspace | ✓ | — | — | — |

Adding an external has two paths with different outcomes: a blank entry (pending,
"Resolve sign-in" required later) available to any workspace admin, or picking an
already-known person from the tenant-wide search (born already resolved) — that
search is app-admin only, since it reads across every account (B7).
| Global external revoke, and removing a guest from the tenant | ✓ | — | — | — |

**Test:** an internal member refused when granting a milestone; a workspace admin
refused when setting an app admin; an external refused on every admin route; the
`#admin` route, the team manager and `clearWorkspace` all refused for anyone but an
app admin — each asserted against the API, since hiding the control is not the
control.

**Acceptance:** a workspace admin adds an external, marks them a contractor, grants
one milestone, and that person signs in and sees exactly it. An app admin finds the
same person in the cross-workspace externals directory and revokes everything they
hold in one action.

### D5. The app admin area

Gate the existing `#admin` route and extend it:

| Screen | For |
|---|---|
| People & roles | Internal users; promote, demote, deactivate |
| **Externals directory** | Every external across every workspace, their account links and grants, with one global revoke. The offboarding view — "this vendor's contract ended, remove them everywhere" — and only possible because identity is the auth user rather than a row per account |
| Site grants | Every site awaiting an A2 grant, as one copyable batch |
| Provisioning status | Which workspaces have Teams, which are pending |
| Access audit | Who granted what to whom, and when |
| Feedback | Existing |

### D6. Workspace administration

No new navigation: the workspace admin's actions live in the Admin tab described in
C3 — the people list, the grant dialog, handover history, external access status,
and promoting an internal member. What D adds is that those controls
are **visible and permitted only to a workspace admin**, while the item-level share
toggles stay available to every internal member.

---

## Environment variables

```sh
# --- Microsoft Graph, delegated (browser; public values, PKCE, no secret) ---
VITE_GRAPH_CLIENT_ID=
VITE_GRAPH_TENANT_ID=

# --- App admin bootstrap (server only) — comma-separated (D2) ---
APP_ADMIN_EMAILS=
```

`SUPABASE_SERVICE_ROLE_KEY` stays in the environment but **leaves the request
path**: it bypasses row-level security, so from B6 onward it is used only by
migrations and admin operations that deliberately cross user boundaries. Ordinary
handlers build their Supabase client from the caller's JWT.

**One naming scheme: `GRAPH_`.** BLOCKERS #10 lists `ENTRA_TENANT_ID` /
`ENTRA_CLIENT_ID` / `VITE_ENTRA_*` for the same app registration; those names are
superseded here, and nothing in the code reads them today. Set the `GRAPH_` names
and retire the `ENTRA_` ones so nobody configures half of each.

The delegated pair are not secrets — a public client id and a tenant id, with PKCE
instead of a secret. **There is no app-only Graph credential**, because nothing runs
app-only.

---

## Sequencing

| Step | Needs | Start |
|---|---|---|
| **B6 foundations** | nothing new from Microsoft — sign-in is already live | **now — blocks the whole access track** |
| **B1 token spike** | A1① | **now — decides the Microsoft track's shape** |
| B2 data model + helpers | `LiveMilestone.id`/`parentId` | **now** |
| B3 provisioning | B1, B2, A1②, and an admin-created Team (A2) | after consent |
| B4 folder tree | B3 | after consent |
| B5 membership | B3 | after consent |
| B5a internal files + upload | B4 | after consent |
| B7 external access + guest invites | B4, B6, A1②, A3 | after consent and guest settings |
| B9 activity | B4 (edits), B7 (opens) | after consent |
| B10 tab deep link | B3 | after consent |
| C1 sign-in routing | B6, and guest sign-in proven (A3) | **with B6** |
| C2 external screen | B6 for data, B7 for files | shell and tasks with B6; files with B7 |
| Retire `ClientFileLink` + contractor file flags | B5a, B7 | with the file views |
| C3 grant surface + grant dialog | B6 | **with B6** — it is how a grant gets made |
| C3 grant health + guest offboarding | B7 | after consent |
| **D1–D3 roles + closing the open surfaces** | nothing | **with B6 — it is part of it** |
| D5 app admin area | D1–D3 | after roles land |

B6 is the largest piece of work and the one nothing else can substitute for: it is
the security foundation the app currently lacks, and it needs no Microsoft
dependency to start. C1–C3's grant surface belongs with it — a grant model with no
way to make a grant is not finished.

The external screen can be built and demonstrated **before any Microsoft
dependency**: tasks come from the app's own state, so C2 is real and usable with
files arriving later at B7.

---

## Risks

- **B6 is a rewrite of how the app persists state**, not an addition to it. Every
  external feature waits on it, and the current single-document `/api/state` cannot
  be made safe by filtering in the client.
- **External logins turn today's open surfaces into escalation paths.** There is no
  role field anywhere, the `#admin` route is reachable by typing its hash, the team
  manager creates and removes sign-in accounts, and `clearWorkspace` wipes shared
  state for everyone — all available to any signed-in user. Harmless while every
  user is AGP staff; a live vulnerability the day an external can sign in. Roles
  (D1–D3) must ship in the same step as external auth, never after it.
- **A matching error becomes real folders.** An unscoped client account provisions
  from the name matcher, which has produced large false positives. Reconcile never
  deletes, so a wrong match leaves permanent folders. The confirmed preview (B4 §6)
  is the guard; skipping it to "just provision everything" is how a client's library
  fills with another client's contracts.
- **The migration has a window where two stores must agree.** Between backfill and
  cutover, every write goes to both the document and Postgres. A missed write path
  means silent drift, discovered later as missing data.
- **RLS is off wherever the service-role key appears.** It bypasses policies
  entirely, so a single handler that keeps using it — or a helper that quietly
  reintroduces it — disables enforcement with no visible symptom. Keep it out of the
  request path and check for it in review.
- **The app is not the file gatekeeper, and must not drift into acting like one.**
  SharePoint enforces file access through the guest's own permission; the app's
  `access_grant` scopes its own screens. Where the two disagree, SharePoint wins on
  files, and the discrepancy is a bug to surface rather than to paper over.
- **Two unverified assumptions carry the external experience** (A3): that an OTP guest
  can sign into the app, and that they can then get a delegated Graph token to read the
  folder shared with them. The first failing locks out everyone without a Microsoft
  account; the second leaves them signed in with tasks and discussions but no files,
  and there is no fallback that does not reintroduce an application credential. One
  Gmail address tests both.
- **B1 decides everything on the Microsoft side.** With no app-only path, a delegated
  token is the *only* way the app reaches Graph — for folders, uploads and guest
  invites alike. If B1 fails, this design has no fallback that keeps its consent ask.
- **A Team must exist before a workspace can provision** (A2) — the one admin action
  per client. It takes minutes; the risk is scheduling attention, not processing time.
- **Provisioning needs a signed-in human.** Folders for new Kantata milestones
  appear the next time someone opens the workspace, not overnight.
- **The milestone set is only as complete as the deepen.** `deepenWorkspaces` caps
  at 12 Kantata workspace ids and 800 stories each and returns `0` silently on
  failure, so a client with more than 12 projects would get a partial tree.
  Provisioning must refuse to run against a mirror that never deepened rather than
  provision a subset and look finished.
- **Client-level Teams accumulate.** Every fiscal year adds a project folder and its
  milestones to the same library, and nothing is deleted. Worth revisiting the
  5,000-item view threshold per folder, and whether closed contracts should collapse
  into an `Archive/` parent once a client has several years of history.

---

## Deferred

Private channels and the 30-channel cap machinery · per-task channels · Team member
removal · library-root (whole-client) grants · audience subfolders inside milestones
· background provisioning.

**Deferred with a named trigger:** Purview per-person open tracking (B9) — the app's
own click record covers the case people actually ask about; build the Management
Activity API integration only if authoritative attribution is required.

Each is additive, and none is load-bearing for "get off the extranet, share one
folder securely, see who opened and edited it."
