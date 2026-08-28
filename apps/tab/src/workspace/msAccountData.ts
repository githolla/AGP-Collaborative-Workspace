import { msApiGetPlain, msApiCallPlain } from "./msApiFetch.js";
import type { Task, TaskAssignment, Campaign } from "./types.js";
import type { ViewConfig } from "./roles.js";

/**
 * Reads the B3-B7 (teams-provisioning-plan.md) collab-schema data for one
 * account from `GET /api/workspace?accountId=` — msTeam ids, provisioned
 * folders, members, externals and grants. Plain Postgres reads, RLS-scoped
 * to the caller; no Graph token needed (msApiGetPlain), unlike everything in
 * msProvision.ts/msShare.ts/msFiles.ts, which mutate or read Graph directly.
 *
 * This is the one place the Admin tab (`ClientAdminPanel.tsx`, embedded in
 * `ClientWorkspace.tsx`) gets its data — every other screen still reads the
 * single JSON document at /api/state, an entirely separate account model
 * bridged only by matching `clientName`, never by a shared id.
 */

export interface MsAccountMsTeam {
  teamId: string | null;
  teamName: string | null;
  groupId: string | null;
  siteId: string | null;
  driveId: string | null;
  webUrl: string | null;
  provisionedAt: string | null;
}

export interface MsAccountFolder {
  id: string;
  kantataId: string;
  folderId: string;
  parentFolderId: string | null;
  name: string;
  level: "project" | "milestone" | "phase" | "task" | "folder";
}

export interface MsAccountMember {
  id: string;
  personId: string;
  name: string;
  title?: string;
  email?: string;
}

export interface MsAccountExternal {
  id: string;
  /** collab.app_user id — absent until they've signed in at least once AND
   * an admin has resolved their identity (POST /api/external PATCH). Only
   * externals WITH a userId can be granted anything (api/grant.ts's
   * access_grant.user_id is NOT NULL). */
  userId?: string;
  name: string;
  org: string;
  role: "client" | "contractor";
  email?: string;
  entraStatus: "none" | "invited" | "active";
  entraUserId?: string;
}

export interface MsAccountGrant {
  id: string;
  // Exactly one of userId/externalLinkId is ever null — a grant made
  // before the person signed in is targeted by externalLinkId alone until
  // "Resolve sign-in" backfills userId (api/external.ts).
  userId: string | null;
  externalLinkId: string | null;
  kantataId: string;
  level: "project" | "milestone" | "phase" | "task" | "folder";
  role: "read" | "write";
  msPermissionId: string | null;
}

/** `collab.task` — the JSON-document migration's foundation phase (see
 * docs/api-spec-workspace-mutations.md). Same table `api/external-workspace.ts`
 * reads for the external subtree, but the FULL internal row here
 * (assignments, dependsOn, hours, dates, folder link) rather than that
 * endpoint's deliberately-reduced external projection. `assignments` stays
 * an opaque jsonb blob server-side (no access decision reads inside it, per
 * 0007's own design note) — shape it precisely once a caller actually needs
 * to read/write individual assignment fields. */
export interface MsAccountTask {
  id: string;
  title: string;
  ownerName?: string;
  assignments: unknown;
  due?: string;
  label?: string;
  status: "todo" | "doing" | "done";
  phaseKey?: string;
  source: "plan" | "manual";
  clientVisible: boolean;
  contractorVisible: boolean;
  createdAt: string;
  completedAt?: string;
  kantataStoryId?: string;
  kantataProjectId?: string;
  projectLabel?: string;
  phaseLabel?: string;
  phaseId?: string;
  dependsOn: string[];
  kantataMilestoneId?: string;
  kantataSyncedAt?: string;
  estimatedHours?: number;
  startDate?: string;
  msFolderId?: string;
  updatedAt: string;
}

/** `collab.thread_message` — one internal discussion thread per account,
 * projected to client/contractor by the two visibility flags (same shape
 * `api/external-workspace.ts` reads, minus the audience filtering an
 * internal caller doesn't need). */
export interface MsAccountMessage {
  id: string;
  author: string;
  authorUserId?: string;
  kind: "human" | "agent";
  body: string;
  topic?: string;
  editedAt?: string;
  clientVisible: boolean;
  contractorVisible: boolean;
  kantataId?: string;
  kantataLevel?: "project" | "milestone" | "phase" | "task";
  createdAt: string;
  updatedAt: string;
}

/** `collab.campaign`. */
export interface MsAccountCampaign {
  id: string;
  name: string;
  status: "active" | "planned" | "complete";
  nextMilestone?: string;
  nextMilestoneDate?: string;
  source?: "kantata";
  kantataProjectId?: string;
  createdAt: string;
}

