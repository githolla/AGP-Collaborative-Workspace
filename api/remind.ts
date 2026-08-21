/**
 * POST /api/remind — `POST /api/account/:id/remind`
 * (docs/api-spec-workspace-mutations.md), replacing `remindClientDeliverable`.
 *
 * The reminder TEXT is built server-side from the task's own current title/due
 * date (a fresh SELECT, not whatever the caller might claim) — the same
 * "nothing trusts a field from the body to establish content" reasoning as
 * message.ts's server-stamped author. Writes a real collab.thread_message
 * (client/contractorVisible both false — an internal note that a reminder
 * was queued), matching store.ts's own thread post.
 *
 * store.ts's version is honest that no send actually happens yet ("Sent via
 * their preferred channel once M365 is connected") — this endpoint is the
 * same: it records the reminder, it does not deliver one. It also skips the
 * client's parallel `notifications`/`activity` writes, same scope choice as
 * every other endpoint so far (task-assignments' done-transition, task.ts) —
 * those stay client-side/document-backed, not part of this pass.
 *
 * RETURNING is safe: thread_message_insert's member branch is the same
 * account_member check thread_message_read's first branch uses.
 */

import { requireUser } from "./_lib/requireUser.js";
import { withUserContext } from "./_lib/db.js";
import { toApiError } from "./_lib/apiError.js";
import { toDateOnly } from "./_lib/dates.js";

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

  const b = req.body as { accountId?: unknown; taskId?: unknown };
  const accountId = typeof b?.accountId === "string" ? b.accountId : "";
  const taskId = typeof b?.taskId === "string" ? b.taskId : "";
  if (!accountId || !taskId) {
    res.status(400).json({ error: { code: "validation_failed", message: "accountId and taskId are required" } });
    return;
  }

  const userId = auth.userId!;

  try {
    const result = await withUserContext(userId, async (tx) => {
      const [task] = await tx<{ title: string; due: Date | null }[]>`
        select title, due from collab.task where id = ${taskId} and account_id = ${accountId}
      `;
      // task_read's policy denies silently — missing here means either the
      // id is wrong, the account doesn't match, or the caller cannot see it.
      if (!task) return { kind: "not_found" as const };

      const [me] = await tx<{ display_name: string }[]>`select display_name from collab.app_user where id = ${userId}`;
      const due = toDateOnly(task.due);
      const dueSuffix = due ? ` (due ${due})` : "";
      const body = `⏰ Reminder sent to the client: "${task.title}"${dueSuffix}.`;

      const [created] = await tx<{ id: string; created_at: string }[]>`
        insert into collab.thread_message (account_id, author, author_user_id, body, topic)
        values (${accountId}, ${me?.display_name ?? "Unknown"}, ${userId}, ${body}, ${task.title})
        returning id, created_at
      `;
      if (!created) throw new Error("insert returned no row");
      return { kind: "ok" as const, messageId: created.id, createdAt: created.created_at, body };
    });

    if (result.kind === "not_found") {
      res.status(404).json({ error: { code: "not_found", message: "task not found" } });
      return;
    }
    res.status(200).json({ data: { messageId: result.messageId, body: result.body, createdAt: result.createdAt } });
  } catch (err) {
    const { status, body } = toApiError(err);
    res.status(status).json(body);
  }
}
