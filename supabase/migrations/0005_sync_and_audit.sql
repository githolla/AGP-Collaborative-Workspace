-- Sync infrastructure + audit trail.

create schema if not exists sync;

-- Durable dedup queue (ADR 0002). At most one PENDING job per entity key;
-- workers claim with FOR UPDATE SKIP LOCKED (see services/sync/sql/queue.sql).
create table sync.jobs (
  id bigint generated always as identity primary key,
  source text not null,            -- kantata | hubspot | givingdna
  entity_type text not null,
  source_id text not null,
  status text not null default 'pending' check (status in ('pending', 'claimed', 'done', 'failed')),
  attempts integer not null default 0,
  last_error text,
  correlation_id text,
  enqueued_at timestamptz not null default now(),
  claimed_at timestamptz,
  finished_at timestamptz
);

-- Dedup: one pending job per key. Partial unique index lets completed history accumulate.
create unique index sync_jobs_pending_key
  on sync.jobs (source, entity_type, source_id)
  where status in ('pending', 'claimed');

-- Raw event storage (Kantata subscribed events, HubSpot webhook payloads).
-- Kept for signal mining (churn-pattern signatures); dedup by source event id.
create table sync.events (
  id bigint generated always as identity primary key,
  source text not null,
  event_id text not null,
  event_type text,
  subject_type text,
  subject_source_id text,
  occurred_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  unique (source, event_id)
);

-- Poll cursors per source/stream, and reconcile watermarks per entity type.
create table sync.cursors (
  source text not null,
  stream text not null,            -- 'events' | entity type for reconcile watermark
  cursor jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (source, stream)
);

-- Every external write with before/after and correlation id (SPEC constraint #6).
create table sync.audit_log (
  id bigint generated always as identity primary key,
  correlation_id text not null,
  actor text not null,             -- service | person entra_id
  target_system text not null,     -- kantata | hubspot | graph | teams
  operation text not null,
  target_ref text not null,
  before jsonb,
  after jsonb,
  autonomy_tier text,
  action_id bigint,
  at timestamptz not null default now()
);

create index on sync.audit_log (correlation_id);
create index on sync.audit_log (target_system, at);
