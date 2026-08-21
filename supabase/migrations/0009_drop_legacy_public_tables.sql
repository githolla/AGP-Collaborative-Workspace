-- Removes an untracked, orphaned schema found in `public` while setting up
-- migration tracking for this project (2026-08-14) — 15 tables + 16 enum
-- types that map closely to this app's types.ts entities (ClientAccount,
-- ExternalMember, Task, ThreadMessage, ClientFileLink, Share, Campaign,
-- ActivityEvent, ClientNotification), evidently an earlier attempt at this
-- same migration, built against the ORIGINAL file-centric access model
-- (ADR 0009 — per-file grants via file_access_grants, a synced graph_item_id
-- on files) before this repo's pivot to the folder-based model in ADR 0010.
--
-- Confirmed before writing this file: every one of the 15 tables holds zero
-- rows (pg_dump --data-only produced no COPY/INSERT statements for any of
-- them), and no application code references any of these table names. It was
-- never recorded in this project's migration history either — created
-- out-of-band, not through `supabase db push` — which is exactly why it was
-- invisible until the ledger was set up and checked against the live schema.
--
-- Dropped rather than adapted: it duplicates the collab schema (0007/0008)
-- for the same purpose, under the access model this repo has since moved
-- away from. Two of its design choices were nonetheless better than this
-- migration's own first draft and are worth carrying forward on purpose,
-- not by inheriting this schema: `file_opens` as a per-event log rather than
-- collab.share's single `opened_at`, and `task_assignments`/
-- `task_dependencies` as real child tables rather than collab.task's
-- jsonb/array columns.
--
-- SAFE TO RUN MORE THAN ONCE, AND SAFE IF THE LEDGER LOSES TRACK OF WHETHER
-- IT RAN. Two separate guarantees, not one:
--
--   1. If these tables are already gone, every statement below is a no-op
--      (`IF EXISTS`) — a plain re-run does nothing, silently and safely.
--   2. If a table with one of these names exists but is NOT the empty
--      legacy schema this migration was written against — because the
--      ledger misfired and this ran again after something new and real was
--      built under the same name — dropping it would be a real, silent
--      data-loss bug. The guard below checks row counts BEFORE any DROP
--      runs and ABORTS THE WHOLE MIGRATION (no partial effect: this file is
--      one transaction) the moment anything unexpected has a row in it. It
--      re-verifies the exact fact that justified writing this file in the
--      first place, rather than trusting that fact still holds.
--
-- The type drops carry the same protection for free: DROP TYPE with no
-- CASCADE (below) already refuses if any column anywhere still depends on
-- it, so a type reused by a future, unrelated table fails loudly rather
-- than being silently removed out from under it.
--
-- EXPLICIT TRANSACTION, ON PURPOSE — do not rely on the caller for this.
-- Tested directly: running this file through plain `psql -f` (no
-- `ON_ERROR_STOP`) does NOT stop at the guard's RAISE EXCEPTION — psql
-- prints the error and keeps executing every statement after it, and each
-- bare DROP is its own implicit transaction, so the drops proceeded anyway
-- and destroyed the very row the guard had just refused to touch. The fix
-- is not a client flag (a future invocation might not set it) — it is this
-- BEGIN/COMMIT. Once the guard raises inside an explicit transaction,
-- Postgres marks that transaction aborted and refuses every statement after
-- it — including the final COMMIT — until a ROLLBACK, so nothing in this
-- file can take effect once the guard fires, regardless of what runs it or
-- which flags it uses.
begin;

do $$
declare
  legacy_tables text[] := array[
    'task_assignments', 'task_dependencies', 'task_estimates', 'file_access_grants',
    'file_opens', 'activity_events', 'campaigns', 'notifications', 'shares', 'messages',
    'files', 'contacts', 'tasks', 'workspace_members', 'workspaces'
  ];
  tbl text;
  row_count bigint;
begin
  foreach tbl in array legacy_tables loop
    if to_regclass('public.' || tbl) is not null then
      execute format('select count(*) from public.%I', tbl) into row_count;
      if row_count > 0 then
        raise exception
          'Refusing to run 0009_drop_legacy_public_tables: public.% has % row(s). '
          'This migration only removes the specific empty, unreferenced legacy schema '
          'confirmed on 2026-08-14 — a table by this name now holding data is not that '
          'schema, and dropping it here would destroy real data. Nothing has been '
          'dropped by this run; investigate before re-running.',
          tbl, row_count;
      end if;
    end if;
  end loop;
end $$;

-- Order: children before parents, so no CASCADE is needed anywhere below —
-- if the order is wrong, this fails loudly with a dependency error rather
-- than silently cascading into something unaccounted for.

drop table if exists public.task_assignments;
drop table if exists public.task_dependencies;
drop table if exists public.task_estimates;
drop table if exists public.file_access_grants;
drop table if exists public.file_opens;
drop table if exists public.activity_events;
drop table if exists public.campaigns;
drop table if exists public.notifications;
drop table if exists public.shares;
drop table if exists public.messages;
drop table if exists public.files;
drop table if exists public.contacts;
drop table if exists public.tasks;
drop table if exists public.workspace_members;
drop table if exists public.workspaces;

drop type if exists public.activity_kind;
drop type if exists public.campaign_status;
drop type if exists public.client_decision;
drop type if exists public.contact_access;
drop type if exists public.contact_role;
drop type if exists public.entra_status;
drop type if exists public.file_kind;
drop type if exists public.grant_permission;
drop type if exists public.message_kind;
drop type if exists public.notify_pref;
drop type if exists public.open_source;
drop type if exists public.share_item_kind;
drop type if exists public.share_purpose;
drop type if exists public.task_source;
drop type if exists public.task_status;
drop type if exists public.workspace_status;

commit;
