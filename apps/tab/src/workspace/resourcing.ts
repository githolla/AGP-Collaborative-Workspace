/**
 * Project-level resourcing — keep weekly allocations aligned to the CURRENT
 * timeline. This is scoped precisely to the problem Kellie named, and no wider:
 *
 *   "We build out timelines for 6 months and assign time estimates for each
 *    role... as soon as that timeline shifts, that initial resourcing is now
 *    outdated... is there a way to keep our resourcing up to date as project
 *    timelines shift?"
 *
 * The whole idea: the PM enters the hours (we do NOT compute them — how AGP
 * estimates effort for templatized vs. custom work is their call, explicitly
 * out of scope). The weekly picture is then DERIVED from each task's hours and
 * its CURRENT due date. So when a task moves, its hours move to the new week
 * automatically — the resourcing never goes stale, and nobody re-does it.
 *
 * Deliberately NOT here (Kellie ruled these out): estimating the hours,
 * inferring complexity/budget, agency rosters, optimization, capacity modeling.
 * Those stay in Kantata. This is hours-in → weekly-allocation-out, kept live.
 *
 * Pure + finance-free (hours and dates only, never rates): safe on the client
 * workspace's import graph, testable, shared by the store and the UI.
 */

export type TaskStatus = "todo" | "doing" | "done";

export interface ResourceTask {
  id: string;
  ownerName?: string;
  /** Start of the work window. With `due`, the span hours spread across. */
  start?: string;
  due?: string;
  /** The scheduled hours (from Kantata; the PM validates/adjusts). */
  estimatedHours?: number;
  status: TaskStatus;
  /** The project (Kantata milestone) — for grouping the view by project. */
  projectLabel?: string;
}

/** Monday (UTC) of the week a date falls in — the week work "hits the desk". */
export function weekStartOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDay(); // 0 = Sunday
  const back = day === 0 ? 6 : day - 1;
  return new Date(d.getTime() - back * 86_400_000).toISOString().slice(0, 10);
}

/** Whether a task contributes to future resourcing: open, owned, dated, hours. */
export function isSchedulable(t: ResourceTask): boolean {
  return t.status !== "done" && !!t.ownerName && !!t.due && (t.estimatedHours ?? 0) > 0;
}

/** Inclusive list of ISO dates from start to end (bounded so a bad span can't run away). */
function daysInclusive(start: string, end: string): string[] {
  const out: string[] = [];
  let cur = Date.parse(`${start}T00:00:00Z`);
  const stop = Date.parse(`${end}T00:00:00Z`);
  for (let i = 0; cur <= stop && i < 366; i += 1) {
    out.push(new Date(cur).toISOString().slice(0, 10));
    cur += 86_400_000;
  }
  return out.length > 0 ? out : [end];
}

export interface WeekAllocation {
  personName: string;
  /** Monday ISO of the reserved week. */
  weekStart: string;
  hours: number;
  taskCount: number;
}

/**
 * Spread each task's scheduled hours across its start→due span, week by week,
 * and sum per person per week. This is exactly how Kellie's team runs it in
 * Kantata — hours tagged at the task level, redistributed across the task's
 * date bracket — except here it's DERIVED, so a timeline shift redistributes on
 * its own instead of the weekly manual "expand all, select all, redistribute".
 *
 * A task with no start date lands its hours in the due week (a single week).
 */
export function weeklyAllocations(tasks: readonly ResourceTask[]): WeekAllocation[] {
  const byKey = new Map<string, { personName: string; weekStart: string; hours: number; tasks: Set<string> }>();
  for (const t of tasks) {
    if (!isSchedulable(t)) continue;
    const personName = t.ownerName!;
    const end = t.due!;
    // A start after the due date (or none) collapses to the due day.
    const start = t.start && t.start <= end ? t.start : end;
    const days = daysInclusive(start, end);
    const perDay = t.estimatedHours! / days.length;
    for (const d of days) {
      const weekStart = weekStartOf(d);
      const key = `${personName}|${weekStart}`;
      const cur = byKey.get(key) ?? { personName, weekStart, hours: 0, tasks: new Set<string>() };
      cur.hours += perDay;
      cur.tasks.add(t.id);
      byKey.set(key, cur);
    }
  }
  return [...byKey.values()]
    .map((a) => ({ personName: a.personName, weekStart: a.weekStart, hours: Math.round(a.hours * 10) / 10, taskCount: a.tasks.size }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart) || a.personName.localeCompare(b.personName));
}

export interface AllocationGrid {
  /** Monday ISO for every week that has any allocation, ascending. */
  weeks: string[];
  /** People with any allocation, ascending. */
  people: string[];
  /** Hours for one person in one week (0 if none). */
  hoursFor: (person: string, week: string) => number;
  /** A person's total hours across all weeks — the "are they loaded" glance. */
  personTotal: (person: string) => number;
  /** Everyone's hours in one week — the "is this week heavy" glance. */
  weekTotal: (week: string) => number;
}

/** Shape the allocations into a person × week grid for the resourcing view. */
export function allocationGrid(tasks: readonly ResourceTask[]): AllocationGrid {
  const allocations = weeklyAllocations(tasks);
  const cell = new Map<string, number>();
  const weeks = new Set<string>();
  const people = new Set<string>();
  for (const a of allocations) {
    cell.set(`${a.personName}|${a.weekStart}`, a.hours);
    weeks.add(a.weekStart);
    people.add(a.personName);
  }
  return {
    weeks: [...weeks].sort(),
    people: [...people].sort(),
    hoursFor: (person, week) => cell.get(`${person}|${week}`) ?? 0,
    personTotal: (person) => allocations.filter((a) => a.personName === person).reduce((s, a) => s + a.hours, 0),
    weekTotal: (week) => allocations.filter((a) => a.weekStart === week).reduce((s, a) => s + a.hours, 0),
  };
}

/** Sum of all estimated hours currently placed on a week — a quick total. */
export function totalScheduledHours(tasks: readonly ResourceTask[]): number {
  return weeklyAllocations(tasks).reduce((s, a) => s + a.hours, 0);
}

/** "Aug 3" style label for a week-start Monday. */
export function weekLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
