export type Source = "kantata" | "hubspot" | "givingdna";

/** Identity of one entity in one source system. */
export interface EntityKey {
  source: Source;
  entityType: string;
  sourceId: string;
}

export function entityKeyString(key: EntityKey): string {
  return `${key.source}:${key.entityType}:${key.sourceId}`;
}

/**
 * A change *hint* — an event, webhook, or poll diff said this entity changed.
 * Change refs are untrusted for content (ADR 0002): they only mark rows dirty;
 * hydration always fetches current state from the source API.
 */
export interface ChangeRef extends EntityKey {
  observedAt: string;
  /** Source event id when the hint came from an event stream (for dedup/mining). */
  eventId?: string;
}

/** Current state of one entity as fetched from the source API. */
export interface HydratedEntity extends EntityKey {
  updatedAt: string;
  data: Record<string, unknown>;
}

/** Opaque per-source cursor; adapters define the shape. */
export type Cursor = Record<string, unknown>;

export interface RawEvent {
  source: Source;
  eventId: string;
  eventType: string;
  subjectType: string;
  subjectSourceId: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}
