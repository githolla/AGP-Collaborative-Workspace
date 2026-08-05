import { describe, expect, it } from "vitest";
import type { ResourceTask } from "./resourcing.js";
import { allocationGrid, isSchedulable, totalScheduledHours, weekStartOf, weeklyAllocations } from "./resourcing.js";

function t(over: Partial<Record<keyof ResourceTask, unknown>> = {}): ResourceTask {
  const base: ResourceTask = { id: "t", ownerName: "Kara Rachal", due: "2026-08-12", estimatedHours: 8, status: "todo" };
  const merged = { ...base, ...over } as Record<string, unknown>;
  // A key explicitly set to undefined means "omit it" (exactOptionalPropertyTypes).
  for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k];
  return merged as unknown as ResourceTask;
}

describe("weekStartOf", () => {
  it("snaps any day to that week's Monday", () => {
    expect(weekStartOf("2026-08-12")).toBe("2026-08-10"); // Wed → Mon
    expect(weekStartOf("2026-08-10")).toBe("2026-08-10"); // Mon → itself
    expect(weekStartOf("2026-08-16")).toBe("2026-08-10"); // Sun → that week's Mon
  });
});

describe("isSchedulable", () => {
  it("needs an owner, a due date, hours, and to be open", () => {
    expect(isSchedulable(t())).toBe(true);
    expect(isSchedulable(t({ status: "done" }))).toBe(false);
    expect(isSchedulable(t({ ownerName: undefined }))).toBe(false);
    expect(isSchedulable(t({ due: undefined }))).toBe(false);
    expect(isSchedulable(t({ estimatedHours: 0 }))).toBe(false);
    expect(isSchedulable(t({ estimatedHours: undefined }))).toBe(false);
  });
});

describe("weeklyAllocations", () => {
  it("buckets each person's hours into the week their task is due", () => {
    const out = weeklyAllocations([
      t({ id: "a", ownerName: "Kara Rachal", due: "2026-08-12", estimatedHours: 8 }),
      t({ id: "b", ownerName: "Kara Rachal", due: "2026-08-13", estimatedHours: 4 }), // same week
      t({ id: "c", ownerName: "David Swets", due: "2026-08-12", estimatedHours: 6 }),
    ]);
    expect(out).toEqual([
      { personName: "David Swets", weekStart: "2026-08-10", hours: 6, taskCount: 1 },
      { personName: "Kara Rachal", weekStart: "2026-08-10", hours: 12, taskCount: 2 },
    ]);
  });

  it("THE POINT: a timeline shift moves the hours to the new week automatically", () => {
    const before = weeklyAllocations([t({ due: "2026-08-12", estimatedHours: 10 })]);
    expect(before[0]).toMatchObject({ weekStart: "2026-08-10", hours: 10 });
    // Same task, date pushed two weeks — no re-entry, the allocation follows.
    const after = weeklyAllocations([t({ due: "2026-08-26", estimatedHours: 10 })]);
    expect(after[0]).toMatchObject({ weekStart: "2026-08-24", hours: 10 });
  });

  it("ignores done, unowned, undated, and zero-hour tasks", () => {
    expect(
      weeklyAllocations([
        t({ status: "done" }),
        t({ ownerName: undefined }),
        t({ due: undefined }),
        t({ estimatedHours: 0 }),
      ]),
    ).toEqual([]);
  });
});

describe("allocationGrid", () => {
  const tasks = [
    t({ id: "a", ownerName: "Kara Rachal", due: "2026-08-12", estimatedHours: 8 }),
    t({ id: "b", ownerName: "Kara Rachal", due: "2026-08-20", estimatedHours: 5 }),
    t({ id: "c", ownerName: "David Swets", due: "2026-08-12", estimatedHours: 6 }),
  ];

  it("lays out people × weeks with per-cell hours", () => {
    const g = allocationGrid(tasks);
    expect(g.weeks).toEqual(["2026-08-10", "2026-08-17"]);
    expect(g.people).toEqual(["David Swets", "Kara Rachal"]);
    expect(g.hoursFor("Kara Rachal", "2026-08-10")).toBe(8);
    expect(g.hoursFor("Kara Rachal", "2026-08-17")).toBe(5);
    expect(g.hoursFor("David Swets", "2026-08-17")).toBe(0);
  });

  it("gives per-person and per-week totals for the overload glance", () => {
    const g = allocationGrid(tasks);
    expect(g.personTotal("Kara Rachal")).toBe(13);
    expect(g.weekTotal("2026-08-10")).toBe(14);
  });
});

describe("totalScheduledHours", () => {
  it("sums everything currently placed on a week", () => {
    expect(totalScheduledHours([t({ estimatedHours: 8 }), t({ id: "x", estimatedHours: 4 })])).toBe(12);
  });
});
