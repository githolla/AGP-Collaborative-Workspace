import type { ClientAccount } from "./types.js";

/**
 * Role model (docs/teams-provisioning-plan.md Part D). Four roles: app admin,
 * workspace admin (per account), internal member, external. An external
 * never holds either admin role, by construction — see `ExternalMember.role`,
 * which selects their screens, not their permissions.
 *
 * HONEST LIMITATION: everything here is CLIENT-SIDE, presentation-layer
 * gating over today's shared-JSON-document store. It hides controls from a
 * normal user; it does not stop someone editing a request by hand, because
 * there is no server that checks a role yet. Real enforcement is B6's job —
 * a Postgres row-level-security policy checked on every `/api` call. This
 * module's shape (an allowlist for app admin, a per-account admin flag for
 * workspace admin) is deliberately the same shape B6's tables will take, so
 * nothing here is thrown away when that lands; it moves server-side.
 */

export type AppRole = "app_admin" | "workspace_admin" | "member" | "external";

/** Parse the comma-separated app-admin allowlist. Case- and
 * whitespace-insensitive, so a trailing space or a differently-cased email
 * in the env var doesn't silently fail to match. */
export function parseAdminAllowlist(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

function norm(email: string | undefined): string | undefined {
  const e = email?.trim().toLowerCase();
  return e && e.length > 0 ? e : undefined;
}

/** Is this email on the bootstrapped app-admin allowlist? */
export function isAppAdmin(email: string | undefined, allowlist: readonly string[]): boolean {
  const e = norm(email);
  if (!e) return false;
  return allowlist.includes(e);
}

/** Is this email a WORKSPACE admin on this specific account — a
 * `members[]` row for them marked `role: "admin"`? Never true for an
 * account the person isn't a member of, and never inferred from Kantata
 * participation. */
export function isWorkspaceAdmin(account: Pick<ClientAccount, "members"> | undefined, email: string | undefined): boolean {
  const e = norm(email);
  if (!account || !e) return false;
  return account.members.some((m) => m.role === "admin" && norm(m.email) === e);
}

/** App admin OR workspace admin for this account — the gate for "give a
 * person access": add/remove an external, grant or revoke a share, add an
 * internal member, promote another workspace admin. Flagging something
 * shareable (a task, a message) is NOT gated by this — any internal member
 * may do that (D1). */
export function canManageWorkspace(account: Pick<ClientAccount, "members"> | undefined, email: string | undefined, appAdminAllowlist: readonly string[]): boolean {
  return isAppAdmin(email, appAdminAllowlist) || isWorkspaceAdmin(account, email);
}

/** The role to report for a signed-in AGP person on one account — for
 * display only ("you are a workspace admin here"), not itself a gate. */
export function roleFor(account: Pick<ClientAccount, "members"> | undefined, email: string | undefined, appAdminAllowlist: readonly string[]): AppRole {
  if (isAppAdmin(email, appAdminAllowlist)) return "app_admin";
  if (isWorkspaceAdmin(account, email)) return "workspace_admin";
  return "member";
}
