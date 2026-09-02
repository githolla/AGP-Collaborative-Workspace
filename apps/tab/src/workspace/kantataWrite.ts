/**
 * Kantata write-back — the browser half.
 *
 * Reads are automatic; WRITES ARE REVIEWED. This module never sends anything
 * on its own. It compares what the workspace holds against what Kantata last
 * told us, and produces a list of proposed changes for a person to approve —
 * the same review gate the task IMPORT uses, for the same reason: Kantata is
 * AGP's system of record for capacity, and a background sync that quietly
 * rewrites it is not something anyone can audit.
 *
 * Approved changes are posted to /api/kantata-write, which holds the token and
 * is itself dry-run by default (see that file). So a write reaches Kantata only
 * when three things are true: someone ticked it, the endpoint is enabled, and
 * the intent passed server-side validation.
 *
 * The intent shapes here mirror api/kantata-write.ts. They are duplicated
 * rather than shared because /api is bundled independently of the monorepo —
 * the same arrangement liveMirror.ts has with api/mirror.ts.
 */
import { apiFetch } from "../auth/apiFetch.js";
import type { LiveProject } from "./campaignImport.js";
import { taskColumn, taskIsDone } from "./campaignImport.js";
import type { MirrorStaff } from "./agpKnowledge.js";
import type { Task, TaskStatus } from "./types.js";

export interface StoryUpdateIntent {
  kind: "story.update";
  ref: string;
  storyId: string;
  title?: string;
  dueDate?: string | null;
  state?: string;
  percent?: number;
  assigneeIds?: string[];
}

export interface StoryCreateIntent {
  kind: "story.create";
  ref: string;
  projectId: string;
  title: string;
  dueDate?: string;
  state?: string;
  assigneeIds?: string[];
}

export interface AllocationSetIntent {
  kind: "allocation.set";
  ref: string;
  projectId: string;
  userId: string;
  startDate: string;
  endDate: string;
  hours: number;
}

export type WriteIntent = StoryUpdateIntent | StoryCreateIntent | AllocationSetIntent;

/** One proposed change, ready to show a person before it is sent. */
export interface PendingWrite {
  ref: string;
  /** Which task this is about, in the words the workspace uses. */
  taskTitle: string;
  /** The Kantata project it lands in. */
  project: string;
  /** Human summary of the change — "Due date · 15 Aug → 22 Aug". */
  changes: { field: string; from: string; to: string }[];
  intent: WriteIntent;
  /**
   * True when sending this would UNDO Kantata's own record — pulling a due date
   * earlier than Kantata's. These are almost always workspace state that drifted
   * behind Kantata rather than a real edit, so the UI flags them, leaves them
   * unchecked, and excludes them from "select all". Reopening a Kantata-completed
   * task is suppressed entirely below, never even listed.
   */
  reverts?: boolean;
}

export interface WriteResult {
  ref: string;
  kind: string;
  ok: boolean;
  planned: boolean;
  createdId?: string;
  error?: string;
  call?: { method: string; path: string; body: Record<string, unknown> };
}

export interface WriteResponse {
  dryRun: boolean;
  reason?: string;
  applied: number;
  failed: number;
  by?: string;
  at?: string;
  results: WriteResult[];
}

/** Workspace column → the Kantata state we write for it. */
export const kantataStateFor = (status: TaskStatus): string =>
  status === "done" ? "completed" : status === "doing" ? "started" : "not started";

/**
 * True when the workspace column and the Kantata state already agree.
 *
 * Deliberately loose in one direction: Kantata's "accepted" and "closed" both
 * read as done here, so marking a task done in the workspace when Kantata
 * already has it accepted produces NO write. Writing "completed" over
 * "accepted" would be a downgrade of the client's own record.
 */
export const statusMatches = (status: TaskStatus, kantataState: string): boolean =>
  status === "done" ? taskIsDone(kantataState) : !taskIsDone(kantataState) && taskColumn(kantataState) === status;

/** Names differ in punctuation and case across systems; ids do not. */
const normName = (n: string): string => n.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Kantata user id for an owner name. Returns undefined when the name doesn't
 * resolve — an unresolvable owner produces no assignee write rather than a
 * guess, because assigning the wrong person is worse than assigning nobody.
 */
export function resolveStaffId(ownerName: string | undefined, staff: readonly MirrorStaff[]): string | undefined {
  const want = normName(ownerName ?? "");
  if (!want) return undefined;
  const exact = staff.filter((s) => normName(s.name) === want);
  // Two people with the same name is exactly the case where a guess is wrong.
  if (exact.length === 1) return exact[0]?.id;
  if (exact.length > 1) return undefined;
  const byEmail = staff.filter((s) => normName(s.email.split("@")[0] ?? "") === want);
  return byEmail.length === 1 ? byEmail[0]?.id : undefined;
}

const dateLabel = (iso: string | undefined): string => (iso ? iso : "—");
const statusLabel = (s: TaskStatus): string => (s === "done" ? "Complete" : s === "doing" ? "In progress" : "To do");

/**
 * Compare the workspace's tasks against the live Kantata mirror and return the
 * changes that would bring Kantata into line.
 *
 * Only tasks carrying a `kantataStoryId` are considered — those are the ones
 * that came FROM Kantata and can be written back by id. A task typed straight
 * into the workspace has no story to update; creating one is a separate,
 * explicit action (`createIntentFor`), never inferred here.
 */
