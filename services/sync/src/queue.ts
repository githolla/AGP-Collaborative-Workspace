import { entityKeyString, type EntityKey } from "./types.js";

export interface ClaimedJob {
  id: number;
  key: EntityKey;
  correlationId: string;
  attempts: number;
}

/**
 * Durable dedup queue (ADR 0002): at most one pending job per entity key, so N
 * duplicate change hints collapse into one hydration. Production implementation
 * is Postgres (`sql/queue.sql`, FOR UPDATE SKIP LOCKED); this interface keeps
 * the pipeline testable without a database.
 */
export interface SyncQueue {
  /** Returns false when a pending job for this key already exists (deduped). */
  enqueue(key: EntityKey, correlationId: string): Promise<boolean>;
  claim(max: number): Promise<ClaimedJob[]>;
  complete(job: ClaimedJob): Promise<void>;
  fail(job: ClaimedJob, error: string): Promise<void>;
  pendingCount(): Promise<number>;
}

const MAX_ATTEMPTS = 5;

export class InMemorySyncQueue implements SyncQueue {
  private nextId = 1;
  private pending = new Map<string, { id: number; key: EntityKey; correlationId: string; attempts: number }>();
  private claimed = new Map<number, { key: EntityKey }>();
  readonly failed: { key: EntityKey; error: string }[] = [];

  async enqueue(key: EntityKey, correlationId: string): Promise<boolean> {
    const k = entityKeyString(key);
    if (this.pending.has(k)) return false;
    if ([...this.claimed.values()].some((j) => entityKeyString(j.key) === k)) return false;
    this.pending.set(k, { id: this.nextId++, key, correlationId, attempts: 0 });
    return true;
  }

  async claim(max: number): Promise<ClaimedJob[]> {
    const jobs: ClaimedJob[] = [];
    for (const [k, job] of this.pending) {
      if (jobs.length >= max) break;
      this.pending.delete(k);
      this.claimed.set(job.id, { key: job.key });
      jobs.push({ id: job.id, key: job.key, correlationId: job.correlationId, attempts: job.attempts });
    }
    return jobs;
  }

  async complete(job: ClaimedJob): Promise<void> {
    this.claimed.delete(job.id);
  }

  async fail(job: ClaimedJob, error: string): Promise<void> {
    this.claimed.delete(job.id);
    if (job.attempts + 1 >= MAX_ATTEMPTS) {
      this.failed.push({ key: job.key, error });
      return;
    }
    this.pending.set(entityKeyString(job.key), {
      id: job.id,
      key: job.key,
      correlationId: job.correlationId,
      attempts: job.attempts + 1,
    });
  }

  async pendingCount(): Promise<number> {
    return this.pending.size;
  }
}
