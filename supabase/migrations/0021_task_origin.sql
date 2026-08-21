-- The initiative->task bridge (docs/api-spec-workspace-mutations.md "the one
-- place the two stores meet"): when an internal build/initiative task is
-- flagged client-visible, it is COPIED into a real collab.task row rather
-- than live-projected from the JSON document (`Initiative` stays in
-- /api/state, out of scope for this migration). These two columns stamp
-- where a copy came from, so re-flagging the same initiative task
-- client-visible twice is idempotent (matched here) rather than creating a
-- duplicate row every time.
--
-- Nullable, and NOT a foreign key: the initiative/task ids they reference
-- live in the OLD JSON document, an entirely different id space with no
-- referential integrity Postgres could enforce here anyway (same reasoning
-- collab.task's own kantata_story_id/kantata_project_id columns already
-- follow for Kantata's foreign ids).
alter table collab.task
  add column origin_initiative_id text,
  add column origin_task_id text;

-- One copy per (account, origin task) — the actual idempotency guard;
-- `where origin_task_id is not null` so ordinary manual/Kantata-imported
-- tasks (which never set this column) aren't constrained by it at all.
create unique index task_origin_unique
  on collab.task (account_id, origin_task_id)
  where origin_task_id is not null;
