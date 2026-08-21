/**
 * GET/POST/DELETE /api/admin/users — `GET`/`POST`/`DELETE /api/admin/users`
 * (docs/api-spec-workspace-mutations.md), replacing `addSignInAccount`/
 * `removeSignInAccount` — "now role assignment, not password creation": the
 * old app-password team accounts are gone (Entra guests + Supabase Auth own
 * every identity now), so this manages who holds the global `app_admin`
 * role, keyed by email rather than an internal id, since that's the only
 * identifier an admin actually has for someone else.
 *
 * SCOPE: `app_admin` only. `workspace_admin` needs an `accountId`
 * (collab.user_role's own NOT NULL constraint), which the spec's documented
 * body (`{ email, role }`, no accountId) doesn't carry — that role is
 * granted through account creation's own bootstrap, not here. A request
 * naming any role other than "app_admin" is rejected rather than silently
 * ignored.
 *
 * Resolving an email to a user id needs `withServiceContext` (db.ts) —
 * `collab.app_user` has no email column, only `auth.users` does, and
 * `authenticated` cannot read that table. Always called AFTER an explicit
 * `isAppAdmin` check, never before — see db.ts's own header.
 *
 * Idempotent (api-spec rule 5): granting an existing admin, or revoking a
 * non-admin, is a no-op success, never a conflict or a 404.
 */

import { requireUser } from "../_lib/requireUser.js";
import { withUserContext, withServiceContext } from "../_lib/db.js";
import { isAppAdmin } from "../_lib/requireAppAdmin.js";
import { toApiError } from "../_lib/apiError.js";

interface AdminRow {
  user_id: string;
  email: string;
  display_name: string;
  granted_at: string;
}

async function findUserIdByEmail(email: string): Promise<string | null> {
  const [row] = await withServiceContext(async (tx) => {
    return tx<{ id: string }[]>`select id from auth.users where lower(email) = lower(${email}) limit 1`;
  });
  return row?.id ?? null;
}

async function handleList(
  res: { status: (code: number) => { json: (body: unknown) => void } },
): Promise<void> {
  // The list itself also needs auth.users (for email) — collab.app_user
  // carries display_name/title but not email, same reason as above.
  const rows = await withServiceContext(async (tx) => {
    return tx<AdminRow[]>`
      select r.user_id, u.email, au.display_name, r.created_at as granted_at
      from collab.user_role r
      join auth.users u on u.id = r.user_id
      join collab.app_user au on au.id = r.user_id
      where r.role = 'app_admin'
      order by r.created_at
    `;
  });
  res.status(200).json({
    data: { admins: rows.map((r) => ({ userId: r.user_id, email: r.email, name: r.display_name, grantedAt: r.granted_at })) },
  });
}

async function handleGrant(
  body: unknown,
  callerId: string,
  res: { status: (code: number) => { json: (body: unknown) => void } },
): Promise<void> {
  const b = body as { email?: unknown; role?: unknown };
  const email = typeof b.email === "string" ? b.email.trim() : "";
  const role = typeof b.role === "string" ? b.role : "app_admin";
  if (!email || role !== "app_admin") {
    res.status(400).json({ error: { code: "validation_failed", message: "email is required and role must be 'app_admin'" } });
    return;
  }

  const targetId = await findUserIdByEmail(email);
  if (!targetId) {
    res.status(404).json({ error: { code: "not_found", message: "no signed-in user with that email yet" } });
    return;
  }

  try {
    const result = await withUserContext(callerId, async (tx) => {
      const [existing] = await tx<{ id: string }[]>`select id from collab.user_role where user_id = ${targetId} and role = 'app_admin'`;
      if (existing) return { kind: "existing" as const };

      const [created] = await tx<{ id: string }[]>`
        insert into collab.user_role (user_id, role, granted_by)
        values (${targetId}, 'app_admin', ${callerId})
        returning id
      `;
      if (!created) throw new Error("insert returned no row");
      return { kind: "created" as const };
    });

    res.status(200).json({ data: { userId: targetId, email, role: "app_admin", ...(result.kind === "existing" ? { note: "already an app admin — no change made" } : {}) } });
  } catch (err) {
    const { status, body: errBody } = toApiError(err);
    res.status(status).json(errBody);
  }
}

async function handleRevoke(
  body: unknown,
  callerId: string,
  res: { status: (code: number) => { json: (body: unknown) => void } },
): Promise<void> {
  const email = typeof (body as { email?: unknown })?.email === "string" ? (body as { email: string }).email.trim() : "";
  if (!email) {
    res.status(400).json({ error: { code: "validation_failed", message: "email is required" } });
    return;
  }

  const targetId = await findUserIdByEmail(email);
  // No account here to make ambiguous between "wrong id" and "no access" —
  // a genuinely unknown email is just a no-op: there was nothing to revoke.
  if (!targetId) {
    res.status(200).json({ data: { email, removed: false } });
    return;
  }

  try {
    const [deleted] = await withUserContext(callerId, async (tx) => {
      return tx<{ id: string }[]>`delete from collab.user_role where user_id = ${targetId} and role = 'app_admin' returning id`;
    });
    res.status(200).json({ data: { userId: targetId, email, removed: !!deleted } });
  } catch (err) {
    const { status, body } = toApiError(err);
    res.status(status).json(body);
  }
}

export default async function handler(
  req: { method?: string; body?: unknown; headers?: Record<string, string | string[] | undefined> },
  res: {
    status: (code: number) => { json: (body: unknown) => void };
    setHeader: (k: string, v: string) => void;
  },
): Promise<void> {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET" && req.method !== "POST" && req.method !== "DELETE") {
    res.status(405).json({ error: { code: "validation_failed", message: "GET, POST or DELETE" } });
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

  if (req.method === "GET") await handleList(res);
  else if (req.method === "POST") await handleGrant(req.body, callerId, res);
  else await handleRevoke(req.body, callerId, res);
}
