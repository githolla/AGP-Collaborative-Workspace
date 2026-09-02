import type { Grade, WorkspaceFactor } from "@agp/roi";

export type InitiativeType = "new_build" | "ai_iteration";

export interface ThreadMessage {
  id: string;
  author: string;
  kind: "human" | "agent";
  at: string; // ISO
  body: string;
  /**
   * What the message is about — a project/campaign name, a task title, or a
   * phase. Lets a client with ~20 projects keep discussion organized and
   * searchable instead of one undifferentiated thread. Empty = "General".
   * (Per the client call: scope by project, pilot at the task level.)
   */
  topic?: string;
  /** Set when the author edited the post — shown so a changed message is
   * never passed off as the original. */
  editedAt?: string;
  /**
   * Contractor-visible slice (spec 5.4). A message flagged contractorVisible
   * is shown to contractors in their scoped view; everything else stays
   * internal-only. Flow-back: contractor-visible messages STILL live in the
   * single internal thread — this flag is a projection, not a separate store —
   * so the full history is preserved while contractors see only their slice.
   */
  contractorVisible?: boolean;
  /** Client-visible slice, the same rule as contractorVisible — independent
   * of it, so a message can be shared to the contractor, the client, both,
   * or neither. See workspace/teams-provisioning-plan.md C2/C4. */
  clientVisible?: boolean;
  /**
   * What this message is about, as a real Kantata reference — a project,
   * milestone, phase, or task id. `topic` above is the free-text human label
   * and cannot be matched against a grant; an external only ever sees a
   * message when kantataId falls under a milestone they hold, regardless of
   * how it is flagged. Absent = never reaches an external, however flagged.
   */
  kantataId?: string;
  kantataLevel?: "project" | "milestone" | "phase" | "task";
}

/** Audit-trail snapshot (roi-calculator-spec §10) written on every factor change. */
export interface Snapshot {
  at: string;
  netOneTime: number;
  netRecurringAnnual: number;
  adjustmentMultiplier: number;
  grade: Grade;
  hasUnknowns: boolean;
}

export type TaskStatus = "todo" | "doing" | "done";

/**
 * Kantata's four working statuses, surfaced on the "Your Tasks" board (Kellie's
 * pilot ask: align to Kantata's Not Started / Started / Needs Info / Complete).
 * The app's own editable state stays the 3-value TaskStatus; workStatus is the
 * richer Kantata-sourced status carried onto the task for display, so "Needs
 * Info" — which the 3-state collapse can't represent — shows on the board.
 */
export type WorkStatus = "not_started" | "started" | "needs_info" | "complete";

/** Shared task (Collab Hub Must): owner, due date, label, status. */
/**
 * One person's stake in a task — the model behind Cara's task-card vision:
 * assign the people, split the hours across them, name a primary owner, and set
 * the handoff order. Crucially, each person marks THEIR OWN part done, so one
 * person completing the task no longer completes it for everyone (the Kantata
 * limitation Kellie flagged — the thing that makes people hesitate to mark
 * anything complete). The task is done only when everyone on it is done.
 */
export interface TaskAssignment {
  /** The person — matches a Kantata assignee / staff name. */
  name: string;
  /** Template role ("Data Developer"), when known — the resourcing anchor. */
  role?: string;
  /**
   * This person's slice of the task's hours. When unset, the app shows an even
   * split of the task's hours across everyone as the default (the PM edits from
   * there); once edited, the explicit value sticks. Feeds weekly resourcing.
   */
  hours?: number;
  /** This person has finished THEIR part. Per-person, not the whole task. */
  done?: boolean;
  /** The one accountable owner — drives whose list the task headlines. */
  primary?: boolean;
  /** Handoff order — 1 starts, higher numbers receive the handoff downstream. */
  order?: number;
}

