/**
 * One-off backfill: `collab.handle_new_auth_user()` (0007) only fires on
 * NEW inserts into `auth.users` — every account that signed in before that
 * trigger existed has no `collab.app_user` row at all, and every FK
 * referencing it (client_account.created_by, user_role.user_id, etc.)
 * fails for them. This inserts exactly what the trigger would have,
 * for every `auth.users` row missing one — same kind rule
 * (`@teamallegiance.com` -> internal, else external), same display-name
 * fallback chain. `on conflict do nothing`, so it's safe to re-run.
 */
import "dotenv/config";
import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.SUPABASE_DB_URL!, { max: 1 });
  const missing = await sql<{ id: string; email: string; raw_user_meta_data: Record<string, unknown> | null }[]>`
    select u.id, u.email, u.raw_user_meta_data
    from auth.users u
    left join collab.app_user a on a.id = u.id
    where a.id is null
  `;
  console.log(`${missing.length} auth.users row(s) with no collab.app_user row.`);
  for (const u of missing) {
    const meta = u.raw_user_meta_data ?? {};
    const displayName = (meta.full_name as string | undefined) || (meta.name as string | undefined) || u.email || "Unknown";
    const kind = /@teamallegiance\.com$/i.test(u.email) ? "internal" : "external";
    await sql`
      insert into collab.app_user (id, display_name, kind)
      values (${u.id}, ${displayName}, ${kind})
      on conflict (id) do nothing
    `;
    console.log(`  ${u.id}  ${u.email}  -> ${kind} (${displayName})`);
  }
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
