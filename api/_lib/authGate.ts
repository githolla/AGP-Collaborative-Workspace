/**
 * Supabase-auth gate for /api handlers.
 *
 * AUTH_REQUIRED=true enables signed-in-only mode. Tokens are validated by
 * Supabase Auth (`/auth/v1/user`) using the project's service key.
 */

export interface AuthGateResult {
  authorized: boolean;
  status: number;
  body?: unknown;
  user?: { name?: string; email?: string };
}

/** `id`/`role` are already present on Supabase's real `/auth/v1/user`
 * response — carried here (not just email/name) so `requireUser.ts` can use
 * this same verification for the collab-schema endpoints, which need the
 * verified user id to scope every RLS-enforced query to. */
interface SupabaseUser {
  id?: string;
  role?: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
}

export async function verifySupabaseToken(token: string, url: string, serviceRoleKey: string): Promise<{ ok: boolean; reason?: string; user?: SupabaseUser }> {
  try {
    const res = await fetch(`${url}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: serviceRoleKey,
      },
    });
    if (!res.ok) return { ok: false, reason: `supabase user lookup failed (${res.status})` };
    const user = (await res.json()) as SupabaseUser;
    return { ok: true, user };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "supabase auth unavailable" };
  }
}

/**
 * Endpoint gate. Open mode (AUTH_REQUIRED unset) authorizes everything.
 * With AUTH_REQUIRED=true, a valid Supabase bearer token is required.
 */
export async function requireAuth(authorizationHeader: string | undefined): Promise<AuthGateResult> {
  if (process.env.AUTH_REQUIRED !== "true") return { authorized: true, status: 200 };

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    return { authorized: false, status: 500, body: { error: "AUTH_REQUIRED set but SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY missing" } };
  }

  const token = authorizationHeader?.startsWith("Bearer ") ? authorizationHeader.slice(7) : undefined;
  if (!token) return { authorized: false, status: 401, body: { error: "sign-in required" } };

  const result = await verifySupabaseToken(token, url, serviceRoleKey);
  if (!result.ok) return { authorized: false, status: 401, body: { error: `invalid token: ${result.reason}` } };

  const meta = (result.user?.user_metadata ?? {}) as Record<string, unknown>;
  const name =
    (typeof meta.full_name === "string" && meta.full_name.trim()) ||
    (typeof meta.name === "string" && meta.name.trim()) ||
    undefined;
  return {
    authorized: true,
    status: 200,
    user: { ...(name ? { name } : {}), ...(result.user?.email ? { email: result.user.email } : {}) },
  };
}
