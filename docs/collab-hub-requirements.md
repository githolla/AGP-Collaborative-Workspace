# Collaboration Hub — Requirements Baseline & Traceability

Source: the manager's **"Collaboration Hub — Features & Potential Mapping to
M365"** document (received 2026-07-20; also kept verbatim intent below). This
is now the tracked requirements baseline for the workspace. Where our existing
build already exceeds a requirement, we keep our approach and note the delta —
per the product owner's direction: *get it in, but not exactly, if what we have
makes it better.*

**Framing note:** the manager's doc describes the workspace as the primary
execution environment for **client accounts** (internal teams + clients +
contractors). Our build so far is the internal **product-initiative** workspace
(sandbox → ROI-graded build). These converge: the same workspace container,
threads, tasks, plans, and feeds serve both; client/contractor access arrives
with the identity/backend layer (Supabase RLS + Entra guests, or the M365
mapping below).

Status legend: ✅ built · 🔨 built this increment · 🧭 designed, needs backend
(Supabase/Entra/M365) · 📋 planned

## Traceability matrix

### Workspace structure & navigation

| Requirement | Pri | Status | Where / how — and deltas that make it better |
|---|---|---|---|
| Workspace per client/project, no cross-visibility | Must | 🔨 + 🧭 | Each initiative/idea is an isolated workspace object today; true access isolation needs the auth layer (Supabase RLS keyed to Entra ID — schema already exists in `supabase/migrations/0006_rls.sql`). |
| Workspace templates | Must | ✅ **better** | Three layers (2026-07-20): every client workspace is created from the standard template; **“Start from a template” on the Project Plan applies AGP service-line playbooks** (Direct Mail, Digital Fundraising, GivingDNA Onboarding, Mid-Major Gifts Sprint) as dated task skeletons from a chosen start date, labeled and dedupe-safe; and in the Sandbox the Copilot *generates* a workspace from a sentence. |
| Home / landing view (find updates, tasks, files in 60s) | Must | 🔨 | "What's new" feed at the top of every workspace + task summary + the decision numbers on the right rail. Global home = portfolio with per-card status. |

### Access control, external users & governance

