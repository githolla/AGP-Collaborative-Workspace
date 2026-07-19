import { entityKeyString, type Cursor, type EntityKey, type HydratedEntity, type RawEvent } from "./types.js";

export interface MirrorRow {
  key: EntityKey;
  updatedAtSource: string | null;
  syncedAt: string | null;
  dirty: boolean;
  deleted: boolean;
  data: Record<string, unknown> | null;
}

/**
 * Persistence boundary of the sync service. Production backs this with the
 * Supabase mirror/sync schemas; tests use the in-memory implementation below.
 */
export interface MirrorStore {
  markDirty(key: EntityKey): Promise<void>;
  upsertHydrated(entity: HydratedEntity, syncedAt: string): Promise<void>;
  markDeleted(key: EntityKey, syncedAt: string): Promise<void>;
  get(key: EntityKey): Promise<MirrorRow | null>;
  list(source: string, entityType: string): Promise<MirrorRow[]>;

  /** Record a raw event; returns false when this event id was already seen. */
  recordEvent(event: RawEvent): Promise<boolean>;

  getCursor(source: string, stream: string): Promise<Cursor | null>;
  setCursor(source: string, stream: string, cursor: Cursor): Promise<void>;
}

export class InMemoryMirrorStore implements MirrorStore {
  private rows = new Map<string, MirrorRow>();
  private events = new Set<string>();
  private cursors = new Map<string, Cursor>();

  async markDirty(key: EntityKey): Promise<void> {
    const existing = this.rows.get(entityKeyString(key));
    if (existing) {
      existing.dirty = true;
    } else {
      this.rows.set(entityKeyString(key), {
        key,
        updatedAtSource: null,
        syncedAt: null,
        dirty: true,
        deleted: false,
        data: null,
      });
    }
  }

  async upsertHydrated(entity: HydratedEntity, syncedAt: string): Promise<void> {
    this.rows.set(entityKeyString(entity), {
      key: { source: entity.source, entityType: entity.entityType, sourceId: entity.sourceId },
      updatedAtSource: entity.updatedAt,
      syncedAt,
      dirty: false,
      deleted: false,
      data: entity.data,
    });
  }

  async markDeleted(key: EntityKey, syncedAt: string): Promise<void> {
    const row = this.rows.get(entityKeyString(key));
    if (row) {
      row.deleted = true;
      row.dirty = false;
      row.syncedAt = syncedAt;
    }
  }

  async get(key: EntityKey): Promise<MirrorRow | null> {
    return this.rows.get(entityKeyString(key)) ?? null;
  }

  async list(source: string, entityType: string): Promise<MirrorRow[]> {
    return [...this.rows.values()].filter(
      (r) => r.key.source === source && r.key.entityType === entityType,
    );
  }

  async recordEvent(event: RawEvent): Promise<boolean> {
    const id = `${event.source}:${event.eventId}`;
    if (this.events.has(id)) return false;
    this.events.add(id);
    return true;
  }

  async getCursor(source: string, stream: string): Promise<Cursor | null> {
    return this.cursors.get(`${source}:${stream}`) ?? null;
  }

  async setCursor(source: string, stream: string, cursor: Cursor): Promise<void> {
    this.cursors.set(`${source}:${stream}`, cursor);
  }
}
