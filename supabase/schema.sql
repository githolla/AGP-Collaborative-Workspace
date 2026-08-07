-- =============================================================================
-- AGP Collaboration Workspace — Supabase schema (project: AGP-A8-AI-collaboration)
-- =============================================================================
-- Backs the Collaboration Workspace app. Grounded in the app's data model
-- (apps/tab/src/workspace/types.ts) and the build spec (D1–D5, §5.1, §7).
--
-- Core ideas encoded here:
--   * A WORKSPACE = one Kantata project = client + fiscal year (spec D1). It
--     carries the Team/SharePoint handles (spec D2) the Files layer reads/writes.
--   * Three audiences, one workspace (spec §7): internal staff (full), contractors
--     (scoped), clients (scoped). Enforced by Row Level Security below.
--   * NEVER leak budgets/costs (spec §7, OPEN-1/2). Effort/hours live in SEPARATE
--     internal-only tables (task_estimates, task_assignments) so no contractor or
--     client policy can ever return them — column leakage is impossible by design.
--   * Contractor/client sharing is a per-row flag (contractor_visible /
--     client_visible / contractor_accessible / client_share_*), mirroring the app.
--   * Discussion flow-back (spec §5.4): contractor-visible messages stay in the
--     single messages table; the flag is a projection, so internal history is whole.
--
-- Roles: Supabase `authenticated` users hit RLS; `service_role` (Part B
-- provisioning + app server) bypasses RLS to create workspaces, add members, and
-- invite Entra guests. Run this whole file in the Supabase SQL editor.
-- =============================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()
create schema if not exists app;            -- helper functions live here
grant usage on schema app to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- ENUMS
-- ─────────────────────────────────────────────────────────────────────────────
create type workspace_status as enum ('active', 'archived');
create type task_status      as enum ('todo', 'doing', 'done');
create type task_source      as enum ('plan', 'manual');
create type contact_role     as enum ('client', 'contractor');
create type contact_access   as enum ('workspace', 'files-only', 'tasks-only');
create type entra_status     as enum ('none', 'invited', 'active');   -- spec D5
create type message_kind     as enum ('human', 'agent');
create type file_kind        as enum ('file', 'doc');
create type share_purpose    as enum ('fyi', 'approval');
create type client_decision  as enum ('approved', 'changes');
create type campaign_status  as enum ('active', 'planned', 'complete');
create type activity_kind    as enum ('task', 'roi', 'team', 'workspace');
create type notify_pref      as enum ('teams', 'email', 'both');
create type open_source      as enum ('workspace', 'sharepoint');
create type grant_permission as enum ('read', 'read_write');
create type share_item_kind  as enum ('file', 'doc', 'task');

