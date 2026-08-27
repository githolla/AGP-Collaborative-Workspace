-- Role-based views (Kellie/Cara/Suuchi pilot call): internal AGP people should
-- see different tabs by tier. Two tiers to start (Cara: "don't overcomplicate,
-- grow into it"): an ACCOUNT tier (Client Experience — strategists + PMs) that
-- sees everything incl. the Client Dashboard and Admin, and a DELIVERY tier
-- (everyone else contributing) that sees only Home, Project Plan, Discussions
-- and Files — no client dashboard. A super-admin configures who is in which
-- tier (Suuchi: front-end configurable, not hard-coded role→access).
--
-- Stored as one jsonb blob per account, same account-scoped-JSON pattern as
-- notify_prefs (0012) and notifications (0007):
--   { "defaultTier": "account"|"delivery",
--     "memberTiers": { "<lowercased-email>": "account"|"delivery" } }
-- Empty '{}' means "everyone is account tier" — i.e. current behavior, so this
-- is strictly opt-in and changes nothing until an admin configures it.
--
-- HONEST LIMITATION (same as roles.ts): this is presentation-layer tiering that
-- hides tabs; it is not yet a security boundary. Real per-tab RLS is B6's job.

alter table collab.client_account add column view_config jsonb not null default '{}'::jsonb;

-- Setter, same shape as collab.set_notify_pref (0012): RLS can't scope an UPDATE
-- to a single jsonb column without opening every other client_account column, so
-- a SECURITY DEFINER function re-checks authorization and touches only
-- view_config. Any account member or admin may set it — the config UI is
-- surfaced to app-admins only on the client, matching the presentation-gating
-- contract; server-side enforcement of "admin only" lands with B6.
create or replace function collab.set_view_config(
  p_account_id uuid,
  p_config jsonb
)
returns collab.client_account
language plpgsql
security definer
set search_path = collab, public
as $$
declare
  v_result collab.client_account;
begin
  if jsonb_typeof(p_config) is distinct from 'object' then
    raise exception 'view_config must be a json object' using errcode = '22023';
  end if;

  if not collab.is_account_member_or_admin(p_account_id) then
    raise exception 'not authorized to set view config on this account' using errcode = '42501';
  end if;

  update collab.client_account
  set view_config = p_config
  where id = p_account_id
  returning * into v_result;

  if v_result.id is null then
    raise exception 'account not found' using errcode = 'P0002';
  end if;

  return v_result;
end;
$$;

grant execute on function collab.set_view_config(uuid, jsonb) to authenticated;
