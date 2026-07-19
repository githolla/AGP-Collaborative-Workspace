import { newCorrelationId } from "@agp/shared";
import type { SourceAdapter } from "./adapters/SourceAdapter.js";
import type { MirrorStore } from "./store.js";
import type { SyncQueue } from "./queue.js";

export interface ReconcileReport {
  checked: number;
  missing: number;
  stale: number;
  deletedCandidates: number;
}

/** Overlap added to the reconcile window so clock skew can't hide an update. */
const OVERLAP_MS = 6 * 60 * 60 * 1000;

/**
 * Nightly full reconcile (SPEC constraint #1, ADR 0002): an outage must never
 * silently lose data. Diffs source-side (id, updatedAt) against the mirror and
 * re-enqueues anything missing or stale. A full pass (no watermark) also
 * detects deletions by set difference — deletion candidates are re-hydrated,
 * and hydrate() returning null marks them deleted.
 *
 * Bounds the damage of any missed event to one reconcile period, independent
 * of Kantata's 9-day event retention.
 */
export async function reconcile(
  adapter: SourceAdapter,
  store: MirrorStore,
  queue: SyncQueue,
  clock: () => Date = () => new Date(),
): Promise<ReconcileReport> {
  const report: ReconcileReport = { checked: 0, missing: 0, stale: 0, deletedCandidates: 0 };
  const correlationId = newCorrelationId(`reconcile-${adapter.source}`, clock());

  for (const entityType of adapter.entityTypes) {
    const watermark = await store.getCursor(adapter.source, `reconcile:${entityType}`);
    const since =
      watermark && typeof watermark.updatedSince === "string"
        ? new Date(new Date(watermark.updatedSince).getTime() - OVERLAP_MS).toISOString()
        : null;
    const fullPass = since === null;

    const sourceRows = await adapter.listUpdatedSince(entityType, since);
    const seen = new Set<string>();
    let maxUpdatedAt = since ?? "";

    for (const { sourceId, updatedAt } of sourceRows) {
      report.checked += 1;
      seen.add(sourceId);
      if (updatedAt > maxUpdatedAt) maxUpdatedAt = updatedAt;

      const key = { source: adapter.source, entityType, sourceId };
      const row = await store.get(key);
      const missing = row === null || row.data === null;
      const stale = !missing && !row.deleted && (row.updatedAtSource ?? "") < updatedAt;
      if (missing || stale || row?.dirty) {
        if (missing) report.missing += 1;
        else if (stale) report.stale += 1;
        await store.markDirty(key);
        await queue.enqueue(key, correlationId);
      }
    }

    if (fullPass) {
      // Anything we mirror that the source no longer lists is a deletion candidate.
      for (const row of await store.list(adapter.source, entityType)) {
        if (!row.deleted && !seen.has(row.key.sourceId)) {
          report.deletedCandidates += 1;
          await store.markDirty(row.key);
          await queue.enqueue(row.key, correlationId);
        }
      }
    }

    if (maxUpdatedAt) {
      await store.setCursor(adapter.source, `reconcile:${entityType}`, { updatedSince: maxUpdatedAt });
    }
  }
  return report;
}

/** Backfill = a reconcile from the beginning of time; same machinery on purpose. */
export async function backfill(
  adapter: SourceAdapter,
  store: MirrorStore,
  queue: SyncQueue,
  clock: () => Date = () => new Date(),
): Promise<ReconcileReport> {
  for (const entityType of adapter.entityTypes) {
    await store.setCursor(adapter.source, `reconcile:${entityType}`, {});
  }
  return reconcile(adapter, store, queue, clock);
}
