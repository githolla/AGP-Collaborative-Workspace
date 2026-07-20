import { describe, expect, it } from "vitest";
import { campaignsFromMirror } from "./campaignImport.js";
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
});
