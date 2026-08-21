-- Collaboration schema group: the external-access model (teams-provisioning-plan.md
-- B6, ADR 0010). A NEW schema, `collab` — not `public`, and deliberately not the
-- `mirror`/`registry`/`app`/`intel`/`sync` schemas from 0001-0006, which are the
-- pre-pivot sync layer (ADR 0005) and are left alone. Naming a schema avoids any
-- future collision when that sync layer is finally applied.
--
-- STATUS AS OF WRITING: this file has NOT been applied anywhere. Author-only —
-- review before running against any project, including one that is "dev today,
-- prod eventually." There is no legacy data to migrate: production has no
-- application tables yet, only Supabase's own `auth` schema (already populated by
-- live Microsoft sign-in).
--
-- Replaces the single JSON document at /api/state for everything EXCEPT the ROI
-- side (`initiatives`, `ideas`, `feedback`), which stays there deliberately — see
-- the note at the bottom of this file.

create schema if not exists collab;

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

-- One row per Supabase Auth user — staff and external guests alike, since both
-- sign in through the same Azure provider (ADR 0010 §4) and both need a role.
-- Deliberately NOT `registry.people`: that table carries org-chart concerns
-- (reports_to, routing_mode, entity_tag, capabilities) that an external
-- collaborator has no business appearing in.
create table collab.app_user (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  title text,
  kind text not null default 'internal' check (kind in ('internal', 'external')),
  created_at timestamptz not null default now()
);

-- Auto-provision an app_user row the moment someone authenticates, so every
-- later table can assume one exists. `kind` mirrors the same domain check
-- App.tsx already uses client-side (viewerIsInternal) — @teamallegiance.com is
-- staff, everything else is external. A person's kind can be corrected later
-- by an app admin; this is only the day-one default.
create or replace function collab.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = collab, public
as $$
begin
  insert into collab.app_user (id, display_name, kind)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', new.email, 'Unknown'),
    case when new.email ilike '%@teamallegiance.com' then 'internal' else 'external' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function collab.handle_new_auth_user();

-- App admin (global) or workspace admin (one account) — see collab_rls.sql for
-- how these are checked. `account_id` is null for an app_admin row and
-- required for a workspace_admin row; enforced below with partial unique
-- indexes rather than a plain UNIQUE, since Postgres treats NULLs as distinct
-- and a plain constraint would let the same person get two app_admin rows.
create table collab.user_role (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references collab.app_user (id) on delete cascade,
  role text not null check (role in ('app_admin', 'workspace_admin')),
  account_id uuid, -- FK added after client_account exists, below
  granted_by uuid references collab.app_user (id),
  created_at timestamptz not null default now(),
  constraint user_role_app_admin_no_account check (role <> 'app_admin' or account_id is null),
  constraint user_role_workspace_admin_needs_account check (role <> 'workspace_admin' or account_id is not null)
);

create unique index user_role_one_app_admin_row on collab.user_role (user_id) where role = 'app_admin';
create unique index user_role_one_workspace_admin_row on collab.user_role (user_id, account_id) where role = 'workspace_admin';

-- ---------------------------------------------------------------------------
-- The workspace
-- ---------------------------------------------------------------------------

