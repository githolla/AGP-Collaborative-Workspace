import { describe, expect, it } from "vitest";
import { accountLiveContext, campaignsFromMirror } from "./campaignImport.js";
import type { AgpMirror } from "./agpKnowledge.js";

const TODAY = "2026-07-20";

function mirror(overrides: Partial<AgpMirror>): AgpMirror {
  return { clients: [], projects: [], campaigns: [], milestones: [], ...overrides };
}

describe("campaignsFromMirror", () => {
  it("imports a Kantata project as an active campaign with its nearest upcoming milestone", () => {
    const m = mirror({
      projects: [
        { id: "ws-1", title: "Harvest Hope Food Bank — Fall Acquisition Mail", serviceLine: "", vertical: "", model: "", dueDate: "2026-11-20" },
      ],
      milestones: [
        { id: "m-late", projectId: "ws-1", title: "In-home date", dueDate: "2026-10-12", state: "not_started" },
        { id: "m-soon", projectId: "ws-1", title: "Print + mail production window", dueDate: "2026-09-14", state: "not_started" },
        { id: "m-done", projectId: "ws-1", title: "Kickoff", dueDate: "2026-06-01", state: "completed" },
      ],
    });
    const out = campaignsFromMirror(m, "Harvest Hope Food Bank", TODAY);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      name: "Fall Acquisition Mail", // client prefix trimmed
      status: "active",
      nextMilestone: "Print + mail production window", // nearest upcoming, not the later one
      nextMilestoneDate: "2026-09-14",
    });
  });

  it("falls back to the project due date when no upcoming milestone exists", () => {
    const m = mirror({
      projects: [{ id: "ws-2", title: "KPBX Digital Retainer", serviceLine: "", vertical: "", model: "", dueDate: "2026-12-31" }],
    });
    const out = campaignsFromMirror(m, "KPBX Public Media", TODAY);
    expect(out[0]).toMatchObject({ status: "active", nextMilestone: "Delivery due", nextMilestoneDate: "2026-12-31" });
  });

  it("maps deals: won→active, open→planned with close date, lost skipped", () => {
    const m = mirror({
      campaigns: [
        { id: "d1", title: "FY27 Renewal", clientName: "KPBX Public Media", stage: "contractsent", kind: "deal", closeDate: "2026-08-30" },
        { id: "d2", title: "Spring Appeal 2026", clientName: "KPBX Public Media", stage: "closedwon", kind: "deal" },
        { id: "d3", title: "Dead Deal", clientName: "KPBX Public Media", stage: "closedlost", kind: "deal" },
        { id: "d4", title: "Someone Else's Deal", clientName: "Other Org", stage: "contractsent", kind: "deal" },
      ],
    });
    const out = campaignsFromMirror(m, "KPBX Public Media", TODAY);
    expect(out).toHaveLength(2);
    expect(out.find((c) => c.name === "FY27 Renewal")).toMatchObject({
      status: "planned",
      nextMilestone: "Close date",
      nextMilestoneDate: "2026-08-30",
    });
    expect(out.find((c) => c.name === "Spring Appeal 2026")).toMatchObject({ status: "active" });
  });

  it("dedupes by name with the Kantata project winning over the deal", () => {
    const m = mirror({
      projects: [{ id: "ws-3", title: "Harvest Hope — Fall Mail", serviceLine: "", vertical: "", model: "" }],
      campaigns: [{ id: "d5", title: "Fall Mail", clientName: "Harvest Hope", stage: "closedwon", kind: "deal" }],
    });
    const out = campaignsFromMirror(m, "Harvest Hope", TODAY);
    expect(out).toHaveLength(1);
    expect(out[0]?.status).toBe("active");
  });

  it("handles regex-special characters in client names", () => {
    const m = mirror({
      projects: [{ id: "ws-4", title: "St. Anselm Health — Grateful Patient Build", serviceLine: "", vertical: "", model: "" }],
    });
    const out = campaignsFromMirror(m, "St. Anselm Health", TODAY);
    expect(out[0]?.name).toBe("Grateful Patient Build");
  });

  it("matches via the HubSpot client abbreviation when titles don't use the full name", () => {
    const m = mirror({
      clients: [{ id: "c1", name: "Harvest Hope Food Bank", vertical: "", abbreviation: "HHFB" }],
      projects: [{ id: "ws-5", title: "HHFB FY27 Acquisition Program", serviceLine: "", vertical: "", model: "" }],
    });
    const out = campaignsFromMirror(m, "Harvest Hope Food Bank", TODAY);
    expect(out).toHaveLength(1);
    expect(out[0]?.name).toBe("HHFB FY27 Acquisition Program");
  });

  it("matches ALL-CAPS identifier tokens like KPBX on their own", () => {
    const m = mirror({
      projects: [{ id: "ws-6", title: "KPBX Digital Retainer", serviceLine: "", vertical: "", model: "" }],
    });
    const out = campaignsFromMirror(m, "KPBX Public Media", TODAY);
    expect(out).toHaveLength(1);
  });

  it("does NOT cross-match generic words: University of the Southwest ≠ University of Illinois work", () => {
    const m = mirror({
      projects: [
        { id: "ws-7", title: "University of Illinois — Annual Fund Appeal", serviceLine: "", vertical: "", model: "" },
      ],
    });
    const out = campaignsFromMirror(m, "University of the Southwest Foundation", TODAY);
    expect(out).toHaveLength(0);
  });

  it("uses the workspace-group join as the exact match, overriding title heuristics", () => {
    const m = mirror({
      clients: [
        { id: "c1", name: "Harvest Hope Food Bank", vertical: "" },
        { id: "c2", name: "Other Client Inc", vertical: "" },
      ],
      projects: [
        // Title mentions a different client entirely — the group join wins.
        { id: "ws-9", title: "Q4 Omnichannel Program", serviceLine: "", vertical: "", model: "", clientGroup: "Harvest Hope Food Bank" },
        // Grouped under a DIFFERENT known client: excluded despite the title.
        { id: "ws-10", title: "Harvest Hope Lookalike Audit", serviceLine: "", vertical: "", model: "", clientGroup: "Other Client Inc" },
      ],
    });
    const out = campaignsFromMirror(m, "Harvest Hope Food Bank", TODAY);
    expect(out).toHaveLength(1);
    expect(out[0]?.name).toBe("Q4 Omnichannel Program");
  });

  it("CATEGORY groups (owned by no client) fall through to title evidence", () => {
    const m = mirror({
      clients: [{ id: "c1", name: "Harvest Hope Food Bank", vertical: "", abbreviation: "HHFB" }],
      projects: [
        { id: "ws-20", title: "HHFB Fall Acquisition", serviceLine: "", vertical: "", model: "", clientGroup: "Direct Mail" },
        { id: "ws-21", title: "Some Other Org Appeal", serviceLine: "", vertical: "", model: "", clientGroup: "Direct Mail" },
      ],
    });
    const out = campaignsFromMirror(m, "Harvest Hope Food Bank", TODAY);
    expect(out).toHaveLength(1);
    expect(out[0]?.name).toBe("HHFB Fall Acquisition");
  });

  it("REGRESSION: 'CDW Direct' must not claim the Direct Mail category", () => {
    const m = mirror({
      clients: [{ id: "c1", name: "CDW Direct", vertical: "" }],
      projects: [
        { id: "ws-30", title: "Fall Direct Mail Program", serviceLine: "", vertical: "", model: "", clientGroup: "Direct Mail" },
        { id: "ws-31", title: "Year-End Direct Response", serviceLine: "", vertical: "", model: "" },
      ],
    });
    expect(campaignsFromMirror(m, "CDW Direct", TODAY)).toHaveLength(0);
  });

  it("REGRESSION: abbreviation-prefixed titles match ('ARMS: Support 25-26')", () => {
    const m = mirror({
      clients: [{ id: "c1", name: "Arms Foundation of America", vertical: "", abbreviation: "ARMS" }],
      projects: [{ id: "ws-40", title: "ARMS: Support 25-26 (Aug25-Jul26)", serviceLine: "", vertical: "", model: "" }],
    });
    expect(campaignsFromMirror(m, "Arms Foundation of America", TODAY)).toHaveLength(1);
  });

  it("REGRESSION: short tokens respect boundaries — UPS ≠ sign-ups", () => {
    const m = mirror({
      clients: [{ id: "c1", name: "UPS - Agency", vertical: "" }],
      projects: [{ id: "ws-50", title: "Community Sign-ups Campaign", serviceLine: "", vertical: "", model: "" }],
    });
    expect(campaignsFromMirror(m, "UPS - Agency", TODAY)).toHaveLength(0);
  });

  it("generic sector words never drive a match (university/athletics)", () => {
    const m = mirror({
      projects: [{ id: "ws-60", title: "University Athletics Annual Fund", serviceLine: "", vertical: "", model: "" }],
    });
    expect(campaignsFromMirror(m, "Syracuse University Athletics", TODAY)).toHaveLength(0);
    const m2 = mirror({
      projects: [{ id: "ws-61", title: "Syracuse Fall Appeal", serviceLine: "", vertical: "", model: "" }],
    });
    expect(campaignsFromMirror(m2, "Syracuse University Athletics", TODAY)).toHaveLength(1);
  });

  it("requires two significant words for multi-word names and accepts them", () => {
    const m = mirror({
      projects: [
        { id: "ws-8", title: "University of Illinois Annual Fund", serviceLine: "", vertical: "", model: "" },
      ],
    });
    const out = campaignsFromMirror(m, "University of Illinois Foundation", TODAY);
    expect(out).toHaveLength(1);
  });
});