export function pendingWrites(
  tasks: readonly Task[],
  projects: readonly LiveProject[],
  staff: readonly MirrorStaff[],
): PendingWrite[] {
  const live = new Map<string, { task: LiveProject["tasks"][number]; project: LiveProject }>();
  for (const p of projects) for (const t of p.tasks) live.set(t.id, { task: t, project: p });

  const out: PendingWrite[] = [];
  for (const task of tasks) {
    if (!task.kantataStoryId) continue;
    const found = live.get(task.kantataStoryId);
    // The story is gone from the mirror (deleted in Kantata, or outside the
    // current scope). Writing to it blind would resurrect deleted work.
    if (!found) continue;

    const changes: PendingWrite["changes"] = [];
    const intent: StoryUpdateIntent = { kind: "story.update", ref: task.id, storyId: task.kantataStoryId };
    let reverts = false;

    if (!statusMatches(task.status, found.task.state)) {
      // NEVER propose reopening a task Kantata has already completed. The import
      // skips done tasks, so a stored "open" task Kantata now shows complete is
      // stale drift (Kantata finished it after import) — not a real reopen. Push
      // it and we'd revert the system of record (Kellie's fear). Suppress it
      // entirely; a genuine reopen is a separate, deliberate flow.
      const staleReopen = taskIsDone(found.task.state) && task.status !== "done";
      if (!staleReopen) {
        intent.state = kantataStateFor(task.status);
        // Kantata's own progress number should agree with a completed task;
        // anything else is left alone, since percent is edited in Kantata.
        if (task.status === "done") intent.percent = 100;
        changes.push({ field: "Status", from: found.task.state || "—", to: statusLabel(task.status) });
      }
    }

    const liveDue = found.task.dueDate ?? "";
    const ourDue = task.due ?? "";
    if (ourDue !== liveDue) {
      intent.dueDate = ourDue ? ourDue : null;
      changes.push({ field: "Due date", from: dateLabel(found.task.dueDate), to: dateLabel(task.due) });
      // Pulling a due date EARLIER than Kantata's is the drift case that undoes
      // Kantata's schedule — flag it so the UI keeps it unchecked and out of
      // "select all". A push to a LATER date is a normal forward edit.
      if (liveDue && ourDue && ourDue < liveDue) reverts = true;
    }

    if (task.ownerName) {
      const already = (found.task.assignees ?? []).some((a: string) => normName(a) === normName(task.ownerName ?? ""));
      const id = resolveStaffId(task.ownerName, staff);
      // No id means the owner isn't an AGP Kantata user (a client contact, a
      // contractor without a seat). Their name stays in the workspace; Kantata
      // simply isn't told, which is correct — it can only hold real users.
      if (!already && id) {
        intent.assigneeIds = [id];
        changes.push({ field: "Owner", from: (found.task.assignees ?? []).join(", ") || "unassigned", to: task.ownerName });
      }
    }

    if (changes.length > 0) {
      out.push({ ref: task.id, taskTitle: task.title, project: found.project.title, changes, intent, ...(reverts ? { reverts: true } : {}) });
    }
  }
  return out;
}

/**
 * Build the intent that creates a workspace-only task in Kantata. Separate
 * from pendingWrites on purpose: this ADDS work to the client's plan, so it
 * needs a person to choose the target project, not a heuristic.
 */
export function createIntentFor(task: Task, projectId: string, staff: readonly MirrorStaff[]): StoryCreateIntent {
  const assigneeId = resolveStaffId(task.ownerName, staff);
  return {
    kind: "story.create",
    ref: task.id,
    projectId,
    title: task.title,
    state: kantataStateFor(task.status),
    ...(task.due ? { dueDate: task.due } : {}),
    ...(assigneeId ? { assigneeIds: [assigneeId] } : {}),
  };
}

/** Monday…Sunday of the week containing `iso`, which is how Kantata books. */
export function weekBounds(iso: string): { startDate: string; endDate: string } {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDay(); // 0 = Sunday
  const back = day === 0 ? 6 : day - 1;
  const monday = new Date(d.getTime() - back * 86_400_000);
  const sunday = new Date(monday.getTime() + 6 * 86_400_000);
  return { startDate: monday.toISOString().slice(0, 10), endDate: sunday.toISOString().slice(0, 10) };
}

/**
 * Reserve hours for one person on one project for the week containing `date`.
 * This is the row Cara's capacity question actually turns on: the plan in the
 * workspace becomes a booking the resource planner can see.
 */
export function allocationIntent(args: {
  ref: string;
  projectId: string;
  userId: string;
  date: string;
  hours: number;
}): AllocationSetIntent {
  const { startDate, endDate } = weekBounds(args.date);
  return {
    kind: "allocation.set",
    ref: args.ref,
    projectId: args.projectId,
    userId: args.userId,
    startDate,
    endDate,
    hours: args.hours,
  };
}

/**
 * Send approved intents. `dryRun` asks the server to validate and describe the
 * calls without making them — what the review panel uses for its preview, and
 * what the endpoint falls back to whenever writes aren't switched on.
 */
export async function pushIntents(
  intents: readonly WriteIntent[],
  opts: { dryRun?: boolean } = {},
): Promise<WriteResponse> {
  const res = await apiFetch("/api/kantata-write", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intents, ...(opts.dryRun ? { dryRun: true } : {}) }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`kantata-write ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
  return (await res.json()) as WriteResponse;
}
