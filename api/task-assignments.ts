/**
 * PUT /api/task-assignments, PATCH /api/task-assignments — the spec's
 * `PUT /api/task/:taskId/assignments` and `PATCH /api/task/:taskId/assignment/:name`
 * (docs/api-spec-workspace-mutations.md). Own file rather than folded into
 * api/task.ts: the two verbs act on the assignments array specifically, and
 * flat/method-dispatched/ids-in-body is this repo's established convention
 * (api/account.ts, api/task.ts) — `taskId` and, for PATCH, `name` both travel
 * in the body instead of the path.
 *
 * `order` here is a direct per-person field set (PATCH takes one integer for
 * the one person named in the request), NOT the client's current
 * `setAccountAssignmentOrder`/`applyHandoffOrder`, which takes a full
 * re-ranked name list and renumbers everyone at once. The spec's endpoint
 * shape is genuinely per-assignment (`/assignment/:name`), so that's what
 * this implements; store.ts's batch reorder will need to become N calls (or
 * its own follow-up endpoint) when it's wired to this API — not a gap here,
 * a difference in shape worth remembering when that wiring happens.
 *
 * No `expectedUpdatedAt` on either verb — the spec's concurrency rule reserves
 * that for task edits and thread message edits specifically; assignment
 * fields are last-write-wins like every other narrow field write.
 *
 * RETURNING is safe on both: task_update's policy is account_member-or-admin,
 * a subset of what task_read (also account_member-or-admin, or a matching
 * external grant) allows — same no-bootstrap-gap reasoning as api/task.ts.
 */

import type postgres from "postgres";
import { requireUser } from "./_lib/requireUser.js";
import { withUserContext } from "./_lib/db.js";
import { toApiError } from "./_lib/apiError.js";
import { logActivity } from "./_lib/activity.js";
import { reconcileAssignments, roundHours, type TaskAssignment } from "./_lib/taskAssignments.js";

interface TaskRow {
  id: string;
  account_id: string;
  title: string;
  assignments: TaskAssignment[];
  status: string;
  completed_at: string | null;
  updated_at: string;
}

function toApi(t: TaskRow) {
  return {
    id: t.id,
    assignments: t.assignments,
    status: t.status,
    ...(t.completed_at ? { completedAt: t.completed_at } : {}),
    updatedAt: t.updated_at,
  };
}

async function handlePut(
  body: unknown,
  userId: string,
  res: { status: (code: number) => { json: (body: unknown) => void } },
): Promise<void> {
  const b = body as { taskId?: unknown; names?: unknown };
  const taskId = typeof b.taskId === "string" ? b.taskId : "";
  const names = Array.isArray(b.names) ? b.names.filter((n): n is string => typeof n === "string") : null;
  if (!taskId || !names) {
    res.status(400).json({ error: { code: "validation_failed", message: "taskId and names (string[]) are required" } });
    return;
  }
  const uniqueNames = [...new Set(names)];

  try {
    const result = await withUserContext(userId, async (tx) => {
      const [current] = await tx<{ assignments: TaskAssignment[] }[]>`
        select assignments from collab.task where id = ${taskId}
      `;
      // task_read's policy denies silently — a missing row means either the
      // id is wrong or the caller cannot see it, collapsed into not_found
      // like every other endpoint's write-miss path.
      if (!current) return { kind: "not_found" as const };

      const next = reconcileAssignments(current.assignments ?? [], uniqueNames);
      // sql.json(), not a pre-stringified string cast to ::jsonb — passing
      // an already-JSON.stringify'd string through a plain parameter with an
      // adjacent ::jsonb cast double-encodes it (Postgres ends up storing a
      // JSON STRING SCALAR containing the array's text, not the array
      // itself). sql.json() binds the value with the jsonb type OID (3802)
      // directly, which is the driver's actual serialization path for it.
      // The cast is just satisfying JSONValue's structural (index-signature)
      // shape check, which a named interface like TaskAssignment never
      // matches even though every value in it plainly is JSON-safe — same
      // category as db.ts's own narrow, documented driver-typing cast.
      const [updated] = await tx<TaskRow[]>`
        update collab.task
        set assignments = ${tx.json(next as unknown as postgres.JSONValue)}
        where id = ${taskId}
        returning id, account_id, title, assignments, status, completed_at, updated_at
      `;
      if (!updated) return { kind: "not_found" as const };
      if (uniqueNames.length > 0) await logActivity(tx, updated.account_id, `Team set on "${updated.title}" — ${uniqueNames.join(", ")}`, "task");
      return { kind: "ok" as const, updated };
    });

    if (result.kind === "not_found") {
      res.status(404).json({ error: { code: "not_found", message: "task not found" } });
      return;
    }
    res.status(200).json({ data: toApi(result.updated) });
  } catch (err) {
    const { status, body: errBody } = toApiError(err);
    res.status(status).json(errBody);
  }
}