/** `collab.share` — the handover/audit record ("what was sent to whom,
 * when, opened when, revoked when"), never deleted, only stamped revoked. */
export interface MsAccountShare {
  id: string;
  personName: string;
  recipientUserId?: string;
  itemKind: "file" | "doc" | "task" | "folder";
  itemId: string;
  itemName: string;
  msItemId?: string;
  grantLevel?: "project" | "milestone" | "phase" | "task";
  sentAt: string;
  sentBy: string;
  openedAt?: string;
  openSource?: "workspace" | "sharepoint";
  revokedAt?: string;
  revokedBy?: string;
}

/** `collab.file_approval` — same shape `api/external-workspace.ts` returns
 * for the external's own decision view. */
export interface MsAccountFileApproval {
  id: string;
  msItemId: string;
  name: string;
  purpose: "fyi" | "approval";
  sharedAt: string;
  sharedBy: string;
  decision: "approved" | "changes" | null;
  decidedAt: string | null;
  decidedBy?: string;
  note: string | null;
  openedAt?: string;
}

export interface MsAccountData {
  id: string;
  clientName: string;
  archived: boolean;
  createdAt: string;
  msTeam: MsAccountMsTeam;
  kantataProjectIds: string[];
  scopedToProjects: boolean;
  /** Role-based view tiers (0026). Absent/`{}` = everyone sees every tab. */
  viewConfig?: ViewConfig;
}

/** `collab.activity` — the internal "what's new" feed (Home's WhatsNew
 * card), migrated off the old model's inline `activityEvent()` helper.
 * Never sent to an external caller (activity_read's RLS policy is
 * account_member-or-admin only). */
export interface MsAccountActivity {
  id: string;
  at: string;
  text: string;
  kind: "task" | "roi" | "team" | "workspace";
}

export interface WorkspaceAccountPayload {
  accounts: MsAccountData[];
  msFolders: MsAccountFolder[];
  members: MsAccountMember[];
  externals: MsAccountExternal[];
  grants: MsAccountGrant[];
  tasks: MsAccountTask[];
  thread: MsAccountMessage[];
  campaigns: MsAccountCampaign[];
  shares: MsAccountShare[];
  fileApprovals: MsAccountFileApproval[];
  activity: MsAccountActivity[];
}

export async function fetchAccountCollabData(accountId: string): Promise<WorkspaceAccountPayload> {
  return msApiGetPlain<WorkspaceAccountPayload>(`/api/workspace?accountId=${encodeURIComponent(accountId)}`);
}

export async function fetchAllAccounts(): Promise<{ accounts: MsAccountData[] }> {
  return msApiGetPlain<{ accounts: MsAccountData[] }>("/api/workspace");
}

/** Save the role-based view-tier config for an account (super-admin only in the
 * UI). Replaces the whole blob; server sanitizes to valid tiers. */
export async function setViewConfig(accountId: string, config: ViewConfig): Promise<{ accountId: string; viewConfig: ViewConfig }> {
  return msApiCallPlain<{ accountId: string; viewConfig: ViewConfig }>("/api/account-view-config", { body: { accountId, config } });
}

/** One open task the signed-in person carries, tagged with which client it's
 * on — for the cross-client "My Work" view. Structurally a Task subset (so
 * isOnPersonList/hoursForPerson work) plus accountId + clientName. */
export interface MyWorkTask {
  id: string;
  accountId: string;
  clientName: string;
  title: string;
  ownerName?: string;
  assignments?: TaskAssignment[];
  due?: string;
  status: "todo" | "doing" | "done";
  projectLabel?: string;
  phaseLabel?: string;
  estimatedHours?: number;
}

/** The signed-in person's open tasks across EVERY client workspace they're on,
 * name-matched and RLS-scoped server-side (GET /api/my-tasks). */
export async function fetchMyTasks(): Promise<{ userName: string; tasks: MyWorkTask[] }> {
  return msApiGetPlain<{ userName: string; tasks: MyWorkTask[] }>("/api/my-tasks");
}

/** One person's cross-client weekly workload vs capacity (the Team Load view). */
export interface PersonLoad {
  name: string;
  capacity: number;
  /** hours keyed by Monday ISO, only for weeks in the window. */
  weekly: Record<string, number>;
  total: number;
  peak: number;
  overWeeks: number;
}

export interface TeamLoadData {
  weeks: string[];
  defaultCapacity: number;
  people: PersonLoad[];
}

/** Cross-client resourcing: everyone's weekly load vs capacity, next 12 weeks,
 * across every account the caller can see (GET /api/team-load). */
export async function fetchTeamLoad(): Promise<TeamLoadData> {
  return msApiGetPlain<TeamLoadData>("/api/team-load");
}

