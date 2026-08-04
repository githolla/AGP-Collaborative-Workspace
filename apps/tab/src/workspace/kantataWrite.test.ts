import { describe, expect, it } from "vitest";
import type { LiveProject } from "./campaignImport.js";
import type { MirrorStaff } from "./agpKnowledge.js";
import type { Task } from "./types.js";
import {
  allocationIntent,
  createIntentFor,
  kantataStateFor,
  pendingWrites,
  resolveStaffId,
  statusMatches,
  weekBounds,
} from "./kantataWrite.js";

const staff: MirrorStaff[] = [
  { id: "101", name: "Jenna Whitfield", title: "AD", email: "jenna@teamallegiance.com" },
  { id: "102", name: "Ren Alvarez", title: "Eng", email: "ren@teamallegiance.com" },
  { id: "103", name: "Sam Doe", title: "PM", email: "sam.doe@teamallegiance.com" },
  { id: "104", name: "Sam Doe", title: "Designer", email: "sdoe@teamallegiance.com" },
];

function task(over: Partial<Task> = {}): Task {
  return {
    id: "task_1",
    title: "Draft creative brief",
    status: "todo",
    source: "manual",
    createdAt: "2026-08-01T00:00:00.000Z",
    kantataStoryId: "9001",
    kantataProjectId: "45402856",
    ...over,
  };
}

function project(tasks: LiveProject["tasks"]): LiveProject {
  return { id: "45402856", title: "IdahoPTV FY27", milestones: [], tasks };
}

const liveTask = (over: Partial<LiveProject["tasks"][number]> = {}): LiveProject["tasks"][number] => ({
  id: "9001",
  projectId: "45402856",
  title: "Draft creative brief",
  state: "not started",
  ...over,
});

describe("statusMatches", () => {
  it("treats Kantata's accepted as done, so no downgrade is written", () => {
    expect(statusMatches("done", "accepted")).toBe(true);
    expect(statusMatches("done", "completed")).toBe(true);
  });

  it("does not confuse 'not started' with 'started'", () => {
    expect(statusMatches("todo", "not started")).toBe(true);
    expect(statusMatches("doing", "not started")).toBe(false);
    expect(statusMatches("doing", "started")).toBe(true);
  });

  it("a done Kantata story never matches an open column", () => {
    expect(statusMatches("todo", "completed")).toBe(false);
    expect(statusMatches("doing", "completed")).toBe(false);
  });
});

describe("resolveStaffId", () => {
  it("resolves an exact name", () => {
    expect(resolveStaffId("Jenna Whitfield", staff)).toBe("101");
  });

  it("ignores case and punctuation", () => {
    expect(resolveStaffId("ren  alvarez", staff)).toBe("102");
  });

  it("refuses an ambiguous name rather than guessing", () => {
    expect(resolveStaffId("Sam Doe", staff)).toBeUndefined();
  });

  it("returns nothing for someone outside the Kantata roster", () => {
    expect(resolveStaffId("Cara at the client", staff)).toBeUndefined();
    expect(resolveStaffId(undefined, staff)).toBeUndefined();
  });
});

