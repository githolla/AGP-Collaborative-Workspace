/**
 * POST /api/grant/revoke-all — `revokeAllForPerson`
 * (docs/api-spec-workspace-mutations.md). A real static path segment (not a
 * dynamic `[id]` route), so it lives alongside ../grant.ts as its own file
 * rather than a body-discriminated branch of it — matching the spec's literal
 * route rather than overloading POST /api/grant with a third meaning.
 *
 * Reads every access_grant row for one (account, user) pair and, for each
 * one that has a real SharePoint permission, revokes it on Graph via the
 * caller's own delegated token BEFORE deleting that row — same rule
 * grant.ts's single delete follows: the DB record and the actual SharePoint
 * access must never diverge, so a grant whose Graph revoke fails (no token,
 * unresolvable folder, a Graph error) keeps its row and is reported as a
 * failure, while the rest of the batch still proceeds. A grant with no
 * SharePoint permission at all (a half-grant) has nothing to revoke there
 * and its row is deleted immediately. Partial failure per grant is
 * recorded, never swallowed (api-spec rule 6) — this is the one place B7
 * explicitly calls out ("revoke-all across levels with one DELETE failing").
 *
 * Unlike a single-target delete (grant.ts, external.ts), a bulk delete's
 * "0 rows affected" is ambiguous in a way a single row's isn't: it means
 * either "authorized, and there was nothing to revoke" (a legitimate,
 * idempotent no-op) or "not authorized for this account at all" (RLS simply
 * filtered every row out silently). Those must not collapse into the same
 * response — the first is a real success, the second would tell an
 * unauthorized caller they'd revoked access when nothing happened. So this
 * checks is_workspace_admin explicitly before deleting, rather than reading
 * the delete's row count as the only signal.
 */

import { requireUser } from "../_lib/requireUser.js";
import { withUserContext } from "../_lib/db.js";
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

  const b = req.body as { accountId?: unknown; userId?: unknown };
  const accountId = typeof b?.accountId === "string" ? b.accountId : "";
  const targetUserId = typeof b?.userId === "string" ? b.userId : "";
  if (!accountId || !targetUserId) {
    res.status(400).json({ error: { code: "validation_failed", message: "accountId and userId are required" } });
    return;
  }

  try {
    const graphToken = graphTokenFrom(req.headers) ?? undefined;
    const result = await withUserContext(auth.userId!, async (tx) => {
      const [access] = await tx<{ ok: boolean }[]>`select collab.is_workspace_admin(${accountId}) as ok`;
      if (!access?.ok) return { kind: "forbidden" as const };

      const grants = await tx<{ id: string; kantata_id: string; ms_permission_id: string | null }[]>`
        select id, kantata_id, ms_permission_id from collab.access_grant where account_id = ${accountId} and user_id = ${targetUserId}
      `;
      if (grants.length === 0) return { kind: "ok" as const, results: [] as { kantataId: string; sharePoint: string; detail: string }[], removedCount: 0 };

      // The DB row and the real SharePoint permission must never diverge —
      // same rule api/grant.ts's single-delete follows (both now share
      // api/_lib/grantRevoke.ts, after this and grant.ts's own copy of this
      // logic were found to have already drifted from each other). A grant
      // with a real ms_permission_id only has its row deleted once the Graph
      // revoke actually succeeds; a failure (no token, unresolvable folder,
      // a Graph error) leaves that ONE row in place and reports it, while
      // the rest of the batch still proceeds (partial failure, never
      // swallowed — api-spec rule 6).
      const results: { kantataId: string; sharePoint: string; detail: string }[] = [];
      let removedCount = 0;
      for (const g of grants) {
        const outcome = await revokeGrantSharePoint(tx, accountId, g.kantata_id, g.ms_permission_id, graphToken);
        results.push({ kantataId: g.kantata_id, sharePoint: outcome.kind === "ok" ? "granted" : "failed", detail: describeGrantRevokeOutcome(outcome) });
        if (outcome.kind === "ok") {
          await tx`delete from collab.access_grant where id = ${g.id}`;
          removedCount += 1;
        }
      }

      return { kind: "ok" as const, results, removedCount };
    });

    if (result.kind === "forbidden") {
      // Collapsed into not_found, same as every other endpoint's write-miss
      // path — this never distinguishes "no such account" from "not yours to
      // manage" to an unauthorized caller.
      res.status(404).json({ error: { code: "not_found", message: "account not found" } });
      return;
    }

    res.status(200).json({
      data: {
        removed: result.removedCount,
        perGrant: result.results,
      },
    });
  } catch (err) {
    const { status, body } = toApiError(err);
    res.status(status).json(body);
  }
}