export interface Task {
  id: string;
  title: string;
  ownerName?: string;
  /**
   * Everyone on the task, with their hour slice, handoff order, primary flag,
   * and per-person done state. When present this supersedes the single
   * ownerName for resourcing and completion; ownerName stays as the display
   * fallback and for tasks that were never split across people.
   */
  assignments?: TaskAssignment[];
  due?: string;
  label?: string;
  status: TaskStatus;
  /**
   * Kantata's richer working status (Not Started / Started / Needs Info /
   * Complete), enriched onto the task from the live Kantata mirror by story id.
   * Drives the "Your Tasks" board columns; absent for workspace-only tasks that
   * never came from Kantata (they fall back to the 3-state `status`).
   */
  workStatus?: WorkStatus;
  phaseKey?: string;
  source: "plan" | "manual";
  /**
   * Layer 0.3: client-facing tasks are a filtered subset. Only tasks flagged
   * clientVisible appear on the linked client account's shared plan; internal
   * tasks never reach it.
   */
  clientVisible?: boolean;
  /**
   * Contractor-facing tasks are a separate filtered subset (spec 5.3/5.5).
   * Only tasks flagged contractorVisible appear on the contractor's scoped
   * plan — "here are your due dates" — without exposing the full internal
   * project plan. Independent of clientVisible: a task can be shared to the
   * contractor, the client, both, or neither.
   */
  contractorVisible?: boolean;
  createdAt: string;
  /** When the task was marked done (ISO) — set on completion, cleared if
   * reopened. Lets "done this week" be a fact instead of a createdAt proxy. */
  completedAt?: string;
  /**
   * Kantata story id, present on tasks imported from Kantata. This is the
   * handle the write-back uses: with it an edit here becomes
   * `PUT /stories/{id}`; without it the task is workspace-only and a write
   * would have to CREATE a story, so it never happens silently.
   */
  kantataStoryId?: string;
  /** Kantata workspace id the story belongs to. */
  kantataProjectId?: string;
  /**
   * The milestone (real project) this task belongs to. At AGP a Kantata
   * workspace is a fiscal-year contract and its milestones are the projects,
   * so this is what lets the plan group and filter tasks by project instead of
   * showing one flat list across a whole year's work.
   */
  projectLabel?: string;
  /**
   * The PHASE (nested Kantata milestone) this task sits under, when the job has
   * phases — the child level below the project. Lets the plan nest tasks as
   * project → phase → task instead of a flat list (Kellie's parent/child ask).
   */
  phaseLabel?: string;
  phaseId?: string;
  /**
   * The full chain of nested milestones between the project and this task,
   * top→nearest (e.g. ["Phase 1", "Design round"]). Lets the plan show every
   * level of a deeply nested job, not just the nearest phase — Kellie's "as far
   * nested as they go". `phaseLabel` stays the last entry for simple callers.
   */
  phasePath?: string[];
  /**
   * Other tasks this one waits on — Cara's "indicate dependencies". A task is
   * BLOCKED until every task it depends on is done, so a resource isn't chasing
   * work that can't start yet. Stored as task ids within the same account.
   */
  dependsOn?: string[];
  kantataMilestoneId?: string;
  /** ISO time of the last successful push of this task to Kantata. */
  kantataSyncedAt?: string;
  /**
   * The PM's own hour estimate for this task's owner. NEVER computed by the app
   * — how AGP estimates effort (templatized vs. custom) is their call, out of
   * scope by design. It exists so weekly resourcing is DERIVED from it plus the
   * task's due date, and a timeline shift keeps resourcing current with no
   * re-entry (the Thursday manual redistribute, automated). Internal only:
   * hours, never rates — off client surfaces by the client-safety wall.
   */
  estimatedHours?: number;
  /**
   * Start of the work window, from Kantata. With `due`, it's the span the
   * estimated hours spread across, week by week — matching how Kantata
   * redistributes scheduled hours. Absent ⇒ the hours land in the due week.
   */
  startDate?: string;
  /** The SharePoint folder this task's files live in, once provisioned
   * (teams-provisioning-plan.md B4). Absent until someone uploads into it,
   * grants it, or asks for it — task folders are created on demand. */
  msFolderId?: string;
}

/** One line in the workspace "what's new" feed (Collab Hub Must). */
export interface ActivityEvent {
  id: string;
  at: string;
  text: string;
  kind: "task" | "roi" | "team" | "workspace";
}

