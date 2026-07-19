-- Mirror schema group: raw copies of Kantata + HubSpot entities.
-- Every mirror table shares the same sync envelope:
--   source_id   the entity's id in the source system (unique per table)
--   raw         full source payload as last hydrated
--   updated_at_source  the source system's updated-at, for reconcile diffing
--   synced_at   when we last hydrated this row
--   dirty       true = a change signal arrived and hydration is pending/queued

create schema if not exists mirror;

-- ---------- Kantata ----------

create table mirror.kantata_workspaces (
  id bigint generated always as identity primary key,
  source_id text not null unique,
  title text,
  status text,
  archived boolean not null default false,
  -- engagement taxonomy (SPEC domain rule 1): vertical x service line x commercial model
  vertical text,
  service_line text,
  commercial_model text, -- retainer | fixed_fee | sprint_build | product_support
  budget_cents bigint,
  start_date date,
  due_date date,
  hubspot_company_source_id text, -- workspace_groups <-> HubSpot company join
  raw jsonb not null default '{}'::jsonb,
  updated_at_source timestamptz,
  synced_at timestamptz,
  dirty boolean not null default true
);

create table mirror.kantata_participations (
  id bigint generated always as identity primary key,
  source_id text not null unique,
  workspace_source_id text not null,
  user_source_id text not null,
  role text,
  raw jsonb not null default '{}'::jsonb,
  updated_at_source timestamptz,
  synced_at timestamptz,
  dirty boolean not null default true
);

create table mirror.kantata_stories (
  id bigint generated always as identity primary key,
  source_id text not null unique,
  workspace_source_id text not null,
  parent_source_id text,
  title text,
  story_type text, -- milestone | task | deliverable | issue
  state text,
  start_date date,
  due_date date,
  -- hard-date milestone class (SPEC domain rule 5): immovable drop/in-home/launch dates
  hard_date boolean not null default false,
  raw jsonb not null default '{}'::jsonb,
  updated_at_source timestamptz,
  synced_at timestamptz,
  dirty boolean not null default true
);

create table mirror.kantata_allocations (
  id bigint generated always as identity primary key,
  source_id text not null unique,
  workspace_source_id text not null,
  user_source_id text not null,
  week_start date,
  minutes integer,
  hard boolean, -- hard/soft allocation flag (tenant grounding: confirm semantics)
  raw jsonb not null default '{}'::jsonb,
  updated_at_source timestamptz,
  synced_at timestamptz,
  dirty boolean not null default true
);

create table mirror.kantata_assignments (
  id bigint generated always as identity primary key,
  source_id text not null unique,
  story_source_id text not null,
  user_source_id text not null,
  raw jsonb not null default '{}'::jsonb,
  updated_at_source timestamptz,
  synced_at timestamptz,
  dirty boolean not null default true
);

create table mirror.kantata_time_entries (
  id bigint generated always as identity primary key,
  source_id text not null unique,
  workspace_source_id text not null,
  user_source_id text not null,
  story_source_id text,
  date_performed date,
  minutes integer,
  notes text,
  bill_rate_cents bigint, -- bill + cost rates live on the entry (tenant grounding)
  cost_rate_cents bigint,
  billable boolean,
  raw jsonb not null default '{}'::jsonb,
  updated_at_source timestamptz,
  synced_at timestamptz,
  dirty boolean not null default true
);

create table mirror.kantata_invoices (
  id bigint generated always as identity primary key,
  source_id text not null unique,
  workspace_source_id text,
  status text,
  amount_cents bigint,
  issued_on date,
  paid_on date,
  raw jsonb not null default '{}'::jsonb,
  updated_at_source timestamptz,
  synced_at timestamptz,
  dirty boolean not null default true
);

create table mirror.kantata_expenses (
  id bigint generated always as identity primary key,
  source_id text not null unique,
  workspace_source_id text not null,
  category text, -- GL-coded category; classified fee vs pass-through via app.expense_category_map
  amount_cents bigint,
  incurred_on date,
  raw jsonb not null default '{}'::jsonb,
  updated_at_source timestamptz,
  synced_at timestamptz,
  dirty boolean not null default true
);

create table mirror.kantata_custom_field_values (
  id bigint generated always as identity primary key,
  source_id text not null unique,
  subject_type text not null, -- workspace | story | user
  subject_source_id text not null,
  field_name text not null,   -- e.g. "Service Line Detail" (tenant grounding)
  value text,
  raw jsonb not null default '{}'::jsonb,
  updated_at_source timestamptz,
  synced_at timestamptz,
  dirty boolean not null default true
);

create table mirror.kantata_users (
  id bigint generated always as identity primary key,
  source_id text not null unique,
  full_name text,
  email text,
  headline text,
  raw jsonb not null default '{}'::jsonb,
  updated_at_source timestamptz,
  synced_at timestamptz,
  dirty boolean not null default true
);

-- ---------- HubSpot ----------

create table mirror.hubspot_companies (
  id bigint generated always as identity primary key,
  source_id text not null unique,
  name text,
  domain text,
  vertical text, -- nonprofit vertical (hospitals, food banks, public media, ...)
  raw jsonb not null default '{}'::jsonb,
  updated_at_source timestamptz,
  synced_at timestamptz,
  dirty boolean not null default true
);

create table mirror.hubspot_deals (
  id bigint generated always as identity primary key,
  source_id text not null unique,
  company_source_id text,
  name text,
  stage text,
  amount_cents bigint,
  service_line text,
  commercial_model text,
  close_date date,
  is_won boolean,
  is_closed boolean,
  raw jsonb not null default '{}'::jsonb,
  updated_at_source timestamptz,
  synced_at timestamptz,
  dirty boolean not null default true
);

create table mirror.hubspot_contacts (
  id bigint generated always as identity primary key,
  source_id text not null unique,
  company_source_id text,
  email text,
  full_name text,
  raw jsonb not null default '{}'::jsonb,
  updated_at_source timestamptz,
  synced_at timestamptz,
  dirty boolean not null default true
);

-- Engagement content (client emails/notes) is used for briefs, triggers, and
-- voice learning only — scope OAuth minimally (SPEC privacy boundary).
create table mirror.hubspot_engagements (
  id bigint generated always as identity primary key,
  source_id text not null unique,
  company_source_id text,
  deal_source_id text,
  engagement_type text, -- email | call | meeting | note
  occurred_at timestamptz,
  subject text,
  body text,
  raw jsonb not null default '{}'::jsonb,
  updated_at_source timestamptz,
  synced_at timestamptz,
  dirty boolean not null default true
);

create table mirror.hubspot_tickets (
  id bigint generated always as identity primary key,
  source_id text not null unique,
  company_source_id text,
  status text,
  subject text,
  created_at_source timestamptz,
  raw jsonb not null default '{}'::jsonb,
  updated_at_source timestamptz,
  synced_at timestamptz,
  dirty boolean not null default true
);

create table mirror.hubspot_line_items (
  id bigint generated always as identity primary key,
  source_id text not null unique,
  deal_source_id text,
  name text,
  amount_cents bigint,
  quantity numeric,
  raw jsonb not null default '{}'::jsonb,
  updated_at_source timestamptz,
  synced_at timestamptz,
  dirty boolean not null default true
);

-- Reconcile + hydration worker access patterns
create index on mirror.kantata_time_entries (workspace_source_id, date_performed);
create index on mirror.kantata_allocations (user_source_id, week_start);
create index on mirror.kantata_stories (workspace_source_id);
create index on mirror.hubspot_deals (company_source_id);
create index on mirror.hubspot_engagements (company_source_id, occurred_at);
