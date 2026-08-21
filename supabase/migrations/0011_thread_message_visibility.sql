-- Lets any account member (not just the author) flip a thread_message's
-- client/contractor visibility flags — api-spec-workspace-mutations.md gives
-- `PATCH /api/message/:messageId/visibility` role "member", distinct from
-- `PATCH /api/message/:messageId` (body edits), which stays "author only".
--
-- Why this needs a function rather than a second RLS policy: RLS policies
-- restrict which ROWS a statement may touch, never which COLUMNS. If a
-- second, permissive "any member may UPDATE" policy existed alongside
-- 0008's author-only one, Postgres OR's every applicable UPDATE policy
-- together — so a non-author member's statement would pass row-eligibility
-- via the member policy even if it also set `body`, since RLS has no way to
-- see "this statement only touches the two visibility columns" versus
-- "this statement also touches body". Column-level GRANTs can't fix this
-- either: a privilege grant is scoped to a ROLE, not conditional on being a
-- particular row's author, so it can't express "authenticated may update
-- body, but only on rows where they are the author" — only RLS can, and
-- only per-row, not per-column.
--
-- A SECURITY DEFINER function sidesteps the conflict entirely: it is the
-- ONLY path allowed to touch these two columns for a non-author, and it
-- re-implements its own authorization check in its body — same pattern as
-- collab.is_workspace_admin()/holds_grant() already use for reads, just the
-- first one that performs a write. Being SECURITY DEFINER, it runs as the
-- function's owner (the migration role, which owns the table) and is not
-- subject to thread_message's RLS policies at all — which is exactly why it
-- must check authorization itself rather than lean on ambient RLS.
create or replace function collab.set_message_visibility(
  p_message_id uuid,
  p_client_visible boolean,
  p_contractor_visible boolean
)
returns collab.thread_message
language plpgsql
security definer
set search_path = collab, public
as $$
declare
  v_account_id uuid;
  v_result collab.thread_message;
begin
  select account_id into v_account_id from collab.thread_message where id = p_message_id;

  -- Existence AND authorization collapse into the SAME error, deliberately —
  -- being SECURITY DEFINER, the lookup above bypasses thread_message's RLS
  -- entirely, so v_account_id resolves for ANY message id, in ANY account,
  -- regardless of the caller's own relationship to it. Raising a distinct
  -- code for "exists but you can't touch it" (42501/403) versus "no such
  -- message" (P0002/404) would let a caller learn that a given UUID belongs
  -- to a real message in someone else's tenant purely from which error code
  -- comes back — a cross-tenant existence oracle, and exactly the ambiguity
  -- every other endpoint in this schema deliberately collapses into one
  -- not_found. Checked here, not left to chance.
  if v_account_id is null or not (
    collab.is_workspace_admin(v_account_id)
    or exists (select 1 from collab.account_member m where m.account_id = v_account_id and m.user_id = auth.uid())
  ) then
    raise exception 'message not found' using errcode = 'P0002';
  end if;

  update collab.thread_message
  set
    client_visible = coalesce(p_client_visible, client_visible),
    contractor_visible = coalesce(p_contractor_visible, contractor_visible)
  where id = p_message_id
  returning * into v_result;

  return v_result;
end;
$$;

-- Not a blanket table grant — only EXECUTE on this one function, which is
-- the whole point: authenticated callers reach these two columns solely
-- through the authorization check above, never through a direct UPDATE.
grant execute on function collab.set_message_visibility(uuid, boolean, boolean) to authenticated;
