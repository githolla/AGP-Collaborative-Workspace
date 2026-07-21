import { describe, expect, it } from "vitest";
import { mapLivePayload, mergeFocusPayload, type RawMirrorPayload } from "./liveMirror.js";

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

  it("joins projects to clients via workspace groups and maps custom-field service lines", () => {
    const mirror = mapLivePayload(
      payload({
        kantataProjects: [{ id: "900", title: "Q4 Omnichannel Program", status: "In Progress" }],
        kantataGroups: [{ id: "g1", name: "Harvest Hope Food Bank", company: "", workspace_ids: ["900"] }],
        kantataCustomFields: [
          { subject_id: "900", name: "Service Line Detail", value: "Direct Mail" },
          { subject_id: "900", name: "Client Vertical", value: "Food Banks" },
        ],
      }),
    );
    expect(mirror.projects[0]).toMatchObject({
      clientGroup: "Harvest Hope Food Bank",
      serviceLine: "Direct Mail",
      vertical: "Food Banks",
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

  it("maps activity + BD-fit company fields (gone-quiet radar, ICP)", () => {
    const mirror = mapLivePayload(
      payload({
        companies: [
          {
            id: "1",
            name: "Harvest Hope",
            notes_last_contacted: "2026-07-14T09:00:00Z",
            notes_next_activity_date: "2026-07-28T15:00:00Z",
            num_contacted_notes: "42",
            hs_ideal_customer_profile: "tier_1",
            hs_is_target_account: "true",
          },
        ],
      }),
    );
    expect(mirror.clients[0]).toMatchObject({
      lastTouch: "2026-07-14",
      nextActivity: "2026-07-28",
      touches: 42,
      icpTier: "tier_1",
      targetAccount: true,
    });
  });

  it("maps the Kantata task tree, delivery team, and server-aggregated hours", () => {
    const mirror = mapLivePayload(
      payload({
        kantataProjects: [
          { id: "900", title: "Fall Mail", status: "In Progress", participant_names: ["Dana Whitfield", "Priya Raman"] },
        ],
        kantataTasks: [
          { id: "t1", workspace_id: 900, title: "Package creative", state: "started", due_date: "2026-08-15T00:00:00Z" },
          { id: "t2", workspace_id: 900, title: "", state: "started" }, // nameless dropped
        ],
        kantataHours: [
          { workspace_id: "900", minutes_30d: 720, minutes_recent: 2400, last_entry_date: "2026-07-13", people_30d: 2 },
        ],
      }),
    );
    expect(mirror.tasks).toEqual([
      { id: "t1", projectId: "900", title: "Package creative", state: "started", dueDate: "2026-08-15" },
    ]);
    expect(mirror.projects[0]).toMatchObject({
      team: ["Dana Whitfield", "Priya Raman"],
      minutes30d: 720,
      minutesRecent: 2400,
      lastEntryDate: "2026-07-13",
      people30d: 2,
    });
  });

  it("KANTATA-ONLY: derives the client directory when no companies arrive", () => {
    const mirror = mapLivePayload(
      payload({
        companies: [],
        kantataProjects: [
          { id: "1", title: "ARMS: Support 25-26 (Aug25-Jul26)" },
          { id: "2", title: "Harvest Hope Food Bank — Fall Acquisition Mail" },
          { id: "3", title: "Internal ops cleanup" }, // no convention → verbatim entry (ALL projects reachable)
          { id: "4", title: "Q4 Omnichannel Program" },
        ],
        kantataGroups: [
          // A client-record group (company/contact info) IS a client…
          { id: "g1", name: "CWS", company: "Church World Service", contact_name: "Maria", email: "m@cws.org", workspace_ids: ["4"] },
          // …a bare-named group is a service category, not a client.
          { id: "g2", name: "Direct Mail", company: "", workspace_ids: ["1", "2"] },
        ],
      }),
    );
    const names = mirror.clients.map((c) => c.name).sort();
    // ALL active work is reachable: conventional titles parse to client
    // names; unconventional ones become verbatim entries.
    expect(names).toEqual(["ARMS", "Church World Service", "Harvest Hope Food Bank", "Internal ops cleanup"]);
    // Wider separators + leading project codes also derive.
    const wide = mapLivePayload(
      payload({
        companies: [],
        kantataProjects: [
          { id: "10", title: "25-031 Riverside Mission - Year-End Appeal" },
          { id: "11", title: "Grace Health Foundation | Digital Retainer" },
        ],
      }),
    );
    expect(wide.clients.map((c) => c.name).sort()).toEqual(["Grace Health Foundation", "Riverside Mission"]);
    const arms = mirror.clients.find((c) => c.name === "ARMS");
    expect(arms?.abbreviation).toBe("ARMS");
    // A legal-name group client gets a clean auto-acronym so its
    // abbreviation-titled projects auto-match (the American Water Works case).
    const legal = mapLivePayload(
      payload({
        companies: [],
        kantataProjects: [{ id: "20", title: "AWW: Spring Mail" }],
        kantataGroups: [{ id: "g9", name: "AWW", company: "American Water Works Company, Inc.", email: "x@aww.com", workspace_ids: ["20"] }],
      }),
    );
    expect(legal.clients.find((c) => c.name === "American Water Works Company, Inc.")?.abbreviation).toBe("AWW");
    // Grouped project prefers the CLIENT group over the category group.
    expect(mirror.projects.find((p) => p.id === "4")?.clientGroup).toBe("Church World Service");
    // Category-grouped project keeps the category as clientGroup fallback.
    expect(mirror.projects.find((p) => p.id === "1")?.clientGroup).toBe("Direct Mail");
  });

  it("returns an empty mirror for an empty payload", () => {
    const mirror = mapLivePayload(payload({}));
    expect(mirror.clients).toHaveLength(0);
    expect(mirror.projects).toHaveLength(0);
    expect(mirror.campaigns).toHaveLength(0);
  });

  it("FOCUS DEEPEN: replaces the sliced stories for focused workspaces, keeps the rest", () => {
    // The tenant-wide boot pull is a recency slice — workspace 902 arrived
    // with ONE task and no milestones. A focus pull returns its COMPLETE
    // set; the merge must replace 902's rows (stale slice out) and keep
    // every other workspace's rows untouched.
    const base = payload({
      kantataTasks: [
        { id: "t1", title: "Old sliced task", workspace_id: "902", state: "completed" },
        { id: "t9", title: "Other project task", workspace_id: "901", state: "started" },
      ],
      kantataMilestones: [{ id: "m9", title: "Other milestone", workspace_id: "901", due_date: "2026-08-01" }],
    });
    const merged = mergeFocusPayload(base, ["902"], {
      kantataTasks: [
        { id: "t2", title: "Audience segmentation refresh", workspace_id: "902", state: "started" },
        { id: "t3", title: "Ask-string matrix", workspace_id: "902", state: "not started" },
      ],
      kantataMilestones: [{ id: "m2", title: "Fall drop in-home", workspace_id: "902", due_date: "2026-09-15" }],
    });
    const mirror = mapLivePayload(merged);
    const tasks = mirror.tasks ?? [];
    expect(tasks.filter((t) => t.projectId === "902").map((t) => t.title)).toEqual([
      "Audience segmentation refresh",
      "Ask-string matrix",
    ]);
    // 901's slice survives; 902's stale row is gone.
    expect(tasks.find((t) => t.id === "t9")).toBeDefined();
    expect(tasks.find((t) => t.id === "t1")).toBeUndefined();
    expect(mirror.milestones.map((m) => m.id).sort()).toEqual(["m2", "m9"]);
  });
});
