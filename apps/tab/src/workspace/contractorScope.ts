import type { ClientAccount, ClientFileLink, Task, ThreadMessage } from "./types.js";

/**
 * The contractor's scoped view (spec 5.5) as pure selectors — the single
 * definition of WHAT a contractor is allowed to see, shared by the in-app
 * Contractor View preview and (later) the real per-contractor surface + Part B
 * permission provisioning. Keeping these pure keeps the projection testable and
 * keeps "never leak budgets/costs/internal chatter" a property we can assert.
 */

/** Tasks on the contractor's plan — "here are your due dates" (spec 5.3/5.5),
 * never the full internal plan. */
export function contractorTasks(tasks: readonly Task[]): Task[] {
  return tasks.filter((t) => t.contractorVisible);
}

/** Files + docs a contractor has been granted (spec 5.5 "My files"). */
export function contractorFiles(account: Pick<ClientAccount, "files" | "docs">): ClientFileLink[] {
  return [...account.files, ...account.docs].filter((f) => f.contractorAccessible);
}

/** The specific files a contractor may UPLOAD into — the "drop finished
 * copy/design here" folders. A subset of contractorFiles. */
export function contractorUploadTargets(account: Pick<ClientAccount, "files" | "docs">): ClientFileLink[] {
  return contractorFiles(account).filter((f) => f.contractorWritable);
}

/**
 * The contractor-visible slice of the discussion (spec 5.4). Flow-back rule:
 * these messages are NOT moved out of the internal thread — this is a filtered
 * projection over the single canonical thread, so the full internal history is
 * always preserved while the contractor sees only their part.
 */
export function contractorMessages(thread: readonly ThreadMessage[]): ThreadMessage[] {
  return thread.filter((m) => m.contractorVisible);
}
