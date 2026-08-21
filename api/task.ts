/**
 * POST /api/task, PATCH /api/task — task lifecycle
 * (docs/api-spec-workspace-mutations.md). Method-dispatched in one file, ids
 * in the body — matching api/account.ts's convention and the reasoning
 * documented there (no Vercel `[id]` dynamic route: this repo has never used
 * one, and it needs a compatibility shim between Vercel's `req.query` and
 * Express's `req.params` for no real benefit).
 *
 * Unlike account creation, RETURNING is safe to use directly here: creating
 * or updating a task requires the caller to already be collab.account_member
 * on an EXISTING account (task_insert/task_update's policy), and that same
 * membership is exactly what task_read's policy also grants — so there is no
 * bootstrap-timing gap the way there is between creating an account and
 * becoming its first member.
 *
 * A manually-created task (source: "manual", the only kind this endpoint
 * makes) has an empty kantata_ancestor_ids by construction — it isn't tied to
 * any Kantata milestone. That means it can never reach an external even if
 * flagged client/contractorVisible, by the same fail-closed rule the plan
 * states for messages: nothing an external sees is reachable without a
 * grant to hold it against, and an empty ancestor list matches no grant.
 * This is the intended behaviour, not a gap.
 */

import { requireUser } from "./_lib/requireUser.js";
import { withUserContext } from "./_lib/db.js";
import { toApiError } from "./_lib/apiError.js";
import { toDateOnly } from "./_lib/dates.js";
import { logActivity } from "./_lib/activity.js";
import type { TaskAssignment } from "./_lib/taskAssignments.js";
import type postgres from "postgres";

const STATUSES = new Set(["todo", "doing", "done"]);

