/**
 * POST /api/admin/workspace/clear — `POST /api/admin/workspace/clear`
 * (docs/api-spec-workspace-mutations.md), replacing `clearWorkspace`.
 *
 * THE SINGLE MOST DESTRUCTIVE ENDPOINT IN THIS API SURFACE. store.ts's
 * `clearWorkspace` wipes the OLD document model's in-memory `accounts`
 * array — reversible in the sense that nothing was ever committed anywhere
 * durable beyond localStorage/the shared JSON blob. This is the Postgres
 * equivalent, and there is no equivalent softness: it `DELETE`s every
 * `collab.client_account` row for real, and every table with an `on delete
 * cascade` back to it (account_member, external_link, access_grant, task,
 * thread_message, campaign, activity, ms_folder, share, file_approval — see
 * 0007) goes with it. There is no undo. `app_admin` rows survive (their
 * account_id is null, matching store.ts's own "sign-in accounts survive").
 *
 * TWO-STEP CONFIRMATION (api/_lib/adminConfirm.ts), not a single boolean —
 * a `{ confirm: true }` field alone is trivially satisfied by resending a
 * copied curl command:
 *
 *  1. Call with no confirmToken -> returns how many accounts would be
 *     deleted and a signed, 5-minute token pinned to that exact count.
 *     Nothing is deleted yet.
 *  2. Call again with `{ confirm: true, confirmToken }` before it expires
 *     -> the count is recomputed fresh and must still match the token's
 *     snapshot (if it doesn't, something changed and a new token is
 *     required) -> only then does the delete run.
 *
 * client_account has no DELETE policy in 0008 at all — under RLS as
 * `authenticated`, nobody can delete a client_account row today, which is
 * deliberate everywhere else (accounts are archived, never deleted).
 * Deleting here therefore needs `withServiceContext` (db.ts) rather than a
 * new policy: adding a client_account_delete policy would let any
 * workspace_admin delete their own account outright, which nothing else in
 * this plan wants — this endpoint is the documented, narrow exception, not
 * a gap to close more broadly.
 *
 * SAME "never diverge" RULE AS EVERY OTHER GRANT-DELETING ENDPOINT (grant.ts,
 * grant/revoke-all.ts, external.ts, admin/offboard.ts — all sharing
 * api/_lib/grantRevoke.ts), at system-wide scale: before the actual delete
 * runs, EVERY access_grant row across EVERY account with a real SharePoint
 * permission must be confirmed revoked on Graph. If even one can't be (no
 * token, an unresolvable folder, a Graph error), the WHOLE clear is refused
 * and nothing is deleted — there is no such thing as "mostly cleared" for
 * an action with no undo; partial completion here would be worse than
 * doing nothing. The confirm-token step (below) still runs first regardless
 * (so a caller learns the account count before committing to anything),
 * and the Graph pass only runs on the real, confirmed second call.
 */

import { requireUser } from "../../_lib/requireUser.js";
import { withUserContext, withServiceContext } from "../../_lib/db.js";
import { isAppAdmin } from "../../_lib/requireAppAdmin.js";
import { issueConfirmToken, verifyConfirmToken } from "../../_lib/adminConfirm.js";
import { toApiError } from "../../_lib/apiError.js";
import { graphTokenFrom } from "../../_lib/graph.js";
import { revokeGrantSharePoint, describeGrantRevokeOutcome } from "../../_lib/grantRevoke.js";

const ACTION = "workspace-clear";

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
  const callerId = auth.userId!;

  if (!(await isAppAdmin(callerId))) {
    res.status(403).json({ error: { code: "forbidden", message: "app admins only" } });
    return;
  }

  const b = req.body as { confirm?: unknown; confirmToken?: unknown } | undefined;
  const confirm = b?.confirm === true;
  const confirmToken = typeof b?.confirmToken === "string" ? b.confirmToken : "";

  const [countRow] = await withUserContext(callerId, async (tx) => {
    // is_app_admin() already lets this count see every account regardless
    // of who created it — client_account_read's policy, not a new one.
    return tx<{ n: number }[]>`select count(*)::int as n from collab.client_account`;
  });
  const accountCount = countRow?.n ?? 0;

  if (!confirm || !confirmToken) {
    const { token, expiresAt } = issueConfirmToken({ action: ACTION, adminUserId: callerId, snapshot: accountCount });
    res.status(200).json({
      data: {
        accountsToDelete: accountCount,
        confirmToken: token,
        expiresAt,
        message: `This will PERMANENTLY delete ${accountCount} account(s) and everything under them. Call again with { confirm: true, confirmToken } before ${expiresAt} to proceed.`,
      },
    });
    return;
  }

  const verified = verifyConfirmToken(confirmToken, { action: ACTION, adminUserId: callerId, snapshot: accountCount });
  if (!verified.ok) {
    res.status(400).json({ error: { code: "validation_failed", message: `confirmation rejected: ${verified.reason}` } });
    return;
  }

  try {
    const graphToken = graphTokenFrom(req.headers) ?? undefined;

    // Revoke EVERY real SharePoint permission, system-wide, before touching
    // any account row — access_grant_read's policy already lets an app
    // admin see every account's grants (is_workspace_admin() returns true
    // for is_app_admin()), so a plain withUserContext call reaches all of
    // them, same as the count query above.
    const failures = await withUserContext(callerId, async (tx) => {
      const grants = await tx<{ id: string; account_id: string; kantata_id: string; ms_permission_id: string | null }[]>`
        select id, account_id, kantata_id, ms_permission_id from collab.access_grant
      `;
      const out: { accountId: string; kantataId: string; detail: string }[] = [];
      for (const g of grants) {
        const outcome = await revokeGrantSharePoint(tx, g.account_id, g.kantata_id, g.ms_permission_id, graphToken);
        if (outcome.kind !== "ok") out.push({ accountId: g.account_id, kantataId: g.kantata_id, detail: describeGrantRevokeOutcome(outcome) });
      }
      return out;
    });

    if (failures.length > 0) {
      res.status(409).json({
        error: {
          code: "conflict",
          message: `${failures.length} SharePoint permission(s) could not be confirmed revoked — nothing was deleted`,
          detail: failures.map((f) => `${f.accountId}/${f.kantataId}: ${f.detail}`).join("; "),
        },
      });
      return;
    }

    const deleted = await withServiceContext(async (tx) => {
      return tx<{ id: string }[]>`delete from collab.client_account returning id`;
    });
    res.status(200).json({ data: { accountsDeleted: deleted.length } });
  } catch (err) {
    const { status, body } = toApiError(err);
    res.status(status).json(body);
  }
}
