-- Grant access to any SharePoint folder, not only ones that map 1:1 to a
-- Kantata project/milestone/phase/task. Today collab.access_grant and
-- collab.ms_folder are both keyed on kantata_id — a folder created manually
-- in SharePoint (never synced from Kantata) has no id to be keyed by, so it
-- is invisible to the app.
--
-- Rather than a second identity column/FK (which would force rewriting
-- collab.holds_grant() and every RLS policy built on it — task_read,
-- thread_message_read/insert, ms_folder_read — plus a backfill of every
-- existing grant row), a folder with no Kantata correspondence is
-- represented by a SYNTHETIC kantata_id: 'graph:' + its real Microsoft Graph
-- driveItem id (api/_lib/msFolder.ts's syntheticIdFor). holds_grant()'s flat
-- string/array match already treats this exactly like any other kantata_id
-- — zero RLS changes, zero backfill needed.
--
-- Constraint names below are Postgres's default auto-generated names (0007
-- never named them explicitly) — confirmed live against
-- pg_constraint before writing this.
alter table collab.access_grant drop constraint access_grant_level_check;
alter table collab.access_grant add constraint access_grant_level_check
  check (level in ('project', 'milestone', 'phase', 'task', 'folder'));

alter table collab.ms_folder drop constraint ms_folder_level_check;
alter table collab.ms_folder add constraint ms_folder_level_check
  check (level in ('project', 'milestone', 'phase', 'task', 'folder'));

-- collab.thread_message.kantata_level's identical-looking check is
-- deliberately NOT widened here — nothing writes 'folder' into it this
-- pass (no messaging UI against a browsed-only folder yet).
