import { describe, expect, it } from "vitest";
import { folderNameFor, folderPathFor, folderTreeOf, milestoneFolderOptions, plannedProvisioning, teamDisplayName } from "./msTeams.js";
import type { LiveMilestone, LiveProject, LiveTask } from "./campaignImport.js";
import type { ClientAccount, MsFolder } from "./types.js";

function task(overrides: Partial<LiveTask> & Pick<LiveTask, "id" | "title">): LiveTask {
  return { projectId: "ws-1", state: "not_started", ...overrides };
}

function milestone(overrides: Partial<LiveMilestone> & Pick<LiveMilestone, "id" | "title">): LiveMilestone {
  return { dueDate: "2026-09-01", state: "not_started", ...overrides };
}

function project(overrides: Partial<LiveProject> & Pick<LiveProject, "id" | "title">): LiveProject {
  return { milestones: [], tasks: [], ...overrides };
}

function account(folders: MsFolder[] = []): Pick<ClientAccount, "msTeam"> {
  return folders.length > 0 ? { msTeam: { teamId: "t", groupId: "g", siteId: "s", driveId: "d", webUrl: "", channels: [], folders } } : {};
}

describe("folderNameFor", () => {
  it("turns the illegal colon in AGP's \"Client: FY27\" convention into a space", () => {
    expect(folderNameFor({ title: "CWS: FY27" })).toBe("CWS FY27");
  });

  it("leaves internal periods in a job number untouched", () => {
    expect(folderNameFor({ title: "44061.01 - Strategy & Consultation" })).toBe("44061.01 - Strategy & Consultation");
  });

  it("replaces every SharePoint-illegal character with a space and collapses runs", () => {
    expect(folderNameFor({ title: 'A"B*C:D<E>F?G/H\\I|J' })).toBe("A B C D E F G H I J");
  });

  it("strips leading and trailing dots and spaces but keeps internal ones", () => {
    expect(folderNameFor({ title: "  .Draft. " })).toBe("Draft");
  });

  it("never produces an empty name", () => {
    expect(folderNameFor({ title: "..." })).toBe("Untitled");
  });

  it("is idempotent — sanitizing an already-sanitized name changes nothing", () => {
    const once = folderNameFor({ title: "CWS: FY27" });
    expect(folderNameFor({ title: once })).toBe(once);
  });

  it("truncates a name over SharePoint's 255-character ceiling", () => {
    const long = "A".repeat(300);
    const out = folderNameFor({ title: long });
    expect(out.length).toBeLessThanOrEqual(255);
  });
});

