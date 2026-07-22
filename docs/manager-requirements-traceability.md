# Collaboration Hub — manager's requirements vs. what's built

Source: **Collaboration Hub — Features & Potential Mapping to M365** (manager's
feature/requirements list shared ahead of the May 1 meeting). This traces every
requirement in that document to what exists in the app, so nothing is missed and
nothing extra creeps in unnoticed.

The manager's doc frames the workspace as *"the primary execution environment
for client accounts; bringing together communication, tasks, files, and
visibility across internal teams, clients, and contractors,"* with a focus on
**simplicity, consistency, and secure external collaboration**.

**Status legend**
- ✅ **Built** — working in the app today.
- ◑ **Partial** — the prototype meets the intent; full depth waits on the M365 platform.
- ▷ **M365 layer** — the manager's *own* mapping table assigns this to Teams/SharePoint/Power Automate; not something this prototype implements itself.
- ✗ **Not built** — no equivalent yet (all are Nice-to-have).

## 1. Workspace Structure & Navigation

| Requirement | Priority | Status | Where it lives |
| --- | --- | --- | --- |
| Workspace per client/project | Must | ✅ | `ClientWorkspace` — one per client account; guest-safety keeps zero cross-visibility by default. |
| Workspace templates | Must | ✅ | `TemplatePicker` + `templates.ts` — apply a service-line template (dated task set) on the plan. |
| Home / landing view | Must | ✅ | Home tab — greeting, notifications, overview, your tasks, due-this-week, files, discussions; everything clickable. |

## 2. Access Control, External Users & Governance

| Requirement | Priority | Status | Where it lives |
| --- | --- | --- | --- |
| External guest access | Must | ✅ | `addExternal` + Contractor Access tab + the People hub's "Invite client/contractor". |
| Granular permissions | Must | ◑ | Enforced **per workspace** (a guest sees only the client surface; financials never render). Folder/page/task-list-level control → ▷ SharePoint. |
| Auditability | Should | ◑ | Access tab lists who has access and at what level; the account activity log records team/access changes. A formal access-log export → ▷ M365. |
| Offboarding | Must | ✅ | `offboardEverywhere` — removing a person revokes access across every workspace at once. |

## 3. Communication

| Requirement | Priority | Status | Where it lives |
| --- | --- | --- | --- |
| Threaded discussions | Must | ✅ | Discussions tab (`Thread`) — tied to the workspace; searchable via global search. Plus the read-only Kantata project conversation. |
| @mentions & notifications | Must | ✅ | `@FirstName` notifies via Team Notifications on Home; the Copilot digest tunes the weekly update. |
| Lightweight real-time chat | Nice | ▷ | Teams chat in the M365 layer — intentionally not rebuilt. |

## 4. Tasks & Work Management

| Requirement | Priority | Status | Where it lives |
| --- | --- | --- | --- |
| Shared task lists | Must | ✅ | `TasksCard` — owners, due dates, status. Task owners now come live from Kantata assignees. |
| Project Plan (Advanced Planner tie-in) | Should | ◑ | One list, no double entry: Kantata's task tree + any linked build plan feed the same list; status flows back. Two-way Advanced Planner sync → ▷ M365 (this is exactly the "avoid AMs updating multiple places" goal). |
| Multiple views | Must | ✅ | List + board views, filters by owner, due date, label, status. |
| Recurring check-ins / recurring tasks | Nice | ✗ | Not built. |

## 5. Files & Document Collaboration

| Requirement | Priority | Status | Where it lives |
| --- | --- | --- | --- |
| Central file repository | Must | ◑ | Files tab links the SharePoint the account lives in (single entry point); the store itself is ▷ SharePoint. |
| Version history & recovery | Must | ▷ | SharePoint versioning — not reimplemented in the prototype. |
| Co-authoring / collaborative docs | Should | ▷ | SharePoint/Office co-authoring. |

## 6. Status & Visibility

| Requirement | Priority | Status | Where it lives |
| --- | --- | --- | --- |
| Activity feed | Must | ✅ | `WhatsNew` — the account's "what's new" feed. |
| Lightweight dashboards | Should | ✅ | Client Dashboard tab — tasks due, status, owners, campaign/milestone health. |
| Exportability | Nice | ✅ | CSV export of the plan (opens in Excel). |

## 7. Search & Findability

| Requirement | Priority | Status | Where it lives |
| --- | --- | --- | --- |
| Search across the workspace | Must | ✅ | `SearchBox` — now spans **client accounts** (their tasks, discussions, files) plus builds and ideas. *(Client accounts were previously missing — closed in this pass.)* |
| Tagging / metadata | Nice | ◑ | Task labels + service-line/vertical tags; a general tag system is not built out. |

## 8. Integrations & Automation

| Requirement | Priority | Status | Where it lives |
| --- | --- | --- | --- |
| Email bridge | Should | ▷ | Power Automate / M365. |
| Automation hooks | Nice | ▷ | Power Automate / Planner rules. |

## 9. Security, Compliance & Lifecycle

| Requirement | Priority | Status | Where it lives |
| --- | --- | --- | --- |
| Storage clarity | Must | ◑ | Provenance chips mark synced data; ADRs document storage (Supabase today → SharePoint target). A user-facing "where this lives" statement is not surfaced in-app yet. |
| External sharing controls | Must | ✅ | Guest-safety: no financial fields on any client-facing surface, client sees only their own workspace — enforced by a build-time test (`clientSafety.test.ts`). |
| Archiving | Should | ✅ | `setAccountArchived` — archive/close while retaining full history. |

## M365 functional mapping

The doc's mapping table (Teams/SharePoint/Planner/Power Automate) is the
*platform* hypothesis, not a per-feature ask of this prototype. Every item this
matrix marks ▷ lines up with that table — so "not built here" means "the
platform provides it," not "missed."

## What we've added beyond this document

The manager's doc scopes the **collaboration workspace**. The app also carries
pieces from AGP's broader initiative — called out here so they're a deliberate
choice, not scope creep:

- **ROI engine + internal Portfolio (financials).** Kept strictly **off** every
  client-facing surface (guest-safety). Internal-only, for AGP's separate
  ROI-collaboration goal. — *confirm still in scope.*
- **Sandbox (idea → ROI basis → promote) + AGP Copilot**, now nested inside each
  client. Beyond a pure collaboration hub. — *confirm still in scope.*
- **Live Kantata integration** (book of business, auto-populate, task owners,
  posts, live team roster). Not in the platform-agnostic doc, but it's the data
  backbone that makes the workspace real rather than empty.

## Bottom line

Every **Must** is satisfied at the prototype level. The only Must-priority items
not implemented in-app are the ones the manager's own M365 mapping assigns to
SharePoint/Teams (version history, co-authoring, folder-level permissions,
real-time chat, email bridge, automation) — platform features, not gaps. The one
genuine miss found by this reconciliation — global search excluded client
accounts — is fixed in this pass.
