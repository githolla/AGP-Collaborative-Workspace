/**
 * Server-side resourcing math for the cross-client Team Load view — a faithful
 * port of the client engine (apps/tab/src/workspace/resourcing.ts's
 * weeklyAllocations + taskAssignments.ts's effectiveHours). Ported rather than
 * imported because api/*.ts files are self-contained (no workspace imports; see
 * api/mirror.ts / kantataHierarchy.ts, which do the same).
 *
 * Aggregating here — not shipping every task to the browser — keeps the payload
 * tiny: an app admin's Team Load spans the whole tenant's tasks, but the OUTPUT
 * is one small row per person. Demand (hours) comes from tasks; capacity (the
 * supply side) is joined in the handler.
 */

export interface LoadTask {
  id: string;
  status: "todo" | "doing" | "done";
  ownerName?: string;
  assignments?: readonly { name: string; hours?: number | null }[];
  estimatedHours?: number | null;
  start?: string | null;
  due?: string | null;
}

/** Monday (UTC) of the week a date falls in. */
export function weekStartOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDay();
  const back = day === 0 ? 6 : day - 1;
  return new Date(d.getTime() - back * 86_400_000).toISOString().slice(0, 10);
}

/** The next `count` Mondays starting from this week's Monday (inclusive). */
export function upcomingWeeks(count: number, todayIso?: string): string[] {
  const start = weekStartOf(todayIso ?? new Date().toISOString().slice(0, 10));
  const out: string[] = [];
  let t = Date.parse(`${start}T00:00:00Z`);
  for (let i = 0; i < count; i += 1) {
    out.push(new Date(t).toISOString().slice(0, 10));
    t += 7 * 86_400_000;
  }
  return out;
}

/** Even-split effective hours per assignee (mirrors taskAssignments.effectiveHours). */
function effectiveHours(assignments: readonly { name: string; hours?: number | null }[], estimated: number): Map<string, number> {
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

export interface PersonLoad {
  name: string;
  /** Available hours/week (from person_capacity; default applied by caller). */
  capacity: number;
  /** hours per Monday-ISO, only for weeks in the requested window. */
  weekly: Record<string, number>;
  /** Sum across the window. */
  total: number;
  /** Busiest single week's hours in the window. */
  peak: number;
  /** How many weeks in the window exceed capacity. */
  overWeeks: number;
}

/**
 * Spread each task's hours across its start→due span (per person for a split
 * task, else the whole estimate on the owner), sum per person per week, and
 * pivot onto the given week window. Weeks outside the window are dropped.
 */
export function teamLoad(tasks: readonly LoadTask[], weeks: readonly string[], capacityOf: (name: string) => number): PersonLoad[] {
  const weekSet = new Set(weeks);
  const byPersonWeek = new Map<string, number>(); // `${name}|${week}` -> hours
  const place = (name: string, start: string, end: string, hours: number): void => {
    if (!name || !(hours > 0)) return;
    const days = daysInclusive(start, end);
    const perDay = hours / days.length;
    for (const d of days) {
      const wk = weekStartOf(d);
      if (!weekSet.has(wk)) continue;
      const key = `${name}|${wk}`;
      byPersonWeek.set(key, (byPersonWeek.get(key) ?? 0) + perDay);
    }
  };

  for (const t of tasks) {
    if (t.status === "done" || !t.due) continue;
    const end = t.due;
    const start = t.start && t.start <= end ? t.start : end;
    if (t.assignments && t.assignments.length > 0) {
      const eff = effectiveHours(t.assignments, t.estimatedHours ?? 0);
      for (const [name, hours] of eff) place(name, start, end, hours);
    } else if (t.ownerName && (t.estimatedHours ?? 0) > 0) {
      place(t.ownerName, start, end, t.estimatedHours!);
    }
  }

  const people = new Map<string, PersonLoad>();
  for (const [key, hours] of byPersonWeek) {
    const sep = key.lastIndexOf("|");
    const name = key.slice(0, sep);
    const wk = key.slice(sep + 1);
    const rounded = Math.round(hours * 10) / 10;
    const row = people.get(name) ?? { name, capacity: capacityOf(name), weekly: {}, total: 0, peak: 0, overWeeks: 0 };
    row.weekly[wk] = rounded;
    people.set(name, row);
  }
  for (const row of people.values()) {
    let total = 0;
    let peak = 0;
    let overWeeks = 0;
    for (const wk of weeks) {
      const h = row.weekly[wk] ?? 0;
      total += h;
      if (h > peak) peak = h;
      if (row.capacity > 0 && h > row.capacity) overWeeks += 1;
    }
    row.total = Math.round(total * 10) / 10;
    row.peak = Math.round(peak * 10) / 10;
    row.overWeeks = overWeeks;
  }

  return [...people.values()].sort((a, b) => {
    const ra = a.capacity > 0 ? a.peak / a.capacity : a.peak;
    const rb = b.capacity > 0 ? b.peak / b.capacity : b.peak;
    return rb - ra || a.name.localeCompare(b.name);
  });
}