create table collab.client_account (
  id uuid primary key default gen_random_uuid(),
  client_name text not null,
  created_by uuid references collab.app_user (id),
  -- Project Finder links (campaignImport.ts's kantataProjectIds/scopedToProjects).
  kantata_project_ids text[] not null default '{}',
  scoped_to_projects boolean not null default false,
  auto_populated boolean not null default false,
  archived boolean not null default false,
  client_contacts integer not null default 0,
  -- Microsoft Team, once an admin creates one and its URL is pasted in (B2/B3).
  ms_team_id text,
  ms_group_id text,
  ms_site_id text,
  ms_drive_id text,
  ms_web_url text,
  ms_provisioned_at timestamptz,
  -- Notifications and per-person notify preference: account-scoped, no access
  -- decision ever filters into them, so jsonb per the plan's own carve-out
  -- rather than two more tables.
  notifications jsonb not null default '[]'::jsonb,
  notify_prefs jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table collab.user_role
  add constraint user_role_account_id_fkey foreign key (account_id) references collab.client_account (id) on delete cascade;

-- Internal AGP staff on an account. `user_id` is nullable: most Kantata-derived
-- delivery participants (populateFromKantata's team seeding) have never signed
-- into the app, so the row exists — carrying the name Kantata gave it — before
-- any auth identity is known, exactly like today's client-side model.
create table collab.account_member (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references collab.client_account (id) on delete cascade,
  user_id uuid references collab.app_user (id) on delete set null,
  person_id text not null, -- Kantata-derived id (e.g. "k-jane-doe") or "u-<email>"
  name text not null,
  title text,
  created_at timestamptz not null default now(),
  unique (account_id, person_id)
);

-- A client or contractor's membership of one account. `user_id` nullable for
-- the same reason as account_member: "externals are named before they have
-- identities" (Share's own comment) — the row exists from the moment someone
-- is added, and gains a user_id once they accept their guest invite and sign
-- in for the first time.
create table collab.external_link (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references collab.client_account (id) on delete cascade,
  user_id uuid references collab.app_user (id) on delete set null,
  name text not null,
  org text not null,
  role text not null check (role in ('client', 'contractor')),
  email text,
  entra_status text not null default 'none' check (entra_status in ('none', 'invited', 'active')),
  entra_user_id text,
  invited_by text,
  last_active timestamptz,
  created_at timestamptz not null default now()
);

-- The permission everything checks — one row per (person, account, Kantata
-- id). `kantata_id` names a project/milestone/phase/task; `level` says which.
-- Covers everything beneath it, present and future, via two mechanisms in two
-- places: SharePoint's own inheritance for files, and kantata_ancestor_ids
-- matching (below, on task/thread_message) for the app's own data.
--
-- NOT named `grant` — reserved word in SQL.
create table collab.access_grant (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references collab.client_account (id) on delete cascade,
  user_id uuid not null references collab.app_user (id) on delete cascade,
  kantata_id text not null,
  level text not null check (level in ('project', 'milestone', 'phase', 'task')),
  role text not null check (role in ('read', 'write')),
  -- The SharePoint invite this grant issued, once B7 exists. A grant with a
  -- role but no ms_permission_id yet is the visible "half-grant" state B7
  -- requires — never silently treated as complete.
  ms_permission_id text,
  granted_by uuid references collab.app_user (id),
  created_at timestamptz not null default now(),
  unique (account_id, user_id, kantata_id)
);

-- ---------------------------------------------------------------------------
-- Workspace content
-- ---------------------------------------------------------------------------

create table collab.task (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references collab.client_account (id) on delete cascade,
  title text not null,
  owner_name text,
  -- Nested per-person assignment detail (name/role/hours/done/primary/order).
  -- jsonb: no access decision reads inside it, and it is genuinely open-shaped.
  assignments jsonb not null default '[]'::jsonb,
  due date,
  label text,
  status text not null default 'todo' check (status in ('todo', 'doing', 'done')),
  phase_key text,
  source text not null default 'manual' check (source in ('plan', 'manual')),
  client_visible boolean not null default false,
  contractor_visible boolean not null default false,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  kantata_story_id text,
  kantata_project_id text,
  project_label text,
  phase_label text,
  phase_id text,
  depends_on uuid[] not null default '{}',
  kantata_milestone_id text,
  kantata_synced_at timestamptz,
  estimated_hours numeric,
  start_date date,
  ms_folder_id text,
  -- The full Kantata ancestor chain this task resolves to (its own story id,
  -- phase, milestone, project — whichever exist), computed by the API layer
  -- the same way projectPhaseResolver/folderTreeOf already do client-side.
  -- holds_grant() matches against this array directly: Postgres never
  -- re-derives Kantata's hierarchy itself, because the live mirror the
  -- hierarchy comes from is not (and should not become) part of this schema.
  kantata_ancestor_ids text[] not null default '{}',
  updated_at timestamptz not null default now() -- optimistic concurrency (expectedUpdatedAt)
);

create index task_account_id_idx on collab.task (account_id);
create index task_kantata_ancestor_ids_idx on collab.task using gin (kantata_ancestor_ids);

create table collab.thread_message (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references collab.client_account (id) on delete cascade,
  author text not null, -- display name at post time — survives an author leaving
  author_user_id uuid references collab.app_user (id), -- REAL identity: "author only" edit/delete is enforced on this, never on the name string
  kind text not null default 'human' check (kind in ('human', 'agent')),
  body text not null,
  topic text, -- free-text human label; never matched against a grant
  edited_at timestamptz,
  client_visible boolean not null default false,
  contractor_visible boolean not null default false,
  kantata_id text, -- what this message is about, directly
  kantata_level text check (kantata_level in ('project', 'milestone', 'phase', 'task')),
  -- Same role as task.kantata_ancestor_ids, and for the same reason: a
  -- message about a task must still match a grant held on that task's
  -- milestone, and the ancestor chain is precomputed at write time.
  kantata_ancestor_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index thread_message_account_id_idx on collab.thread_message (account_id);
create index thread_message_kantata_ancestor_ids_idx on collab.thread_message using gin (kantata_ancestor_ids);

create table collab.campaign (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references collab.client_account (id) on delete cascade,
  name text not null,
  status text not null check (status in ('active', 'planned', 'complete')),
  next_milestone text,
  next_milestone_date date,
  source text check (source in ('kantata')),
  -- NOT populated by today's campaignsFromMirror, which carries no Kantata id
  -- at all (campaigns are matched by name on re-import — a pre-existing gap,
  -- not one this schema introduces). Added so per-milestone filtering of a
  -- CLIENT external's "Campaigns, plan, dashboard" view (the one row in the
  -- plan's "what each caller gets" table with real per-milestone scoping) can
  -- be built without a second migration. Until campaignsFromMirror is changed
  -- to carry it, this stays null and a client sees every campaign on an
  -- account they are linked to — a real, documented gap, not a silent one.
  kantata_project_id text,
  created_at timestamptz not null default now()
);

create table collab.activity (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references collab.client_account (id) on delete cascade,
  at timestamptz not null default now(),
  text text not null,
  kind text not null check (kind in ('task', 'roi', 'team', 'workspace'))
);

-- One row per provisioned SharePoint folder, keyed on the Kantata id it
-- stands for (B2/B4). A table, not jsonb on client_account, because a grant
-- joins to it, the milestone picker reads it, and reconcile rewrites names
-- in it — all real queries, not display-only.
create table collab.ms_folder (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references collab.client_account (id) on delete cascade,
  kantata_id text not null,
  folder_id text not null,
  parent_folder_id text,
  name text not null,
  level text not null check (level in ('project', 'milestone', 'phase', 'task')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, kantata_id)
);

-- What was handed to whom — a RECORD, not a permission (handover.ts). Revoking
-- stamps revoked_at and keeps the row; nothing ever deletes one.
create table collab.share (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references collab.client_account (id) on delete cascade,
  person_name text not null,
  recipient_user_id uuid references collab.app_user (id),
  item_kind text not null check (item_kind in ('file', 'doc', 'task', 'folder')),
  item_id text not null,
  item_name text not null, -- captured at send time; survives a rename or deletion
  ms_item_id text,
  grant_level text check (grant_level in ('project', 'milestone', 'phase', 'task')),
  sent_at timestamptz not null default now(),
  sent_by text not null,
  opened_at timestamptz,
  open_source text check (open_source in ('workspace', 'sharepoint')),
  revoked_at timestamptz,
  revoked_by text,
  created_at timestamptz not null default now()
);

-- A document shared for client review or approval, keyed on the SharePoint
-- item id — the folder-model replacement for ClientFileLink.clientShare, now
-- that there is no app-side file inventory to hang it on (B7).
create table collab.file_approval (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references collab.client_account (id) on delete cascade,
  ms_item_id text not null,
  name text not null,
  purpose text not null check (purpose in ('fyi', 'approval')),
  shared_at timestamptz not null default now(),
  shared_by text not null,
  decision text check (decision in ('approved', 'changes')),
  decided_at timestamptz,
  decided_by text,
  note text,
  opened_at timestamptz,
  created_at timestamptz not null default now()
);

create table collab.access_audit (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references collab.client_account (id) on delete cascade,
  actor_user_id uuid references collab.app_user (id),
  subject_user_id uuid references collab.app_user (id),
  action text not null check (action in ('grant_created', 'grant_revoked', 'file_downloaded', 'file_uploaded', 'file_opened')),
  kantata_id text,
  detail jsonb,
  created_at timestamptz not null default now()
);

create index access_audit_account_id_idx on collab.access_audit (account_id);

-- bump updated_at on every row change — task and thread_message use this for
-- the optimistic-concurrency check (expectedUpdatedAt).
create or replace function collab.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger task_set_updated_at before update on collab.task
  for each row execute function collab.set_updated_at();
create trigger thread_message_set_updated_at before update on collab.thread_message
  for each row execute function collab.set_updated_at();
create trigger ms_folder_set_updated_at before update on collab.ms_folder
  for each row execute function collab.set_updated_at();

-- ---------------------------------------------------------------------------
-- Deliberately NOT in this schema
-- ---------------------------------------------------------------------------
-- `initiatives`, `ideas`, `feedback` (the ROI side) stay in the JSON document
-- at /api/state, reduced to just that content. Internal-only, no external
-- ever reaches them, no access decision reads them — they gain nothing from
-- tables and would cost a migration for no benefit (teams-provisioning-plan.md
-- B6). If that ever stops being true, the content moves; the rule does not.
--
-- `ClientFileLink` (files/docs arrays) is not modeled here at all — B7 retires
-- it. The folder IS the file list, read live from SharePoint; `file_approval`
-- above is the one piece of it that needed a persistent record.
