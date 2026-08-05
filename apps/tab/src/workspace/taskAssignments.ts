/**
 * Task-assignment logic — Cara's task-card vision, made concrete and testable.
 *
 * The problem it solves (straight from the call):
 *  - a task routinely has 4-5 people on it, but only some do the work;
 *  - Kantata marks a task complete for EVERYONE the moment one person clicks
 *    done, so people hesitate to mark anything;
 *  - a resource's task list is meaningless because it lists every task they're
 *    merely CC'd on, not the ones they actually owe hours to.
 *
 * So here: split the hours across the people (an even split is the default the
 * PM tunes — the "AI default" step; budget-weighting comes later), name ONE
 * primary owner, set a handoff order, and let each person mark THEIR OWN part
 * done. The task is done only when everyone is. Someone with no hours isn't
 * really on the hook — their view can hide it.
 *
 * Pure + finance-free (hours and names only, never rates): safe on the client
 * import graph, shared by the store, the resourcing engine, and the UI.
 */
import type { Task, TaskAssignment } from "./types.js";

/** Round to one decimal — hours are shown to a tenth, never sub-minute noise. */
const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * The effective hours for each assignment: the explicit value when the PM set
 * one, otherwise an even split of the task's remaining hours across the people
 * who haven't been given an explicit number. This is the default allocation —
 * deterministic and obvious — that the PM edits from.
 *
 * Example: task = 12h, three people, none edited → 4h each. Edit one to 6h →
 * the other two split the remaining 6h → 3h each.
 */
export function effectiveHours(task: Pick<Task, "assignments" | "estimatedHours">): Map<string, number> {
  const out = new Map<string, number>();
  const people = task.assignments ?? [];
  if (people.length === 0) return out;
  const total = task.estimatedHours ?? 0;
  const explicit = people.filter((a) => typeof a.hours === "number");
  const explicitSum = explicit.reduce((s, a) => s + (a.hours ?? 0), 0);
  const rest = people.filter((a) => typeof a.hours !== "number");
  // What's left to spread across the un-set people (never negative).
  const remaining = Math.max(0, total - explicitSum);
  const perRest = rest.length > 0 ? remaining / rest.length : 0;
  for (const a of people) {
    out.set(a.name, round1(typeof a.hours === "number" ? a.hours : perRest));
  }
  return out;
}

/** This person's effective hours on the task (0 if they're not on it). */
export function hoursForPerson(task: Pick<Task, "assignments" | "estimatedHours">, name: string): number {
  return effectiveHours(task).get(name) ?? 0;
}

/** The primary owner's name — the explicit primary, else the first assignee,
 * else the legacy single ownerName. Drives whose list the task headlines. */
export function primaryOwner(task: Pick<Task, "assignments" | "ownerName">): string | undefined {
  const people = task.assignments ?? [];
  return people.find((a) => a.primary)?.name ?? people[0]?.name ?? task.ownerName;
}

/**
 * Whether a task belongs in THIS person's working list. With assignments, a
 * person is on the hook only if they have hours (or are the primary owner) —
 * so a task you're merely informed on doesn't clutter your list. Without
 * assignments, the legacy single-owner rule stands.
 */
export function isOnPersonList(task: Pick<Task, "assignments" | "ownerName" | "estimatedHours">, name: string): boolean {
  const people = task.assignments ?? [];
  if (people.length === 0) return !!task.ownerName && task.ownerName === name;
  const mine = people.find((a) => a.name === name);
  if (!mine) return false;
  return mine.primary === true || hoursForPerson(task, name) > 0;
}

/** Whether this specific person has finished their part. */
export function personDone(task: Pick<Task, "assignments">, name: string): boolean {
  return (task.assignments ?? []).find((a) => a.name === name)?.done === true;
}

/**
 * Is the WHOLE task complete? Only when everyone on it is done — that's the
 * point: one person clicking done no longer completes it for the rest. A task
 * with no assignments falls back to its own status being "done".
 */
