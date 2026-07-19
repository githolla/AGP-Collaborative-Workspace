import { newCorrelationId } from "@agp/shared";
import type { SourceAdapter } from "./adapters/SourceAdapter.js";
import type { MirrorStore } from "./store.js";
import type { SyncQueue } from "./queue.js";

/**
 * Poll → dirty-flag → hydrate (ADR 0002).
 *
 * pollOnce(): ask the adapter for change hints since the stored cursor, record
 * raw events (deduped by event id), mark the mirror rows dirty, and enqueue
 * hydration. Duplicate and out-of-order hints are harmless: the queue holds at
 * most one pending job per entity, and hydration fetches *current* state.
 *
 * drain(): work the queue until empty. Hydration returning null means the
 * entity is gone at the source → mark deleted (archive semantics; never
 * destructive).
 */
export class SyncPipeline {
  constructor(
    private readonly adapter: SourceAdapter,
    private readonly store: MirrorStore,
    private readonly queue: SyncQueue,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async pollOnce(): Promise<{ newJobs: number; dedupedEvents: number }> {
    const cursor = await this.store.getCursor(this.adapter.source, "events");
    const result = await this.adapter.pollChanges(cursor);
    const correlationId = newCorrelationId(`poll-${this.adapter.source}`, this.clock());

    let dedupedEvents = 0;
    const freshEventIds = new Set<string>();
    for (const event of result.rawEvents) {
      const inserted = await this.store.recordEvent(event);
      if (inserted) freshEventIds.add(event.eventId);
      else dedupedEvents += 1;
    }

    let newJobs = 0;
    for (const change of result.changes) {
      // A change ref tied to an already-seen event is a redelivery — skip it.
      if (change.eventId !== undefined && !freshEventIds.has(change.eventId)) continue;
      await this.store.markDirty(change);
      const enqueued = await this.queue.enqueue(change, correlationId);
      if (enqueued) newJobs += 1;
    }

    await this.store.setCursor(this.adapter.source, "events", result.nextCursor);
    return { newJobs, dedupedEvents };
  }

  async drain(batchSize = 20): Promise<{ hydrated: number; deleted: number }> {
    let hydrated = 0;
    let deleted = 0;
    for (;;) {
      const jobs = await this.queue.claim(batchSize);
      if (jobs.length === 0) break;
      for (const job of jobs) {
        try {
          const entity = await this.adapter.hydrate(job.key);
          const syncedAt = this.clock().toISOString();
          if (entity === null) {
            await this.store.markDeleted(job.key, syncedAt);
            deleted += 1;
          } else {
            await this.store.upsertHydrated(entity, syncedAt);
            hydrated += 1;
          }
          await this.queue.complete(job);
        } catch (err) {
          await this.queue.fail(job, err instanceof Error ? err.message : String(err));
        }
      }
    }
    return { hydrated, deleted };
  }
}
