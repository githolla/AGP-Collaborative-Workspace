import { describe, expect, it } from "vitest";
import type { Task, TaskAssignment } from "./types.js";
import {
  allAssignmentsDone,
  applyHandoffOrder,
  applyPersonDone,
  assignmentProgress,
  blockingDeps,
  currentHandoffStep,
  effectiveHours,
  handoffSequence,
  hoursForPerson,
  isBlocked,
  isOnPersonList,
  personDone,
  primaryOwner,
  reconcileAssignments,
} from "./taskAssignments.js";

const task = (over: Partial<Task> = {}): Task => ({
  id: "t", title: "Generate first draft", status: "todo", source: "plan", createdAt: "2026-08-01", ...over,
});
const a = (name: string, over: Partial<TaskAssignment> = {}): TaskAssignment => ({ name, ...over });

describe("effectiveHours — the AI default split, editable", () => {
  it("splits the task's hours evenly when nobody is set", () => {
    const h = effectiveHours(task({ estimatedHours: 12, assignments: [a("Heidi"), a("Kellie"), a("Mackenzie")] }));
    expect(h.get("Heidi")).toBe(4);
    expect(h.get("Kellie")).toBe(4);
    expect(h.get("Mackenzie")).toBe(4);
  });

  it("respects an explicit edit and splits the remainder across the rest", () => {
    const h = effectiveHours(task({ estimatedHours: 12, assignments: [a("Heidi", { hours: 6 }), a("Kellie"), a("Mackenzie")] }));
    expect(h.get("Heidi")).toBe(6);
    expect(h.get("Kellie")).toBe(3);
    expect(h.get("Mackenzie")).toBe(3);
  });

  it("never spreads a negative remainder when edits exceed the total", () => {
    const h = effectiveHours(task({ estimatedHours: 8, assignments: [a("Heidi", { hours: 10 }), a("Kellie")] }));
    expect(h.get("Heidi")).toBe(10);
    expect(h.get("Kellie")).toBe(0);
  });

  it("is empty for a task with no assignments", () => {
    expect(effectiveHours(task({ estimatedHours: 8 })).size).toBe(0);
  });
});

describe("primaryOwner", () => {
  it("prefers the marked primary, then the first assignee, then legacy ownerName", () => {
    expect(primaryOwner(task({ assignments: [a("Heidi"), a("Kellie", { primary: true })] }))).toBe("Kellie");
    expect(primaryOwner(task({ assignments: [a("Heidi"), a("Kellie")] }))).toBe("Heidi");
    expect(primaryOwner(task({ ownerName: "Kara" }))).toBe("Kara");
  });
});

describe("isOnPersonList — the meaningful task list", () => {
  const t = task({ estimatedHours: 10, assignments: [a("Heidi", { hours: 8 }), a("Kellie", { hours: 0 }), a("Rob")] });
  it("includes people who actually owe hours", () => {
    expect(isOnPersonList(t, "Heidi")).toBe(true);
  });
  it("includes the un-set person taking the even-split default (>0)", () => {
    expect(isOnPersonList(t, "Rob")).toBe(true); // remaining 2h → Rob gets it
  });
  it("excludes a person explicitly given zero hours (merely informed)", () => {
    expect(isOnPersonList(t, "Kellie")).toBe(false);
  });
  it("still includes a zero-hour person if they're the primary owner", () => {
    const t2 = task({ estimatedHours: 10, assignments: [a("Heidi", { hours: 10 }), a("Kellie", { hours: 0, primary: true })] });
    expect(isOnPersonList(t2, "Kellie")).toBe(true);
  });
  it("falls back to the single owner when there are no assignments", () => {
    expect(isOnPersonList(task({ ownerName: "Kara" }), "Kara")).toBe(true);
    expect(isOnPersonList(task({ ownerName: "Kara" }), "Rob")).toBe(false);
  });
});

describe("per-person completion — one click doesn't complete for everyone", () => {
  const t = task({ status: "doing", assignments: [a("Heidi"), a("Kellie"), a("Rob")] });

  it("marks only that person done, task stays open", () => {
    const r = applyPersonDone(t, "Heidi", true);
    expect(personDone({ assignments: r.assignments }, "Heidi")).toBe(true);
    expect(personDone({ assignments: r.assignments }, "Kellie")).toBe(false);
    expect(r.status).toBe("doing");
    expect(allAssignmentsDone({ assignments: r.assignments, status: r.status })).toBe(false);
  });

  it("completes the task only when the LAST person marks done", () => {
    let cur = applyPersonDone(t, "Heidi", true);
    cur = applyPersonDone({ ...t, assignments: cur.assignments }, "Kellie", true);
    expect(cur.status).toBe("doing");
    cur = applyPersonDone({ ...t, assignments: cur.assignments }, "Rob", true);
    expect(cur.status).toBe("done");
    expect(allAssignmentsDone({ assignments: cur.assignments, status: cur.status })).toBe(true);
  });

  it("re-opens the task when someone un-checks after completion", () => {
    const done = task({ status: "done", assignments: [a("Heidi", { done: true }), a("Kellie", { done: true })] });
    const r = applyPersonDone(done, "Kellie", false);
    expect(r.status).toBe("doing");
  });

  it("reports progress as N of M", () => {
    expect(assignmentProgress(task({ assignments: [a("Heidi", { done: true }), a("Kellie"), a("Rob", { done: true })] }))).toEqual({ done: 2, total: 3 });
  });
});

