-- Adds the UPDATE policy 0008 never gave collab.access_grant — a real gap,
-- not a formality: with none, RLS defaults to DENY for that command
-- entirely, regardless of any GRANT (0010's blanket table grant included).
-- Caught by testing: api/grant.ts's re-grant-with-a-different-role path
-- (an idempotent upsert, added in this same pass) tried to UPDATE an
-- existing row's role and silently affected 0 rows — not a caller-facing
-- 403 (RLS denials on UPDATE are silent, same as everywhere else in this
-- schema), just a confusing "update returned no row" error, since nothing
-- in code was watching for this specific failure mode.
--
-- Same shape as access_grant_insert/access_grant_delete: workspace_admin
-- only (is_workspace_admin() already covers app_admin via its own OR
-- branch) — a grant's role can be changed by whoever could grant or revoke
-- it in the first place, nothing broader.
create policy access_grant_update on collab.access_grant
  for update using (collab.is_workspace_admin(account_id)) with check (collab.is_workspace_admin(account_id));

-- 0010 covers every TABLE added by a future migration (its own
-- `alter default privileges ... on tables`) but never did the same for
-- FUNCTIONS — a real gap in that migration's own stated goal ("so a table
-- added by a future migration does not silently repeat this exact gap").
-- 0011/0012's functions both work today only because Postgres grants
-- EXECUTE to PUBLIC by default on a newly created function, and nothing
-- here has ever revoked that — fragile, not broken: a future security
-- hardening pass (`revoke execute on functions from public`, a common
-- tightening step) would silently break any function added afterward that
-- forgot its own explicit grant, exactly like 0007/0008's table grants were
-- once silently missing. Closed here the same way, for functions.
alter default privileges in schema collab grant execute on functions to authenticated;
