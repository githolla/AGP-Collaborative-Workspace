/**
 * The one place a `collab.access_grant` row's real SharePoint permission is
 * actually revoked on Graph — shared by every endpoint that removes a grant
 * (api/grant.ts's single DELETE, api/grant/revoke-all.ts, api/external.ts's
 * removal, api/admin/offboard.ts, api/admin/workspace/clear.ts), so the
 * "the DB row and the real SharePoint permission must never diverge" rule
 * is enforced in exactly one place rather than hand-copied per caller —
 * found duplicated (and already drifted) across grant.ts/revoke-all.ts
 * during a code review, which is plausibly why the other three callers
 * never had it at all.
 *
 * A grant with no `msPermissionId` never held real SharePoint access (a
 * "half-grant") — nothing to revoke there, always `{ kind: "ok" }`.
 */

import postgres from "postgres";
import { graphFetch, GraphError } from "./graph.js";

export type GrantRevokeOutcome =
  | { kind: "ok" }
  | { kind: "graph_token_required" }
  | { kind: "unresolvable" }
  | { kind: "graph_failed"; err: unknown };

/** Human-readable reason for a failed outcome — for endpoints (revoke-all,
 * offboard) that report per-item results in a 200 response rather than
 * failing the whole request. */
export function describeGrantRevokeOutcome(outcome: GrantRevokeOutcome): string {
  switch (outcome.kind) {
    case "ok":
      return "revoked";
    case "graph_token_required":
      return "no X-Graph-Token provided";
    case "unresolvable":
      return "account or folder no longer resolvable";
    case "graph_failed":
      return outcome.err instanceof GraphError ? `${outcome.err.status}: ${outcome.err.detail}` : outcome.err instanceof Error ? outcome.err.message : "Graph request failed";
  }
}

export async function revokeGrantSharePoint(
  tx: postgres.TransactionSql,
  accountId: string,
  kantataId: string,
  msPermissionId: string | null,
  graphToken: string | undefined,
): Promise<GrantRevokeOutcome> {
  if (!msPermissionId) return { kind: "ok" };
  if (!graphToken) return { kind: "graph_token_required" };

  const [account] = await tx<{ ms_drive_id: string | null }[]>`select ms_drive_id from collab.client_account where id = ${accountId}`;
  const [folder] = await tx<{ folder_id: string }[]>`select folder_id from collab.ms_folder where account_id = ${accountId} and kantata_id = ${kantataId}`;
  if (!account?.ms_drive_id || !folder) return { kind: "unresolvable" };

  try {
    await graphFetch(graphToken, `/drives/${account.ms_drive_id}/items/${folder.folder_id}/permissions/${msPermissionId}`, { method: "DELETE" });
    return { kind: "ok" };
  } catch (err) {
    return { kind: "graph_failed", err };
  }
}