export interface Initiative {
  id: string;
  name: string;
  type: InitiativeType;
  summary: string;
  factors: WorkspaceFactor[];
  plan?: ProjectPlan;
  tasks: Task[];
  activity: ActivityEvent[];
  archived?: boolean;
  /**
   * Layer 0.1 zone pairing: a build can be the INTERNAL ZONE of a client
   * account. The link is only ever rendered on the internal side; the client
   * workspace never exposes it.
   */
  clientAccountId?: string;
  thread: ThreadMessage[];
  snapshots: Snapshot[];
  createdAt: string;
}

export const TYPE_LABEL: Record<InitiativeType, string> = {
  new_build: "New build",
  ai_iteration: "AI added to existing product",
};

// ---------------------------------------------------------------------------
// Client-account workspace (Collab Hub doc + wireframe): the standardized
// execution environment per client account — internal teams, clients, and
// contractors. HARD RULE: internal financials (margin, ROI factors, realism,
// human-in-the-loop) never render in this workspace type.
// ---------------------------------------------------------------------------

export interface ClientFileLink {
  id: string;
  name: string;
  /** SharePoint/OneDrive link once the M365 layer lands; optional today. */
  url?: string;
  kind: "file" | "doc";
  addedAt: string;
  /**
   * Client-facing share state. Cara's ask: share a document into the client
   * space — sometimes just to read (a living strategy doc), sometimes FOR
   * APPROVAL — and let the client approve or ask for changes, without it
   * having to hang off a task. Absent = internal only, never shown to a client.
   * See workspace/clientApproval.ts.
   */
  clientShare?: ClientShare;
}

/** A document shared with the client, and where its approval stands. */
export interface ClientShare {
  /** "fyi" = shared to read/collaborate; "approval" = a decision is requested. */
  purpose: "fyi" | "approval";
  sharedAt: string;
  sharedBy: string;
  /**
   * The client's decision on an approval request. Absent while pending.
   * "changes" carries a note saying what to change.
   */
  decision?: "approved" | "changes";
  decidedAt?: string;
  decidedBy?: string;
  note?: string;
  /**
   * First time the client opened it. Observed directly only once SharePoint is
   * connected (BLOCKERS #5); until then it stays absent — we don't fake it.
   */
  openedAt?: string;
}

export interface ClientNotification {
  id: string;
  text: string;
  at: string;
}

export interface Campaign {
  id: string;
  name: string;
  status: "active" | "planned" | "complete";
  nextMilestone?: string;
  nextMilestoneDate?: string;
  /** "kantata" = synced from the live pull (renders the provenance chip). */
  source?: "kantata";
  /** Kantata workspace id, when this campaign came from a matched project
   * (never set for a HubSpot deal). Carried through so a confirmed import
   * can also link the collab-schema account's kantata_project_ids. */
  kantataProjectId?: string;
}

export interface ExternalMember {
  id: string;
  name: string;
  org: string;
  role: "client" | "contractor";
  /** Access register (Layer 0.5): who granted access and when they last showed up. */
  invitedBy?: string;
  lastActive?: string;
  addedAt: string;
  /** Contractor email — the identity the Entra guest invite is keyed to (D5). */
  email?: string;
  /**
   * Microsoft Entra guest-provisioning state (spec D5). A contractor must be an
   * Entra guest to reach Team/SharePoint files. The app tracks the state; the
   * actual invite is Part B automation (manual for the first pilots):
   * none = not yet provisioned, invited = guest invite sent, active = signed in.
   */
  entraStatus?: "none" | "invited" | "active";
  /** The Entra object id returned by the invite (`grantedToV2.user.id`), once
   * the guest exists — set from the invite response, never guessed. Absent
   * until entraStatus moves past "none". */
  entraUserId?: string;
}

/**
 * One thing handed to one outside person — the handover record.
 *
 * A RECORD, not a permission: revoking stamps `revokedAt` and keeps the row,
 * because "sent 3 Aug, opened 4 Aug, revoked 20 Aug" has to still be
 * answerable a year later. See workspace/handover.ts.
 */
