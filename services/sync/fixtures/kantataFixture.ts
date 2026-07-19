import type { KantataApiPort, KantataEvent } from "../src/adapters/kantata.js";

export interface KantataFixtureData {
  entities: Record<string, Record<string, unknown>[]>; // entityType -> entities (each with id, updated_at)
  events: KantataEvent[];
}

/**
 * Fixture-backed Kantata API (ADR 0003): lets the whole sync stack (and later
 * the UI) run with zero credentials. Mutable so tests can simulate the real
 * API's failure modes — duplicated events, out-of-order delivery, and updates
 * that never produced an event (the gap the nightly reconcile must catch).
 */
export class FixtureKantataApi implements KantataApiPort {
  constructor(readonly data: KantataFixtureData) {}

  async listEvents(afterEventId: string | null): Promise<KantataEvent[]> {
    if (afterEventId === null) return [...this.data.events];
    const idx = this.data.events.findLastIndex((e) => e.id === afterEventId);
    return idx === -1 ? [...this.data.events] : this.data.events.slice(idx + 1);
  }

  async getEntity(entityType: string, id: string): Promise<Record<string, unknown> | null> {
    const found = (this.data.entities[entityType] ?? []).find((e) => e.id === id);
    return found ? { ...found } : null;
  }

  async listEntities(
    entityType: string,
    updatedSince: string | null,
  ): Promise<{ id: string; updated_at: string }[]> {
    return (this.data.entities[entityType] ?? [])
      .filter((e) => updatedSince === null || String(e.updated_at) > updatedSince)
      .map((e) => ({ id: String(e.id), updated_at: String(e.updated_at) }));
  }

  // ---- test helpers ----

  /** Update an entity AND append the event Kantata would emit. */
  updateEntity(entityType: string, id: string, patch: Record<string, unknown>, event: KantataEvent): void {
    this.updateEntitySilently(entityType, id, patch);
    this.data.events.push(event);
  }

  /** Update an entity WITHOUT an event — simulates a lost/expired event (the reconcile gap). */
  updateEntitySilently(entityType: string, id: string, patch: Record<string, unknown>): void {
    const list = this.data.entities[entityType] ?? [];
    const entity = list.find((e) => e.id === id);
    if (!entity) throw new Error(`fixture: no ${entityType} with id ${id}`);
    Object.assign(entity, patch);
  }

  /** Remove an entity entirely — simulates deletion at the source. */
  deleteEntity(entityType: string, id: string): void {
    const list = this.data.entities[entityType] ?? [];
    const idx = list.findIndex((e) => e.id === id);
    if (idx === -1) throw new Error(`fixture: no ${entityType} with id ${id}`);
    list.splice(idx, 1);
  }
}
