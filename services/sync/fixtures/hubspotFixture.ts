import type { HubSpotApiPort } from "../src/adapters/hubspot.js";

export interface HubSpotFixtureData {
  entities: Record<string, Record<string, unknown>[]>; // entityType -> entities (each with id, hs_lastmodifieddate)
}

export class FixtureHubSpotApi implements HubSpotApiPort {
  constructor(readonly data: HubSpotFixtureData) {}

  async searchUpdatedSince(
    entityType: string,
    since: string | null,
  ): Promise<{ id: string; hs_lastmodifieddate: string }[]> {
    return (this.data.entities[entityType] ?? [])
      .filter((e) => since === null || String(e.hs_lastmodifieddate) > since)
      .map((e) => ({ id: String(e.id), hs_lastmodifieddate: String(e.hs_lastmodifieddate) }));
  }

  async getEntity(entityType: string, id: string): Promise<Record<string, unknown> | null> {
    const found = (this.data.entities[entityType] ?? []).find((e) => e.id === id);
    return found ? { ...found } : null;
  }

  updateEntity(entityType: string, id: string, patch: Record<string, unknown>): void {
    const list = this.data.entities[entityType] ?? [];
    const entity = list.find((e) => e.id === id);
    if (!entity) throw new Error(`fixture: no ${entityType} with id ${id}`);
    Object.assign(entity, patch);
  }
}