export interface Share {
  id: string;
  /** Recipient, by name — externals are named before they have identities. */
  personName: string;
  itemKind: "file" | "doc" | "task" | "folder";
  itemId: string;
  /** Name captured AT SEND TIME, so the record survives a rename or deletion. */
  itemName: string;
  /** The SharePoint item this grant covers, when itemKind is "folder"
   * (teams-provisioning-plan.md B7). */
  msItemId?: string;
  /** Which level of the folder tree was granted — a milestone by default;
   * project and phase are rarer, task is the exception for a milestone too
   * broad to hand over whole. */
  grantLevel?: "project" | "milestone" | "phase" | "task";
  sentAt: string;
  sentBy: string;
  /** First observed open. Absent until we actually see one — never inferred. */
  openedAt?: string;
  /**
   * How we know it was opened. "workspace" = they opened it from inside this
   * app, which we observe directly today. "sharepoint" = Microsoft told us,
   * which needs the Graph connection (BLOCKERS #5).
   */
  openSource?: "workspace" | "sharepoint";
  revokedAt?: string;
  revokedBy?: string;
}

/** A folder in the account's SharePoint document library, keyed on the
 * Kantata id it stands for (teams-provisioning-plan.md B2/B4). Names change
 * when Kantata retitles something; `kantataId` and `folderId` do not, so a
 * rename is a PATCH of this row, never a second one. */
export interface MsFolder {
  kantataId: string;
  folderId: string;
  /** Parent folder id — the chain an access check walks. Ids survive
   * renames; paths do not, so nothing is keyed on a stored path. */
  parentFolderId?: string;
  name: string;
  level: "project" | "milestone" | "phase" | "task";
}

/** The Microsoft Team provisioned for one `ClientAccount`. See `MsFolder`. */
export interface MsTeam {
  teamId: string;
  groupId: string;
  /** The team site — carried for links and diagnostics. */
  siteId: string;
  driveId: string;
  webUrl: string;
  /** Channels created, keyed by name — idempotency by stored id. */
  channels: { key: string; channelId: string }[];
  folders: MsFolder[];
  provisionedAt?: string;
}

export interface ClientAccount {
  id: string;
  clientName: string;
  /**
   * Internal AGP members on the account. `email` + `role` are optional so
   * members added before roles existed still load — a member with no role
   * is presumed a regular member, never an admin (teams-provisioning-plan.md
   * D1/D2). `role: "admin"` is a WORKSPACE admin for this one account, set on
   * whoever creates the workspace and on anyone they promote; distinct from
   * an app admin, who manages every workspace and is bootstrapped from
   * `APP_ADMIN_EMAILS` (see workspace/roles.ts).
   */
  members: { personId: string; name: string; title: string; email?: string; role?: "admin" | "member" }[];
  /** Clients + contractors (Contractor Access tab). Removal revokes instantly. */
  externals: ExternalMember[];
  /**
   * What each outside person was handed, when, and whether they opened it.
   * Optional so workspaces saved before handover tracking existed still load.
   */
  shares?: Share[];
  /**
   * The Microsoft Team provisioned for this account (teams-provisioning-plan.md
   * B2/B3). Absent until an admin creates the Team by hand and its URL is
   * pasted in. One Team per client, covering every Kantata project matched
   * to it — never per project.
   */
  msTeam?: MsTeam;
  clientContacts: number;
  campaigns: Campaign[];
  notifications: ClientNotification[];
  tasks: Task[];
  thread: ThreadMessage[];
  files: ClientFileLink[];
  docs: ClientFileLink[];
  activity: ActivityEvent[];
  /**
   * Kantata project IDs a human explicitly linked to this workspace (the
   * Project Finder). Beats every name heuristic: once linked, the project's
   * campaigns/milestones/tasks/hours follow this client permanently.
   */
  kantataProjectIds?: string[];
  /**
   * When true, this workspace covers ONLY the projects in `kantataProjectIds`
   * — not everything under the client name.
   *
   * From Cara's pilot feedback (2026-07-30): "the workspace would align to one
   * client project… although all of these projects align to the PATNC client,
   * they may have completely different project teams and comingling them is
   * not ideal." So a workspace is scoped to selected work by default once the
   * user picks; covering the whole client stays available for the cases she
   * called the exception.
   */
  scopedToProjects?: boolean;
  /**
   * Set once the workspace has been auto-populated from Kantata's full task
   * tree (deepen + import). Guards against re-adding work the user later
   * removed: the automatic top-up runs once per workspace, then the human
   * curates freely and new Kantata work arrives through "Review import".
   */
  autoPopulated?: boolean;
  archived?: boolean;
  createdAt: string;
}

