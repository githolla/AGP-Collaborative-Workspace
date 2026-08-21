-- A cooldown on Kantata-triggering endpoints (POST /api/account-import,
-- /api/account-deepen, PUT /api/account-scope, POST /api/account-projects) —
-- every one of them is reachable by any plain collab.account_member (not
-- just workspace_admin), and every one fans out into ~10 parallel paginated
-- calls against Kantata's own API (api/_lib/kantataMirror.ts). With no
-- throttling at all, a single authorized-but-malicious member could loop
-- calls and burn through the shared, tenant-wide KANTATA_API_TOKEN's rate
-- limit or run up Vercel compute cost — a real, verified gap from a
-- security review, not theoretical.
--
-- Stateless per-instance rate limiting (an in-memory counter) doesn't work
-- here for the same reason api/_lib/adminConfirm.ts's confirm token isn't
-- in-memory either: two calls can land on two different, unrelated Vercel
-- invocations with no shared memory. Postgres is the one piece of shared,
-- durable state every invocation already has — so the cooldown lives here,
-- on the account itself, claimed via one atomic UPDATE.

alter table collab.client_account add column last_kantata_pull_at timestamptz;

-- SECURITY DEFINER, same reasoning as collab.set_message_visibility()/
-- set_notify_pref(): client_account_update's own RLS policy (0008) is
-- workspace_admin-only, but these routes correctly allow any plain member
-- (matching the client's own auto-populate-on-open behavior) — a narrower,
-- purpose-built operation than the general "update this account" capability
-- the blanket policy governs, so it needs its own authorization check
-- rather than either widening client_account_update (which would let any
-- member rename the account, archive it, etc.) or routing through
-- withServiceContext (reserved for the two documented, narrower crossings
-- in api/admin/users.ts and api/admin/workspace/clear.ts).
--
-- The UPDATE's WHERE clause both CHECKS the cooldown and CLAIMS the slot in
-- one atomic statement — two concurrent calls can't both pass the check and
-- then both proceed; Postgres's own row-level locking serializes them, and
-- the second sees the first's fresh timestamp once it commits.
create or replace function collab.claim_kantata_pull_slot(p_account_id uuid, p_cooldown_seconds int)
returns boolean
language plpgsql
security definer
set search_path = collab, public
as $$
declare
  v_claimed uuid;
begin
  if not (
    collab.is_workspace_admin(p_account_id)
    or exists (select 1 from collab.account_member m where m.account_id = p_account_id and m.user_id = auth.uid())
  ) then
    raise exception 'not authorized for this account' using errcode = '42501';
  end if;

  update collab.client_account
  set last_kantata_pull_at = now()
  where id = p_account_id
    and (last_kantata_pull_at is null or last_kantata_pull_at < now() - make_interval(secs => p_cooldown_seconds))
  returning id into v_claimed;

  return v_claimed is not null;
end;
$$;

grant execute on function collab.claim_kantata_pull_slot(uuid, int) to authenticated;