describe("folderTreeOf", () => {
  it("produces one project node per LiveProject", () => {
    const tree = folderTreeOf({ projects: [project({ id: "ws-1", title: "CWS FY27" }), project({ id: "ws-2", title: "CWS FY26" })] });
    const projects = tree.filter((n) => n.level === "project");
    expect(projects).toHaveLength(2);
    expect(projects.map((p) => p.kantataId).sort()).toEqual(["ws-1", "ws-2"]);
  });

  it("puts a top-level milestone directly under its project", () => {
    const tree = folderTreeOf({
      projects: [project({ id: "ws-1", title: "CWS FY27", milestones: [milestone({ id: "m-1", title: "44061.10 - August Appeal DM" })] })],
    });
    const m = tree.find((n) => n.kantataId === "m-1");
    expect(m).toMatchObject({ level: "milestone", parentKantataId: "ws-1" });
  });

  it("puts a nested milestone under its top-most ancestor as a phase", () => {
    const tree = folderTreeOf({
      projects: [
        project({
          id: "ws-1",
          title: "CWS FY27",
          milestones: [
            milestone({ id: "m-1", title: "44061.09 - August Upgrade Appeal DM" }),
            milestone({ id: "m-1-phase2", title: "Phase 2 - Production", parentId: "m-1" }),
          ],
        }),
      ],
    });
    expect(tree.find((n) => n.kantataId === "m-1")).toMatchObject({ level: "milestone", parentKantataId: "ws-1" });
    expect(tree.find((n) => n.kantataId === "m-1-phase2")).toMatchObject({ level: "phase", parentKantataId: "m-1" });
  });

  it("collapses a deeper chain of nested milestones to one phase level under the top-most", () => {
    const tree = folderTreeOf({
      projects: [
        project({
          id: "ws-1",
          title: "CWS FY27",
          milestones: [
            milestone({ id: "m-1", title: "Job" }),
            milestone({ id: "m-2", title: "Phase", parentId: "m-1" }),
            milestone({ id: "m-3", title: "Sub-phase", parentId: "m-2" }),
          ],
        }),
      ],
    });
    expect(tree.find((n) => n.kantataId === "m-3")).toMatchObject({ level: "phase", parentKantataId: "m-1" });
  });

  it("puts a task straight off its milestone when it has no phase", () => {
    const tree = folderTreeOf({
      projects: [
        project({
          id: "ws-1",
          title: "CWS FY27",
          milestones: [milestone({ id: "m-1", title: "44061.10" })],
          tasks: [task({ id: "t-1", title: "Segment file", milestoneId: "m-1" })],
        }),
      ],
    });
    expect(tree.find((n) => n.kantataId === "t-1")).toMatchObject({ level: "task", parentKantataId: "m-1" });
  });

  it("puts a task under its phase, not its milestone, when it has both", () => {
    const tree = folderTreeOf({
      projects: [
        project({
          id: "ws-1",
          title: "CWS FY27",
          milestones: [milestone({ id: "m-1", title: "44061.09" }), milestone({ id: "m-1-p2", title: "Phase 2", parentId: "m-1" })],
          tasks: [task({ id: "t-1", title: "Copywriting (Base)", milestoneId: "m-1", phaseId: "m-1-p2" })],
        }),
      ],
    });
    expect(tree.find((n) => n.kantataId === "t-1")).toMatchObject({ level: "task", parentKantataId: "m-1-p2" });
  });

  it("omits a task with no resolvable milestone rather than guessing", () => {
    const tree = folderTreeOf({
      projects: [project({ id: "ws-1", title: "CWS FY27", tasks: [task({ id: "t-1", title: "Ungrouped" })] })],
    });
    expect(tree.find((n) => n.kantataId === "t-1")).toBeUndefined();
  });
});

describe("folderPathFor", () => {
  it("builds the full sanitized path for a task under a milestone", () => {
    const tree = folderTreeOf({
      projects: [
        project({
          id: "ws-1",
          title: "CWS: FY27",
          milestones: [milestone({ id: "m-1", title: "44061.10 - August Appeal DM" })],
          tasks: [task({ id: "t-1", title: "Segment file", milestoneId: "m-1" })],
        }),
      ],
    });
    expect(folderPathFor(tree, "t-1")).toBe("CWS FY27/44061.10 - August Appeal DM/Segment file");
  });

  it("includes the phase segment when the task has one", () => {
    const tree = folderTreeOf({
      projects: [
        project({
          id: "ws-1",
          title: "CWS FY27",
          milestones: [milestone({ id: "m-1", title: "44061.09" }), milestone({ id: "m-1-p2", title: "Phase 2 - Production", parentId: "m-1" })],
          tasks: [task({ id: "t-1", title: "Copywriting (Base)", milestoneId: "m-1", phaseId: "m-1-p2" })],
        }),
      ],
    });
    expect(folderPathFor(tree, "t-1")).toBe("CWS FY27/44061.09/Phase 2 - Production/Copywriting (Base)");
  });

  it("truncates only the leaf when the joined path would exceed the ceiling, never an ancestor", () => {
    const longTitle = "T".repeat(500);
    const tree = folderTreeOf({
      projects: [
        project({
          id: "ws-1",
          title: "CWS FY27",
          milestones: [milestone({ id: "m-1", title: "44061.10 - August Appeal DM" })],
          tasks: [task({ id: "t-1", title: longTitle, milestoneId: "m-1" })],
        }),
      ],
    });
    const path = folderPathFor(tree, "t-1");
    expect(path.length).toBeLessThanOrEqual(400);
    expect(path.startsWith("CWS FY27/44061.10 - August Appeal DM/")).toBe(true);
  });
});

