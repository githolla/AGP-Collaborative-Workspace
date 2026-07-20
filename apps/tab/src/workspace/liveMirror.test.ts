import { describe, expect, it } from "vitest";
import { mapLivePayload, type RawMirrorPayload } from "./liveMirror.js";

/**
 * The raw /api/mirror payload → AgpMirror mapping, validated against the
 * portal property reference (docs/hubspot-property-map.md): agp_industry is
 * the vertical with industry fallback, deals resolve their client via the
 * company association, Kantata workspaces map with custom fields empty
 * until the tenant grounding doc lands.
 */

function payload(overrides: Partial<RawMirrorPayload>): RawMirrorPayload {
  return {
    live: true,
    fetchedAt: "2026-07-20T12:00:00Z",
    sources: {
      hubspot: { ok: true, note: "", companies: 0, deals: 0 },
      kantata: { ok: true, note: "", projects: 0 },
    },
    companies: [],
    deals: [],
    kantataProjects: [],
    ...overrides,
  };
}

describe("mapLivePayload", () => {
  it("maps vertical from agp_industry with industry fallback", () => {
    const mirror = mapLivePayload(
      payload({
        companies: [
          { id: "1", name: "Harvest Hope", agp_industry: "Food Banks", industry: "NONPROFIT" },
          { id: "2", name: "KPBX", agp_industry: "", industry: "BROADCAST_MEDIA" },
        ],
      }),
    );
    expect(mirror.clients[0]?.vertical).toBe("Food Banks");
    expect(mirror.clients[1]?.vertical).toBe("BROADCAST_MEDIA");
  });

  it("carries account intelligence and drops nameless companies", () => {
    const mirror = mapLivePayload(
      payload({
        companies: [
          {
            id: "1",
            name: "Harvest Hope",
            client_health_index__c: "Green",
            renewal: "2026-11-01",
            gdna_subscription_level: "Pro",
            hs_count_intent_signals_created_last_30_days: "4",
            lifecyclestage: "customer",
            ownername: "Dana W.",
          },
          { id: "ghost", name: "" },
        ],
      }),
    );
    expect(mirror.clients).toHaveLength(1);
    const c = mirror.clients[0]!;
    expect(c.healthIndex).toBe("Green");
    expect(c.renewal).toBe("2026-11-01");
    expect(c.gdnaLevel).toBe("Pro");
    expect(c.intentCount30d).toBe(4);
    expect(c.lifecycleStage).toBe("customer");
    expect(c.owner).toBe("Dana W.");
  });

  it("resolves a deal's client through the company association", () => {
    const mirror = mapLivePayload(
      payload({
        companies: [{ id: "77", name: "Harvest Hope" }],
        deals: [
          { id: "d1", dealname: "FY27 Direct Mail Renewal", dealstage: "contractsent", company_id: "77" },
          { id: "d2", dealname: "", dealstage: "x", company_id: "77" },
        ],
      }),
    );
    expect(mirror.campaigns).toHaveLength(1);
    expect(mirror.campaigns[0]).toMatchObject({
      title: "FY27 Direct Mail Renewal",
      clientName: "Harvest Hope",
      stage: "contractsent",
      kind: "deal",
    });
  });

  it("maps Kantata workspaces with dates and custom fields honestly empty", () => {
    const mirror = mapLivePayload(
      payload({
        kantataProjects: [
          { id: "900", title: "Year-Round Digital Retainer", status: "In Progress", start_date: "2026-01-01", due_date: "2026-12-31" },
        ],
      }),
    );
    expect(mirror.projects[0]).toMatchObject({
      id: "900",
      title: "Year-Round Digital Retainer",
      serviceLine: "",
      vertical: "",
      model: "In Progress",
      startDate: "2026-01-01",
      dueDate: "2026-12-31",
    });
  });

  it("maps Kantata milestones to their projects and drops dateless ones", () => {
    const mirror = mapLivePayload(
      payload({
        kantataMilestones: [
          { id: "s1", workspace_id: 900, title: "Fall pledge drive launch", due_date: "2026-10-01T00:00:00Z", state: "not_started" },
          { id: "s2", workspace_id: 900, title: "No date yet", due_date: "", state: "not_started" },
        ],
      }),
    );
    expect(mirror.milestones).toHaveLength(1);
    expect(mirror.milestones[0]).toMatchObject({
      id: "s1",
      projectId: "900",
      title: "Fall pledge drive launch",
      dueDate: "2026-10-01",
      state: "not_started",
    });
  });

  it("carries deal close dates for the campaign import", () => {
    const mirror = mapLivePayload(
      payload({
        companies: [{ id: "77", name: "Harvest Hope" }],
        deals: [{ id: "d1", dealname: "FY27 Renewal", dealstage: "contractsent", company_id: "77", closedate: "2026-08-30T12:00:00Z" }],
      }),
    );
    expect(mirror.campaigns[0]?.closeDate).toBe("2026-08-30T12:00:00Z");
  });

  it("returns an empty mirror for an empty payload", () => {
    const mirror = mapLivePayload(payload({}));
    expect(mirror.clients).toHaveLength(0);
    expect(mirror.projects).toHaveLength(0);
    expect(mirror.campaigns).toHaveLength(0);
  });
});
