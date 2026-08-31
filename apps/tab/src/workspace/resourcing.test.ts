import { describe, expect, it } from "vitest";
import type { ResourceReservation, ResourceTask } from "./resourcing.js";
import { allocationGrid, gridFrom, isSchedulable, totalScheduledHours, weekStartOf, weeklyAllocations, weeklyReservations, weeklyLoad } from "./resourcing.js";

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

  it("with a per-person split, spreads EACH person's hours independently across the span", () => {
    // One task, two people, each with their own hours over the same 2-week span.
    const out = weeklyAllocations([
      t({
        id: "split", ownerName: undefined, start: "2026-08-03", due: "2026-08-16", estimatedHours: undefined,
        assignments: [{ name: "Heidi", hours: 42 }, { name: "Kellie", hours: 14 }],
      }),
    ]);
    expect(out).toEqual([
      { personName: "Heidi", weekStart: "2026-08-03", hours: 21, taskCount: 1 },
      { personName: "Kellie", weekStart: "2026-08-03", hours: 7, taskCount: 1 },
      { personName: "Heidi", weekStart: "2026-08-10", hours: 21, taskCount: 1 },
      { personName: "Kellie", weekStart: "2026-08-10", hours: 7, taskCount: 1 },
    ].sort((a, b) => a.weekStart.localeCompare(b.weekStart) || a.personName.localeCompare(b.personName)));
  });

  it("a split person with zero hours contributes nothing", () => {
    const out = weeklyAllocations([
      t({ id: "z", ownerName: undefined, due: "2026-08-12", estimatedHours: undefined, assignments: [{ name: "Heidi", hours: 8 }, { name: "Informed", hours: 0 }] }),
    ]);
    expect(out).toEqual([{ personName: "Heidi", weekStart: "2026-08-10", hours: 8, taskCount: 1 }]);
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

describe("weeklyReservations (real Kantata Resource Center rows)", () => {
  const r = (over: Partial<ResourceReservation> = {}): ResourceReservation => ({
    id: "r", personName: "Amy Warren", end: "2026-08-14", hours: 40, ...over,
  });

  it("lands a single-week reservation whole in that week", () => {
    const out = weeklyReservations([r({ start: "2026-08-10", end: "2026-08-16", hours: 40 })]);
    expect(out).toEqual([{ personName: "Amy Warren", weekStart: "2026-08-10", hours: 40, taskCount: 1 }]);
  });

  it("spreads a multi-week reservation evenly by day across the weeks it covers", () => {
    // Mon 3 Aug → Sun 16 Aug = 14 days, 42h → 3h/day → 21h per week.
    const out = weeklyReservations([r({ start: "2026-08-03", end: "2026-08-16", hours: 42 })]);
    expect(out).toEqual([
      { personName: "Amy Warren", weekStart: "2026-08-03", hours: 21, taskCount: 1 },
      { personName: "Amy Warren", weekStart: "2026-08-10", hours: 21, taskCount: 1 },
    ]);
  });

  it("with no start, collapses hours into the end week", () => {
    const out = weeklyReservations([r({ end: "2026-08-12", hours: 8 })]);
    expect(out).toEqual([{ personName: "Amy Warren", weekStart: "2026-08-10", hours: 8, taskCount: 1 }]);
  });

  it("sums two people's overlapping reservations per week and counts rows", () => {
    const out = weeklyReservations([
      r({ id: "a", personName: "Amy Warren", start: "2026-08-10", end: "2026-08-16", hours: 40 }),
      r({ id: "b", personName: "Amy Warren", start: "2026-08-10", end: "2026-08-16", hours: 3 }),
      r({ id: "c", personName: "Asha Warren", start: "2026-08-10", end: "2026-08-16", hours: 10 }),
    ]);
    expect(out).toEqual([
      { personName: "Amy Warren", weekStart: "2026-08-10", hours: 43, taskCount: 2 },
      { personName: "Asha Warren", weekStart: "2026-08-10", hours: 10, taskCount: 1 },
    ]);
  });

  it("drops rows with no person, no end, or no hours", () => {
    expect(
      weeklyReservations([
        r({ personName: "" }),
        r({ end: "" }),
        r({ hours: 0 }),
      ]),
    ).toEqual([]);
  });

  it("gridFrom shapes reservations into a person × week grid the view renders", () => {
    const g = gridFrom(
      weeklyReservations([
        r({ id: "a", personName: "Amy Warren", start: "2026-08-10", end: "2026-08-16", hours: 40 }),
        r({ id: "c", personName: "Asha Warren", start: "2026-08-10", end: "2026-08-16", hours: 10 }),
      ]),
    );
    expect(g.weeks).toEqual(["2026-08-10"]);
    expect(g.people).toEqual(["Amy Warren", "Asha Warren"]);
    expect(g.hoursFor("Amy Warren", "2026-08-10")).toBe(40);
    expect(g.weekTotal("2026-08-10")).toBe(50);
  });
});

describe("totalScheduledHours", () => {
  it("sums everything currently placed on a week", () => {
    expect(totalScheduledHours([t({ estimatedHours: 8 }), t({ id: "x", estimatedHours: 4 })])).toBe(12);
  });
});

describe("weeklyLoad", () => {
  it("counts open, owned, dated tasks even with ZERO hours (the fresh-Kantata case)", () => {
    const load = weeklyLoad([
      t({ id: "a", ownerName: "Kara Rachal", due: "2026-08-12", estimatedHours: undefined }),
      t({ id: "b", ownerName: "Kara Rachal", due: "2026-08-13", estimatedHours: undefined }),
    ]);
    // Both fall in the week of 2026-08-10 for Kara.
    const cell = load.find((c) => c.personName === "Kara Rachal" && c.weekStart === "2026-08-10");
    expect(cell?.taskCount).toBe(2);
    expect(cell?.hours).toBe(0);
    expect(cell?.taskIds.sort()).toEqual(["a", "b"]);
  });

  it("skips done tasks and tasks with no owner or no due date", () => {
    const load = weeklyLoad([
      t({ id: "done", status: "done" }),
      t({ id: "noowner", ownerName: undefined }),
      t({ id: "nodue", due: undefined }),
      t({ id: "ok" }),
    ]);
    expect(load.flatMap((c) => c.taskIds)).toEqual(["ok"]);
  });

  it("counts each assignee of a split task in their own weeks", () => {
    const load = weeklyLoad([
      t({ id: "s", ownerName: undefined, due: "2026-08-12", estimatedHours: undefined, assignments: [{ name: "Amy", hours: 0 }, { name: "Lee", hours: 0 }] }),
    ]);
    expect(load.map((c) => c.personName).sort()).toEqual(["Amy", "Lee"]);
    expect(load.every((c) => c.taskCount === 1)).toBe(true);
  });

  it("carries hours along when they exist, so the same grid drives the hours view", () => {
    const load = weeklyLoad([t({ id: "h", ownerName: "Kara Rachal", start: "2026-08-10", due: "2026-08-10", estimatedHours: 8 })]);
    const cell = load.find((c) => c.personName === "Kara Rachal");
    expect(cell?.hours).toBe(8);
    expect(cell?.taskCount).toBe(1);
  });
});