/** Set a person's weekly capacity (hours). App-admin only, enforced server-side. */
export async function setPersonCapacity(name: string, weeklyHours: number): Promise<{ name: string; weeklyHours: number }> {
  return msApiCallPlain<{ name: string; weeklyHours: number }>("/api/person-capacity", { body: { name, weeklyHours } });
}

/** Bridges the OLD single-JSON-document account model to this NEW
 * `collab.client_account` one, by matching `clientName` case-insensitively —
 * the only usable join, since the two account universes have entirely
 * unrelated ids (same pattern `ClientAdminTab`/`ClientWorkspace`'s discussion
 * thread already use). Returns `null` for both "genuinely doesn't exist yet"
 * and "ambiguous, more than one match" — deliberately not distinguished here,
 * since either way there is no single safe account to act on; a caller that
 * needs to tell those apart (to offer a Create action, say) should call
 * `fetchAllAccounts` itself instead of this convenience wrapper. */
export async function resolveAccountIdByName(clientName: string): Promise<string | null> {
  const { accounts } = await fetchAllAccounts();
  const matches = accounts.filter((a) => a.clientName.toLowerCase() === clientName.toLowerCase());
  return matches.length === 1 ? matches[0]!.id : null;
}

/** `MsAccountTask` (the collab.task row) → the OLD `Task` shape, so every
 * consumer that already reads a `Task` (TasksCard, TaskDetail, the Kantata
 * write-back queue, the live-mirror enrichment pass) keeps working unchanged
 * once its data source moves to Postgres — a pure field rename/reshape, not
 * a behavior change. `assignments` is cast, not reshaped: the server only
 * ever writes it in `TaskAssignment[]` shape (task-assignments.ts), jsonb is
 * just untyped on the way back. */
export function toOldTask(t: MsAccountTask): Task {
  return {
    id: t.id,
    title: t.title,
    ...(t.ownerName ? { ownerName: t.ownerName } : {}),
    ...(Array.isArray(t.assignments) && t.assignments.length > 0 ? { assignments: t.assignments as TaskAssignment[] } : {}),
    ...(t.due ? { due: t.due } : {}),
    ...(t.label ? { label: t.label } : {}),
    status: t.status,
    ...(t.phaseKey ? { phaseKey: t.phaseKey } : {}),
    source: t.source,
    clientVisible: t.clientVisible,
    contractorVisible: t.contractorVisible,
    createdAt: t.createdAt,
    ...(t.completedAt ? { completedAt: t.completedAt } : {}),
    ...(t.kantataStoryId ? { kantataStoryId: t.kantataStoryId } : {}),
    ...(t.kantataProjectId ? { kantataProjectId: t.kantataProjectId } : {}),
    ...(t.projectLabel ? { projectLabel: t.projectLabel } : {}),
    ...(t.phaseLabel ? { phaseLabel: t.phaseLabel } : {}),
    ...(t.phaseId ? { phaseId: t.phaseId } : {}),
    ...(t.dependsOn.length > 0 ? { dependsOn: t.dependsOn } : {}),
    ...(t.kantataMilestoneId ? { kantataMilestoneId: t.kantataMilestoneId } : {}),
    ...(t.kantataSyncedAt ? { kantataSyncedAt: t.kantataSyncedAt } : {}),
    ...(t.estimatedHours != null ? { estimatedHours: t.estimatedHours } : {}),
    ...(t.startDate ? { startDate: t.startDate } : {}),
    ...(t.msFolderId ? { msFolderId: t.msFolderId } : {}),
  };
}

/** Same idea as `toOldTask`, for `collab.campaign` → the OLD `Campaign` shape. */
export function toOldCampaign(c: MsAccountCampaign): Campaign {
  return {
    id: c.id,
    name: c.name,
    status: c.status,
    ...(c.nextMilestone ? { nextMilestone: c.nextMilestone } : {}),
    ...(c.nextMilestoneDate ? { nextMilestoneDate: c.nextMilestoneDate } : {}),
    ...(c.source ? { source: c.source } : {}),
    ...(c.kantataProjectId ? { kantataProjectId: c.kantataProjectId } : {}),
  };
}

export interface ProvisioningPlanNode {
  kantataId: string;
  title: string;
  level: "project" | "milestone" | "phase" | "task";
  parentKantataId?: string;
  hasFolder: boolean;
}

/** B4 §7's confirmed preview, and the milestone picker's own list (§5) — one
 * read of the full desired folder tree, server-computed from the Kantata
 * mirror (api/account-provisioning-plan.ts), no Graph token needed. */
export async function fetchProvisioningPlan(accountId: string): Promise<{ tree: ProvisioningPlanNode[] }> {
  return msApiGetPlain<{ tree: ProvisioningPlanNode[] }>(`/api/account-provisioning-plan?accountId=${encodeURIComponent(accountId)}`);
}