| Requirement | Pri | Status | Where / how |
|---|---|---|---|
| External guest access (clients/contractors) | Must | 🧭 | Backend-gated: Entra guest accounts (BLOCKERS #5) or Teams/SharePoint guests per the M365 mapping. The workspace model already separates per-workspace membership (team/parts). |
| Granular permissions | Must | 🧭 | RLS policies per table exist; per-workspace member scoping lands with Supabase persistence. |
| Auditability | Should | ✅ partial | Every ROI change writes an immutable snapshot (audit trail card); access-level audit needs the auth layer. |
| Offboarding revokes immediately | Must | 🧭 | Auth-layer requirement; noted in the Supabase persistence design. |

### Communication

| Requirement | Pri | Status | Where / how |
|---|---|---|---|
| Threaded discussions, searchable, workspace-tied | Must | ✅ + 🔨 | Per-workspace collaboration thread (humans + AI agents) — now covered by global search. |
| @mentions & notifications | Must | 🔨 app / 🧭 Teams | In-app half live 2026-07-20: “@FirstName” in a client-workspace post raises a Team Notification on Home (AGP team + externals). Push/Teams delivery rides the M365 layer. |
| Lightweight real-time chat | Nice | 🧭 | Maps to Teams chat per the manager's own mapping; not rebuilding chat. |

### Tasks & work management

| Requirement | Pri | Status | Where / how — and deltas |
|---|---|---|---|
| Shared task lists (owners, due dates, status) | Must | 🔨 | Tasks per workspace: owner, due date, status (to do / doing / done), quick-add. **Better:** the AI seeds the task list from the project plan — each person's work package becomes their task with phase-derived due dates — so AMs never start from an empty list. |
| Project plan tied into tasks (avoid double entry) | Should | 🔨 **better** | The plan IS the source: packages → tasks automatically; re-planning keeps statuses. No dual maintenance. |
| Multiple views (board/list; filter owner/status) | Must | 🔨 | List and board views with owner + status filters. |
| Recurring check-ins / recurring tasks | Nice | 🔨 partial | The AI-drafted weekly client digest (draft-then-approve, Discussions) covers the status-check-in intent; literal recurring tasks stay planned with the signals layer. |

### Files & document collaboration

| Requirement | Pri | Status | Where / how |
|---|---|---|---|
| Central file repository / version history / co-authoring | Must/Must/Should | 🧭 | Maps to SharePoint + Teams Files per the manager's mapping — we should not rebuild file storage. The workspace links artifacts (briefs, SOWs) and will deep-link SharePoint folders per workspace when the Teams shell lands. Our versioned, provenance-linked **artifacts** (ROI snapshots, briefs) already exceed version-history needs for generated documents. |

### Status & visibility

| Requirement | Pri | Status | Where / how — and deltas |
|---|---|---|---|
| Activity feed / "what's new" | Must | 🔨 | Unified per-workspace feed: discussion, ROI snapshot changes, task and part events — newest first. |
| Lightweight dashboards | Should | ✅ **better** | The portfolio rollup + per-workspace decision view are live computed dashboards (annual net, payback, grade, parts-in count) — stronger than task-count reporting. |
| Exportability | Nice | 🔨 | “⬇ Export CSV” on the client Project Plan (task/owner/due/status/label) — opens in Excel. Snapshot JSON already exportable. |

### Search & findability

| Requirement | Pri | Status | Where / how |
|---|---|---|---|
| Search across the workspace | Must | 🔨 | Global search over workspaces, discussions, tasks, people, and parts with jump-to-result. |
| Tagging / metadata | Nice | ✅ | Classification chips (service line × vertical × client) are auto-derived metadata; searchable. |

### Integrations & automation

| Requirement | Pri | Status | Where / how |
|---|---|---|---|
| Email bridge | Should | 🧭 | HubSpot engagement sync (built, dormant) is the email context bridge for client accounts; Teams/Outlook bridge with M365 layer. |
| Automation hooks | Nice | ✅ core | The autonomy-tier gate + Copilot flags are the automation substrate (approve-by-exception, undo windows) — richer than reminder rules. |

### Security, compliance & lifecycle

| Requirement | Pri | Status | Where / how |
|---|---|---|---|
| Storage clarity | Must | ✅ doc | Today: browser localStorage (demo). Next: Supabase Postgres (schema committed), files in SharePoint per mapping. Documented here + README. |
| External sharing controls | Must | 🧭 | With auth layer / M365. |
| Archiving with history | Should | 🔨 | Archive/unarchive per workspace incl. CLIENT workspaces (2026-07-20): Archive button in the workspace header, “Archived (N)” restore list on the Clients page; full history + auditability retained. |

## SPEC v2_1 Layer 0 adoption (2026-07-20)

SPEC.md was updated to v2_1, whose only change is a new **Layer 0 —
Collaboration Container** codifying the manager's hub. App-side status:

| Layer 0 item | Status | Notes |
|---|---|---|
| 0.1 Two-zone structure | 🔨 model | Builds can be linked as the **internal zone** of a client account; the link renders only on the internal side. Teams shared/private channels carry it physically with the M365 layer. |
| 0.1 No-financials hard rule "in code and test" | 🔨 **tested** | `apps/tab/src/clientSafety.test.ts`: build-time allowlist walking the runtime import graph of guest-visible components — fails CI if any financial/intelligence module becomes reachable, plus a word-bounded identifier check. Thread was refactored (agent roster injected by internal callers) so the guest graph is clean. |
| 0.2 Provisioning-as-template | 🔨 app / 🧭 Graph | Standard client template on create; Graph (channels, SharePoint taxonomy, Planner tab, Entra B2B invites) blocker-gated. |
| 0.3 Kantata ⇄ Planner, client-visible flag | 🔨 shape | `clientVisible` flag on build tasks; flagged tasks mirror onto the linked account's shared plan and **status changes flow back** — one list, no double entry. Kantata/Planner adapters ride this same shape via the sync service when credentials land. |
| 0.4 Home tabs, two variants | 🔨 | Guest variant = client Home (wireframe); staff variant = build workspace. Upcoming milestones added to client Home. |
| 0.5 Guest lifecycle & register | 🔨 | Register now shows invited-by + last-active; per-workspace immediate revoke and **one-click cross-workspace offboard**, all audit-logged. Entra removal attaches when identity lands. |
| 0.6 Don't rebuild native M365 | ✅ | Unchanged position: discussions/mentions/files/search map to Teams/SharePoint. |

## M365 mapping (manager's table, with our recommendation)

The manager's mapping (Teams channels, Planner, SharePoint, Power Automate) is
sound as the **delivery fabric**. Our recommendation, consistent with the
original Teams-tab architecture: this workspace runs **as the Teams tab** per
client/project channel — Teams provides container, chat, guests, and files
(SharePoint); this app provides the intelligence M365 lacks: AI-drafted
workspaces, ROI engine + grades, plans→tasks without double entry, flags, and
the collaboration copilot. Planner sync (tasks ↔ Advanced Planner) becomes an
adapter once Graph access lands (BLOCKERS #5/#6).

## Drift review (2026-07-20) — against the full document including the wireframe

The doc embeds a **sample wireframe** that is the clearest statement of intent:
a workspace for **"ABC Foodbank of the Southeast"** — a *client account* — with
nav tabs **Home · Project Plan · Client Dashboard · Files · Discussions ·
Contractor Access**, and a personal home ("Hi Jane!") composed of: Team
Notifications · Account Overview (active campaigns, upcoming tasks, client
contacts) · **Your Tasks** (personal board with owners + due dates) · **Due
This Week** · Recent Files · Core Documentation · Latest Discussions.

### Where we match her wireframe already
- The task board (To Do / In Progress / Completed with "Jen M. · Due Apr 30"
  rows) is nearly identical to our board view.
- Latest Discussions ↔ our thread + What's-new feed.
- Account Overview counters ↔ our stat-tile pattern.
- Search, archive, activity feed, owners/due/status all align.
- Her Advanced-Planner worry (updates in multiple places) is answered
  structurally: plan seeds tasks; parts completing close tasks.

### Honest drift register (severity order)
1. **Workspace subject (major) — CLOSED 2026-07-20.** Her hub is per **client account** for
   delivery execution with clients and contractors in the room. Our primary
   surface is the internal product-initiative workspace with ROI math. These
   are two workspace *types* on the same bones — but today only the internal
   type exists. Correction: add a **Client account** workspace type whose Home
   mirrors her wireframe; keep initiative workspaces as the internal line.
2. **Files (major) — CLOSED 2026-07-20 (links-based; storage stays SharePoint).** Two of her eight home zones are files (Recent Files,
   Core Documentation). We have no file surface at all — not even SharePoint
   links. Correction: links-based Files & Core Docs cards now; SharePoint
   deep-links with the M365 layer.
3. **Person-centric home (major) — CLOSED for client workspaces 2026-07-20.** "Hi Jane" + *your* tasks + due this week +
   notifications. Ours is workspace-centric with no "my work" view.
   Correction: personal home + Due This Week; notifications need backend.
4. **Client Dashboard / internal-client boundary (critical rule).** Her
   wireframe has a client-facing status tab. Our numbers (margin, realism
   haircut, human-in-the-loop tax) are **internal-only and must never be
   guest-visible**. Rule adopted: ROI surfaces render only for internal roles;
   the Client Dashboard is a separate, curated, client-safe view.
5. **Simplicity (her opening sentence).** "…without adding unnecessary
   complexity or overhead." Her wireframe is calm; our build page stacks 10+
   dense panels. Correction: move ROI depth behind a Numbers section/tab;
   landing view = what's new, tasks, plan, discussions.
6. **Small gaps — CLOSED 2026-07-20 (labels + due-date filters shipped).** Original: task filters lacked due-date and labels (her acceptance
   criteria names both); tasks have no labels; @mentions/notifications (Must)
   still backend-gated; no export. Update 2026-07-20: in-app @mentions,
   CSV export, client-workspace archiving, and the What's-new activity feed
   all shipped — remaining backend-gated: Teams push delivery, email bridge.

### Verdict
The collaboration bones (tasks, discussions, feed, search, plan-to-tasks,
archive) are on target and in places ahead of the ask. The drift is that the
**client-account execution workspace — the actual subject of her document —
does not exist yet as a workspace type**, files are absent, and the home is
not person-centric. The ROI/sandbox intelligence is the product owner's
deliberate extension, defensible as the *internal* workspace type, provided
it is firewalled from client visibility (rule 4).

## Deltas kept deliberately (where our build improves the ask)

1. **Templates are generative, not static** — a sentence produces the workspace.
2. **Plan and tasks are one thing** — the doc's "avoid AMs updating multiple
   places" concern is solved structurally, not by integration.
3. **Dashboards carry credibility grades** — numbers show their evidence
   quality, not just counts.
4. **AI is a workspace member with consent modes** — copilot-from-start or
   observe-until-invited, always explaining itself.
