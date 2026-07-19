-- Row-level security. App tables key to Entra object ID via people.entra_id;
-- inference tables are service-role/admin only (SPEC privacy hard rule).
--
-- The JWT from Teams SSO carries the Entra object id in the `oid` claim, mapped
-- into Supabase auth as auth.jwt() ->> 'oid'.

create or replace function app.current_person_id()
returns bigint
language sql stable security definer
set search_path = registry
as $$
  select id from registry.people where entra_id = (auth.jwt() ->> 'oid');
$$;

create or replace function app.is_admin()
returns boolean
language sql stable security definer
set search_path = registry
as $$
  select coalesce(
    (select role = 'admin' from registry.people where entra_id = (auth.jwt() ->> 'oid')),
    false
  );
$$;

-- Registry: people readable by any signed-in staff member; writes via service role.
alter table registry.people enable row level security;
create policy people_read on registry.people
  for select using (auth.role() = 'authenticated');

-- Capabilities + playbook derivations: service role + admins ONLY.
-- No general read policy — capability inference must never be peer-visible.
alter table registry.capabilities enable row level security;
create policy capabilities_admin_read on registry.capabilities
  for select using (app.is_admin());

alter table registry.playbooks enable row level security;
create policy playbooks_read on registry.playbooks
  for select using (auth.role() = 'authenticated');

-- Per-person surfaces: a person sees only their own rows (admins see all).
alter table app.loop_ins enable row level security;
create policy loop_ins_own on app.loop_ins
  for select using (person_id = app.current_person_id() or app.is_admin());

alter table app.alerts enable row level security;
create policy alerts_own on app.alerts
  for select using (person_id = app.current_person_id() or app.is_admin());

alter table app.digests enable row level security;
create policy digests_own on app.digests
  for select using (person_id = app.current_person_id() or app.is_admin());

alter table intel.user_prefs_learned enable row level security;
create policy prefs_own on intel.user_prefs_learned
  for select using (person_id = app.current_person_id() or app.is_admin());

-- Shared project surfaces: readable by authenticated staff.
alter table app.workspaces_map enable row level security;
create policy workspaces_map_read on app.workspaces_map
  for select using (auth.role() = 'authenticated');

alter table intel.artifacts enable row level security;
create policy artifacts_read on intel.artifacts
  for select using (auth.role() = 'authenticated');

alter table intel.signals enable row level security;
create policy signals_read on intel.signals
  for select using (auth.role() = 'authenticated');

alter table intel.actions enable row level security;
create policy actions_read on intel.actions
  for select using (auth.role() = 'authenticated');

-- Mirror + sync + audit schemas: service role only (no policies = no anon/auth access
-- once RLS is enabled). The tab reads through views/functions, not raw mirror tables.
do $$
declare t record;
begin
  for t in
    select schemaname, tablename from pg_tables where schemaname in ('mirror', 'sync')
  loop
    execute format('alter table %I.%I enable row level security', t.schemaname, t.tablename);
  end loop;
end $$;

-- All writes from the app go through service-role endpoints that enforce the
-- autonomy-tier gate in code; client-side writes are not granted by policy.