export function allAssignmentsDone(task: Pick<Task, "assignments" | "status">): boolean {
  const people = task.assignments ?? [];
  if (people.length === 0) return task.status === "done";
  return people.every((a) => a.done === true);
}

/** "2 of 4 done" — the honest progress line for a multi-person task. */
export function assignmentProgress(task: Pick<Task, "assignments">): { done: number; total: number } {
  const people = task.assignments ?? [];
  return { done: people.filter((a) => a.done === true).length, total: people.length };
}

/**
 * Toggle ONE person's done state and return the new assignments plus the status
 * the task should now carry. Marking the last person done completes the task;
 * un-checking anyone re-opens it to "doing" (work is back in flight). This is
 * the store's single source of truth for per-person completion.
 */
export function applyPersonDone(
  task: Pick<Task, "assignments" | "status">,
  name: string,
  done: boolean,
): { assignments: TaskAssignment[]; status: Task["status"] } {
  const people = (task.assignments ?? []).map((a) => (a.name === name ? { ...a, done } : a));
  const status: Task["status"] = people.length === 0 ? task.status : people.every((a) => a.done) ? "done" : "doing";
  return { assignments: people, status };
}

/**
 * The handoff path — Cara's "who starts, who it passes to, who marks it done".
 * Assignments in `order` (1 starts, ascending), falling back to array order for
 * any without one. This is the sequence the work moves through.
 */
export function handoffSequence(task: Pick<Task, "assignments">): TaskAssignment[] {
  const people = [...(task.assignments ?? [])];
  return people
    .map((a, i) => ({ a, i, order: typeof a.order === "number" ? a.order : i + 1 }))
    .sort((x, y) => x.order - y.order || x.i - y.i)
    .map((x) => x.a);
}

/**
 * Whose turn it is: the first person in the handoff sequence who hasn't marked
 * their part done. Undefined when everyone is done (the task is complete).
 */
export function currentHandoffStep(task: Pick<Task, "assignments">): TaskAssignment | undefined {
  return handoffSequence(task).find((a) => a.done !== true);
}

/**
 * Reorder the handoff: given the names in the new sequence, return assignments
 * with `order` set 1..n to match, preserving every other field.
 */
export function applyHandoffOrder(existing: readonly TaskAssignment[], orderedNames: readonly string[]): TaskAssignment[] {
  const rank = new Map(orderedNames.map((n, i) => [n, i + 1]));
  return existing.map((a) => ({ ...a, order: rank.get(a.name) ?? a.order ?? orderedNames.length + 1 }));
}

/**
 * Which of a task's dependencies are still open — the tasks it's WAITING on.
 * A task is blocked while any of these aren't done. Missing ids (a dependency
 * that was deleted) are ignored rather than treated as permanently blocking.
 */
export function blockingDeps(
  task: Pick<Task, "dependsOn">,
  byId: (id: string) => { title: string; status: string } | undefined,
): { id: string; title: string }[] {
  const out: { id: string; title: string }[] = [];
  for (const id of task.dependsOn ?? []) {
    const dep = byId(id);
    if (dep && dep.status !== "done") out.push({ id, title: dep.title });
  }
  return out;
}

/** A task is blocked when it's still waiting on at least one dependency. */
export function isBlocked(
  task: Pick<Task, "dependsOn">,
  byId: (id: string) => { title: string; status: string } | undefined,
): boolean {
  return blockingDeps(task, byId).length > 0;
}

/**
 * Normalize an incoming set of assignee names into assignment rows, preserving
 * any edits already made (hours, done, primary, order) and dropping people no
 * longer on the task. New people arrive un-set (they'll take the even-split
 * default). The first person becomes primary when none is marked yet.
 */
export function reconcileAssignments(existing: readonly TaskAssignment[], names: readonly string[]): TaskAssignment[] {
  const byName = new Map(existing.map((a) => [a.name, a]));
  const rows = names.map((name, i) => {
    const prev = byName.get(name);
    return prev ? { ...prev } : { name, order: i + 1 };
  });
  if (rows.length > 0 && !rows.some((a) => a.primary)) rows[0]!.primary = true;
  return rows;
}
