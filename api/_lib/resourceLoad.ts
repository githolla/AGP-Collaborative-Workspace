/**
 * Server-side resourcing math for the cross-client Team Load view — a faithful
 * port of the client engine (apps/tab/src/workspace/resourcing.ts's
 * weeklyAllocations + taskAssignments.ts's effectiveHours), aggregated so the
 * payload is one small row per person even when an app admin's view spans the
 * whole tenant. Demand (hours) comes from tasks; capacity (supply) is joined in.
 *
 * Correctness rules this engine encodes (each fixes a real audit finding):
 *  - IDENTITY: people are keyed by lower(trim(name)) so one person can't split
 *    into duplicate rows across name spellings, and their capacity matches.
 *  - LONG SPANS: per-day rate is computed from the TRUE span length, and only
 *    in-window days are emitted — a multi-year retainer no longer drops its
 *    hours or inflates its weekly rate.
 *  - OVERDUE: an open task already past due dumps its remaining hours into the
 *    current week (backlog due now) instead of vanishing before the window.
 *  - DONE PORTIONS: a split-task assignee who finished their part books no
 *    future hours.
 *  - ZERO CAPACITY: someone at 0h capacity with load counts as over-allocated.
 */

export interface LoadAssignment { name: string; hours?: number | null; done?: boolean }
export interface LoadTask {
  id: string;
  status: "todo" | "doing" | "done";
  ownerName?: string;
  assignments?: readonly LoadAssignment[];
  estimatedHours?: number | null;
  start?: string | null;
  due?: string | null;
}

export interface CapacityInfo { displayName: string; weeklyHours: number }

const MS_DAY = 86_400_000;
const SPAN_CAP_DAYS = 1500; // safety only; real span drives the per-day rate

const normKey = (name: string): string => name.trim().toLowerCase();

/** Monday (UTC) of the week a date falls in. */
export function weekStartOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDay();
  const back = day === 0 ? 6 : day - 1;
  return new Date(d.getTime() - back * MS_DAY).toISOString().slice(0, 10);
}

/** The next `count` Mondays starting from this week's Monday (inclusive). */
export function upcomingWeeks(count: number, todayIso?: string): string[] {
  const start = weekStartOf(todayIso ?? new Date().toISOString().slice(0, 10));
  const out: string[] = [];
  let t = Date.parse(`${start}T00:00:00Z`);
  for (let i = 0; i < count; i += 1) {
    out.push(new Date(t).toISOString().slice(0, 10));
    t += 7 * MS_DAY;
  }
  return out;
}

/** Even-split effective hours per assignee (mirrors taskAssignments.effectiveHours). */
function effectiveHours(assignments: readonly LoadAssignment[], estimated: number): Map<string, number> {
  const out = new Map<string, number>();
  if (assignments.length === 0) return out;
  const explicit = assignments.filter((a) => typeof a.hours === "number");
  const explicitSum = explicit.reduce((s, a) => s + (a.hours ?? 0), 0);
  const rest = assignments.filter((a) => typeof a.hours !== "number");
  const remaining = Math.max(0, estimated - explicitSum);
  const perRest = rest.length > 0 ? remaining / rest.length : 0;
  for (const a of assignments) out.set(a.name, typeof a.hours === "number" ? a.hours : perRest);
  return out;
}

export interface PersonLoad {
  /** Canonical display name. */
  name: string;
  /** Available hours/week. */
  capacity: number;
  /** True when no capacity was set for this person (showing the default). */
  isDefaultCapacity: boolean;
  /** hours per Monday-ISO, only for weeks in the window. */
  weekly: Record<string, number>;
  /** Sum across the window. */
  total: number;
  /** Busiest single week's hours. */
  peak: number;
  /** Weeks in the window that exceed capacity. */
  overWeeks: number;
  /** This week's (first window week) hours — the "now" number. */
  thisWeek: number;
}

/** Over-allocated in a given week: hours beyond capacity, OR any load with zero capacity. */
export function isOver(hours: number, capacity: number): boolean {
  return hours > 0 && (capacity <= 0 || hours > capacity);
}

const r1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Spread each task's hours across its span, sum per person per week, pivot onto
 * the window, and join capacity. Every person with load OR a capacity row gets a
 * row (so "who's free" is answerable). Identity is normalized so no one splits.
 */
