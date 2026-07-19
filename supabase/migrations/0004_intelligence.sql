-- Intelligence schema group: artifacts, signals, actions, baselines, embeddings.

create extension if not exists vector;

create schema if not exists intel;

create table intel.artifacts (
  id bigint generated always as identity primary key,
  artifact_type text not null,     -- sow | project_plan | brief | budget_model | client_report | change_order | case_study
  workspace_map_id bigint,
  version integer not null default 1,
  status text not null default 'draft' check (status in ('draft', 'approved', 'live', 'superseded')),
  outcome_tags text[] not null default '{}', -- won | delivered_on_budget | beat_benchmark | ...
  title text not null,
  body text not null,
  provenance jsonb not null default '[]'::jsonb, -- array of source_ref; no unreferenced quantitative claims
  created_by bigint,
  approved_by bigint,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table intel.signals (
  id bigint generated always as identity primary key,
  signal_type text not null,       -- burn_deviation | allocation_conflict | milestone_slip | stale_timesheet | ...
  workspace_map_id bigint,
  client_source_id text,
  severity text not null default 'info',
  payload jsonb not null default '{}'::jsonb,
  explanation text not null,       -- one-sentence "because"
  detected_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table intel.actions (
  id bigint generated always as identity primary key,
  action_type text not null,
  autonomy_tier text not null check (autonomy_tier in ('A', 'B', 'C')),
  signal_id bigint references intel.signals (id),
  status text not null default 'proposed' check (status in (
    'proposed', 'approved', 'executed', 'undone', 'dismissed', 'expired'
  )),
  payload jsonb not null default '{}'::jsonb,
  explanation text not null,
  undo_deadline timestamptz,       -- Tier A: executed with undo window
  acted_by bigint,                 -- person who approved/dismissed (null for Tier A auto)
  created_at timestamptz not null default now(),
  executed_at timestamptz
);

-- Learned per-project/per-client normals; never user-configured thresholds.
create table intel.baselines (
  id bigint generated always as identity primary key,
  scope_type text not null check (scope_type in ('workspace', 'client', 'vertical_service')),
  scope_key text not null,
  metric text not null,            -- weekly_burn | comms_recency | task_churn | ...
  commercial_model text,           -- burn baselines are per commercial model (domain rule 2)
  value jsonb not null,            -- distribution params, not a single number
  learned_at timestamptz not null default now(),
  unique (scope_type, scope_key, metric)
);

create table intel.user_prefs_learned (
  id bigint generated always as identity primary key,
  person_id bigint not null,
  signal_type text not null,
  weight numeric not null default 1.0, -- dismissals lower it, engagement raises it
  updated_at timestamptz not null default now(),
  unique (person_id, signal_type)
);

create table intel.embeddings (
  id bigint generated always as identity primary key,
  source_ref jsonb not null,       -- {system, entity, id, snapshot_at}
  content_kind text not null,      -- time_entry_note | task_description | engagement_body | artifact_text | deal_description
  content text not null,
  embedding vector(1536),
  created_at timestamptz not null default now()
);

create index on intel.embeddings using hnsw (embedding vector_cosine_ops);
create index on intel.signals (signal_type, detected_at);
create index on intel.actions (status, autonomy_tier);
