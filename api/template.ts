/**
 * POST /api/template — `POST /api/account/:id/template`
 * (docs/api-spec-workspace-mutations.md), replacing `applyTemplate`. Static
 * playbook data (api/_lib/templates.ts), no Kantata dependency — unlike
 * setProjectScope/linkProjects, safe to build in this pass.
 *
 * Dedupes by title (case-insensitive) against the account's EXISTING tasks,
 * exactly like store.ts's own applyTemplate — a re-run only adds what's
 * missing, matching api-spec rule 5 ("idempotent where it can be... report
 * what they actually did").
 *
 * RETURNING is safe: task_insert's policy is the same account_member check
 * task_read's first branch uses.
 */

import { requireUser } from "./_lib/requireUser.js";
import { withUserContext } from "./_lib/db.js";
import { toApiError } from "./_lib/apiError.js";
import { toDateOnly } from "./_lib/dates.js";
import { logActivity } from "./_lib/activity.js";
import { TEMPLATES, instantiateTemplate } from "./_lib/templates.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

interface CreatedTaskRow {
  id: string;
  title: string;
  due: Date | null;
  label: string | null;
}

export default async function handler(
  req: { method?: string; body?: unknown; headers?: Record<string, string | string[] | undefined> },
  res: {
    status: (code: number) => { json: (body: unknown) => void };
    setHeader: (k: string, v: string) => void;
  },
): Promise<void> {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.status(405).json({ error: { code: "validation_failed", message: "POST only" } });
    return;
  }

  const authHeader = typeof req.headers?.authorization === "string" ? req.headers.authorization : undefined;
  const auth = await requireUser(authHeader);
  if (!auth.authorized) {
    res.status(auth.status).json(auth.body);
    return;
  }

  const b = req.body as { accountId?: unknown; templateKey?: unknown; startDate?: unknown };
  const accountId = typeof b?.accountId === "string" ? b.accountId : "";
  const templateKey = typeof b?.templateKey === "string" ? b.templateKey : "";
  const startDate = typeof b?.startDate === "string" ? b.startDate : "";
  if (!accountId || !templateKey || !DATE.test(startDate)) {
    res.status(400).json({ error: { code: "validation_failed", message: "accountId, templateKey and startDate ('YYYY-MM-DD') are required" } });
    return;
  }
  const tpl = TEMPLATES.find((t) => t.key === templateKey);
  if (!tpl) {
    res.status(400).json({ error: { code: "validation_failed", message: `unknown templateKey: ${templateKey}` } });
    return;
  }

  try {
    const result = await withUserContext(auth.userId!, async (tx) => {
      const existing = await tx<{ title: string }[]>`select title from collab.task where account_id = ${accountId}`;
      // task_read's policy denies silently — an account the caller cannot
      // see returns zero existing titles, which would make every draft look
      // "new" and attempt the insert below, which task_insert's own policy
      // then genuinely refuses (42501) — a real access decision, not a
      // false not_found, since unlike a single-row endpoint there's no one
      // row whose absence could mean "wrong id" here.
      const have = new Set(existing.map((t) => t.title.toLowerCase()));

      const drafts = instantiateTemplate(tpl, startDate).filter((d) => !have.has(d.title.toLowerCase()));

      // Individual inserts, not a bulk multi-row statement — same choice as
      // api/share.ts, for the same reason: a template is at most a couple
      // dozen rows, and it keeps every RETURNING row in the same shape the
      // rest of this API already produces without fighting the driver's
      // generic multi-row-insert typing for no real benefit at this scale.
      const created: CreatedTaskRow[] = [];
      for (const d of drafts) {
        const [row] = await tx<CreatedTaskRow[]>`
          insert into collab.task (account_id, title, due, label, source)
          values (${accountId}, ${d.title}, ${d.due}, ${tpl.name}, 'manual')
          returning id, title, due, label
        `;
        if (row) created.push(row);
      }
      if (created.length > 0) await logActivity(tx, accountId, `Applied "${tpl.name}" template — ${created.length} task${created.length === 1 ? "" : "s"} added`, "task");
      return created;
    });

    res.status(200).json({
      data: {
        added: result.length,
        tasks: result.map((t) => {
          const due = toDateOnly(t.due);
          return { id: t.id, title: t.title, ...(due ? { due } : {}), ...(t.label ? { label: t.label } : {}) };
        }),
      },
    });
  } catch (err) {
    const { status, body } = toApiError(err);
    res.status(status).json(body);
  }
}