describe("plannedProvisioning", () => {
  it("is empty for an already-provisioned, unchanged account", () => {
    const liveCtx = { projects: [project({ id: "ws-1", title: "CWS FY27" })] };
    const plan = plannedProvisioning(account([{ kantataId: "ws-1", folderId: "f-1", name: "CWS FY27", level: "project" as const }]), liveCtx);
    expect(plan).toEqual({ toCreate: [], toRename: [], goneFromKantata: [] });
  });

  it("proposes creating only project folders, never a missing milestone folder", () => {
    const liveCtx = {
      projects: [project({ id: "ws-1", title: "CWS FY27", milestones: [milestone({ id: "m-1", title: "44061.10" })] })],
    };
    const plan = plannedProvisioning(account(), liveCtx);
    expect(plan.toCreate).toEqual([{ kantataId: "ws-1", title: "CWS FY27", level: "project" }]);
  });

  it("proposes a rename when an already-provisioned folder's Kantata title changed", () => {
    const liveCtx = { projects: [project({ id: "ws-1", title: "CWS: FY27 (renamed)" })] };
    const plan = plannedProvisioning(account([{ kantataId: "ws-1", folderId: "f-1", name: "CWS FY27", level: "project" as const }]), liveCtx);
    expect(plan.toRename).toEqual([{ existing: { kantataId: "ws-1", folderId: "f-1", name: "CWS FY27", level: "project" }, newName: "CWS FY27 (renamed)" }]);
  });

  it("renames an existing milestone folder too, at any level", () => {
    const liveCtx = {
      projects: [project({ id: "ws-1", title: "CWS FY27", milestones: [milestone({ id: "m-1", title: "44061.10 - Renamed" })] })],
    };
    const existing: MsFolder = { kantataId: "m-1", folderId: "f-2", name: "44061.10", level: "milestone", parentFolderId: "f-1" };
    const plan = plannedProvisioning(account([{ kantataId: "ws-1", folderId: "f-1", name: "CWS FY27", level: "project" }, existing]), liveCtx);
    expect(plan.toRename).toEqual([{ existing, newName: "44061.10 - Renamed" }]);
  });

  it("reports a folder whose Kantata id disappeared, and never proposes deleting it", () => {
    const liveCtx = { projects: [] as LiveProject[] };
    const gone: MsFolder = { kantataId: "ws-1", folderId: "f-1", name: "CWS FY27", level: "project" };
    const plan = plannedProvisioning(account([gone]), liveCtx);
    expect(plan.goneFromKantata).toEqual([gone]);
    expect(plan.toCreate).toEqual([]);
  });
});

describe("milestoneFolderOptions", () => {
  it("lists every milestone of one project with whether it already has a folder", () => {
    const liveCtx = {
      projects: [
        project({
          id: "ws-1",
          title: "CWS FY27",
          milestones: [milestone({ id: "m-1", title: "44061.01" }), milestone({ id: "m-2", title: "44061.10" })],
        }),
      ],
    };
    const opts = milestoneFolderOptions(account([{ kantataId: "m-1", folderId: "f-2", name: "44061.01", level: "milestone" as const }]), liveCtx, "ws-1");
    expect(opts).toEqual([
      { kantataId: "m-1", title: "44061.01", hasFolder: true },
      { kantataId: "m-2", title: "44061.10", hasFolder: false },
    ]);
  });

  it("never lists a phase as a pickable milestone", () => {
    const liveCtx = {
      projects: [
        project({
          id: "ws-1",
          title: "CWS FY27",
          milestones: [milestone({ id: "m-1", title: "Job" }), milestone({ id: "m-1-p2", title: "Phase 2", parentId: "m-1" })],
        }),
      ],
    };
    const opts = milestoneFolderOptions(account(), liveCtx, "ws-1");
    expect(opts.map((o) => o.kantataId)).toEqual(["m-1"]);
  });
});

describe("teamDisplayName", () => {
  it("collapses internal whitespace and trims", () => {
    expect(teamDisplayName({ clientName: "  CWS   Foundation  " })).toBe("CWS Foundation");
  });

  it("falls back rather than proposing an empty Team name", () => {
    expect(teamDisplayName({ clientName: "   " })).toBe("Untitled client");
  });
});
