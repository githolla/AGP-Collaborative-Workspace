-- Lets any account member (not just workspace_admin) set another person's
-- notify preference — api-spec-workspace-mutations.md gives
-- `PATCH /api/account/:id/notify/:personName` role "member", but
-- `client_account_update` (0008) is workspace_admin-only, since every OTHER
-- field on client_account (client_name, archived, kantata_project_ids, the
-- ms_* provisioning columns) is deliberately admin-only. Same shape of
-- problem as 0011's message-visibility split, and the same fix: RLS can't
-- restrict an UPDATE to one jsonb key without a permissive policy also
-- opening every other column on the row to any member, so this is a
-- SECURITY DEFINER function that re-checks its own authorization (member or
-- admin) and touches only notify_prefs.
create or replace function collab.set_notify_pref(
  p_account_id uuid,
  p_person_name text,
  p_pref text
)
returns collab.client_account
language plpgsql
security definer
set search_path = collab, public
as $$
declare
  v_result collab.client_account;
begin
  if p_pref not in ('teams', 'email', 'both') then
    raise exception 'pref must be teams, email or both' using errcode = '23514';
  end if;

  if not (
    collab.is_workspace_admin(p_account_id)
    or exists (select 1 from collab.account_member m where m.account_id = p_account_id and m.user_id = auth.uid())
  ) then
    raise exception 'not authorized to set notify preferences on this account' using errcode = '42501';
  end if;

  update collab.client_account
  set notify_prefs = notify_prefs || jsonb_build_object(p_person_name, p_pref)
  where id = p_account_id
  returning * into v_result;

  if v_result.id is null then
    raise exception 'account not found' using errcode = 'P0002';
  end if;

  return v_result;
end;
$$;

grant execute on function collab.set_notify_pref(uuid, text, text) to authenticated;