describe("accountLiveContext", () => {
  it("returns the CRM record, matched projects with FULL milestone lists, and deals", () => {
    const m = mirror({
      clients: [
        {
          id: "c1",
          name: "Harvest Hope Food Bank",
          vertical: "food_banks",
          abbreviation: "HHFB",
          lifecycleStage: "customer",
          healthIndex: "82",
          renewal: "2027-03-01T00:00:00Z",
          gdnaLevel: "Level 2",
          owner: "Jane Smith",
          intentCount30d: 4,
        },
      ],
      projects: [
        { id: "ws-1", title: "HHFB Fall Acquisition", serviceLine: "", vertical: "", model: "", status: "in_progress", dueDate: "2026-11-20" },
        { id: "ws-2", title: "Unrelated Org Appeal", serviceLine: "", vertical: "", model: "" },
      ],
      milestones: [
        { id: "m1", projectId: "ws-1", title: "In-home date", dueDate: "2026-10-12", state: "not_started", hard: true },
        { id: "m2", projectId: "ws-1", title: "Kickoff", dueDate: "2026-06-01", state: "completed" },
      ],
      campaigns: [
        { id: "d1", title: "FY27 Renewal", clientName: "Harvest Hope Food Bank", stage: "contractsent", kind: "deal", closeDate: "2026-08-30T00:00:00Z" },
        { id: "d2", title: "Lost One", clientName: "Harvest Hope Food Bank", stage: "closedlost", kind: "deal" },
      ],
    });
    const ctx = accountLiveContext(m, "Harvest Hope Food Bank");
    expect(ctx.crm).toMatchObject({ owner: "Jane Smith", healthIndex: "82", renewal: "2027-03-01", abbreviation: "HHFB" });
    expect(ctx.projects).toHaveLength(1);
    // Full history, date-sorted — not just the next milestone.
    expect(ctx.projects[0]?.milestones.map((x) => x.title)).toEqual(["Kickoff", "In-home date"]);
    expect(ctx.projects[0]?.milestones[1]?.hard).toBe(true);
    expect(ctx.deals).toHaveLength(1);
    expect(ctx.deals[0]).toMatchObject({ title: "FY27 Renewal", won: false, closeDate: "2026-08-30" });
  });

  it("matches the workspace name to the CRM record case-insensitively", () => {
    const m = mirror({
      clients: [{ id: "c1", name: "KPBX Public Media", vertical: "", owner: "Sam Lee" }],
      projects: [{ id: "ws-1", title: "KPBX Digital Retainer", serviceLine: "", vertical: "", model: "" }],
    });
    const ctx = accountLiveContext(m, "kpbx public media");
    expect(ctx.crm?.owner).toBe("Sam Lee");
    expect(ctx.projects).toHaveLength(1);
  });

  it("reports honestly when nothing matches: no crm, empty projects and deals", () => {
    const m = mirror({
      clients: [{ id: "c1", name: "Someone Else", vertical: "" }],
      projects: [{ id: "ws-1", title: "Someone Else Appeal", serviceLine: "", vertical: "", model: "" }],
    });
    const ctx = accountLiveContext(m, "Riverside Food Bank");
    expect(ctx.crm).toBeUndefined();
    expect(ctx.projects).toHaveLength(0);
    expect(ctx.deals).toHaveLength(0);
  });
});
