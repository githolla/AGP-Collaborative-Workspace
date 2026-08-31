-- Security tightening (handoff review M4): set_view_config (0026) gated on
-- is_account_member_or_admin, so ANY internal account member could rewrite the
-- account's view tiers — including other people's. View tiers are an ADMIN
-- control (the config UI is app-admin-only), so restrict the setter to
-- workspace admins, matching every other client_account mutation.
-- is_workspace_admin() already returns true for app admins, so the super-admins
-- who configure tiers still pass. create-or-replace = safe to re-run.

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

  if not collab.is_workspace_admin(p_account_id) then
    raise exception 'only workspace admins may set view config on this account' using errcode = '42501';
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
