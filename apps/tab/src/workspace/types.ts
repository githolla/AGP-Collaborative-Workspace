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
  phaseKey?: string;
  source: "plan" | "manual";
  /**
   * Layer 0.3: client-facing tasks are a filtered subset. Only tasks flagged
   * clientVisible appear on the linked client account's shared plan; internal
   * tasks never reach it.
   */
  clientVisible?: boolean;
  createdAt: string;
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
}

export interface ExternalMember {
  id: string;
  name: string;
  org: string;
  role: "client" | "contractor";
  access: "workspace" | "files-only" | "tasks-only";
  /** Access register (Layer 0.5): who granted access and when they last showed up. */
  invitedBy?: string;
  lastActive?: string;
  addedAt: string;
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
  itemKind: "file" | "doc" | "task";
  itemId: string;
  /** Name captured AT SEND TIME, so the record survives a rename or deletion. */
  itemName: string;
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

export interface ClientAccount {
  id: string;
  clientName: string;
  /** Internal AGP members on the account. */
  members: { personId: string; name: string; title: string }[];
  /** Clients + contractors (Contractor Access tab). Removal revokes instantly. */
  externals: ExternalMember[];
  /**
   * What each outside person was handed, when, and whether they opened it.
   * Optional so workspaces saved before handover tracking existed still load.
   */
  shares?: Share[];
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
  /**
   * How each person on the account prefers to be notified (client call: some
   * want Teams, some email, some both). Keyed by person name. The channel is
   * honoured once the M365 layer is connected; the in-app notification always
   * fires. Absent = the account default (both).
   */
  notifyPrefs?: Record<string, "teams" | "email" | "both">;
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
