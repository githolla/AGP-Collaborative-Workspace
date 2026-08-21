-- api/_lib/msFolder.ts's "created on demand" folder-chain bookkeeping
-- (ensureFolderChain/ensureMsFolderForGraphId, teams-provisioning-plan.md B4
-- §5/§6) ran its collab.ms_folder existence checks and inserts under the
-- CALLING PERSON'S OWN RLS context (withUserContext) — the same connection
-- every other query in a handler uses. That is correct for anything the
-- person is actually being SHOWN, but this bookkeeping is different: it
-- decides whether an ANCESTOR folder (the project/milestone above whatever
-- leaf the person is actually writing into) already exists, purely to avoid
-- re-creating it. ms_folder_read's policy (0008) only shows a row to an
-- external if THEIR OWN grant matches THAT ROW'S OWN kantata_id — correct
-- for what their Files tab should list, but an ancestor folder is
-- deliberately never in their own grant, so the existence check came back
-- empty even when the row was real. ensureFolderChain then tried to
-- (re)create that ancestor at Microsoft Graph, which correctly refused with
-- a 409 nameAlreadyExists — confirmed live 2026-08-19: a contractor's
-- upload into their own granted milestone folder failed this way because
-- the PARENT project folder's row (which they hold no grant on directly)
-- was invisible to their own RLS lens, not because anything was actually
-- missing. The INSERT side has the identical problem in the other
-- direction: ms_folder_insert requires is_workspace_admin(account_id), so
-- even a genuinely-missing ancestor folder could never be written by a
-- non-admin external's own request.
--
-- Fix: two narrow security-definer functions, same trust pattern as
-- is_workspace_admin()/holds_grant() above — small, single-purpose, and
-- reachable only from this app's own server code (raw Postgres, never
-- PostgREST; collab is not in its exposed schema list). Each is called only
-- after the handler that calls it has independently verified the caller may
-- write into the SPECIFIC kantata_id actually being resolved
-- (files-upload-session.ts's is_member/write_grant check, grant.ts's
-- is_workspace_admin check) — the ancestor chain above that id is this
-- app's own infrastructure, not a separate thing the caller is being
-- granted or denied.

create or replace function collab.ms_folder_lookup(p_account_id uuid, p_kantata_id text)
returns table(folder_id text, parent_folder_id text, name text)
language sql stable
security definer
set search_path = collab, public
as $$
  select folder_id, parent_folder_id, name
  from collab.ms_folder
  where account_id = p_account_id and kantata_id = p_kantata_id;
$$;

create or replace function collab.ms_folder_lookup_by_graph_id(p_account_id uuid, p_folder_id text)
returns table(kantata_id text)
language sql stable
security definer
set search_path = collab, public
as $$
  select kantata_id
  from collab.ms_folder
  where account_id = p_account_id and folder_id = p_folder_id;
$$;

create or replace function collab.ms_folder_upsert(
  p_account_id uuid,
  p_kantata_id text,
  p_folder_id text,
  p_parent_folder_id text,
  p_name text,
  p_level text
)
returns void
language sql
security definer
set search_path = collab, public
as $$
  insert into collab.ms_folder (account_id, kantata_id, folder_id, parent_folder_id, name, level)
  values (p_account_id, p_kantata_id, p_folder_id, p_parent_folder_id, p_name, p_level)
  on conflict (account_id, kantata_id) do update set folder_id = excluded.folder_id, name = excluded.name;
$$;