describe("pendingWrites", () => {
  it("proposes nothing when the workspace and Kantata agree", () => {
    const writes = pendingWrites([task({ due: "2026-09-01" })], [project([liveTask({ dueDate: "2026-09-01" })])], staff);
    expect(writes).toEqual([]);
  });

  it("writes a status change", () => {
    const writes = pendingWrites([task({ status: "doing" })], [project([liveTask()])], staff);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.intent).toMatchObject({ kind: "story.update", storyId: "9001", state: "started" });
    expect(writes[0]?.changes[0]).toMatchObject({ field: "Status", to: "In progress" });
  });

  it("sends 100 percent alongside a completion", () => {
    const writes = pendingWrites([task({ status: "done" })], [project([liveTask()])], staff);
    expect(writes[0]?.intent).toMatchObject({ state: "completed", percent: 100 });
  });

  it("writes a due date, and null when it is cleared", () => {
    const added = pendingWrites([task({ due: "2026-09-15" })], [project([liveTask()])], staff);
    expect(added[0]?.intent).toMatchObject({ dueDate: "2026-09-15" });

    const cleared = pendingWrites([task()], [project([liveTask({ dueDate: "2026-09-15" })])], staff);
    expect(cleared[0]?.intent).toMatchObject({ dueDate: null });
  });

  it("writes an owner that resolves to a Kantata user", () => {
    const writes = pendingWrites([task({ ownerName: "Jenna Whitfield" })], [project([liveTask()])], staff);
    expect(writes[0]?.intent).toMatchObject({ assigneeIds: ["101"] });
  });

  it("leaves the assignee alone when the owner is already on the story", () => {
    const writes = pendingWrites(
      [task({ ownerName: "Jenna Whitfield" })],
      [project([liveTask({ assignees: ["Jenna Whitfield"] })])],
      staff,
    );
    expect(writes).toEqual([]);
  });

  it("does not write an owner Kantata has no user for", () => {
    const writes = pendingWrites([task({ ownerName: "Cara at the client" })], [project([liveTask()])], staff);
    expect(writes).toEqual([]);
  });

  it("ignores tasks that never came from Kantata", () => {
    const local = task({ status: "done" });
    delete local.kantataStoryId;
    expect(pendingWrites([local], [project([liveTask()])], staff)).toEqual([]);
  });

  it("ignores a story the mirror no longer has, so deletions are not resurrected", () => {
    const writes = pendingWrites([task({ status: "done" })], [project([])], staff);
    expect(writes).toEqual([]);
  });

  it("bundles several field changes into one update", () => {
    const writes = pendingWrites(
      [task({ status: "doing", due: "2026-10-01", ownerName: "Ren Alvarez" })],
      [project([liveTask()])],
      staff,
    );
    expect(writes).toHaveLength(1);
    expect(writes[0]?.changes.map((c: { field: string }) => c.field)).toEqual(["Status", "Due date", "Owner"]);
    expect(writes[0]?.intent).toMatchObject({ state: "started", dueDate: "2026-10-01", assigneeIds: ["102"] });
  });
});

describe("createIntentFor", () => {
  it("creates a task in the chosen project with its owner and date", () => {
    const intent = createIntentFor(task({ ownerName: "Ren Alvarez", due: "2026-09-09", status: "doing" }), "45442936", staff);
    expect(intent).toEqual({
      kind: "story.create",
      ref: "task_1",
      projectId: "45442936",
      title: "Draft creative brief",
      state: "started",
      dueDate: "2026-09-09",
      assigneeIds: ["102"],
    });
  });
});

describe("weekBounds", () => {
  it("snaps to Monday–Sunday", () => {
    // 2026-08-04 is a Tuesday.
    expect(weekBounds("2026-08-04")).toEqual({ startDate: "2026-08-03", endDate: "2026-08-09" });
  });

  it("keeps a Sunday in the week that just ended, not the one starting", () => {
    expect(weekBounds("2026-08-09")).toEqual({ startDate: "2026-08-03", endDate: "2026-08-09" });
  });

  it("keeps a Monday as its own week start", () => {
    expect(weekBounds("2026-08-03")).toEqual({ startDate: "2026-08-03", endDate: "2026-08-09" });
  });
});

describe("allocationIntent", () => {
  it("books hours against the week containing the date", () => {
    expect(allocationIntent({ ref: "a1", projectId: "45402856", userId: "101", date: "2026-08-06", hours: 12 })).toEqual({
      kind: "allocation.set",
      ref: "a1",
      projectId: "45402856",
      userId: "101",
      startDate: "2026-08-03",
      endDate: "2026-08-09",
      hours: 12,
    });
  });
});

describe("kantataStateFor", () => {
  it("maps the three workspace columns", () => {
    expect(kantataStateFor("todo")).toBe("not started");
    expect(kantataStateFor("doing")).toBe("started");
    expect(kantataStateFor("done")).toBe("completed");
  });
});
