-- Base privileges on the collab schema — missing from 0007/0008, and a real
-- gap, not a formality: RLS policies only RESTRICT which rows a role may
-- touch within an operation it is already permitted to attempt. Without an
-- explicit GRANT, `authenticated` has no privilege to run that operation at
-- all, and every query from the /api layer (db.ts, which SET LOCAL ROLE
-- authenticated per request) would fail with "permission denied for schema
-- collab" — regardless of how correct the policies in 0008 are.
--
-- Caught because the local RLS validation for 0007/0008 (this session,
-- 2026-08-14) manually issued these exact grants in the TEST harness's setup
-- script, not in the migration itself — so the tests passed while the real,
-- already-pushed project was left with no working access path at all. Fixed
-- here as its own migration rather than editing 0007/0008, which are already
-- applied and part of the ledger.
--
-- `anon` gets nothing on this schema, deliberately: every collab endpoint
-- requires a verified, authenticated caller before it ever reaches Postgres
-- (api/_lib/requireUser.ts refuses anything else outright), so an anonymous
-- request reaching this schema at all would mean that gate failed — and it
-- should be refused here too, not only in the application layer.

grant usage on schema collab to authenticated;
grant select, insert, update, delete on all tables in schema collab to authenticated;

-- service_role is BYPASSRLS but that does not imply table privileges — it
-- still needs an explicit grant, used only by migrations and the /api/admin
-- operations that deliberately cross user boundaries (teams-provisioning-plan.md
-- D5), never by a per-request handler acting on a caller's own behalf.
grant usage on schema collab to service_role;
grant all on all tables in schema collab to service_role;

-- So a table added by a FUTURE migration in this schema does not silently
-- repeat this exact gap.
alter default privileges in schema collab grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema collab grant all on tables to service_role;
