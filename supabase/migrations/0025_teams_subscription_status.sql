-- Two-way Teams sync: background-provisioning status, one row per account.
--
-- Creating a Graph change-notification subscription makes THREE outbound calls
-- to Microsoft (app token, resolve channel, create subscription — the last of
-- which has Graph synchronously call our webhook back to validate it). Behind
-- Cloudflare that round-trip can outlive the origin's ~30s connection cap and
-- the browser gets a gateway 502 with no detail. So /api/teams-subscribe now
-- does the fast checks, returns immediately, and runs the Graph work in the
-- background; this table records how that background attempt went so the client
-- can poll for the outcome — success OR the real Graph error — instead of
-- holding an HTTP connection open the whole time.
--
-- teams_subscription (0024) still holds ONLY successful, live subscriptions
-- (every column there is NOT NULL). This table is the separate, always-present
-- per-account status/observability record that can also represent 'creating'
-- and 'error' states, which that table structurally cannot.
--
-- Service role only, same as teams_subscription: RLS enabled with no policies.

create table collab.teams_subscription_status (
  account_id uuid primary key references collab.client_account(id) on delete cascade,
  -- 'creating' while the background attempt runs, 'active' once Graph accepted
  -- the subscription, 'error' if it failed (reason in last_error).
  state text not null default 'creating',
  last_error text,
  last_attempt_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table collab.teams_subscription_status enable row level security;
-- No policies on purpose: authenticated users get nothing; service role only.
