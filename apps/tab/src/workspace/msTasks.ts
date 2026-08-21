import { msApiCallPlain } from "./msApiFetch.js";

/**
 * Client-side actions for `collab.task` (docs/api-spec-workspace-mutations.md
 * "Tasks" + "Kantata import") — the migration off `/api/state`'s
 * `account.tasks` JSON array. Plain Postgres writes, no Graph token
 * (msApiCallPlain), same as msPeople.ts/msMessages.ts.
 */

/** What `api/task.ts`'s `toApi()` actually returns on create/update — a
 * DELIBERATELY smaller shape than `MsAccountTask` (msAccountData.ts): no
 * `assignments` (never selected by either RETURNING clause) and `dependsOn`
 * only present when non-empty. Reusing `MsAccountTask` here would promise a
 * shape the server never sends — every caller today reloads the full
 * account via `GET /api/workspace` anyway rather than reading this value
 * directly, so this only matters for whoever reaches for it next. */
export interface TaskWriteResult {
  id: string;
  accountId: string;
  title: string;
  ownerName?: string;
  status: "todo" | "doing" | "done";
  due?: string;
  label?: string;
  estimatedHours?: number;
  startDate?: string;
  dependsOn?: string[];
  clientVisible: boolean;
  contractorVisible: boolean;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export async function createTask(accountId: string, title: string, ownerName?: string, due?: string, label?: string): Promise<TaskWriteResult> {
  return msApiCallPlain<TaskWriteResult>("/api/task", { body: { accountId, title, ...(ownerName ? { ownerName } : {}), ...(due ? { due } : {}), ...(label ? { label } : {}) } });
}

/** The initiative->task bridge's copy-at-share-time write (docs/api-spec-workspace-mutations.md
 * "the one place the two stores meet") — a real collab.task row for a build/
 * initiative task just flagged client-visible, stamped with its origin so
 * re-flagging the same one twice is idempotent, not a duplicate. */
export async function copyInitiativeTask(
  accountId: string,
  originInitiativeId: string,
  originTaskId: string,
  title: string,
  ownerName?: string,
  due?: string,
  label?: string,
): Promise<TaskWriteResult> {
  return msApiCallPlain<TaskWriteResult>("/api/task", {
    body: { accountId, title, originInitiativeId, originTaskId, ...(ownerName ? { ownerName } : {}), ...(due ? { due } : {}), ...(label ? { label } : {}) },
  });
}

export interface TaskPatch {
  status?: "todo" | "doing" | "done";
  /** `undefined` = leave unchanged, `null` = clear, a string = set. */
  due?: string | null;
  estimatedHours?: number | null;
  startDate?: string | null;
  dependsOn?: string[];
  clientVisible?: boolean;
  contractorVisible?: boolean;
}

/** `expectedUpdatedAt` is the task's own current `updatedAt` — api/task.ts's
 * optimistic-concurrency guard (the same "two people editing at once is
 * real" rule as messages). A conflict throws; the caller reloads and retries
 * rather than getting a silent, possibly-stale write. */
export async function updateTask(taskId: string, patch: TaskPatch, expectedUpdatedAt: string): Promise<TaskWriteResult> {
  return msApiCallPlain<TaskWriteResult>("/api/task", { method: "PATCH", body: { taskId, ...patch, expectedUpdatedAt } });
}

export interface AssignmentsResult {
  id: string;
  assignments: unknown;
  status: "todo" | "doing" | "done";
  completedAt?: string;
  updatedAt: string;
}

export async function setTaskAssignments(taskId: string, names: string[]): Promise<AssignmentsResult> {
  return msApiCallPlain<AssignmentsResult>("/api/task-assignments", { method: "PUT", body: { taskId, names } });
}

export interface AssignmentPatch {
  /** `undefined` = leave unchanged, `null` = clear back to even-split default. */
  hours?: number | null;
  done?: boolean;
  primary?: boolean;
  order?: number;
}

export async function patchAssignment(taskId: string, name: string, patch: AssignmentPatch): Promise<AssignmentsResult> {
  return msApiCallPlain<AssignmentsResult>("/api/task-assignments", { method: "PATCH", body: { taskId, name, ...patch } });
}

/** `api/task-assignments.ts`'s PATCH is genuinely per-assignment (one
 * person's `order` at a time) — no batch-reorder endpoint exists, so a full
 * re-ranked handoff list becomes N sequential calls, one per person, each
 * setting that person's new index. Sequential, not `Promise.all`: the
 * server's whole-task read-modify-write per call means concurrent requests
 * for the SAME task risk one overwriting another's `assignments` write. */
export async function setAssignmentOrder(taskId: string, orderedNames: string[]): Promise<void> {
  for (let i = 0; i < orderedNames.length; i += 1) {
    await patchAssignment(taskId, orderedNames[i]!, { order: i });
  }
}

export interface ApplyTemplateResult {
  added: number;
  tasks: { id: string; title: string; due?: string; label?: string }[];
}

export async function applyTemplate(accountId: string, templateKey: string, startDate: string): Promise<ApplyTemplateResult> {
  return msApiCallPlain<ApplyTemplateResult>("/api/template", { body: { accountId, templateKey, startDate } });
}

export async function markTasksSynced(accountId: string, applied: { ref: string; createdId?: string }[]): Promise<{ updated: number }> {
  return msApiCallPlain<{ updated: number }>("/api/account-tasks-synced", { body: { accountId, applied } });
}

export interface ImportSelection {
  campaignProjectIds?: string[];
  taskStoryIds?: string[];
}

export interface ImportResult {
  campaignsAdded: number;
  campaignsUpdated: number;
  tasksAdded: number;
  note?: string;
}

/** No `selected` — import everything found for `scope`. With `selected` —
 * the review panel's "confirm these specific ones" (api/account-import.ts
 * re-pulls fresh live data and filters to just what was picked, rather than
 * trusting client-cached candidate fields). */
export async function importFromKantata(accountId: string, scope: "all" | "campaigns" | "tasks", selected?: ImportSelection): Promise<ImportResult> {
  return msApiCallPlain<ImportResult>("/api/account-import", { body: { accountId, scope, ...(selected ? { selected } : {}) } });
}

export async function removeCampaign(accountId: string, campaignId: string): Promise<{ id: string }> {
  return msApiCallPlain<{ id: string }>("/api/account-campaigns", { method: "DELETE", body: { accountId, campaignId } });
}

export async function clearCampaigns(accountId: string): Promise<{ removed: number }> {
  return msApiCallPlain<{ removed: number }>("/api/account-campaigns", { method: "DELETE", body: { accountId } });
}

/** `PUT /api/account-scope` — replaces `setProjectScope`. REPLACES
 * `kantataProjectIds`/`scoped` wholesale (unlike `linkKantataProjects`'s
 * union-only link in msPeople.ts) and drops any Kantata-sourced campaign
 * that fell outside the new scope, then re-imports within it — same
 * `ImportResult` shape as `importFromKantata` since it ends in the same
 * re-import step. */
export async function setAccountScope(accountId: string, kantataProjectIds: string[], scoped: boolean): Promise<ImportResult> {
  return msApiCallPlain<ImportResult>("/api/account-scope", { method: "PUT", body: { accountId, kantataProjectIds, scoped } });
}
