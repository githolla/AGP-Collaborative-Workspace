-- Postgres implementation of the SyncQueue interface (see src/queue.ts and
-- supabase/migrations/0005_sync_and_audit.sql for the table + partial unique
-- index that provides dedup).

-- enqueue: dedup via the partial unique index on (source, entity_type, source_id)
-- where status in ('pending','claimed'). Returns 0 rows when deduped.
insert into sync.jobs (source, entity_type, source_id, correlation_id)
values ($1, $2, $3, $4)
on conflict (source, entity_type, source_id) where status in ('pending', 'claimed')
do nothing
returning id;

-- claim: workers race safely via FOR UPDATE SKIP LOCKED (SPEC engineering standard).
with next_jobs as (
  select id from sync.jobs
  where status = 'pending'
  order by enqueued_at
  limit $1
  for update skip locked
)
update sync.jobs j
set status = 'claimed', claimed_at = now(), attempts = attempts + 1
from next_jobs
where j.id = next_jobs.id
returning j.id, j.source, j.entity_type, j.source_id, j.correlation_id, j.attempts;

-- complete
update sync.jobs set status = 'done', finished_at = now() where id = $1;

-- fail (retry until attempts exhausted, then park as failed for operator review)
update sync.jobs
set status = case when attempts >= 5 then 'failed' else 'pending' end,
    last_error = $2,
    finished_at = case when attempts >= 5 then now() else null end
where id = $1;
