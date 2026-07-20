import type { Grade, WorkspaceFactor } from "@agp/roi";

export type InitiativeType = "new_build" | "ai_iteration";

export interface ThreadMessage {
  id: string;
  author: string;
  kind: "human" | "agent";
  at: string; // ISO
  body: string;
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
export interface Task {
  id: string;
  title: string;
  ownerName?: string;
  due?: string;
  label?: string;
  status: TaskStatus;
  phaseKey?: string;
  source: "plan" | "manual";
  createdAt: string;
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
}

export interface ExternalMember {
  id: string;
  name: string;
  org: string;
  role: "client" | "contractor";
  access: "workspace" | "files-only" | "tasks-only";
  addedAt: string;
}

export interface ClientAccount {
  id: string;
  clientName: string;
  /** Internal AGP members on the account. */
  members: { personId: string; name: string; title: string }[];
  /** Clients + contractors (Contractor Access tab). Removal revokes instantly. */
  externals: ExternalMember[];
  clientContacts: number;
  campaigns: Campaign[];
  notifications: ClientNotification[];
  tasks: Task[];
  thread: ThreadMessage[];
  files: ClientFileLink[];
  docs: ClientFileLink[];
  activity: ActivityEvent[];
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
  promotedInitiativeId?: string;
  createdAt: string;
}
