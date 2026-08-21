/**
 * Auth gate for the collab-schema endpoints (teams-provisioning-plan.md B6),
 * deliberately separate from authGate.ts's `requireAuth`.
 *
 * `requireAuth` authorizes every request when AUTH_REQUIRED is unset — a
 * rollout toggle that made sense for the old shared-JSON-document world,
 * where there was no per-row access to protect. It does not make sense here:
 * every query against `collab.*` is scoped to a real, verified user id via
 * Postgres RLS (db.ts), so a request with no verified identity has nothing
 * to scope to and must be refused outright, unconditionally — never behind a
 * flag that could be left unset.
 */

import { verifySupabaseToken } from "./authGate.js";

export interface RequireUserResult {
  authorized: boolean;
  status: number;
  body?: unknown;
  /** Present only when authorized: true. */
  userId?: string;
  email?: string;
}

export async function requireUser(authorizationHeader: string | undefined): Promise<RequireUserResult> {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    return { authorized: false, status: 500, body: { error: { code: "unauthenticated", message: "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set" } } };
  }

  const token = authorizationHeader?.startsWith("Bearer ") ? authorizationHeader.slice(7) : undefined;
  if (!token) return { authorized: false, status: 401, body: { error: { code: "unauthenticated", message: "sign-in required" } } };

  const result = await verifySupabaseToken(token, url, serviceRoleKey);
  if (!result.ok || !result.user?.id) {
    return { authorized: false, status: 401, body: { error: { code: "unauthenticated", message: `invalid token: ${result.reason ?? "no user id in response"}` } } };
  }

  return {
    authorized: true,
    status: 200,
    userId: result.user.id,
    ...(result.user.email ? { email: result.user.email } : {}),
  };
}