-- ─────────────────────────────────────────────────────────────────────────────
-- WORKSPACES  (spec D1/D2 — one Kantata project = client + fiscal year)
-- ─────────────────────────────────────────────────────────────────────────────
create table workspaces (
  id                  uuid primary key default gen_random_uuid(),
  client_name         text        not null,
  fiscal_year         text,                                   -- e.g. 'FY27'
  title               text,                                   -- 'Church World Service FY27'
  status              workspace_status not null default 'active',
  owner_user_id       uuid        references auth.users(id) on delete set null,  -- OPEN-3

  -- Kantata (system of record). A workspace may cover several linked projects.
  cantata_project_id  text,                                   -- primary linked project
  kantata_project_ids text[]      not null default '{}',      -- all linked (Project Finder)
  scoped_to_projects  boolean     not null default true,      -- Cara 2026-07-30
  auto_populated      boolean     not null default false,     -- one-time deepen+import guard

  -- Microsoft Teams / SharePoint handles (Part B provisioning writes these).
  team_id             text,                                   -- MS Teams / Graph group id
  sharepoint_site_id  text,                                   -- Team's SharePoint site id
  public_folder_path  text,                                   -- sync-back target (spec D3)

  client_contacts     integer     not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
comment on table workspaces is
  'One collaboration workspace = one Kantata project (client + fiscal year). Carries the Team/SharePoint handles the Files layer reads/writes and syncs back (spec D1–D3).';

-- Internal AGP staff on the workspace. Team membership drives full access.
create table workspace_members (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         uuid not null references workspaces(id) on delete cascade,
  user_id              uuid references auth.users(id) on delete cascade,
  name                 text not null,
  title                text,
  imported_from_cantata boolean not null default false,       -- OPEN-3 selection
  is_owner             boolean not null default false,
  is_active            boolean not null default true,
  notify_pref          notify_pref not null default 'both',
  created_at           timestamptz not null default now(),
  unique (workspace_id, user_id)
);

-- Externals: clients + contractors (Contractor Access tab). Entra guest state D5.
create table contacts (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete set null,  -- once the Entra guest signs in
  name          text not null,
  org           text,
  email         text,                                   -- the identity the Entra invite is keyed to
  role          contact_role not null,
  access        contact_access not null default 'files-only',
  entra_guest_id text,
  entra_status  entra_status not null default 'none',
  notify_pref   notify_pref not null default 'both',
  invited_by    text,
  added_at      timestamptz not null default now(),
  last_active   timestamptz
);
create index on contacts (workspace_id);
create index on contacts (lower(email));
comment on table contacts is
  'Clients + contractors. Removal revokes instantly. entra_status tracks the D5 guest-provisioning chain (invite is Part B automation).';

-- ─────────────────────────────────────────────────────────────────────────────
-- TASKS  (project plan). NO cost/effort columns here — see task_estimates.
-- ─────────────────────────────────────────────────────────────────────────────
create table tasks (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references workspaces(id) on delete cascade,
  title              text not null,
  owner_name         text,                                    -- display fallback
  status             task_status not null default 'todo',
  source             task_source not null default 'plan',
  due                date,
  start_date         date,                                    -- work-window start (not sensitive)
  label              text,

  -- Sharing axes (independent): a task can go to contractor, client, both, none.
  client_visible     boolean not null default false,         -- spec 5.6
  contractor_visible boolean not null default false,         -- spec 5.3/5.5

  -- Grouping (Kantata milestone tree).
  project_label      text,                                    -- the real project (milestone)
  phase_label        text,                                    -- nested phase
  phase_key          text,
  phase_id           text,

  -- Kantata write-back handles.
  kantata_story_id     text,
  kantata_project_id   text,
  kantata_milestone_id text,
  kantata_synced_at    timestamptz,

  completed_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index on tasks (workspace_id);
create index on tasks (workspace_id, status);
create index on tasks (workspace_id, due);
create index on tasks (workspace_id) where contractor_visible;
create index on tasks (workspace_id) where client_visible;
comment on table tasks is
  'Project-plan rows. Deliberately holds NO effort/cost data so contractor/client RLS can never leak it — estimated hours live in task_estimates, per-person hours in task_assignments (both internal-only).';

-- INTERNAL-ONLY effort estimate (the resourcing anchor). Never exposed externally.
create table task_estimates (
  task_id         uuid primary key references tasks(id) on delete cascade,
  estimated_hours numeric(8,2),
  updated_at      timestamptz not null default now()
);
comment on table task_estimates is
  'Internal-only. Effort estimate feeding weekly resourcing — off every external surface by the client-safety wall.';

-- INTERNAL-ONLY per-person stake: hour split, handoff order, per-person done.
create table task_assignments (
  task_id   uuid not null references tasks(id) on delete cascade,
  name      text not null,                                 -- matches Kantata assignee / staff
  role      text,                                          -- template role ('Data Developer')
  hours     numeric(8,2),                                  -- this person's slice (internal)
  is_primary boolean not null default false,               -- the one accountable owner
  is_done   boolean not null default false,                -- THEIR part done (not the whole task)
  seq       integer,                                       -- handoff order (1 starts)
  primary key (task_id, name)
);
comment on table task_assignments is
  'Internal-only. Each person marks THEIR OWN part done — the task is done only when everyone is (fixes the Kantata single-checkbox limitation). Hour splits feed resourcing.';

-- Dependencies (normalized from Task.dependsOn) — a task is blocked until all done.
create table task_dependencies (
  task_id       uuid not null references tasks(id) on delete cascade,
  depends_on_id uuid not null references tasks(id) on delete cascade,
  primary key (task_id, depends_on_id),
  check (task_id <> depends_on_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- FILES  (metadata; bytes live in the Team's SharePoint via Graph — spec D2)
-- ─────────────────────────────────────────────────────────────────────────────
create table files (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references workspaces(id) on delete cascade,
  name                  text not null,
  kind                  file_kind not null default 'file',   -- 'doc' = core documentation
  url                   text,
  graph_item_id         text,                                 -- Microsoft Graph driveItem id
  folder                text,
  path                  text,
  last_synced_at        timestamptz,                          -- sync-back to public (spec D3)

  -- Contractor access (spec 5.5): read on granted files, write on upload folders.
  contractor_accessible boolean not null default false,
  contractor_writable   boolean not null default false,       -- Part B enforces the Graph write

  -- Client share (spec 5.6) — fyi or approval, with the client's decision.
  client_share_purpose  share_purpose,                        -- null = not shared to client
  client_share_by       text,
  client_share_at       timestamptz,
  client_decision       client_decision,
  client_decided_at     timestamptz,
  client_change_note    text,

  added_at              timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index on files (workspace_id);
create index on files (workspace_id) where contractor_accessible;
create index on files (workspace_id) where client_share_purpose is not null;

-- Per-contact file/folder grants (spec 5.1). Contractors need read_write on
-- specific upload folders to drop finished copy/design back in.
create table file_access_grants (
  id          uuid primary key default gen_random_uuid(),
  file_id     uuid not null references files(id) on delete cascade,
  contact_id  uuid not null references contacts(id) on delete cascade,
  permission  grant_permission not null default 'read',
  granted_by  text,
  created_at  timestamptz not null default now(),
  unique (file_id, contact_id)
);

-- Read receipts for the client dashboard ("opened / not opened").
create table file_opens (
  id          uuid primary key default gen_random_uuid(),
  file_id     uuid not null references files(id) on delete cascade,
  contact_id  uuid references contacts(id) on delete set null,
  opened_at   timestamptz not null default now(),
  source      open_source not null default 'workspace'
);
create index on file_opens (file_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- DISCUSSIONS  (single thread; contractor/client slices are projections — §5.4)
-- ─────────────────────────────────────────────────────────────────────────────
create table messages (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references workspaces(id) on delete cascade,
  parent_id          uuid references messages(id) on delete cascade,
  author             text not null,
  kind               message_kind not null default 'human',
  body               text not null,
  topic              text,                                    -- project/campaign/task/phase
  contractor_visible boolean not null default false,         -- spec 5.4 slice
  client_visible     boolean not null default false,         -- client discussion slice
  edited_at          timestamptz,
  created_at         timestamptz not null default now()
);
create index on messages (workspace_id, created_at);
create index on messages (workspace_id) where contractor_visible;
create index on messages (workspace_id) where client_visible;
comment on table messages is
  'One canonical thread per workspace. contractor_visible/client_visible are PROJECTIONS — messages are never moved out, so the internal history stays whole (spec 5.4 flow-back).';

-- ─────────────────────────────────────────────────────────────────────────────
-- HANDOVER RECORD, CAMPAIGNS, NOTIFICATIONS, ACTIVITY
-- ─────────────────────────────────────────────────────────────────────────────
-- A RECORD, not a permission: revoking stamps revoked_at and keeps the row so
-- "sent 3 Aug, opened 4 Aug, revoked 20 Aug" stays answerable a year later.
create table shares (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  person_name  text not null,
  item_kind    share_item_kind not null,
  item_id      uuid,
  item_name    text not null,          -- captured at send time; survives rename/delete
  sent_at      timestamptz not null default now(),
  sent_by      text not null,
  opened_at    timestamptz,
  open_source  open_source,
  revoked_at   timestamptz,
  revoked_by   text
);
create index on shares (workspace_id);

create table campaigns (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references workspaces(id) on delete cascade,
  name                text not null,
  status              campaign_status not null default 'active',
  next_milestone      text,
  next_milestone_date date,
  from_kantata        boolean not null default false,
  created_at          timestamptz not null default now()
);
create index on campaigns (workspace_id);

create table notifications (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  text         text not null,
  at           timestamptz not null default now()
);
create index on notifications (workspace_id);

create table activity_events (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  text         text not null,
  kind         activity_kind not null default 'workspace',
  at           timestamptz not null default now()
);
create index on activity_events (workspace_id, at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- updated_at triggers
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function app.touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger t_workspaces_touch before update on workspaces
  for each row execute function app.touch_updated_at();
create trigger t_tasks_touch before update on tasks
  for each row execute function app.touch_updated_at();
create trigger t_files_touch before update on files
  for each row execute function app.touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS helper functions (SECURITY DEFINER — bypass RLS to avoid recursion)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function app.current_email() returns text
language sql stable as $$ select nullif(auth.jwt() ->> 'email', '') $$;

-- Internal staff on the workspace (Team member) — full access.
create or replace function app.is_member(ws uuid) returns boolean
language sql stable security definer set search_path = public, app as $$
  select exists (
    select 1 from workspace_members m
    where m.workspace_id = ws and m.user_id = auth.uid() and m.is_active
  );
$$;

create or replace function app.is_contractor(ws uuid) returns boolean
language sql stable security definer set search_path = public, app as $$
  select exists (
    select 1 from contacts c
    where c.workspace_id = ws and c.role = 'contractor'
      and (c.user_id = auth.uid()
           or (app.current_email() is not null and lower(c.email) = lower(app.current_email())))
  );
$$;

create or replace function app.is_client(ws uuid) returns boolean
language sql stable security definer set search_path = public, app as $$
  select exists (
    select 1 from contacts c
    where c.workspace_id = ws and c.role = 'client'
      and (c.user_id = auth.uid()
           or (app.current_email() is not null and lower(c.email) = lower(app.current_email())))
  );
$$;

grant execute on function app.current_email, app.is_member, app.is_contractor, app.is_client
  to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security
--   Internal staff  : full read/write on their workspace.
--   Contractors     : read tasks(contractor_visible), files(contractor_accessible),
--                     messages(contractor_visible); post messages; see own contact.
--   Clients         : read tasks(client_visible), shared files, client messages,
--                     campaigns (progress); post client messages; see own contact.
--   Effort/cost tables (task_estimates, task_assignments) : internal-only, always.
--   service_role bypasses all of this (Part B provisioning + trusted server code).
-- ─────────────────────────────────────────────────────────────────────────────
alter table workspaces        enable row level security;
alter table workspace_members enable row level security;
alter table contacts          enable row level security;
alter table tasks             enable row level security;
alter table task_estimates    enable row level security;
alter table task_assignments  enable row level security;
alter table task_dependencies enable row level security;
alter table files             enable row level security;
alter table file_access_grants enable row level security;
alter table file_opens        enable row level security;
alter table messages          enable row level security;
alter table shares            enable row level security;
alter table campaigns         enable row level security;
alter table notifications     enable row level security;
alter table activity_events   enable row level security;

-- WORKSPACES — visible to anyone attached to it; only internal staff mutate.
create policy ws_read on workspaces for select
  using (app.is_member(id) or app.is_contractor(id) or app.is_client(id));
create policy ws_write on workspaces for all
  using (app.is_member(id)) with check (app.is_member(id));

-- WORKSPACE_MEMBERS — internal-only.
create policy wm_all on workspace_members for all
  using (app.is_member(workspace_id)) with check (app.is_member(workspace_id));

-- CONTACTS — internal manage all; an external sees only their own row.
create policy contacts_internal on contacts for all
  using (app.is_member(workspace_id)) with check (app.is_member(workspace_id));
create policy contacts_self on contacts for select
  using (user_id = auth.uid()
         or (app.current_email() is not null and lower(email) = lower(app.current_email())));

-- TASKS — internal full; contractor & client see only their shared slice.
create policy tasks_internal on tasks for all
  using (app.is_member(workspace_id)) with check (app.is_member(workspace_id));
create policy tasks_contractor_read on tasks for select
  using (contractor_visible and app.is_contractor(workspace_id));
create policy tasks_client_read on tasks for select
  using (client_visible and app.is_client(workspace_id));

-- EFFORT/COST — internal-only, no external policy exists (leak-proof by design).
create policy est_internal on task_estimates for all
  using (app.is_member((select workspace_id from tasks t where t.id = task_id)))
  with check (app.is_member((select workspace_id from tasks t where t.id = task_id)));
create policy asg_internal on task_assignments for all
  using (app.is_member((select workspace_id from tasks t where t.id = task_id)))
  with check (app.is_member((select workspace_id from tasks t where t.id = task_id)));
create policy dep_internal on task_dependencies for all
  using (app.is_member((select workspace_id from tasks t where t.id = task_id)))
  with check (app.is_member((select workspace_id from tasks t where t.id = task_id)));

-- FILES — internal full; contractor sees accessible; client sees shared.
create policy files_internal on files for all
  using (app.is_member(workspace_id)) with check (app.is_member(workspace_id));
create policy files_contractor_read on files for select
  using (contractor_accessible and app.is_contractor(workspace_id));
create policy files_client_read on files for select
  using (client_share_purpose is not null and app.is_client(workspace_id));

-- FILE_ACCESS_GRANTS — internal manage; a contact sees its own grants.
create policy grants_internal on file_access_grants for all
  using (app.is_member((select workspace_id from files f where f.id = file_id)))
  with check (app.is_member((select workspace_id from files f where f.id = file_id)));
create policy grants_self on file_access_grants for select
  using (contact_id in (select id from contacts c
           where c.user_id = auth.uid()
              or (app.current_email() is not null and lower(c.email) = lower(app.current_email()))));

-- FILE_OPENS — internal read all; a contact records/reads its own opens.
create policy opens_internal on file_opens for select
  using (app.is_member((select workspace_id from files f where f.id = file_id)));
create policy opens_self_insert on file_opens for insert
  with check (contact_id in (select id from contacts c
           where c.user_id = auth.uid()
              or (app.current_email() is not null and lower(c.email) = lower(app.current_email()))));

-- MESSAGES — internal full; externals read their slice and can post into it.
create policy msg_internal on messages for all
  using (app.is_member(workspace_id)) with check (app.is_member(workspace_id));
create policy msg_contractor_read on messages for select
  using (contractor_visible and app.is_contractor(workspace_id));
create policy msg_client_read on messages for select
  using (client_visible and app.is_client(workspace_id));
create policy msg_contractor_post on messages for insert
  with check (app.is_contractor(workspace_id) and contractor_visible and not client_visible);
create policy msg_client_post on messages for insert
  with check (app.is_client(workspace_id) and client_visible and not contractor_visible);

-- SHARES — internal-only audit record (the app writes it on their behalf).
create policy shares_internal on shares for all
  using (app.is_member(workspace_id)) with check (app.is_member(workspace_id));

-- CAMPAIGNS — internal full; client may read for progress.
create policy camp_internal on campaigns for all
  using (app.is_member(workspace_id)) with check (app.is_member(workspace_id));
create policy camp_client_read on campaigns for select
  using (app.is_client(workspace_id));

-- NOTIFICATIONS & ACTIVITY — internal-only.
create policy notif_internal on notifications for all
  using (app.is_member(workspace_id)) with check (app.is_member(workspace_id));
create policy act_internal on activity_events for all
  using (app.is_member(workspace_id)) with check (app.is_member(workspace_id));

-- Table privileges (RLS still governs row access on top of these).
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;

-- =============================================================================
-- NOTES for Ren
-- -----------------------------------------------------------------------------
-- * Provisioning (create workspace, add members, invite Entra guests, associate
--   the Team/SharePoint site) runs as service_role, which bypasses RLS. Do it
--   from trusted server code / Part B automation — never from the browser.
-- * Column-safety: contractors/clients physically cannot read effort or hour
--   splits because those columns live in task_estimates / task_assignments, which
--   have NO external policy. Keep any future cost/budget field out of `tasks`,
--   `files`, and `messages` for the same reason.
-- * OPEN-1 (contractor folder scoping): today a contractor sees files where
--   contractor_accessible = true; tighten to per-folder with file_access_grants
--   if a workspace needs internal-only areas alongside contractor areas.
-- * OPEN-3 (Cantata import selection): workspace_members.imported_from_cantata +
--   is_owner support "pick who joins" and a single owner.
-- * Storage/sync (spec D3/OPEN-4): files.graph_item_id + last_synced_at +
--   workspaces.public_folder_path are the hooks the sync-back/cleanup automation
--   keys on. Retention (delete Team-side copy after FY close) runs as service_role.
-- =============================================================================
