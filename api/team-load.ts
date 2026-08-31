/**
 * GET /api/team-load — the cross-client resourcing picture (Kellie/Cara): each
 * AGP person's weekly workload across EVERY client, next 12 weeks, measured
 * against their capacity so over-allocation and idle time finally surface.
 *
 * Demand comes from collab.task (RLS-scoped, so a PM sees their accounts and an
 * app admin sees the whole book); the weekly spread is aggregated server-side
 * (api/_lib/resourceLoad.ts) so the payload is one small row per person. Supply
 * comes from collab.person_capacity (default 40h/week when a person isn't set).
 */

import { requireUser } from "./_lib/requireUser.js";
import { withUserContext } from "./_lib/db.js";
import { toApiError } from "./_lib/apiError.js";
import { toDateOnly } from "./_lib/dates.js";
import { teamLoad, upcomingWeeks, type LoadTask, type LoadAssignment, type CapacityInfo } from "./_lib/resourceLoad.js";

const DEFAULT_CAPACITY = 40;
const WEEKS = 12;

interface TaskRow {
  id: string;
  owner_name: string | null;
  assignments: unknown;
  start_date: Date | string | null;
  due: Date | string | null;
  estimated_hours: string | null; // postgres.js returns numeric as a string
  status: "todo" | "doing" | "done";
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
    // Internal-only: Team Load exposes the whole AGP staff roster + each
    // person's capacity across the portfolio — an external client/contractor
    // (who also authenticates as `authenticated`) must never see it.
    const [me] = await withUserContext(auth.userId!, async (tx) => {
      return await tx<{ kind: string }[]>`select kind from collab.app_user where id = ${auth.userId!}`;
    });
    if (me?.kind !== "internal") {
      res.status(403).json({ error: { code: "forbidden", message: "team resourcing is internal-only" } });
      return;
    }

    const { rows, caps } = await withUserContext(auth.userId!, async (tx) => {
      const rowsP = await tx<TaskRow[]>`
        select id, owner_name, assignments, start_date, due, estimated_hours, status
        from collab.task
        where status <> 'done' and due is not null
      `;
      const capsP = await tx<{ person_key: string; display_name: string; weekly_hours: string }[]>`
        select person_key, display_name, weekly_hours from collab.person_capacity
      `;
      return { rows: rowsP, caps: capsP };
    });

    const capacities = new Map<string, CapacityInfo>();
    for (const c of caps) capacities.set(c.person_key, { displayName: c.display_name || c.person_key, weeklyHours: Number(c.weekly_hours) });

    const tasks: LoadTask[] = rows.map((r) => ({
      id: r.id,
      status: r.status,
      ...(r.owner_name ? { ownerName: r.owner_name } : {}),
      ...(Array.isArray(r.assignments) ? { assignments: r.assignments as LoadAssignment[] } : {}),
      ...(r.estimated_hours != null ? { estimatedHours: Number(r.estimated_hours) } : {}),
      ...(toDateOnly(r.start_date) ? { start: toDateOnly(r.start_date)! } : {}),
      ...(toDateOnly(r.due) ? { due: toDateOnly(r.due)! } : {}),
    }));

    const weeks = upcomingWeeks(WEEKS);
    const people = teamLoad(tasks, weeks, capacities, DEFAULT_CAPACITY);

    res.status(200).json({ data: { weeks, defaultCapacity: DEFAULT_CAPACITY, people } });
  } catch (err) {
    const { status, body } = toApiError(err);
    res.status(status).json(body);
  }
}
