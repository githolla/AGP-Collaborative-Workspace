-- Two-way Teams sync (inbound): a Microsoft Graph change-notification
-- subscription per account Team, so a reply typed in the Teams channel flows
-- back into the workspace Discussion. One row per active subscription.
--
-- Only the service role touches this table (the webhook receiver and the
-- subscribe endpoint both go through withServiceContext / the elevated
-- connection role, which bypasses RLS). RLS is enabled with NO permissive
-- policies so the `authenticated` role can never read or write it directly —
-- subscription ids + client_state are effectively secrets.

create table collab.teams_subscription (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references collab.client_account(id) on delete cascade,
  -- Graph subscription id (the handle for renew/delete).
  subscription_id text not null unique,
  -- The subscribed resource, e.g. teams/{id}/channels/{id}/messages.
  resource text not null,
  team_id text not null,
  channel_id text not null,
  -- Secret echoed by Graph on every notification; we reject any that mismatch.
  client_state text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One live subscription per account (renew updates the row in place).
create unique index teams_subscription_account_uniq on collab.teams_subscription (account_id);

alter table collab.teams_subscription enable row level security;
-- No policies on purpose: authenticated users get nothing; service role only.

-- Idempotency for inbound replies: the Teams message id a Discussion post came
-- from (null for posts authored in the app). A retried Graph notification can't
-- double-post, and it also tags which thread messages originated in Teams.
alter table collab.thread_message add column teams_message_id text;
create unique index thread_message_teams_id_uniq
  on collab.thread_message (account_id, teams_message_id)
  where teams_message_id is not null;
