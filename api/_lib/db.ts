/**
 * Direct Postgres access for the collab schema (teams-provisioning-plan.md
 * B6). `collab` is not exposed through Supabase's auto-generated REST API —
 * only `public`/`graphql_public` are, and widening that list means a
 * `supabase config push`, which would risk overwriting real project settings
 * that aren't reflected in this repo's freshly-generated config.toml. So this
 * connects to Postgres directly and reproduces, by hand, exactly what
 * PostgREST does per request: switch to the `authenticated` role and set the
 * JWT claims Postgres's RLS policies (and the real `auth.uid()`) read.
 *
 * SUPABASE_DB_URL must be the TRANSACTION POOLER connection string (port
 * 6543) — see .env.example. The direct connection (5432) exhausts its limit
 * fast under Vercel's short-lived, highly concurrent invocation pattern.
 */

import postgres from "postgres";

let client: postgres.Sql | null = null;

function getClient(): postgres.Sql {
  if (client) return client;
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error("SUPABASE_DB_URL not set");
  client = postgres(url, {
    // One connection per warm serverless instance; the Transaction pooler is
    // what actually multiplexes across instances. Reusing this across warm
    // invocations is safe ONLY because every real query below runs inside
    // its own transaction with SET LOCAL — nothing here is shared ACROSS
    // requests, just the underlying TCP connection.
    max: 1,
    // Supavisor's transaction-pooling mode does not support named prepared
    // statements (a statement prepared on one pooled backend connection may
    // be replayed against a different one). Required with this pooler mode.
    prepare: false,
  });
  return client;
}

/**
 * Runs `fn` with Postgres RLS enforcing as `userId` — the hand-rolled
 * equivalent of what PostgREST does automatically per request.
 *
 * `userId` MUST already be independently verified before this is called
 * (api/_lib/requireUser.ts verifies the bearer token against Supabase Auth's
 * own signature check via `/auth/v1/user`). This function has no way to
 * verify anything itself — it trusts `userId` completely, so calling it with
 * an unverified value is a full authentication bypass, not a lesser bug.
 *
 * Both `request.jwt.claims` (the JSON form Postgres's real auth.uid() reads)
 * and `request.jwt.claim.sub` (the flattened form some Postgres/PostgREST
 * versions use) are set, matching what PostgREST itself sets, so this
 * behaves identically regardless of which form a given policy or helper
 * function happens to read.
 *
 * `set_config(..., true)` — not a raw `SET LOCAL '...'` string — so the
 * claims value is bound as a real query parameter. userId is already a
 * verified UUID with nothing attacker-controlled in it, but binding it
 * costs nothing and closes the door on it ever becoming an injection point
 * if that ever changes.
 *
 * Scoped to one transaction (`sql.begin`), so SET LOCAL cannot leak between
 * requests even though the underlying connection is reused across warm
 * invocations — it stops applying the moment this transaction ends.
 */
export async function withUserContext<T>(userId: string, fn: (sql: postgres.TransactionSql) => Promise<T>): Promise<T> {
  const db = getClient();
  const claims = JSON.stringify({ sub: userId, role: "authenticated" });
  // `begin`'s declared return type is `Promise<UnwrapPromiseArray<T>>`, a
  // special case for callbacks that resolve to an array (postgres.js's own
  // batch-query convenience). It never unifies with a plain `Promise<T>` at
  // the type level, even though for any T this function is actually called
  // with — none of them are arrays — the two are identical at runtime. The
  // cast is narrow and understood, not a strictness bypass.
  return db.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claims}, true)`;
    await tx`select set_config('request.jwt.claim.sub', ${userId}, true)`;
    await tx`set local role authenticated`;
    return fn(tx);
  }) as Promise<T>;
}

/**
 * The one deliberate crossing of "always scope by the caller's own JWT"
 * (api-spec-workspace-mutations.md rule 1: "SUPABASE_SERVICE_ROLE_KEY
 * appears only in migrations and the two admin operations that deliberately
 * cross user boundaries"). No role switch, no JWT claim set — runs as
 * whatever SUPABASE_DB_URL's own login role is (Supabase's elevated
 * connection role, not `authenticated`), which can read `auth.users`
 * directly. `authenticated` never can: `collab.app_user` deliberately has
 * no `email` column (0007's own comment — an external collaborator has no
 * business appearing in anything roster-shaped), so resolving "which
 * account belongs to this email" before any RLS-scoped identity exists yet
 * has no other path.
 *
 * ONLY for that narrow lookup (api/admin/users.ts, api/admin/offboard.ts),
 * and ONLY ever called after an explicit `collab.is_app_admin()` check has
 * already passed inside a real `withUserContext` transaction — this
 * function has no authorization logic of its own, exactly like
 * `withUserContext` trusts its caller to have verified the bearer token
 * first.
 */
export async function withServiceContext<T>(fn: (sql: postgres.TransactionSql) => Promise<T>): Promise<T> {
  const db = getClient();
  return db.begin(async (tx) => fn(tx)) as Promise<T>;
}
