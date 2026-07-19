-- Workspace-app schema group: provisioning sagas, mappings, loop-ins, alerts.

create schema if not exists app;

create table app.workspaces_map (
  id bigint generated always as identity primary key,
  hubspot_deal_source_id text unique,
  kantata_workspace_source_id text unique,
  teams_channel_id text unique,
  teams_team_id text,
  tab_pinned boolean not null default false,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

-- Provisioning saga state (SPEC 1c): resumable, idempotent, duplicate triggers are no-ops.
create table app.provisioning_jobs (
  id bigint generated always as identity primary key,
  hubspot_deal_source_id text not null unique, -- uniqueness = idempotency of the trigger
  state text not null default 'pending' check (state in (
    'pending', 'workspace_created', 'cast_planned', 'channel_created',
    'tab_pinned', 'kickoff_posted', 'complete', 'failed'
  )),
  attempts integer not null default 0,
  last_error text,
  correlation_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table app.loop_ins (
  id bigint generated always as identity primary key,
  person_id bigint not null,
  workspace_map_id bigint not null references app.workspaces_map (id),
  trigger_kind text not null,      -- capability_keyword | client_email_signal | service_line_expansion | playbook_trigger_point
  trigger_explanation text not null, -- the one-sentence "because" (SPEC explainability)
  brief_ref text,                  -- artifact id of the 60-second onboarding brief
  estimated_hours numeric,
  window_start date,
  window_end date,
  status text not null default 'proposed' check (status in ('proposed', 'invited', 'accepted', 'declined', 'deferred')),
  routed_via_manager boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table app.alerts (
  id bigint generated always as identity primary key,
  signal_id bigint,
  person_id bigint,
  channel text not null,           -- feed | teams_card | channel_post
  severity text not null default 'info',
  body text not null,
  explanation text not null,       -- one-sentence "because"
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);

create table app.digests (
  id bigint generated always as identity primary key,
  person_id bigint not null,
  digest_date date not null,
  items jsonb not null default '[]'::jsonb,
  delivered_at timestamptz,
  unique (person_id, digest_date)
);

-- Admin-editable mappings (ADR 0003: tenant-specific facts are data, not code)
create table app.expense_category_map (
  category text primary key,
  classification text not null check (classification in ('fee', 'pass_through')),
  gl_code text,
  admin_edited boolean not null default false
);

create table app.deal_field_map (
  hubspot_field text primary key,
  kantata_field text not null,
  admin_edited boolean not null default false
);

-- Fundraising surge calendar (domain rule 4): seeded defaults + learned curves
create table app.surge_calendar (
  id bigint generated always as identity primary key,
  label text not null,             -- year_end | giving_tuesday | spring_appeals | pledge_drive | ...
  vertical text,                   -- null = applies to all verticals
  window_start date not null,
  window_end date not null,
  source text not null default 'seed' check (source in ('seed', 'learned', 'admin')),
  created_at timestamptz not null default now()
);
