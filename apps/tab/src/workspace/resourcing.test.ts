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
  it("with no start date, lands a task's hours in its due week", () => {
    const out = weeklyAllocations([
      t({ id: "a", ownerName: "Kara Rachal", start: undefined, due: "2026-08-12", estimatedHours: 8 }),
      t({ id: "b", ownerName: "Kara Rachal", start: undefined, due: "2026-08-13", estimatedHours: 4 }), // same week
      t({ id: "c", ownerName: "David Swets", start: undefined, due: "2026-08-12", estimatedHours: 6 }),
    ]);
    expect(out).toEqual([
      { personName: "David Swets", weekStart: "2026-08-10", hours: 6, taskCount: 1 },
      { personName: "Kara Rachal", weekStart: "2026-08-10", hours: 12, taskCount: 2 },
    ]);
  });

  it("SPREADS a task's hours across its start→due span, week by week (Kantata's redistribute)", () => {
    // 14 days, Mon 3 Aug → Sun 16 Aug — two full weeks, 42h → 3h/day → 21h each.
    const out = weeklyAllocations([t({ ownerName: "Kara Rachal", start: "2026-08-03", due: "2026-08-16", estimatedHours: 42 })]);
    expect(out).toEqual([
      { personName: "Kara Rachal", weekStart: "2026-08-03", hours: 21, taskCount: 1 },
      { personName: "Kara Rachal", weekStart: "2026-08-10", hours: 21, taskCount: 1 },
    ]);
  });

  it("THE POINT: a timeline shift redistributes automatically, no manual redo", () => {
    const before = weeklyAllocations([t({ start: "2026-08-10", due: "2026-08-14", estimatedHours: 10 })]);
    expect(before).toEqual([{ personName: "Kara Rachal", weekStart: "2026-08-10", hours: 10, taskCount: 1 }]);
    // Push the whole task two weeks — the hours follow, no re-entry.
    const after = weeklyAllocations([t({ start: "2026-08-24", due: "2026-08-28", estimatedHours: 10 })]);
    expect(after).toEqual([{ personName: "Kara Rachal", weekStart: "2026-08-24", hours: 10, taskCount: 1 }]);
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
