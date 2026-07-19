-- Registry schema group: people, capabilities, playbooks (SPEC Layer 4a).
-- Capability/inference tables are readable only by service role + admins —
-- comparative performance framing must never reach peers (SPEC hard rule).

create schema if not exists registry;

create table registry.people (
  id bigint generated always as identity primary key,
  entra_id text unique,            -- resolved at ingest by name/email match; null = unresolved
  kantata_user_source_id text unique,
  hubspot_owner_id text unique,
  full_name text not null,
  email text,
  title text,
  role text,
  function text,                   -- inferred function from org seed
  team text,
  entity_tag text,                 -- PG Agency | PG Software | PG Ops | Staff (merger heritage dimension)
  reports_to bigint references registry.people (id),
  routing_mode text not null default 'direct' check (routing_mode in ('direct', 'via_manager')),
  in_org_seed boolean not null default false, -- false = appeared in Kantata but not the seed (known_gaps)
  ambiguous_match boolean not null default false, -- flagged for admin review at ingest
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table registry.capabilities (
  id bigint generated always as identity primary key,
  person_id bigint not null references registry.people (id),
  capability text not null,
  evidence_refs jsonb not null default '[]'::jsonb, -- array of source_ref
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  admin_edited boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (person_id, capability)
);

create table registry.playbooks (
  id bigint generated always as identity primary key,
  engagement_type text not null,   -- keys on vertical x service line, never service alone
  vertical text,
  service_line text,
  version integer not null default 1,
  canonical boolean not null default false, -- leadership-designated AGP standard (domain rule 9)
  legacy_firm text,                -- provenance of derived variants (Pursuant, Allegiance, ...)
  source_project_refs jsonb not null default '[]'::jsonb,
  cast_template jsonb not null default '[]'::jsonb, -- [{function, trigger_point, typical_hours, sequence}]
  admin_edited boolean not null default false,
  created_at timestamptz not null default now(),
  unique (engagement_type, vertical, service_line, version)
);
