/**
 * DELETE /api/account-campaigns — `DELETE /api/account/:id/campaigns/:campaignId`
 * and `DELETE /api/account/:id/campaigns` (docs/api-spec-workspace-mutations.md),
 * replacing `removeCampaign`/`clearCampaigns`. Flat, id-in-body: `campaignId`
 * present removes ONE campaign; absent clears every campaign on the account
 * (store.ts's own "the undo for a bad bulk import").
 *
 * Plain collab.campaign delete — campaign_delete's policy is the same
 * account_member-or-admin check used everywhere else in this group, no
 * Kantata call involved at all.
 *
 * The bulk (no campaignId) branch explicitly checks access before deleting,
 * same fix as api/grant/revoke-all.ts: a bulk DELETE's "0 rows affected" is
 * ambiguous in a way a single row's isn't — it could mean "authorized, and
 * there was nothing to remove" (a real, idempotent no-op) or "not
 * authorized for this account at all" (RLS silently filtered every row
 * out). Those must not collapse into the same response.
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

  if (req.method !== "DELETE") {
    res.status(405).json({ error: { code: "validation_failed", message: "DELETE only" } });
    return;
  }

  const authHeader = typeof req.headers?.authorization === "string" ? req.headers.authorization : undefined;
  const auth = await requireUser(authHeader);
  if (!auth.authorized) {
    res.status(auth.status).json(auth.body);
    return;
  }

  const b = req.body as { accountId?: unknown; campaignId?: unknown };
  const accountId = typeof b?.accountId === "string" ? b.accountId : "";
  const campaignId = typeof b?.campaignId === "string" ? b.campaignId : "";
  if (!accountId) {
    res.status(400).json({ error: { code: "validation_failed", message: "accountId is required" } });
    return;
  }

  try {
    if (campaignId) {
      const [deleted] = await withUserContext(auth.userId!, async (tx) => {
        const [row] = await tx<{ id: string; name: string }[]>`delete from collab.campaign where account_id = ${accountId} and id = ${campaignId} returning id, name`;
        if (row) await logActivity(tx, accountId, `Campaign removed — ${row.name}`, "task");
        return [row];
      });
      // campaign_delete's policy denies silently — missing here means either
      // the id is wrong or the caller cannot manage this account.
      if (!deleted) {
        res.status(404).json({ error: { code: "not_found", message: "campaign not found" } });
        return;
      }
      res.status(200).json({ data: { id: deleted.id } });
      return;
    }

    const result = await withUserContext(auth.userId!, async (tx) => {
      const [access] = await tx<{ ok: boolean }[]>`select collab.is_account_member_or_admin(${accountId}) as ok`;
      if (!access?.ok) return { kind: "forbidden" as const };
      const deleted = await tx<{ id: string }[]>`delete from collab.campaign where account_id = ${accountId} returning id`;
      if (deleted.length > 0) await logActivity(tx, accountId, `All campaigns removed (${deleted.length}) — re-import from Review import`, "task");
      return { kind: "ok" as const, removed: deleted.length };
    });

    if (result.kind === "forbidden") {
      // Collapsed into not_found, same as every other endpoint's write-miss
      // path — never distinguishes "no such account" from "not yours" for
      // an unauthorized caller.
      res.status(404).json({ error: { code: "not_found", message: "account not found" } });
      return;
    }
    res.status(200).json({ data: { removed: result.removed } });
  } catch (err) {
    const { status, body } = toApiError(err);
    res.status(status).json(body);
  }
}
