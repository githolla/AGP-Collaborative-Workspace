/**
 * POST /api/admin/offboard — `POST /api/admin/externals/:userId/offboard`
 * (docs/api-spec-workspace-mutations.md), replacing `offboardEverywhere`.
 * `userId` travels in the body (this repo's flat/id-in-body convention),
 * not the path.
 *
 * store.ts's version only ever touched `externals` and `shares` — there was
 * no separate grants table in the old document model; access WAS the
 * externals row plus a coarse access enum. In this schema, access_grant is
 * the REAL mechanism (removeExternal's own comment: "removal revokes access
 * across the workspace immediately"), so offboarding here also revokes
 * every access_grant row for this person — leaving them behind would be a
 * silent, stale hole in exactly the place offboarding is supposed to close.
 *
 * Same "DB row and real SharePoint permission must never diverge" rule
 * api/grant.ts/api/grant/revoke-all.ts/api/external.ts follow (all four now
 * share api/_lib/grantRevoke.ts) — a grant whose Graph revoke can't be
 * confirmed (no token, unresolvable folder, a Graph error) keeps its row
 * and is reported as a failure rather than being deleted anyway; this is a
 * cross-account bulk action so partial failure is per-grant, never
 * swallowed (api-spec rule 6), same as revoke-all.
 *
 * Every write here is scoped by `is_workspace_admin(account_id)` per row
 * (external_link_delete, access_grant_delete, share_update's admin branch),
 * which `is_app_admin()` satisfies for every account — no service-role
 * crossing needed, unlike api/admin/users.ts.
 *
 * No not_found path: this is a global admin action, not a single-resource
 * one, so there is no row whose existence needs hiding from an unauthorized
 * caller (the isAppAdmin gate already refused them before this ever runs) —
 * removing zero rows for an id nobody holds is simply nothing to do.
 */

import { requireUser } from "../_lib/requireUser.js";
import { withUserContext } from "../_lib/db.js";
import { isAppAdmin } from "../_lib/requireAppAdmin.js";
import { toApiError } from "../_lib/apiError.js";
import { graphTokenFrom } from "../_lib/graph.js";
import { revokeGrantSharePoint, describeGrantRevokeOutcome } from "../_lib/grantRevoke.js";

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

  const targetUserId = typeof (req.body as { userId?: unknown })?.userId === "string" ? (req.body as { userId: string }).userId : "";
  if (!targetUserId) {
    res.status(400).json({ error: { code: "validation_failed", message: "userId is required" } });
    return;
  }

  try {
    const graphToken = graphTokenFrom(req.headers) ?? undefined;
    const result = await withUserContext(callerId, async (tx) => {
      // Revoke every real grant BEFORE removing any external_link — same
      // "never diverge" rule the single/bulk grant revoke and api/external.ts
      // follow. A grant whose Graph revoke can't be confirmed keeps its row
      // and blocks removing the external_link on THAT account (they'd still
      // hold real access there); every other account this person is on
      // still gets fully offboarded in the same call.
      const grants = await tx<{ id: string; account_id: string; kantata_id: string; ms_permission_id: string | null }[]>`
        select id, account_id, kantata_id, ms_permission_id from collab.access_grant where user_id = ${targetUserId}
      `;
      let grantsRevoked = 0;
      const blockedAccountIds = new Set<string>();
      const failures: { accountId: string; kantataId: string; detail: string }[] = [];
      for (const g of grants) {
        const outcome = await revokeGrantSharePoint(tx, g.account_id, g.kantata_id, g.ms_permission_id, graphToken);
        if (outcome.kind === "ok") {
          await tx`delete from collab.access_grant where id = ${g.id}`;
          grantsRevoked += 1;
        } else {
          blockedAccountIds.add(g.account_id);
          failures.push({ accountId: g.account_id, kantataId: g.kantata_id, detail: describeGrantRevokeOutcome(outcome) });
        }
      }

      const externalLinks =
        blockedAccountIds.size > 0
          ? await tx<{ id: string }[]>`delete from collab.external_link where user_id = ${targetUserId} and not (account_id = any(${[...blockedAccountIds]})) returning id`
          : await tx<{ id: string }[]>`delete from collab.external_link where user_id = ${targetUserId} returning id`;
      const shares = await tx<{ id: string }[]>`
        update collab.share
        set revoked_at = now(), revoked_by = 'cross-workspace offboard'
        where recipient_user_id = ${targetUserId} and revoked_at is null
        returning id
      `;
      return { externalLinks: externalLinks.length, grants: grantsRevoked, shares: shares.length, failures };
    });

    res.status(200).json({
      data: {
        userId: targetUserId,
        externalLinksRemoved: result.externalLinks,
        grantsRevoked: result.grants,
        sharesRevoked: result.shares,
        ...(result.failures.length > 0
          ? { incomplete: result.failures, note: `${result.failures.length} grant(s) could not be confirmed revoked on SharePoint — those accounts' external access was NOT removed` }
          : {}),
      },
    });
  } catch (err) {
    const { status, body } = toApiError(err);
    res.status(status).json(body);
  }
}
