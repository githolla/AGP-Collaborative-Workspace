/**
 * POST /api/account-tasks-synced — `POST /api/account/:id/tasks/synced`
 * (docs/api-spec-workspace-mutations.md), replacing `markTasksSynced`.
 *
 * The other half of the Kantata write-back loop: api/kantata-write.ts's own
 * response shape is `{ ref, ok, planned, createdId? }` per intent (confirmed
 * by reading it directly) — `ref` is the LOCAL task id the intent was FOR,
 * `createdId` is the brand-new Kantata story id when the write created one
 * (the task had none before). The caller is expected to send only the
 * entries where `ok === true && !planned` — this endpoint trusts that
 * filtering already happened client-side (same as store.ts's own
 * `markTasksSynced`, which never re-verifies against Kantata itself) and
 * just stamps them.
 *
 * `createdId` only overwrites `kantata_story_id` when present — an already-
 * synced task (updated in place, no new story) sends no `createdId` and its
 * existing id is left alone via `coalesce`.
 *
 * Explicitly checks access to `accountId` before the loop — same fix as
 * api/grant/revoke-all.ts and api/account-campaigns.ts: this is a BULK
 * operation (many single-row UPDATEs run in sequence), and task_update's
 * RLS policy denies silently, one row at a time. Without this check, an
 * unauthorized accountId would just make every UPDATE match 0 rows and the
 * loop would finish reporting `updated: 0` — indistinguishable from
 * "authorized, but nothing needed syncing", exactly the ambiguity those two
 * endpoints were already fixed to avoid.
 */

import { requireUser } from "./_lib/requireUser.js";
import { withUserContext } from "./_lib/db.js";
import { toApiError } from "./_lib/apiError.js";
import { logActivity } from "./_lib/activity.js";

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

  const b = req.body as { accountId?: unknown; applied?: unknown };
  const accountId = typeof b?.accountId === "string" ? b.accountId : "";
  const applied = Array.isArray(b?.applied)
    ? b.applied.filter(
        (a): a is { ref: string; createdId?: string } =>
          !!a && typeof a === "object" && typeof (a as { ref?: unknown }).ref === "string" &&
          ((a as { createdId?: unknown }).createdId === undefined || typeof (a as { createdId?: unknown }).createdId === "string"),
      )
    : null;
  if (!accountId || !applied) {
    res.status(400).json({ error: { code: "validation_failed", message: "accountId and applied ({ ref, createdId? }[]) are required" } });
    return;
  }
  if (applied.length === 0) {
    res.status(200).json({ data: { updated: 0 } });
    return;
  }

  try {
    const result = await withUserContext(auth.userId!, async (tx) => {
      const [access] = await tx<{ ok: boolean }[]>`select collab.is_account_member_or_admin(${accountId}) as ok`;
      if (!access?.ok) return { kind: "forbidden" as const };

      let count = 0;
      for (const a of applied) {
        const [row] = await tx<{ id: string }[]>`
          update collab.task
          set kantata_synced_at = now(), kantata_story_id = coalesce(${a.createdId ?? null}, kantata_story_id)
          where account_id = ${accountId} and id = ${a.ref}
          returning id
        `;
        if (row) count += 1;
      }
      if (count > 0) await logActivity(tx, accountId, `${count} task${count === 1 ? "" : "s"} pushed to Kantata`, "task");
      return { kind: "ok" as const, updated: count };
    });

    if (result.kind === "forbidden") {
      res.status(404).json({ error: { code: "not_found", message: "account not found" } });
      return;
    }
    res.status(200).json({ data: { updated: result.updated } });
  } catch (err) {
    const { status, body } = toApiError(err);
    res.status(status).json(body);
  }
}