describe("reconcileAssignments — keep edits as Kantata assignees change", () => {
  it("preserves hours/done/primary for people who remain and drops those who left", () => {
    const existing = [a("Heidi", { hours: 6, done: true, primary: true }), a("Rob", { hours: 4 })];
    const next = reconcileAssignments(existing, ["Heidi", "Mackenzie"]);
    expect(next.find((x) => x.name === "Heidi")).toMatchObject({ hours: 6, done: true, primary: true });
    expect(next.find((x) => x.name === "Rob")).toBeUndefined();
    expect(next.find((x) => x.name === "Mackenzie")).toMatchObject({ name: "Mackenzie" });
  });

  it("makes the first person primary when none is marked", () => {
    const next = reconcileAssignments([], ["Heidi", "Kellie"]);
    expect(next[0]).toMatchObject({ name: "Heidi", primary: true });
    expect(next[1]?.primary).toBeUndefined();
  });
});

describe("handoff path — who starts → next → final", () => {
  it("orders assignments by their handoff order, then array order", () => {
    const t = task({ assignments: [a("Kellie", { order: 3 }), a("Heidi", { order: 1 }), a("Mackenzie", { order: 2 })] });
    expect(handoffSequence(t).map((x) => x.name)).toEqual(["Heidi", "Mackenzie", "Kellie"]);
  });

  it("falls back to array order when no order is set", () => {
    const t = task({ assignments: [a("Heidi"), a("Kellie"), a("Rob")] });
    expect(handoffSequence(t).map((x) => x.name)).toEqual(["Heidi", "Kellie", "Rob"]);
  });

  it("current step is the first person in sequence not yet done", () => {
    const t = task({ assignments: [a("Heidi", { order: 1, done: true }), a("Mackenzie", { order: 2 }), a("Kellie", { order: 3 })] });
    expect(currentHandoffStep(t)?.name).toBe("Mackenzie");
  });

  it("current step is undefined once everyone is done", () => {
    const t = task({ assignments: [a("Heidi", { done: true }), a("Kellie", { done: true })] });
    expect(currentHandoffStep(t)).toBeUndefined();
  });

  it("applyHandoffOrder renumbers 1..n by the given sequence, keeping fields", () => {
    const existing = [a("Heidi", { hours: 6, done: true }), a("Kellie", { hours: 4 })];
    const next = applyHandoffOrder(existing, ["Kellie", "Heidi"]);
    expect(next.find((x) => x.name === "Kellie")).toMatchObject({ order: 1, hours: 4 });
    expect(next.find((x) => x.name === "Heidi")).toMatchObject({ order: 2, hours: 6, done: true });
  });
});

describe("dependencies — a task waits on others", () => {
  const byId = (map: Record<string, { title: string; status: string }>) => (id: string) => map[id];
  const world = { d1: { title: "Data pull", status: "done" }, d2: { title: "Copy draft", status: "doing" } };

  it("lists only the dependencies that aren't done", () => {
    const t = task({ dependsOn: ["d1", "d2"] });
    expect(blockingDeps(t, byId(world))).toEqual([{ id: "d2", title: "Copy draft" }]);
  });

  it("is blocked while any dependency is open, unblocked when all done", () => {
    expect(isBlocked(task({ dependsOn: ["d1", "d2"] }), byId(world))).toBe(true);
    expect(isBlocked(task({ dependsOn: ["d1"] }), byId(world))).toBe(false);
    expect(isBlocked(task({ dependsOn: [] }), byId(world))).toBe(false);
  });

  it("ignores a dependency id that no longer exists", () => {
    expect(isBlocked(task({ dependsOn: ["gone"] }), byId(world))).toBe(false);
  });
});

describe("hoursForPerson", () => {
  it("returns the person's effective hours, 0 when off the task", () => {
    const t = task({ estimatedHours: 10, assignments: [a("Heidi"), a("Kellie")] });
    expect(hoursForPerson(t, "Heidi")).toBe(5);
    expect(hoursForPerson(t, "Nobody")).toBe(0);
  });
});