interface TaskRow {
  id: string;
  account_id: string;
  title: string;
  owner_name: string | null;
  status: string;
  due: Date | null;
  label: string | null;
  estimated_hours: string | null;
  start_date: Date | null;
  depends_on: string[];
  client_visible: boolean;
  contractor_visible: boolean;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

function toApi(t: TaskRow) {
  const due = toDateOnly(t.due);
  const startDate = toDateOnly(t.start_date);
  return {
    id: t.id,
    accountId: t.account_id,
    title: t.title,
    ...(t.owner_name ? { ownerName: t.owner_name } : {}),
    status: t.status,
    ...(due ? { due } : {}),
    ...(t.label ? { label: t.label } : {}),
    ...(t.estimated_hours != null ? { estimatedHours: Number(t.estimated_hours) } : {}),
    ...(startDate ? { startDate } : {}),
    ...(t.depends_on.length > 0 ? { dependsOn: t.depends_on } : {}),
    clientVisible: t.client_visible,
    contractorVisible: t.contractor_visible,
    ...(t.completed_at ? { completedAt: t.completed_at } : {}),
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  };
}

async function handleCreate(
  body: unknown,
  userId: string,
  res: { status: (code: number) => { json: (body: unknown) => void } },
): Promise<void> {
  const b = body as { accountId?: unknown; title?: unknown; ownerName?: unknown; due?: unknown; label?: unknown; originInitiativeId?: unknown; originTaskId?: unknown };
  const accountId = typeof b.accountId === "string" ? b.accountId : "";
  const title = typeof b.title === "string" ? b.title.trim() : "";
  if (!accountId || !title) {
    res.status(400).json({ error: { code: "validation_failed", message: "accountId and title are required" } });
    return;
  }
  const ownerName = typeof b.ownerName === "string" ? b.ownerName : null;
  const due = typeof b.due === "string" ? b.due : null;
  const label = typeof b.label === "string" ? b.label : null;
  // Set only by the initiative->task bridge (docs/api-spec-workspace-mutations.md
  // "the one place the two stores meet") — a task copied in from a
  // client-visible-flagged build/initiative task, stamped with its origin so
  // re-flagging the SAME initiative task client-visible again is idempotent
  // (the unique index on (account_id, origin_task_id), 0021) rather than
  // creating a duplicate copy every time. Never typed by hand. Trimmed and
  // treated as absent when empty — an empty string is NOT null, so it would
  // otherwise satisfy the partial unique index itself and collide with any
  // OTHER task whose origin id was also blank, silently reusing one
  // initiative task's copy as the response for a completely different one.
  const originInitiativeId = typeof b.originInitiativeId === "string" && b.originInitiativeId.trim() ? b.originInitiativeId.trim() : null;
  const originTaskId = typeof b.originTaskId === "string" && b.originTaskId.trim() ? b.originTaskId.trim() : null;

  try {
    const [created] = await withUserContext(userId, async (tx) => {
      // ON CONFLICT DO UPDATE, not DO NOTHING: re-flagging the same
      // initiative task client-visible again must refresh the copy's
      // reference fields (title/owner/due/label) from the source, or a
      // rename on the initiative side would never reach the client-visible
      // copy again after the first flag. Only those fields — status,
      // assignments, visibility flags are this copy's OWN independent
      // state once it exists, not the initiative's to overwrite.
      // `xmax = 0` is the standard trick for telling INSERT apart from the
      // ON CONFLICT UPDATE branch in the same RETURNING (only a genuine
      // insert leaves xmax unset) — the activity log below should say
      // "added" only on a real first add, not on every refresh.
      const rows = await tx<(TaskRow & { inserted: boolean })[]>`
        insert into collab.task (account_id, title, owner_name, due, label, origin_initiative_id, origin_task_id)
        values (${accountId}, ${title}, ${ownerName}, ${due}, ${label}, ${originInitiativeId}, ${originTaskId})
        on conflict (account_id, origin_task_id) where origin_task_id is not null
        do update set title = excluded.title, owner_name = excluded.owner_name, due = excluded.due, label = excluded.label
        returning id, account_id, title, owner_name, status, due, label, estimated_hours,
                  start_date, depends_on, client_visible, contractor_visible, completed_at,
                  created_at, updated_at, (xmax = 0) as inserted
      `;
      if (rows[0]?.inserted) await logActivity(tx, accountId, `Task added — "${title}"${ownerName ? ` (${ownerName})` : ""}`, "task");
      return rows;
    });
    if (!created) throw new Error("insert returned no row");
    res.status(200).json({ data: toApi(created) });
  } catch (err) {
    // Unlike a read/update miss (silent zero rows), an INSERT whose
    // account_member requirement isn't met is a genuine WITH CHECK refusal —
    // Postgres throws 42501 for it, which toApiError maps to 403 forbidden.
    const { status, body } = toApiError(err);
    res.status(status).json(body);
  }
}

async function handleUpdate(
  body: unknown,
  userId: string,
  res: { status: (code: number) => { json: (body: unknown) => void } },
): Promise<void> {
  const b = body as {
    taskId?: unknown;
    status?: unknown;
    due?: unknown;
    estimatedHours?: unknown;
    startDate?: unknown;
    dependsOn?: unknown;
    clientVisible?: unknown;
    contractorVisible?: unknown;
    expectedUpdatedAt?: unknown;
  };
  const taskId = typeof b.taskId === "string" ? b.taskId : "";
  // Required, not optional — the api-spec's concurrency rule names task
  // edits as one of only two mutations that carry this guard specifically
  // because "two people typing over each other is real"; making it optional
  // would let a caller silently skip the one check that rule exists for.
  // PATCH /api/message already treats it this way; this now matches.
  const expectedUpdatedAt = typeof b.expectedUpdatedAt === "string" ? b.expectedUpdatedAt : "";
  if (!taskId || !expectedUpdatedAt) {
    res.status(400).json({ error: { code: "validation_failed", message: "taskId and expectedUpdatedAt are required" } });
    return;
  }

  // Validated against the schema's own enum in JS, matching every other
  // enum field in this codebase (external.ts's role, grant.ts's level/role,
  // message.ts's kantataLevel, notify.ts's pref) — this one used to rely
  // solely on Postgres's 23514 check-violation, the one inconsistent spot.
  if (b.status !== undefined && (typeof b.status !== "string" || !STATUSES.has(b.status))) {
    res.status(400).json({ error: { code: "validation_failed", message: "status must be 'todo', 'doing' or 'done'" } });
    return;
  }
  const status = typeof b.status === "string" ? b.status : null;
  const dependsOn = Array.isArray(b.dependsOn) ? b.dependsOn.filter((x): x is string => typeof x === "string") : null;
  const clientVisible = typeof b.clientVisible === "boolean" ? b.clientVisible : null;
  const contractorVisible = typeof b.contractorVisible === "boolean" ? b.contractorVisible : null;

  // Three real states for due/estimatedHours/startDate, same reasoning as
  // task-assignments.ts's own hours handling: absent (leave unchanged), null
  // (explicit clear — coalesce alone can never express this, since it can't
  // tell "omitted" from "clear"), or a real value (set it). The old client's
  // setAccountTaskHours(undefined) explicitly supported clearing; this
  // endpoint silently couldn't, until now.
  const dueProvided = b.due !== undefined;
  const dueValid = !dueProvided || b.due === null || typeof b.due === "string";
  const startDateProvided = b.startDate !== undefined;
  const startDateValid = !startDateProvided || b.startDate === null || typeof b.startDate === "string";
  const estimatedHoursProvided = b.estimatedHours !== undefined;
  const estimatedHoursValid = !estimatedHoursProvided || b.estimatedHours === null || typeof b.estimatedHours === "number";
  if (!dueValid || !startDateValid || !estimatedHoursValid) {
    res.status(400).json({ error: { code: "validation_failed", message: "due, startDate and estimatedHours must each be a string/number or null" } });
    return;
  }

  if (
    status === null &&
    !dueProvided &&
    !estimatedHoursProvided &&
    !startDateProvided &&
    dependsOn === null &&
    clientVisible === null &&
    contractorVisible === null
  ) {
    res.status(400).json({ error: { code: "validation_failed", message: "at least one field to update is required" } });
    return;
  }

  try {
    const result = await withUserContext(userId, async (tx) => {
      const [current] = await tx<(TaskRow & { assignments: TaskAssignment[] })[]>`
        select id, account_id, title, owner_name, status, due, label, estimated_hours,
               start_date, depends_on, client_visible, contractor_visible, completed_at,
               created_at, updated_at, assignments
        from collab.task where id = ${taskId}
      `;
      // task_read's policy denies silently — a missing row here means either
      // the id is wrong or the caller cannot see it, and both read the same
      // to them: not_found, never a hint about which.
      if (!current) return { kind: "not_found" as const };

      if (new Date(expectedUpdatedAt).getTime() !== new Date(current.updated_at).getTime()) {
        return { kind: "conflict" as const, current };
      }

      // completed_at follows a status change, computed from the row's OWN
      // pre-update value (current.status) — set on the transition INTO
      // "done", cleared on the transition OUT of it, left alone otherwise.
      const completedAt =
        status === null
          ? current.completed_at
          : status === "done" && current.status !== "done"
            ? new Date().toISOString()
            : status !== "done"
              ? null
              : current.completed_at;

      // Keep the coarse status and the per-person flags in agreement — the
      // old client's setAccountTaskStatus did this explicitly ("a task with
      // a team is done only when everyone is, so marking the whole task
      // Done marks every person's part done... without this, the status
      // button and the per-person model contradict each other"). Only
      // touches assignments when status ACTUALLY CHANGED (not just present
      // in the request — resending the current, unchanged status must
      // never re-stamp everyone's done flag, or a client that always
      // submits every field on save would silently wipe real per-person
      // progress on every unrelated edit) and the task actually has any.
      const statusChanged = status !== null && status !== current.status;
      const nextAssignments =
        statusChanged && current.assignments.length > 0
          ? current.assignments.map((a) => ({ ...a, done: status === "done" }))
          : current.assignments;

      const nextDue = dueProvided ? (typeof b.due === "string" ? b.due : null) : current.due;
      const nextStartDate = startDateProvided ? (typeof b.startDate === "string" ? b.startDate : null) : current.start_date;
      const nextEstimatedHours = estimatedHoursProvided ? (typeof b.estimatedHours === "number" ? b.estimatedHours : null) : current.estimated_hours;

      // Same sanitization the old client-side setTaskDependencies mutator
      // did (store.ts): dedup, never let a task depend on itself, and drop
      // any id that isn't a real task on THIS account — dropped silently
      // rather than rejected, matching that old behavior, since a stale id
      // (the referenced task was since deleted) is routine, not an error.
      let cleanDependsOn: string[] | null = null;
      if (dependsOn !== null) {
        const candidates = [...new Set(dependsOn)].filter((d) => d !== taskId);
        if (candidates.length === 0) {
          cleanDependsOn = [];
        } else {
          const valid = await tx<{ id: string }[]>`select id from collab.task where account_id = ${current.account_id} and id = any(${candidates})`;
          const validIds = new Set(valid.map((v) => v.id));
          cleanDependsOn = candidates.filter((d) => validIds.has(d));
        }
      }

      const [updated] = await tx<TaskRow[]>`
        update collab.task
        set
          status = coalesce(${status}, status),
          due = ${nextDue},
          estimated_hours = ${nextEstimatedHours},
          start_date = ${nextStartDate},
          depends_on = coalesce(${cleanDependsOn}, depends_on),
          client_visible = coalesce(${clientVisible}, client_visible),
          contractor_visible = coalesce(${contractorVisible}, contractor_visible),
          completed_at = ${completedAt},
          assignments = ${tx.json(nextAssignments as unknown as postgres.JSONValue)}
        where id = ${taskId}
        returning id, account_id, title, owner_name, status, due, label, estimated_hours,
                  start_date, depends_on, client_visible, contractor_visible, completed_at,
                  created_at, updated_at
      `;
      if (!updated) return { kind: "not_found" as const };
      if (statusChanged) {
        const label = status === "done" ? "completed" : status === "doing" ? "in progress" : "to do";
        await logActivity(tx, updated.account_id, `"${updated.title}" → ${label}`, "task");
      }
      return { kind: "ok" as const, updated };
    });

    if (result.kind === "not_found") {
      res.status(404).json({ error: { code: "not_found", message: "task not found" } });
    } else if (result.kind === "conflict") {
      res.status(409).json({ error: { code: "conflict", message: "task changed since expectedUpdatedAt" }, data: toApi(result.current) });
    } else {
      res.status(200).json({ data: toApi(result.updated) });
    }
  } catch (err) {
    const { status, body } = toApiError(err);
    res.status(status).json(body);
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

  if (req.method !== "POST" && req.method !== "PATCH") {
    res.status(405).json({ error: { code: "validation_failed", message: "POST or PATCH" } });
    return;
  }

  const authHeader = typeof req.headers?.authorization === "string" ? req.headers.authorization : undefined;
  const auth = await requireUser(authHeader);
  if (!auth.authorized) {
    res.status(auth.status).json(auth.body);
    return;
  }

  if (req.method === "POST") await handleCreate(req.body, auth.userId!, res);
  else await handleUpdate(req.body, auth.userId!, res);
}
