import { msApiCallPlain, msApiGetPlain, msApiCallOptionalGraphToken } from "./msApiFetch.js";
import type { ImportResult } from "./msTasks.js";

/**
 * Plain Postgres writes for account_member / external_link
 * (teams-provisioning-plan.md B5/B7) — no Graph token needed, unlike
 * msProvision.ts/msShare.ts/msFiles.ts. These are the roster/roll-call rows;
 * the Graph-facing actions (add to Team, invite a guest, grant a folder)
 * are separate calls in those other modules.
 */

export interface MemberResult {
  id: string;
  accountId: string;
  personId: string;
  name: string;
  title?: string;
  email?: string;
  createdAt: string;
  note?: string;
}

/** `personId` is the Kantata roster id, when adding from that roster
 * (CollaborateHub's quick-add, ClientAdminPanel's MembershipPanel) — omit it
 * for someone typed in by hand, matching the old model's
 * addAccountMember/addAccountMemberNamed split, now unified into one call. */
export async function addMember(accountId: string, name: string, opts: { title?: string; email?: string; personId?: string } = {}): Promise<MemberResult> {
  return msApiCallPlain<MemberResult>("/api/member", { body: { accountId, name, ...opts } });
}

export async function setMemberEmail(memberId: string, email: string): Promise<MemberResult> {
  return msApiCallPlain<MemberResult>("/api/member", { method: "PATCH", body: { memberId, email } });
}

export interface ResolveMemberEmailsResult {
  matched: { memberId: string; name: string; email: string }[];
  unmatched: string[];
}

/** Backfills email for every member on this account with none on file, by
 * name-matching Kantata's own staff roster live (B5) — never overwrites an
 * email an admin already set by hand. */
export async function resolveMemberEmails(accountId: string): Promise<ResolveMemberEmailsResult> {
  return msApiCallPlain<ResolveMemberEmailsResult>("/api/account-members-resolve-emails", { body: { accountId } });
}

export interface ExternalResult {
  id: string;
  accountId: string;
  userId?: string;
  name: string;
  org: string;
  role: "client" | "contractor";
  email?: string;
  entraStatus: "none" | "invited" | "active";
  entraUserId?: string;
  note?: string;
}

/** `userId` is set only by the "pick an existing person" picker
 * (ClientAdminPanel.tsx) — an already-known collab.app_user id, so the
 * created row is born resolved instead of waiting on a future
 * "Resolve sign-in". Never typed by hand. */
export async function addExternal(accountId: string, name: string, org: string, role: "client" | "contractor", email?: string, userId?: string): Promise<ExternalResult> {
  return msApiCallPlain<ExternalResult>("/api/external", { body: { accountId, name, org, role, ...(email ? { email } : {}), ...(userId ? { userId } : {}) } });
}

/** Optional-token, not plain: removing an external now must revoke any real
 * SharePoint access they hold first (api/external.ts's own header) — a
 * token-less call still succeeds for someone with no real grants, but
 * throws with a clear reason if a real permission couldn't be confirmed
 * revoked, rather than silently leaving it live. */
export async function removeExternal(externalId: string, loginHintEmail?: string | undefined): Promise<{ id: string }> {
  return msApiCallOptionalGraphToken<{ id: string }>("/api/external", { method: "DELETE", body: { externalId }, loginHintEmail });
}

/** Tries to link an external's `email` to an already-signed-in
 * `collab.app_user`, so a grant can target them (api/external.ts's own
 * header explains why this bridge has to be explicit and admin-triggered).
 * A `note` on the result means it did NOT resolve — no signed-in account
 * yet, or no email on file — never a thrown error for that case. */
export async function resolveExternalIdentity(externalId: string): Promise<ExternalResult> {
  return msApiCallPlain<ExternalResult>("/api/external", { method: "PATCH", body: { externalId, resolveIdentity: true } });
}

export interface AdminExternalRow {
  id: string;
  accountId: string;
  clientName: string;
  userId?: string;
  name: string;
  org: string;
  role: "client" | "contractor";
  email?: string;
  entraStatus: "none" | "invited" | "active";
  lastActive?: string;
  createdAt: string;
}

/** Every external across every workspace — app_admin only (GET /api/admin/externals
 * 403s otherwise). Powers the "pick an existing person" search in
 * ClientAdminPanel.tsx's GrantPanel; callers should treat a rejected
 * promise as "no picker for this caller," not an error to surface. */
export async function fetchAllExternals(): Promise<{ externals: AdminExternalRow[] }> {
  return msApiGetPlain<{ externals: AdminExternalRow[] }>("/api/admin/externals");
}

/** Unions the given ids into the account's existing linked set and
 * re-imports (`api/account-projects.ts`) — same `ImportResult` shape as
 * `msTasks.ts`'s `importFromKantata`/`setAccountScope`, since it ends in the
 * same re-import step they do. */
export async function linkKantataProjects(accountId: string, kantataProjectIds: string[]): Promise<ImportResult> {
  return msApiCallPlain<ImportResult>("/api/account-projects", { body: { accountId, kantataProjectIds } });
}

export interface CreateAccountResult {
  id: string;
  clientName: string;
  archived: boolean;
  createdAt: string;
}

export async function createAccount(clientName: string): Promise<CreateAccountResult> {
  return msApiCallPlain<CreateAccountResult>("/api/account", { body: { clientName } });
}

/** `PATCH /api/account` — replaces `renameAccount`/`setAccountArchived`.
 * At least one of `clientName`/`archived` is required (api/account.ts's own
 * validation); pass only the field actually changing. */
export async function updateAccount(accountId: string, patch: { clientName?: string; archived?: boolean }): Promise<CreateAccountResult> {
  return msApiCallPlain<CreateAccountResult>("/api/account", { method: "PATCH", body: { id: accountId, ...patch } });
}