async function handlePatch(
  body: unknown,
  userId: string,
  res: { status: (code: number) => { json: (body: unknown) => void } },
): Promise<void> {
  const b = body as { taskId?: unknown; name?: unknown; hours?: unknown; done?: unknown; primary?: unknown; order?: unknown };
  const taskId = typeof b.taskId === "string" ? b.taskId : "";
  const name = typeof b.name === "string" ? b.name : "";
  if (!taskId || !name) {
    res.status(400).json({ error: { code: "validation_failed", message: "taskId and name are required" } });
    return;
  }

  // Three real states for hours, distinguished explicitly rather than
  // inferred from typeof (null and "not present" must never collapse into
  // the same case: one clears the field, the other leaves it untouched):
  // absent (leave unchanged), null (explicit clear back to even-split
  // default, matching the client's setAccountAssignmentHours(undefined)),
  // or a finite number (set it). Anything else is a malformed request.
  const hoursProvided = "hours" in b && b.hours !== undefined;
  // Matches the old client's own guard (setAccountTaskHours: `hours > 0`) —
  // a number is only meaningful strictly positive; 0 or negative isn't a
  // real hour count, and "no hours" is already expressed by null (clear).
  const hoursIsValid = !hoursProvided || b.hours === null || (typeof b.hours === "number" && Number.isFinite(b.hours) && b.hours > 0);
  const hours = hoursProvided && typeof b.hours === "number" ? b.hours : null;
  const doneProvided = typeof b.done === "boolean";
  const primaryProvided = typeof b.primary === "boolean";
  const orderProvided = typeof b.order === "number";

  if (!hoursProvided && !doneProvided && !primaryProvided && !orderProvided) {
    res.status(400).json({ error: { code: "validation_failed", message: "at least one of hours, done, primary or order is required" } });
    return;
  }
  if (!hoursIsValid) {
    res.status(400).json({ error: { code: "validation_failed", message: "hours must be a number or null" } });
    return;
  }

  try {
    const result = await withUserContext(userId, async (tx) => {
      const [current] = await tx<{ account_id: string; title: string; assignments: TaskAssignment[]; status: string; completed_at: string | null }[]>`
        select account_id, title, assignments, status, completed_at from collab.task where id = ${taskId}
      `;
      if (!current) return { kind: "not_found" as const };

      const people = current.assignments ?? [];
      if (!people.some((a) => a.name === name)) return { kind: "no_assignment" as const };

      const nextPeople = people.map((a): TaskAssignment => {
        if (a.name !== name) return primaryProvided && b.primary === true ? { ...a, primary: false } : a;
        const patched: TaskAssignment = { ...a };
        if (hoursProvided) {
          if (hours == null) delete patched.hours;
          else patched.hours = roundHours(hours);
        }
        if (doneProvided) patched.done = b.done as boolean;
        if (primaryProvided) patched.primary = b.primary as boolean;
        if (orderProvided) patched.order = b.order as number;
        return patched;
      });

      // Whole-task status follows everyone's done state, same rule as the
      // client's applyPersonDone: complete only when every assignment is,
      // reopened to "doing" the moment any single one isn't — never touched
      // when `done` wasn't part of this request at all.
      const newStatus = !doneProvided
        ? current.status
        : nextPeople.length === 0
          ? current.status
          : nextPeople.every((a) => a.done === true)
            ? "done"
            : "doing";
      const completedAt =
        newStatus === current.status ? current.completed_at : newStatus === "done" ? new Date().toISOString() : null;

      const [updated] = await tx<TaskRow[]>`
        update collab.task
        set
          assignments = ${tx.json(nextPeople as unknown as postgres.JSONValue)},
          status = ${newStatus},
          completed_at = ${completedAt}
        where id = ${taskId}
        returning id, account_id, title, assignments, status, completed_at, updated_at
      `;
      if (!updated) return { kind: "not_found" as const };
      if (newStatus === "done" && current.status !== "done") {
        await logActivity(tx, updated.account_id, `"${updated.title}" → completed (everyone done)`, "task");
      }
      return { kind: "ok" as const, updated };
    });

    if (result.kind === "not_found") {
      res.status(404).json({ error: { code: "not_found", message: "task not found" } });
    } else if (result.kind === "no_assignment") {
      res.status(404).json({ error: { code: "not_found", message: "assignment not found on this task" } });
    } else {
      res.status(200).json({ data: toApi(result.updated) });
    }
  } catch (err) {
    const { status, body: errBody } = toApiError(err);
    res.status(status).json(errBody);
  }
}

export default async function handler(
  req: { method?: string; body?: unknown; headers?: Record<string, string | string[] | undefined> },
  res: {
    status: (code: number) => { json: (body: unknown) => void };
    setHeader: (k: string, v: string) => void;
  },
): Promise<void> {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "PUT" && req.method !== "PATCH") {
    res.status(405).json({ error: { code: "validation_failed", message: "PUT or PATCH" } });
    return;
  }

  const authHeader = typeof req.headers?.authorization === "string" ? req.headers.authorization : undefined;
  const auth = await requireUser(authHeader);
  if (!auth.authorized) {
    res.status(auth.status).json(auth.body);
    return;
  }

  if (req.method === "PUT") await handlePut(req.body, auth.userId!, res);
  else await handlePatch(req.body, auth.userId!, res);
}