/**
 * A sandbox idea: not tied to any product or initiative. A manager captures
 * the idea, roughs out what it would replace (the ROI basis), sees a
 * back-of-napkin number, and promotes it into a real build when it earns it.
 */
export interface CastMember {
  personId: string;
  name: string;
  title: string;
  role: string;
  /** One-sentence "because" — every suggestion explains itself. */
  why: string;
  /** Dispatch-managed teams are routed via their manager, never invited directly. */
  viaManager?: string;
}

/** One person's part of the project — drafted by the copilot, added by them. */
export interface WorkPackage {
  personId: string;
  name: string;
  title: string;
  /** What their part is, in plain words. */
  part: string;
  /** The one input only they can bring (feeds the gather list). */
  bring?: string;
  phaseKey: string;
  hours: number;
  status: "proposed" | "invited" | "part_added";
  why: string;
  viaManager?: string;
}

export interface PlanPhase {
  key: string;
  label: string;
  goal: string;
  start: string; // ISO date
  end: string;
}

export interface ProjectPlan {
  phases: PlanPhase[];
  packages: WorkPackage[];
  /** The auto-generated 60-second brief — what, why, numbers, who does what. */
  brief: string;
}

export interface IdeaClassification {
  serviceLine?: string;
  vertical?: string;
  /** Owning department/team, e.g. "Analytics" — inferred or user-picked. */
  department?: string;
  clientNames: string[];
}

export interface RelatedItem {
  title: string;
  why: string;
}

/**
 * How much the AI participates:
 * - "copilot": drafts from the start and replies to every message.
 * - "observer": humans collaborate; the Copilot analyzes silently in the
 *   background and joins only when invited — arriving already informed,
 *   posting flags and gap-fill suggestions without overwriting human work.
 */
export type AiMode = "copilot" | "observer";

export interface SandboxIdea {
  id: string;
  /** The client workspace this idea belongs to — the sandbox lives INSIDE
   * each client, not as a separate surface. Absent = legacy/unclaimed;
   * claimable into a workspace from its Sandbox tab. */
  accountId?: string;
  title: string;
  aiMode: AiMode;
  /** The idea in the manager's own words. */
  pitch: string;
  basis: import("@agp/roi").RoiModel;
  plan?: ProjectPlan;
  /** Copilot-drafted cast (approval-by-exception: remove what's wrong). */
  team: CastMember[];
  classification: IdeaClassification;
  relatedProjects: RelatedItem[];
  relatedCampaigns: RelatedItem[];
  thread: ThreadMessage[];
  status: "exploring" | "promoted";
  /** False until the human has reviewed the Copilot's draft (copilot mode). */
  reviewed?: boolean;
  promotedInitiativeId?: string;
  createdAt: string;
}

/**
 * One answer to one tour question. The tour teaches; these capture what people
 * think of the design and the workflow while they're looking at it — which is
 * the only moment the reaction is honest. Stored alongside the workspace so
 * responses from every tester land in one place.
 */
export interface TourFeedback {
  id: string;
  createdAt: string;
  /** Stable key of the tour step this answers. */
  stepKey: string;
  /** Human title of that step, denormalized so an exported CSV reads on its own. */
  stepTitle: string;
  /** The question as it was asked — questions get reworded between rounds. */
  prompt: string;
  /** "a" | "b" | "c", or "" when someone only left a comment. */
  choice: string;
  /** Denormalized option text, for the same reason as stepTitle. */
  choiceLabel: string;
  /** Optional free text — the part that usually carries the real signal. */
  comment: string;
  personName: string;
  personEmail: string;
}
