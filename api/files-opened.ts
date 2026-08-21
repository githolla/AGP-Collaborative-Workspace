/**
 * POST /api/files/opened (docs/api-spec-workspace-mutations.md "Files and
 * approvals"), replacing `recordShareOpened`/`recordItemOpened`. Body:
 * `{ accountId, msItemId, shareId? }`. Role: any signed-in caller — this is
 * the one endpoint meant to let a recipient mark their OWN item opened, not
 * just a workspace admin.
 *
 * Two branches, matching the two old mutators it replaces:
 * - `shareId` set → stamps `collab.share.opened_at`/`open_source` (the
 *   handover/audit model, `recordShareOpened`'s replacement).
 * - `shareId` absent → stamps `collab.file_approval.opened_at` for
 *   `(accountId, msItemId)` (`recordItemOpened`'s replacement).
 *
 * First-open-only, same as both old mutators: re-calling once already
 * opened is an idempotent success returning the existing state, never an
 * error. COLUMN-LEVEL DISCIPLINE, same caveat share.ts/files-approval-decision.ts
 * state for their own tables: the RLS policies here (0008's `share_update`,
 * `file_approval_decision`) are intentionally broader than "own row only" —
 * this handler is what actually restricts the write to `opened_at`/
 * `open_source`, never anything else, regardless of who's calling.
 */

import { requireUser } from "./_lib/requireUser.js";
import { withUserContext } from "./_lib/db.js";
import { toApiError } from "./_lib/apiError.js";

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

  const b = req.body as { accountId?: unknown; msItemId?: unknown; shareId?: unknown };
  const shareId = typeof b.shareId === "string" ? b.shareId : "";
  const accountId = typeof b.accountId === "string" ? b.accountId : "";
  const msItemId = typeof b.msItemId === "string" ? b.msItemId : "";
  if (!shareId && (!accountId || !msItemId)) {
    res.status(400).json({ error: { code: "validation_failed", message: "either shareId, or accountId and msItemId, are required" } });
    return;
  }

  try {
    const result = await withUserContext(auth.userId!, async (tx) => {
      if (shareId) {
        const [updated] = await tx<{ id: string; opened_at: string }[]>`
          update collab.share set opened_at = now(), open_source = 'workspace'
          where id = ${shareId} and opened_at is null and revoked_at is null
          returning id, opened_at
        `;
        if (updated) return { kind: "ok" as const, id: updated.id, openedAt: updated.opened_at };
        const [existing] = await tx<{ id: string; opened_at: string | null; revoked_at: string | null }[]>`
          select id, opened_at, revoked_at from collab.share where id = ${shareId}
        `;
        if (!existing) return { kind: "not_found" as const };
        // The UPDATE's own `revoked_at is null` guard means landing here
        // with a null openedAt AND a revoked share is NOT the same idempotent
        // no-op as "already opened" — it's "revoked before it was ever
        // opened, and never will be now." Told apart explicitly so a caller
        // can't mistake that for a normal success.
        if (existing.revoked_at && !existing.opened_at) return { kind: "revoked" as const, id: existing.id };
        return { kind: "ok" as const, id: existing.id, openedAt: existing.opened_at };
      }

      const [updated] = await tx<{ id: string; opened_at: string }[]>`
        update collab.file_approval set opened_at = now()
        where account_id = ${accountId} and ms_item_id = ${msItemId} and opened_at is null
        returning id, opened_at
      `;
      if (updated) return { kind: "ok" as const, id: updated.id, openedAt: updated.opened_at };
      const [existing] = await tx<{ id: string; opened_at: string | null }[]>`
        select id, opened_at from collab.file_approval where account_id = ${accountId} and ms_item_id = ${msItemId}
      `;
      if (!existing) return { kind: "not_found" as const };
      return { kind: "ok" as const, id: existing.id, openedAt: existing.opened_at };
    });

    if (result.kind === "not_found") {
      res.status(404).json({ error: { code: "not_found", message: "share or file approval not found" } });
      return;
    }
    if (result.kind === "revoked") {
      res.status(409).json({ error: { code: "conflict", message: "this share was revoked before it was ever opened" } });
      return;
    }
    res.status(200).json({ data: { id: result.id, ...(result.openedAt ? { openedAt: result.openedAt } : {}) } });
  } catch (err) {
    const { status, body } = toApiError(err);
    res.status(status).json(body);
  }
}
