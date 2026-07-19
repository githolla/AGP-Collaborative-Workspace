import type { ChangeRef, Cursor, EntityKey, HydratedEntity, RawEvent, Source } from "../types.js";

export interface PollResult {
  changes: ChangeRef[];
  rawEvents: RawEvent[];
  nextCursor: Cursor;
}

/**
 * One interface for every source system (SPEC constraint #2): Kantata's
 * subscribed-events polling, HubSpot's webhook-or-poll, and a future GivingDNA
 * connector all present the same three capabilities to the pipeline.
 */
export interface SourceAdapter {
  readonly source: Source;
  readonly entityTypes: readonly string[];

  /** Detect changes since `cursor` (null = from the beginning of the stream). */
  pollChanges(cursor: Cursor | null): Promise<PollResult>;

  /** Fetch current entity state. Returns null when the entity no longer exists. */
  hydrate(key: EntityKey): Promise<HydratedEntity | null>;

  /**
   * List (id, updatedAt) for every entity of a type updated since `since`
   * (null = all). Powers backfill and the nightly reconcile.
   */
  listUpdatedSince(
    entityType: string,
    since: string | null,
  ): Promise<{ sourceId: string; updatedAt: string }[]>;
}