export function teamLoad(
  tasks: readonly LoadTask[],
  weeks: readonly string[],
  capacities: ReadonlyMap<string, CapacityInfo>,
  defaultCapacity: number,
): PersonLoad[] {
  const firstWeek = weeks[0];
  const lastWeek = weeks[weeks.length - 1];
  if (!firstWeek || !lastWeek) return [];
  const weekSet = new Set(weeks);

  const byKeyWeek = new Map<string, number>(); // `${key}|${week}` -> hours
  const displayByKey = new Map<string, string>(); // canonical display name per key

  const remember = (name: string): string => {
    const key = normKey(name);
    if (!displayByKey.has(key)) displayByKey.set(key, name.trim());
    return key;
  };
  const addWeek = (key: string, week: string, hours: number): void => {
    if (!(hours > 0)) return;
    const k = `${key}|${week}`;
    byKeyWeek.set(k, (byKeyWeek.get(k) ?? 0) + hours);
  };

  const placeTask = (name: string, start: string, end: string, hours: number): void => {
    if (!name || !(hours > 0)) return;
    const key = remember(name);
    // Fully overdue open work: dump the remaining estimate into the current week.
    if (end < firstWeek) { addWeek(key, firstWeek, hours); return; }
    const startMs = Date.parse(`${start}T00:00:00Z`);
    const endMs = Date.parse(`${end}T00:00:00Z`);
    const spanDays = Math.min(SPAN_CAP_DAYS, Math.max(1, Math.round((endMs - startMs) / MS_DAY) + 1));
    const perDay = hours / spanDays;
    let cur = startMs;
    for (let i = 0; i < spanDays; i += 1, cur += MS_DAY) {
      const wk = weekStartOf(new Date(cur).toISOString().slice(0, 10));
      if (wk < firstWeek || !weekSet.has(wk)) continue; // pre-window elapsed / beyond window
      addWeek(key, wk, perDay);
    }
  };

  for (const t of tasks) {
    if (t.status === "done" || !t.due) continue;
    const end = t.due;
    const start = t.start && t.start <= end ? t.start : end;
    if (t.assignments && t.assignments.length > 0) {
      const eff = effectiveHours(t.assignments, t.estimatedHours ?? 0);
      for (const a of t.assignments) {
        if (a.done) continue; // finished their part — no future hours
        placeTask(a.name, start, end, eff.get(a.name) ?? 0);
      }
    } else if (t.ownerName && (t.estimatedHours ?? 0) > 0) {
      placeTask(t.ownerName, start, end, t.estimatedHours!);
    }
  }

  // Seed a row for every capacity person too, so people who are free (capacity
  // but no load) still appear and idle/portfolio totals are complete.
  const keys = new Set<string>([...displayByKey.keys()]);
  for (const [key, info] of capacities) {
    keys.add(key);
    if (!displayByKey.has(key)) displayByKey.set(key, info.displayName);
  }

  const people: PersonLoad[] = [];
  for (const key of keys) {
    const cap = capacities.get(key);
    const capacity = cap ? cap.weeklyHours : defaultCapacity;
    const weekly: Record<string, number> = {};
    let total = 0;
    let peak = 0;
    let overWeeks = 0;
    for (const wk of weeks) {
      const h = r1(byKeyWeek.get(`${key}|${wk}`) ?? 0);
      if (h > 0) weekly[wk] = h;
      total += h;
      if (h > peak) peak = h;
      if (isOver(h, capacity)) overWeeks += 1;
    }
    people.push({
      name: displayByKey.get(key) ?? key,
      capacity,
      isDefaultCapacity: !cap,
      weekly,
      total: r1(total),
      peak: r1(peak),
      overWeeks,
      thisWeek: weekly[firstWeek] ?? 0,
    });
  }

  return people.sort((a, b) => {
    // Over-allocated first, then by peak utilization, then name.
    const oa = a.capacity > 0 ? a.peak / a.capacity : (a.peak > 0 ? Infinity : 0);
    const ob = b.capacity > 0 ? b.peak / b.capacity : (b.peak > 0 ? Infinity : 0);
    return ob - oa || a.name.localeCompare(b.name);
  });
}
