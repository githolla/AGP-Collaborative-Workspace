-- A companion to collab.is_workspace_admin(), for the one check that keeps
-- getting copy-pasted as raw SQL in the API layer instead of called as a
-- function: "is this caller a plain member OR an admin of this account" —
-- needed ahead of a bulk/rate-limited operation whose own RLS policy would
-- otherwise deny silently (0 rows), making "authorized, nothing to do"
-- indistinguishable from "not authorized at all" unless checked explicitly
-- first. Found duplicated verbatim across api/account-campaigns.ts,
-- api/account-deepen.ts, api/account-import.ts, api/account-tasks-synced.ts
-- during a dead-code/redundancy review — same expression already used
-- repeatedly as policy bodies in migration 0008 (task_insert, campaign_write,
-- activity_insert, etc.), just never itself named and reused.
create or replace function collab.is_account_member_or_admin(p_account_id uuid)
returns boolean
language sql stable
security definer
set search_path = collab, public
as $$
  select
    collab.is_workspace_admin(p_account_id)
    or exists (select 1 from collab.account_member m where m.account_id = p_account_id and m.user_id = auth.uid());
$$;

grant execute on function collab.is_account_member_or_admin(uuid) to authenticated;
