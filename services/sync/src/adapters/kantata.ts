import type { ChangeRef, Cursor, EntityKey, HydratedEntity, RawEvent } from "../types.js";
import type { PollResult, SourceAdapter } from "./SourceAdapter.js";

/**
 * Kantata has NO push webhooks (SPEC constraint #1) — only the Subscribed
 * Events API: ~9-day retention, minutes of lag, out-of-order, duplicates.
 * The adapter treats events purely as dirty-hints; content is never trusted.
 */

export interface KantataEvent {
  id: string;
  eventType: string; // e.g. "story:updated"
  subjectType: string; // e.g. "story", "workspace", "time_entry"
  subjectId: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

/**
 * Narrow port over the Kantata HTTP API. Production implements this with
 * RateLimitedClient; tests and pre-credential development use the fixture
 * implementation in fixtures/.
 */
export interface KantataApiPort {
  /** Events after the given event id position (Kantata's sequence semantics). */
  listEvents(afterEventId: string | null): Promise<KantataEvent[]>;
  getEntity(entityType: string, id: string): Promise<Record<string, unknown> | null>;
  listEntities(
    entityType: string,
    updatedSince: string | null,
  ): Promise<{ id: string; updated_at: string }[]>;
}

export const KANTATA_ENTITY_TYPES = [
  "workspace",
  "participation",
  "story",
  "allocation",
  "assignment",
  "time_entry",
  "invoice",
  "expense",
  "custom_field_value",
  "user",
] as const;

const SUBJECT_TO_ENTITY: Record<string, (typeof KANTATA_ENTITY_TYPES)[number]> = {
  workspace: "workspace",
  participation: "participation",
  story: "story",
  allocation: "allocation",
  assignment: "assignment",
  time_entry: "time_entry",
  invoice: "invoice",
  expense: "expense",
  custom_field_value: "custom_field_value",
  user: "user",
};

export class KantataAdapter implements SourceAdapter {
  readonly source = "kantata" as const;
  readonly entityTypes = KANTATA_ENTITY_TYPES;

  constructor(private readonly api: KantataApiPort) {}

  async pollChanges(cursor: Cursor | null): Promise<PollResult> {
    const afterEventId =
      cursor && typeof cursor.lastEventId === "string" ? cursor.lastEventId : null;
    const events = await this.api.listEvents(afterEventId);

    const changes: ChangeRef[] = [];
    const rawEvents: RawEvent[] = [];
    let lastEventId = afterEventId;

    for (const event of events) {
      lastEventId = event.id;
      rawEvents.push({
        source: this.source,
        eventId: event.id,
        eventType: event.eventType,
        subjectType: event.subjectType,
        subjectSourceId: event.subjectId,
        occurredAt: event.occurredAt,
        payload: event.payload,
      });
      const entityType = SUBJECT_TO_ENTITY[event.subjectType];
      if (!entityType) continue; // unknown subject types are stored raw but not mirrored
      changes.push({
        source: this.source,
        entityType,
        sourceId: event.subjectId,
        observedAt: event.occurredAt,
        eventId: event.id,
      });
    }

    return {
      changes,
      rawEvents,
      nextCursor: lastEventId === null ? {} : { lastEventId },
    };
  }

  async hydrate(key: EntityKey): Promise<HydratedEntity | null> {
    const data = await this.api.getEntity(key.entityType, key.sourceId);
    if (data === null) return null;
    const updatedAt = typeof data.updated_at === "string" ? data.updated_at : new Date(0).toISOString();
    return { ...key, updatedAt, data };
  }

  async listUpdatedSince(
    entityType: string,
    since: string | null,
  ): Promise<{ sourceId: string; updatedAt: string }[]> {
    const rows = await this.api.listEntities(entityType, since);
    return rows.map((r) => ({ sourceId: r.id, updatedAt: r.updated_at }));
  }
}
