import { describe, expect, it } from "vitest";
import { accountLiveContext, autoAbbreviation, campaignsFromMirror, crmGoneQuiet, deliveryQuiet, initialism, isInBook, milestoneResolver, projectPhaseResolver, stripCorpSuffix, suggestClients, taskColumn, taskIsDone } from "./campaignImport.js";
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
        {
          id: "ws-1",
          title: "HHFB Fall Acquisition",
          serviceLine: "",
          vertical: "",
          model: "",
          status: "in_progress",
          dueDate: "2026-11-20",
          team: ["Dana Whitfield", "Priya Raman"],
          minutes30d: 720,
          minutesRecent: 2400,
          lastEntryDate: "2026-07-13",
          people30d: 2,
        },
        { id: "ws-2", title: "Unrelated Org Appeal", serviceLine: "", vertical: "", model: "" },
      ],
      milestones: [
        { id: "m1", projectId: "ws-1", title: "In-home date", dueDate: "2026-10-12", state: "not_started", hard: true },
        { id: "m2", projectId: "ws-1", title: "Kickoff", dueDate: "2026-06-01", state: "completed" },
      ],
      tasks: [
        { id: "t1", projectId: "ws-1", title: "Package creative", state: "started", dueDate: "2026-08-15" },
        { id: "t2", projectId: "ws-2", title: "Someone else's task", state: "started" },
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
    // Task tree, delivery team, and hours ride along — only THIS client's.
    // The Kantata story id rides along too: it is what makes an imported task
    // writable back to Kantata (PUT /stories/{id}) instead of duplicable.
    expect(ctx.projects[0]?.tasks).toEqual([
      { id: "t1", projectId: "ws-1", title: "Package creative", state: "started", dueDate: "2026-08-15" },
    ]);
    expect(ctx.projects[0]?.team).toEqual(["Dana Whitfield", "Priya Raman"]);
    expect(ctx.projects[0]).toMatchObject({ minutes30d: 720, people30d: 2, lastEntryDate: "2026-07-13" });
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

describe("link rescue", () => {
  const book = mirror({
    clients: [
      { id: "1", name: "Church World Service", vertical: "" },
      { id: "2", name: "Harvest Hope of the Carolinas", vertical: "" },
      { id: "3", name: "Totally Different Org", vertical: "" },
    ],
  });

  it("isInBook: case/punctuation-insensitive membership", () => {
    expect(isInBook(book, "church world service")).toBe(true);
    expect(isInBook(book, "Church World Service, Inc.")).toBe(false); // different name is different
    expect(isInBook(book, "ABC Foodbank of the Southeast")).toBe(false);
  });

  it("suggestClients: finds the near-miss, skips unrelated, ranks containment first", () => {
    expect(suggestClients(book, "Church World Services")).toEqual(["Church World Service"]); // typo rescued
    expect(suggestClients(book, "Harvest Hope Food Bank")).toEqual(["Harvest Hope of the Carolinas"]); // shared distinctive words
    expect(suggestClients(book, "Riverside Animal Shelter")).toEqual([]); // nothing similar → say so honestly
  });

  it("INITIALISM BRIDGE: full-name workspaces link to Kantata's abbreviation clients", () => {
    // The Kantata-derived directory speaks in abbreviations.
    const kantataBook = mirror({
      clients: [{ id: "1", name: "SUA", vertical: "", abbreviation: "SUA" }],
      projects: [{ id: "ws-1", title: "SUA: Athletics Annual Fund", serviceLine: "", vertical: "", model: "" }],
    });
    // "Syracuse University Athletics" → initials SUA → linked, badge clears…
    expect(isInBook(kantataBook, "Syracuse University Athletics")).toBe(true);
    // …and the matcher finds the client's work through the same bridge.
    expect(campaignsFromMirror(kantataBook, "Syracuse University Athletics", TODAY)).toHaveLength(1);
    // Suggestions also bridge, for the relink flow.
    expect(suggestClients(kantataBook, "Syracuse University Athletics")).toEqual(["SUA"]);
    // Reverse: a workspace literally named by the abbreviation finds the full-name client.
    const fullBook = mirror({ clients: [{ id: "1", name: "Church World Service", vertical: "" }] });
    expect(isInBook(fullBook, "CWS")).toBe(true);
  });
});

describe("hand-linked projects (Project Finder)", () => {
  it("a linked project ALWAYS belongs, regardless of any name evidence", () => {
    const m = mirror({
      projects: [
        { id: "ws-1", title: "24-117 FY Support Retainer", serviceLine: "", vertical: "", model: "", dueDate: "2026-12-01" },
        { id: "ws-2", title: "Some Other Org Appeal", serviceLine: "", vertical: "", model: "" },
      ],
    });
    // No heuristic could connect this title to the client…
    expect(campaignsFromMirror(m, "Syracuse University Athletics", TODAY)).toHaveLength(0);
    // …but a human link settles it, and only for the linked project.
    const linked = campaignsFromMirror(m, "Syracuse University Athletics", TODAY, ["ws-1"]);
    expect(linked).toHaveLength(1);
    expect(linked[0]?.name).toBe("24-117 FY Support Retainer");
    // Live context honors the same link, and exposes the searchable list.
    const ctx = accountLiveContext(m, "Syracuse University Athletics", ["ws-1"]);
    expect(ctx.projects).toHaveLength(1);
    expect(ctx.searchable.map((p) => p.id).sort()).toEqual(["ws-1", "ws-2"]);
  });
});

describe("quiet signals", () => {
  it("crmGoneQuiet: stale last touch with nothing booked → quiet", () => {
    expect(crmGoneQuiet({ name: "X", lastTouch: "2026-06-01" }, TODAY)).toBe(true);
    expect(crmGoneQuiet({ name: "X" }, TODAY)).toBe(true); // never touched
  });

  it("crmGoneQuiet: a future activity or a recent touch → not quiet", () => {
    expect(crmGoneQuiet({ name: "X", lastTouch: "2026-06-01", nextActivity: "2026-07-28" }, TODAY)).toBe(false);
    expect(crmGoneQuiet({ name: "X", lastTouch: "2026-07-14" }, TODAY)).toBe(false);
    expect(crmGoneQuiet(undefined, TODAY)).toBe(false); // no record ≠ quiet
  });

  it("deliveryQuiet: hours pulled but zero in 30 days → quiet; no hours data → unknown, not quiet", () => {
    const base = { id: "p1", title: "P", milestones: [], tasks: [] };
    expect(deliveryQuiet([{ ...base, minutesRecent: 900, minutes30d: 0 }])).toBe(true);
    expect(deliveryQuiet([{ ...base, minutesRecent: 900, minutes30d: 120 }])).toBe(false);
    expect(deliveryQuiet([base])).toBe(false);
    expect(deliveryQuiet([])).toBe(false);
  });

  it("task state classifier tolerates tenant variants (not just the exact strings)", () => {
    // Done detection: a finished task must never import as open, whatever the
    // tenant calls it.
    for (const s of ["completed", "Completed", "accepted", "closed", "Finished", "done"]) {
      expect(taskIsDone(s), `${s} should be done`).toBe(true);
    }
    for (const s of ["", "started", "not started", "in progress", "backlog"]) {
      expect(taskIsDone(s), `${s} should not be done`).toBe(false);
    }
    // Column: active work lands in "doing" over a space or a synonym.
    expect(taskColumn("started")).toBe("doing");
    expect(taskColumn("in progress")).toBe("doing"); // the old exact "in_progress" missed this
    expect(taskColumn("in_progress")).toBe("doing");
    expect(taskColumn("active")).toBe("doing");
    expect(taskColumn("not started")).toBe("todo");
    expect(taskColumn("")).toBe("todo");
  });

  it("corporate legal suffixes don't poison the acronym (American Water Works case)", () => {
    expect(stripCorpSuffix("American Water Works Company, Inc.")).toBe("American Water Works");
    expect(stripCorpSuffix("Riverside Mission LLC")).toBe("Riverside Mission");
    expect(stripCorpSuffix("Grace Health Foundation")).toBe("Grace Health Foundation"); // not a legal suffix — untouched
    // The whole point: acronym is AWW, not AWWCI.
    expect(initialism("American Water Works Company, Inc.")).toBe("AWW");
    // Auto-abbreviation only for distinctive 3–6 letter acronyms.
    expect(autoAbbreviation("American Water Works Company, Inc.")).toBe("AWW");
    expect(autoAbbreviation("General Motors")).toBeUndefined(); // GM — 2 letters, too generic
    expect(autoAbbreviation("Grace Health Foundation")).toBe("GHF");
  });

  it("a legal-name client auto-matches its abbreviation-titled projects (no hand-linking)", () => {
    // The exact banner case: workspace named with the legal name, projects
    // titled with the acronym. The auto-abbreviation must bridge them.
    const m = mirror({
      clients: [{ id: "k-aww", name: "American Water Works Company, Inc.", vertical: "", abbreviation: "AWW", lifecycleStage: "customer" }],
      projects: [
        { id: "ws-1", title: "AWW: Spring Acquisition Mail", serviceLine: "", vertical: "", model: "", dueDate: "2026-09-01" },
        { id: "ws-2", title: "Unrelated — sign-ups microsite", serviceLine: "", vertical: "", model: "" },
      ],
    });
    const imported = campaignsFromMirror(m, "American Water Works Company, Inc.", TODAY);
    expect(imported.map((c) => c.name)).toEqual(["AWW: Spring Acquisition Mail"]);
    // Bounded: the acronym must not fire inside an unrelated word.
    expect(imported.some((c) => c.name.includes("sign-ups"))).toBe(false);
  });
});

/**
 * Project scoping — from Cara's pilot feedback: a workspace usually covers ONE
 * project, because two projects under one client can have different teams and
 * "comingling them is not ideal".
 */
describe("accountLiveContext — project scope", () => {
  const scopedMirror = () =>
    mirror({
      clients: [{ id: "c1", name: "PATNC", vertical: "" }],
      projects: [
        { id: "p1", title: "PATNC: Main Site Ongoing Support", serviceLine: "", vertical: "", model: "" },
        { id: "p2", title: "PATNC: Design and Development", serviceLine: "", vertical: "", model: "" },
        { id: "p3", title: "PATNC: Ongoing Support", serviceLine: "", vertical: "", model: "" },
      ],
    });

  it("covers every project under the client when unscoped", () => {
    expect(accountLiveContext(scopedMirror(), "PATNC").projects).toHaveLength(3);
  });

  it("covers ONLY the chosen projects when scoped", () => {
    const ctx = accountLiveContext(scopedMirror(), "PATNC", ["p1"], true);
    expect(ctx.projects.map((p) => p.id)).toEqual(["p1"]);
  });

  it("keeps name-matching additive when links exist but scope is off", () => {
    // Linking is the rescue flow for an unmatched workspace; it must not
    // silently narrow a workspace that never asked to be narrowed.
    const ctx = accountLiveContext(scopedMirror(), "PATNC", ["p1"], false);
    expect(ctx.projects).toHaveLength(3);
  });

  it("refuses to scope to nothing", () => {
    // An empty selection would empty the workspace with no way back.
    const ctx = accountLiveContext(scopedMirror(), "PATNC", [], true);
    expect(ctx.projects).toHaveLength(3);
  });

  it("scopes the import the same way, so the plan matches the workspace", () => {
    const camps = campaignsFromMirror(scopedMirror(), "PATNC", "2026-07-31", ["p2"], true);
    expect(camps.map((c) => c.name)).toEqual(["PATNC: Design and Development"]);
  });
});

describe("milestoneResolver — task → real project (Kantata milestone)", () => {
  // The AGP shape: one workspace (fiscal-year contract), milestones = projects,
  // tasks nested under a milestone, sub-tasks nested under a task.
  const milestones = [
    { id: "m1", title: "44061.10 - August Appeal DM" },
    { id: "m2", title: "44061.16 - November CYE I Appeal DM" },
  ];
  const tasks = [
    { id: "t1", parentId: "m1" }, // task directly under a milestone
    { id: "t2", parentId: "m2" },
    { id: "s1", parentId: "t1" }, // sub-task under t1 → still project m1
    { id: "orphan" }, // no parent — a top-level task, no project
    { id: "loose", parentId: "ghost" }, // parent isn't in the set
  ];

  it("maps a task to the milestone it hangs under", () => {
    const resolve = milestoneResolver(milestones, tasks);
    expect(resolve("t1")).toEqual({ id: "m1", title: "44061.10 - August Appeal DM" });
    expect(resolve("t2")).toEqual({ id: "m2", title: "44061.16 - November CYE I Appeal DM" });
  });

  it("walks up through a sub-task to the milestone", () => {
    expect(milestoneResolver(milestones, tasks)("s1")).toEqual({ id: "m1", title: "44061.10 - August Appeal DM" });
  });

  it("uses the top-most ancestor when the project level is a TASK, not a milestone", () => {
    // Some tenants file the project as an ordinary parent task/deliverable, not
    // a Kantata milestone. The top-most ancestor is still the project.
    const taskProjects = [
      { id: "p1", title: "44061.10 - August Appeal DM" }, // a task, not in `milestones`
      { id: "phase", parentId: "p1", title: "Copy phase" },
      { id: "leaf", parentId: "phase", title: "Create Copy Document" },
    ];
    expect(milestoneResolver([], taskProjects)("leaf")).toEqual({ id: "p1", title: "44061.10 - August Appeal DM" });
  });

  it("prefers a milestone ancestor over a higher non-milestone ancestor", () => {
    // grp is the top-most story but is NOT a milestone; ms in the middle IS.
    // The nearest milestone should win over the higher plain ancestor.
    const stories = [
      { id: "grp", title: "Program group" },
      { id: "ms", parentId: "grp", title: "Real Milestone" },
      { id: "leaf", parentId: "ms", title: "A task" },
    ];
    expect(milestoneResolver([{ id: "ms", title: "Real Milestone" }], stories)("leaf")).toEqual({
      id: "ms",
      title: "Real Milestone",
    });
  });

  it("returns undefined for a task with no milestone ancestor", () => {
    const resolve = milestoneResolver(milestones, tasks);
    expect(resolve("orphan")).toBeUndefined();
    expect(resolve("loose")).toBeUndefined();
  });

  it("does not loop on a malformed parent cycle", () => {
    const cyclic = [
      { id: "a", parentId: "b" },
      { id: "b", parentId: "a" },
    ];
    expect(milestoneResolver(milestones, cyclic)("a")).toBeUndefined();
  });
});

describe("projectPhaseResolver — parent job → phase → task nesting", () => {
  // The AGP shape Kellie described: the job (with its number) is the top-most
  // milestone; the phases under it are also milestones; tasks hang off a phase.
  const milestones = [
    { id: "job", title: "44061.03 - Fall Program Analysis" },
    { id: "ph1", title: "Phase 1: Strategy", parentId: "job" },
    { id: "ph2", title: "Phase 2: Production", parentId: "job" },
  ];
  const tasks = [
    { id: "t1", parentId: "ph1" }, // under phase 1
    { id: "t2", parentId: "ph2" }, // under phase 2
    { id: "sub", parentId: "t1" }, // sub-task under t1 → phase 1
    { id: "direct", parentId: "job" }, // straight under the job, no phase
  ];

  it("puts the job number at the top and nests the phase under it", () => {
    const r = projectPhaseResolver(milestones, tasks);
    expect(r("t1")).toEqual({ project: { id: "job", title: "44061.03 - Fall Program Analysis" }, phase: { id: "ph1", title: "Phase 1: Strategy" } });
    expect(r("t2")).toEqual({ project: { id: "job", title: "44061.03 - Fall Program Analysis" }, phase: { id: "ph2", title: "Phase 2: Production" } });
  });

  it("walks a sub-task up to its phase and job", () => {
    expect(projectPhaseResolver(milestones, tasks)("sub")).toEqual({ project: { id: "job", title: "44061.03 - Fall Program Analysis" }, phase: { id: "ph1", title: "Phase 1: Strategy" } });
  });

  it("a task straight under the job has a project but NO phase", () => {
    const r = projectPhaseResolver(milestones, tasks)("direct");
    expect(r.project).toEqual({ id: "job", title: "44061.03 - Fall Program Analysis" });
    expect(r.phase).toBeUndefined();
  });

  it("no loop on a malformed cycle", () => {
    expect(projectPhaseResolver(milestones, [{ id: "a", parentId: "b" }, { id: "b", parentId: "a" }])("a")).toEqual({});
  });
});

describe("accountLiveContext — tasks carry their project label", () => {
  const mirror = {
    clients: [{ id: "c1", name: "CWS", serviceLines: [], verticals: [] }],
    projects: [
      { id: "ws1", title: "CWS: FY27", serviceLine: "", vertical: "", model: "" },
    ],
    milestones: [
      { id: "m1", projectId: "ws1", title: "44061.10 - August Appeal DM", dueDate: "2026-08-15", state: "active" },
      { id: "m2", projectId: "ws1", title: "44061.16 - November CYE I Appeal DM", dueDate: "2026-11-20", state: "active" },
    ],
    tasks: [
      { id: "t1", projectId: "ws1", title: "Create Copy Document", state: "not started", parentId: "m1" },
      { id: "t2", projectId: "ws1", title: "Create Copy Document", state: "not started", parentId: "m2" },
    ],
    campaigns: [],
    posts: [],
    staff: [],
  } as unknown as Parameters<typeof accountLiveContext>[0];

  it("labels two same-named tasks with their different projects", () => {
    const ctx = accountLiveContext(mirror, "CWS");
    const byId = new Map(ctx.projects[0]!.tasks.map((t) => [t.id, t]));
    expect(byId.get("t1")?.projectLabel).toBe("44061.10 - August Appeal DM");
    expect(byId.get("t2")?.projectLabel).toBe("44061.16 - November CYE I Appeal DM");
    // Same title, different project — the whole point.
    expect(byId.get("t1")?.title).toBe(byId.get("t2")?.title);
  });
});
