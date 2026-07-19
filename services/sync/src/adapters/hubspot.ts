import type { ChangeRef, Cursor, EntityKey, HydratedEntity } from "../types.js";
import type { PollResult, SourceAdapter } from "./SourceAdapter.js";

/**
 * HubSpot adapter (SPEC constraint #2): webhooks need a public app, so the
 * product must work on a private-app token. Polling on hs_lastmodifieddate is
 * the baseline change source; webhook payloads (when the public app exists)
 * feed the same pipeline via changesFromWebhook().
 */

export interface HubSpotApiPort {
  searchUpdatedSince(
    entityType: string,
    since: string | null,
  ): Promise<{ id: string; hs_lastmodifieddate: string }[]>;
  getEntity(entityType: string, id: string): Promise<Record<string, unknown> | null>;
}

export const HUBSPOT_ENTITY_TYPES = [
  "company",
  "deal",
  "contact",
  "engagement",
  "ticket",
  "line_item",
] as const;

export class HubSpotAdapter implements SourceAdapter {
  readonly source = "hubspot" as const;
  readonly entityTypes = HUBSPOT_ENTITY_TYPES;

  constructor(private readonly api: HubSpotApiPort) {}

  async pollChanges(cursor: Cursor | null): Promise<PollResult> {
    const watermarks: Record<string, string> =
      cursor && typeof cursor.watermarks === "object" && cursor.watermarks !== null
        ? { ...(cursor.watermarks as Record<string, string>) }
        : {};

    const changes: ChangeRef[] = [];
    for (const entityType of this.entityTypes) {
      const since = watermarks[entityType] ?? null;
      const rows = await this.api.searchUpdatedSince(entityType, since);
      for (const row of rows) {
        changes.push({
          source: this.source,
          entityType,
          sourceId: row.id,
          observedAt: row.hs_lastmodifieddate,
        });
        const current = watermarks[entityType];
        if (current === undefined || row.hs_lastmodifieddate > current) {
          watermarks[entityType] = row.hs_lastmodifieddate;
        }
      }
    }
    return { changes, rawEvents: [], nextCursor: { watermarks } };
  }

  /** Translate a HubSpot webhook delivery into change refs for the same pipeline. */
  static changesFromWebhook(
    events: { subscriptionType: string; objectId: number | string; occurredAt: number }[],
  ): ChangeRef[] {
    const typeMap: Record<string, (typeof HUBSPOT_ENTITY_TYPES)[number]> = {
      "company.propertyChange": "company",
      "company.creation": "company",
      "deal.propertyChange": "deal",
      "deal.creation": "deal",
      "contact.propertyChange": "contact",
      "contact.creation": "contact",
      "ticket.propertyChange": "ticket",
      "ticket.creation": "ticket",
    };
    const changes: ChangeRef[] = [];
    for (const event of events) {
      const entityType = typeMap[event.subscriptionType];
      if (!entityType) continue;
      changes.push({
        source: "hubspot",
        entityType,
        sourceId: String(event.objectId),
        observedAt: new Date(event.occurredAt).toISOString(),
      });
    }
    return changes;
  }

  async hydrate(key: EntityKey): Promise<HydratedEntity | null> {
    const data = await this.api.getEntity(key.entityType, key.sourceId);
    if (data === null) return null;
    const updatedAt =
      typeof data.hs_lastmodifieddate === "string"
        ? data.hs_lastmodifieddate
        : new Date(0).toISOString();
    return { ...key, updatedAt, data };
  }

  async listUpdatedSince(
    entityType: string,
    since: string | null,
  ): Promise<{ sourceId: string; updatedAt: string }[]> {
    const rows = await this.api.searchUpdatedSince(entityType, since);
    return rows.map((r) => ({ sourceId: r.id, updatedAt: r.hs_lastmodifieddate }));
  }
}
