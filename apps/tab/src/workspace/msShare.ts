import { msApiCall, msApiCallOptionalGraphToken } from "./msApiFetch.js";

/**
 * Client-side grant actions (teams-provisioning-plan.md B7 "External access
 * — guests and folder grants"). Thin wrappers over api/grant.ts and
 * api/grant/revoke-all.ts — see msApiFetch.ts's header for why the actual
 * Graph invite/revoke calls run server-side rather than here.
 *
 * GRANT is "one action, two effects" (B7): it writes the `access_grant` row
 * AND attempts the SharePoint invite in the same request, and the response
 * always carries BOTH outcomes — `sharePoint: "failed"` is not thrown as an
 * error (the row is real either way, a "half-grant" the UI shows with a
 * retry), so callers must render it, never treat a resolved promise as
 * "fully granted."
 *
 * REVOKE is NOT the mirror of that: the DB row and the real SharePoint
 * permission must never diverge, so api/grant.ts's DELETE only ever
 * succeeds (200) once the SharePoint side is actually gone (or never
 * existed) — a resolved promise here really does mean fully revoked. A
 * revoke that couldn't reach SharePoint throws instead of silently
 * "succeeding" with the row deleted and real access left behind.
 */

export interface GrantResult {
  grantId: string;
  row: "created" | "updated" | "unchanged" | "deleted";
  sharePoint: "granted" | "failed";
  detail: string;
  msPermissionId?: string;
}

export interface RevokeGrantResult {
  grantId: string;
  row: "deleted";
}

/** Targets an already-resolved person (`userId`, `collab.app_user.id`) OR
 * one who hasn't signed in yet (`externalLinkId`, `collab.external_link.id`
 * — the row that exists the moment staff add the client, no sign-in
 * required). The latter is what lets the real Microsoft B2B invite fire off
 * an email address alone, before the person can possibly have signed in. */
export type GrantTarget = { userId: string } | { externalLinkId: string };

/** Grants (or re-grants/retries) one person one Kantata id, `read` or
 * `write`. Which role a given person gets is decided by the caller building
 * this UI, not by this function, which passes the role through as given. */
export async function grantAccess(
  accountId: string,
  target: GrantTarget,
  kantataId: string,
  level: "project" | "milestone" | "phase" | "task" | "folder",
  role: "read" | "write",
  loginHintEmail?: string | undefined,
): Promise<GrantResult> {
  return msApiCall<GrantResult>("/api/grant", { body: { accountId, ...target, kantataId, level, role }, loginHintEmail });
}

/** Optional-token, not `msApiCall`'s hard-required one: a grant with no real
 * SharePoint permission (a half-grant) has nothing to revoke there, so it
 * shouldn't force a Graph sign-in just to delete its own record. A grant
 * that DOES hold real access still needs a token to actually revoke it —
 * api/grant.ts's DELETE now enforces that itself (throws `graph_token_required`
 * rather than deleting the row without it), so trying without one first is
 * safe: it either succeeds (nothing real to revoke) or fails with a clear
 * reason, never a silent no-op that leaves real access behind. */
export async function revokeGrant(grantId: string, loginHintEmail?: string | undefined): Promise<RevokeGrantResult> {
  return msApiCallOptionalGraphToken<RevokeGrantResult>("/api/grant", { method: "DELETE", body: { grantId }, loginHintEmail });
}

export interface RevokeAllResult {
  removed: number;
  perGrant: { kantataId: string; sharePoint: string; detail: string }[];
}

/** Every grant one person holds on one account, revoked in one call — the
 * offboarding action (D5's "remove them everywhere" starts here, per grant
 * held; the tenant-guest removal itself is a separate admin action). Unlike
 * a single revoke, this ALWAYS resolves (never throws) since it's a batch —
 * `perGrant` carries the per-item outcome, and any grant whose SharePoint
 * side couldn't be confirmed revoked keeps its row rather than being
 * deleted anyway (api/grant/revoke-all.ts's own header). */
export async function revokeAllForPerson(accountId: string, userId: string, loginHintEmail?: string | undefined): Promise<RevokeAllResult> {
  return msApiCallOptionalGraphToken<RevokeAllResult>("/api/grant/revoke-all", { body: { accountId, userId }, loginHintEmail });
}
