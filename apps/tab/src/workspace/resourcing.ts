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
  /**
   * Per-person hour split, when the task has been divided across its people
   * (Cara's task-card vision). When present, EACH person's hours spread across
   * the span independently — so the weekly grid reflects who actually owes what,
   * not the whole task piled on one owner. Absent ⇒ the single-owner path below.
   */
  assignments?: readonly { name: string; hours: number }[];
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

const MS_DAY = 86_400_000;
const SPAN_EMIT_CAP = 800; // ~2 years of days emitted, for runaway safety

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
  const place = (personName: string, taskId: string, start: string, end: string, hours: number): void => {
    if (!personName || !(hours > 0)) return;
    // Per-day rate is the TRUE span length (not a truncated day list), so a
    // long task can't over-weight its early weeks; emission is capped only for
    // runaway safety.
    const startMs = Date.parse(`${start}T00:00:00Z`);
    const endMs = Date.parse(`${end}T00:00:00Z`);
    const spanDays = Math.max(1, Math.round((endMs - startMs) / MS_DAY) + 1);
    const perDay = hours / spanDays;
    let curMs = startMs;
    for (let i = 0; i < Math.min(spanDays, SPAN_EMIT_CAP); i += 1, curMs += MS_DAY) {
      const weekStart = weekStartOf(new Date(curMs).toISOString().slice(0, 10));
      const key = `${personName}|${weekStart}`;
      const cur = byKey.get(key) ?? { personName, weekStart, hours: 0, tasks: new Set<string>() };
      cur.hours += perDay;
      cur.tasks.add(taskId);
      byKey.set(key, cur);
    }
  };
  for (const t of tasks) {
    if (t.status === "done" || !t.due) continue;
    const end = t.due;
    // A start after the due date (or none) collapses to the due day.
    const start = t.start && t.start <= end ? t.start : end;
    if (t.assignments && t.assignments.length > 0) {
      // Split task: each person's hours spread across the span independently.
      for (const person of t.assignments) place(person.name, t.id, start, end, person.hours);
    } else if (isSchedulable(t)) {
      // Single-owner task: the whole estimate on the one owner.
      place(t.ownerName!, t.id, start, end, t.estimatedHours!);
    }
  }
  return [...byKey.values()]
    .map((a) => ({ personName: a.personName, weekStart: a.weekStart, hours: Math.round(a.hours * 10) / 10, taskCount: a.tasks.size }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart) || a.personName.localeCompare(b.personName));
}

/**
 * A reservation already made in Kantata (the Resource Center grid): a person
 * reserved for some hours over a window. Unlike a ResourceTask — which the app
 * SPREADS into weeks — this is Kellie's actual scheduled time, read back so the
 * view mirrors what she already maintains instead of re-deriving it.
 */
export interface ResourceReservation {
  id: string;
  personName: string;
  /** Start of the reserved window; collapses to `end` when absent/after. */
  start?: string;
  end: string;
  hours: number;
}

/**
 * Bucket real Kantata reservations into the same person × week shape the
 * derived view uses. A reservation that spans several weeks spreads evenly by
 * day across them (matching how Kantata's own grid reads per week); a
 * single-week reservation lands whole in that week.
 */
export function weeklyReservations(reservations: readonly ResourceReservation[]): WeekAllocation[] {
  const byKey = new Map<string, { personName: string; weekStart: string; hours: number; items: Set<string> }>();
  for (const r of reservations) {
    if (!r.personName || !r.end || !(r.hours > 0)) continue;
    const start = r.start && r.start <= r.end ? r.start : r.end;
    const startMs = Date.parse(`${start}T00:00:00Z`);
    const endMs = Date.parse(`${r.end}T00:00:00Z`);
    const spanDays = Math.max(1, Math.round((endMs - startMs) / MS_DAY) + 1);
    const perDay = r.hours / spanDays;
    let curMs = startMs;
    for (let i = 0; i < Math.min(spanDays, SPAN_EMIT_CAP); i += 1, curMs += MS_DAY) {
      const weekStart = weekStartOf(new Date(curMs).toISOString().slice(0, 10));
      const key = `${r.personName}|${weekStart}`;
      const cur = byKey.get(key) ?? { personName: r.personName, weekStart, hours: 0, items: new Set<string>() };
      cur.hours += perDay;
      cur.items.add(r.id);
      byKey.set(key, cur);
    }
  }
  return [...byKey.values()]
    .map((a) => ({ personName: a.personName, weekStart: a.weekStart, hours: Math.round(a.hours * 10) / 10, taskCount: a.items.size }))
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

/** Shape any set of weekly allocations into a person × week grid. */
export function gridFrom(allocations: readonly WeekAllocation[]): AllocationGrid {
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

/** Shape task-derived allocations into a person × week grid for the view. */
export function allocationGrid(tasks: readonly ResourceTask[]): AllocationGrid {
  return gridFrom(weeklyAllocations(tasks));
}

/** Sum of all estimated hours currently placed on a week — a quick total. */
export function totalScheduledHours(tasks: readonly ResourceTask[]): number {
  return weeklyAllocations(tasks).reduce((s, a) => s + a.hours, 0);
}

/** "Aug 3" style label for a week-start Monday. */
export function weekLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
