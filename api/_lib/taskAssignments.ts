/**
 * Assignment-array logic for the server side of task.assignments (jsonb).
 * Ported from apps/tab/src/workspace/taskAssignments.ts's `reconcileAssignments`
 * and the hours-rounding rule `setAccountAssignmentHours` uses — not imported
 * across the boundary, because api/*.ts files are self-contained on purpose
 * (see api/mirror.ts's header): Vercel bundles each function independently of
 * the pnpm monorepo. Keep in sync with the client copy if either changes;
 * both are covered by tests (the client's in taskAssignments.test.ts, this
 * one through api/task-assignments.ts's own end-to-end HTTP tests).
 */

export interface TaskAssignment {
  name: string;
  role?: string;
  hours?: number;
  done?: boolean;
  primary?: boolean;
  order?: number;
}

/** Round to one decimal — hours are shown to a tenth, never sub-minute noise. */
export function roundHours(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Normalize an incoming set of assignee names into assignment rows,
 * preserving any edits already made (hours, done, primary, order) and
 * dropping people no longer on the task. New people arrive un-set (they'll
 * take the client's even-split default). The first person becomes primary
 * when none is marked yet.
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
