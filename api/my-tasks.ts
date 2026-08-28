/**
 * GET /api/my-tasks — the signed-in AGP person's OPEN tasks across EVERY client
 * workspace they're on, for the cross-client "My Work" view (Kellie's pilot ask:
 * "how do people who work across 15 clients see everything due, regardless of
 * client, sorted by due date").
 *
 * One RLS-scoped query, no per-account loop: collab.task's row-level security
 * already limits rows to accounts the caller is a member of (or admin of), so a
 * plain select returns exactly their visible tasks. We additionally filter by
 * the caller's display name (owner_name or an assignment carrying that name) —
 * both to bound the payload (an app admin can otherwise see every task in the
 * tenant) and because "mine" is, in this data model, a name match: assignments
 * identify a person by Kantata-derived name string, never a user id. The client
 * then refines with the same isOnPersonList rule the in-account list uses
 * (primary, or hours > 0) and buckets by due date.
 *
 * Known limitation (documented, matches today's behavior): a task only appears
 * if (a) the caller's account_member row is user-id-linked so RLS admits it, and
 * (b) the assignment name equals the caller's display name. Name-format drift
 * ("Jane A. Doe" vs "Jane Doe") can hide a task — same gap the existing
 * per-account "My Tasks" has.
 */

import { requireUser } from "./_lib/requireUser.js";
import { withUserContext, withServiceContext } from "./_lib/db.js";
import { toApiError } from "./_lib/apiError.js";
import { toDateOnly } from "./_lib/dates.js";

interface MyTaskRow {
  id: string;
  account_id: string;
  client_name: string;
  title: string;
  owner_name: string | null;
  assignments: unknown;
  due: Date | string | null;
  status: "todo" | "doing" | "done";
  project_label: string | null;
  phase_label: string | null;
  estimated_hours: number | null;
}

export default async function handler(
  req: { method?: string; headers?: Record<string, string | string[] | undefined> },
  res: { status: (code: number) => { json: (body: unknown) => void }; setHeader: (k: string, v: string) => void },
): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.status(405).json({ error: { code: "validation_failed", message: "GET only" } });
    return;
  }

  const auth = await requireUser(typeof req.headers?.authorization === "string" ? req.headers.authorization : undefined);
  if (!auth.authorized) {
    res.status(auth.status).json(auth.body);
    return;
  }

  try {
    // Authoritative display name for the caller (same string Kantata assignments
    // and owner_name carry for AGP staff).
    const [me] = await withServiceContext(async (tx) => {
      return await tx<{ display_name: string | null }[]>`select display_name from collab.app_user where id = ${auth.userId!}`;
    });
    const myName = (me?.display_name ?? "").trim();
    if (!myName) {
      // No name to match on — return an empty, honest result rather than the
      // whole tenant's tasks.
      res.status(200).json({ data: { userName: "", tasks: [] } });
      return;
    }

    const rows = await withUserContext(auth.userId!, async (tx) => {
      return await tx<MyTaskRow[]>`
        select t.id, t.account_id, a.client_name, t.title, t.owner_name, t.assignments,
               t.due, t.status, t.project_label, t.phase_label, t.estimated_hours
        from collab.task t
        join collab.client_account a on a.id = t.account_id
        where t.status <> 'done'
          and a.archived = false
          and ( t.owner_name = ${myName} or t.assignments @> ${tx.json([{ name: myName }])} )
        order by t.due asc nulls last
      `;
    });

    const tasks = rows.map((r) => {
      const due = toDateOnly(r.due);
      return {
        id: r.id,
        accountId: r.account_id,
        clientName: r.client_name,
        title: r.title,
        ...(r.owner_name ? { ownerName: r.owner_name } : {}),
        assignments: Array.isArray(r.assignments) ? r.assignments : [],
        ...(due ? { due } : {}),
        status: r.status,
        ...(r.project_label ? { projectLabel: r.project_label } : {}),
        ...(r.phase_label ? { phaseLabel: r.phase_label } : {}),
        ...(r.estimated_hours != null ? { estimatedHours: r.estimated_hours } : {}),
      };
    });

    res.status(200).json({ data: { userName: myName, tasks } });
  } catch (err) {
    const { status, body } = toApiError(err);
    res.status(status).json(body);
  }
}
