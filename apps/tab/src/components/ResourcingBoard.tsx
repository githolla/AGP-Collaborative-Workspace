/**
 * The interactive heart of the per-client Resourcing tab. Built for Cara &
 * Kellie's one ask: keep the weekly, per-person/per-project picture current
 * automatically as timelines shift, and show where work piles up — no manual
 * "expand-all, select-all, redistribute" every Thursday.
 *
 * The foundation is TASK LOAD (weeklyLoad): every open, owned, dated task
 * counted by person and week. That comes straight from the auto-imported
 * Kantata data (owners + due dates), so the board is populated the moment a
 * workspace opens — even before anyone touches hours (fresh Kantata pulls carry
 * no story hours). When hours DO exist — Resource Center reservations, or hours
 * the PM validates here — the same board switches to an hours view and can push
 * the weekly reservations back to Kantata.
 *
 * Everything is clickable: a heatmap cell, a person, or a week drills into the
 * exact tasks behind it, where hours are validated inline. No leveling, no
 * auto-estimate, no capacity here — those are Team Load / Kantata, by decision.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { card, T } from "../theme.js";
import { StatTile, SectionTitle } from "./bits.js";
import type { Task } from "../workspace/types.js";
import type { WriteResponse } from "../workspace/kantataWrite.js";
import { msApiGetPlain, MsApiError } from "../workspace/msApiFetch.js";
import {
  weeklyLoad, weeklyReservations, gridFrom, allocationGrid, weekLabel,
  type ResourceTask, type ResourceReservation, type AllocationGrid, type WeekLoadCell,
} from "../workspace/resourcing.js";

const navy = T.roi.navy;

type Mode = "tasks" | "hours";
type Selection = { person?: string; week?: string; needsHours?: boolean; all?: boolean } | null;

/** Makes a KPI tile clickable-to-drill, with a hover lift and a selected ring. */
function DrillStat({ onClick, active, title, children }: { onClick: () => void; active: boolean; title: string; children: ReactNode }) {
  const [hover, setHover] = useState(false);
  return (
    <div role="button" tabIndex={0} title={title} onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)} onBlur={() => setHover(false)}
      style={{
        position: "relative", cursor: "pointer", borderRadius: 12,
        outline: active ? `2px solid ${T.roi.navy}` : hover ? `1.5px solid ${T.roi.cyan}` : "none",
        outlineOffset: 1,
        boxShadow: hover && !active ? "0 4px 14px rgba(15,41,74,.12)" : "none",
        transform: hover && !active ? "translateY(-1px)" : "none",
        transition: "transform .12s, box-shadow .12s",
      }}>
      {children}
      {/* Resting affordance: a plain-language hint that brightens on hover so the
          tile reads as clickable — click to open the tasks behind it. */}
      <span aria-hidden style={{
        position: "absolute", top: 8, right: 10, fontSize: 10.5, fontWeight: 700,
        letterSpacing: 0.2, color: active ? T.roi.navy : hover ? T.roi.cyan : T.inkMuted,
        opacity: active || hover ? 1 : 0.6, transition: "color .12s, opacity .12s",
      }}>{active ? "Hide ✕" : "View →"}</span>
    </div>
  );
}

/** Teal-ramp cell shade by magnitude. */
function seqCell(value: number, max: number): { bg: string; fg: string } {
  if (value <= 0) return { bg: "transparent", fg: T.grid };
  const idx = Math.min(9, Math.max(1, Math.round((value / (max || 1)) * 9)));
  return { bg: T.seq[idx] ?? T.seq[1]!, fg: idx >= 6 ? "#fff" : T.ink };
}

export function ResourcingBoard({
  tasks,
  reservations = [],
  toResourceTasks,
  onSetHours,
  onPublish,
  accountId,
}: {
  tasks: Task[];
  reservations?: readonly ResourceReservation[];
  toResourceTasks: (tasks: Task[]) => ResourceTask[];
  onSetHours: (taskId: string, hours: number | undefined) => void;
  onPublish?: (() => Promise<WriteResponse>) | undefined;
  /** Enables the one-click "Check Kantata for hours" diagnostic for this client. */
  accountId?: string | null | undefined;
}) {
  const resTasks = useMemo(() => toResourceTasks(tasks), [tasks, toResourceTasks]);
  const load = useMemo(() => weeklyLoad(resTasks), [resTasks]);
  const hoursGrid: AllocationGrid = useMemo(
    () => (reservations.length > 0 ? gridFrom(weeklyReservations(reservations)) : allocationGrid(resTasks)),
    [reservations, resTasks],
  );
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const hasHours = hoursGrid.weeks.length > 0;
  const fromKantata = reservations.length > 0;
  const [mode, setMode] = useState<Mode>(hasHours ? "hours" : "tasks");
  const [sel, setSel] = useState<Selection>(null);
  const activeMode: Mode = mode === "hours" && !hasHours ? "tasks" : mode;
  // Auto-offer the hours view the first time hours appear (a PM enters some, or
  // reservations load), unless they've explicitly chosen a mode — so entering
  // hours in task mode gives visible feedback instead of a heatmap that doesn't
  // move (task-count cells don't change when you add hours).
  const userPicked = useRef(false);
  const pickMode = (m: Mode) => { userPicked.current = true; setMode(m); };
  useEffect(() => { if (hasHours && !userPicked.current) setMode("hours"); }, [hasHours]);

  // ---- axes -----------------------------------------------------------------
  const loadCell = useMemo(() => {
    const m = new Map<string, WeekLoadCell>();
    for (const c of load) m.set(`${c.personName}|${c.weekStart}`, c);
    return m;
  }, [load]);

  const people = useMemo(() => {
    const set = new Set<string>([...load.map((c) => c.personName), ...hoursGrid.people]);
    const arr = [...set];
    // Most-loaded first, in the active unit.
    const total = (p: string) => activeMode === "hours"
      ? hoursGrid.personTotal(p)
      : load.filter((c) => c.personName === p).reduce((s, c) => s + c.taskCount, 0);
    return arr.sort((a, b) => total(b) - total(a) || a.localeCompare(b));
  }, [load, hoursGrid, activeMode]);

  const weeks = useMemo(() => {
    const set = new Set<string>([...load.map((c) => c.weekStart), ...hoursGrid.weeks]);
    return [...set].sort();
  }, [load, hoursGrid]);

  // cell value in the active unit (a cell is "active that week", correct per-week)
  const cellValue = (p: string, w: string): number =>
    activeMode === "hours" ? hoursGrid.hoursFor(p, w) : (loadCell.get(`${p}|${w}`)?.taskCount ?? 0);
  const maxCell = useMemo(() => Math.max(1, ...people.flatMap((p) => weeks.map((w) => cellValue(p, w)))), [people, weeks, activeMode]);
  // Totals in TASK mode must count DISTINCT tasks (a task spanning N weeks shows
  // in N cells but is one task) so the row/week/KPI totals match the drill;
  // summing per-week cells would over-report by the span length. Hours mode sums
  // fine (hours are split across weeks).
  const distinctTasks = (pred: (c: WeekLoadCell) => boolean): number => {
    const s = new Set<string>();
    for (const c of load) if (pred(c)) for (const id of c.taskIds) s.add(id);
    return s.size;
  };
  const weekTotal = (w: string) => activeMode === "hours" ? people.reduce((s, p) => s + hoursGrid.hoursFor(p, w), 0) : distinctTasks((c) => c.weekStart === w);
  const personTotal = (p: string) => activeMode === "hours" ? weeks.reduce((s, w) => s + hoursGrid.hoursFor(p, w), 0) : distinctTasks((c) => c.personName === p);
  const unit = activeMode === "hours" ? "h" : "";

  // ---- KPIs -----------------------------------------------------------------
  const candidates = tasks.filter((t) => t.status !== "done" && t.ownerName && t.due);
  const missingHours = candidates.filter((t) => t.estimatedHours == null).length;
  const busiest = weeks.reduce((best, w) => { const v = weekTotal(w); return v > best.v ? { w, v } : best; }, { w: "", v: 0 });

  // ---- drill ----------------------------------------------------------------
  const drillTasks: Task[] = useMemo(() => {
    if (!sel) return [];
    const ids = new Set<string>();
    for (const c of load) {
      if (sel.person && c.personName !== sel.person) continue;
      if (sel.week && c.weekStart !== sel.week) continue;
      for (const id of c.taskIds) ids.add(id);
    }
    let list = [...ids].map((id) => taskById.get(id)).filter((t): t is Task => !!t);
    if (sel.needsHours) list = list.filter((t) => t.estimatedHours == null);
    return list.sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""));
  }, [sel, load, taskById]);

  const toggle = (next: Selection) => setSel((cur) => (JSON.stringify(cur) === JSON.stringify(next) ? null : next));

  if (weeks.length === 0) {
    return (
      <div style={{ ...card, background: "#fbfbf8", borderStyle: "dashed", fontSize: 12.5, color: T.inkSecondary }}>
        No open, owned, dated tasks to resource yet. Once Kantata tasks import with owners and due dates, the weekly
        picture builds itself here — automatically.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* KPI row — each tile drills into the tasks behind it */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
        <DrillStat onClick={() => toggle({ all: true })} active={!!sel?.all} title="Show all tasks in play">
          <StatTile label="People on the account" value={String(people.length)} detail={`${candidates.length} tasks in play`} />
        </DrillStat>
        <DrillStat onClick={() => toggle({ all: true })} active={!!sel?.all} title="Show every scheduled task">
          <StatTile label={activeMode === "hours" ? "Scheduled hours" : "Tasks scheduled"} value={`${Math.round(personTotalAll())}${unit}`} detail="across the weeks below" />
        </DrillStat>
        <DrillStat onClick={() => busiest.w && toggle({ week: busiest.w })} active={!!busiest.w && sel?.week === busiest.w} title="Drill into the busiest week">
          <StatTile label="Busiest week" value={busiest.v > 0 ? `${Math.round(busiest.v)}${unit}` : "—"} {...(busiest.w ? { detail: weekLabel(busiest.w) } : {})} />
        </DrillStat>
        <DrillStat onClick={() => missingHours > 0 && toggle({ needsHours: true })} active={!!sel?.needsHours} title="Show the tasks that need hours">
          <StatTile label="Need hours" value={String(missingHours)} detail={missingHours > 0 ? "click to see which" : "all set"} {...(missingHours > 0 ? { detailColor: T.status.warning } : { detailColor: T.status.good })} />
        </DrillStat>
      </div>

      {/* Mode toggle + source note */}
      <div style={{ ...card, padding: "10px 14px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", background: "#f4fbfd", borderColor: T.roi.cyan }}>
        <div style={{ display: "inline-flex", gap: 3, background: "#fff", border: `1px solid ${T.grid}`, borderRadius: 8, padding: 3 }}>
          {(["tasks", "hours"] as const).map((m) => {
            const disabled = m === "hours" && !hasHours;
            return (
              <button key={m} type="button" disabled={disabled}
                onClick={() => pickMode(m)}
                title={disabled ? "Add hours to a task (or pull Kantata reservations) to see the hours view" : ""}
                style={{ border: 0, background: activeMode === m ? T.roi.cyan : "transparent", color: activeMode === m ? "#fff" : disabled ? T.inkMuted : T.inkSecondary, fontSize: 12, fontWeight: 700, padding: "5px 12px", borderRadius: 6, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.55 : 1 }}>
                {m === "tasks" ? "By tasks" : "By hours"}
              </button>
            );
          })}
        </div>
        <span style={{ fontSize: 11.5, color: "#16708f", flex: 1, minWidth: 220 }}>
          {activeMode === "hours"
            ? (fromKantata ? "Live from Kantata's Resource Center — reserved hours per person, per week." : "Hours you've set on tasks, spread across each task's dates. Re-figures on its own when a timeline moves.")
            : "Live from Kantata — every owned, dated task counted by person and week, no hours needed. Add hours to switch to the hours view."}
        </span>
        {accountId && <KantataHoursCheckInline accountId={accountId} emphasize={!hasHours} />}
      </div>

      {/* Demand trend — clickable weeks */}
      <div style={card}>
        <SectionTitle right={<span style={{ fontSize: 10.5, color: T.inkMuted }}>{activeMode === "hours" ? "hours" : "tasks"} due by week · click a week to drill</span>}>Demand by week</SectionTitle>
        <DemandTrend weeks={weeks} valueOf={weekTotal} unit={unit} selectedWeek={sel?.week} onPick={(w) => toggle({ week: w })} />
      </div>

      {/* Person × week heatmap — clickable cells / rows / cols */}
      <div style={card}>
        <SectionTitle right={<span style={{ fontSize: 10.5, color: T.inkMuted }}>deeper teal = heavier · click any cell</span>}>Who's loaded, when</SectionTitle>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 11.5, minWidth: 480, width: "100%" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "6px 10px 6px 2px", color: T.inkMuted, fontWeight: 700, position: "sticky", left: 0, background: T.surface, zIndex: 2 }}>Person</th>
                {weeks.map((w) => (
                  <th key={w} onClick={() => toggle({ week: w })}
                    style={{ textAlign: "center", padding: "6px 8px", color: sel?.week === w ? T.roi.cyan : T.inkMuted, fontWeight: 700, whiteSpace: "nowrap", cursor: "pointer" }}>{weekLabel(w)}</th>
                ))}
                <th style={{ textAlign: "center", padding: "6px 10px", color: navy, fontWeight: 800, position: "sticky", right: 0, background: T.surface, zIndex: 2 }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p} style={{ borderTop: `1px solid ${T.grid}`, background: sel?.person === p && !sel?.week ? "#f0fafc" : "transparent" }}>
                  <td onClick={() => toggle({ person: p })}
                    style={{ padding: "6px 10px 6px 2px", fontWeight: 600, color: sel?.person === p ? T.roi.cyan : T.ink, whiteSpace: "nowrap", position: "sticky", left: 0, background: sel?.person === p && !sel?.week ? "#f0fafc" : T.surface, zIndex: 1, cursor: "pointer" }}>{p}</td>
                  {weeks.map((w) => {
                    const v = cellValue(p, w);
                    const c = seqCell(v, maxCell);
                    const isSel = sel?.person === p && sel?.week === w;
                    return (
                      <td key={w} onClick={() => toggle({ person: p, week: w })}
                        title={`${p} · ${weekLabel(w)} · ${v}${unit || " task" + (v === 1 ? "" : "s")}`}
                        style={{ textAlign: "center", padding: "6px 8px", fontVariantNumeric: "tabular-nums", color: v === 0 ? T.grid : c.fg, fontWeight: v > 0 ? 600 : 400, background: c.bg, cursor: "pointer", outline: isSel ? `2px solid ${T.roi.navy}` : "none", outlineOffset: -2 }}>
                        {v === 0 ? "·" : Math.round(v)}
                      </td>
                    );
                  })}
                  <td onClick={() => toggle({ person: p })} title={`All of ${p}'s tasks`}
                    style={{ textAlign: "center", padding: "6px 10px", fontWeight: 800, color: navy, fontVariantNumeric: "tabular-nums", position: "sticky", right: 0, background: sel?.person === p && !sel?.week ? "#f0fafc" : T.surface, cursor: "pointer" }}>{Math.round(personTotal(p))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: `2px solid ${T.grid}` }}>
                <td onClick={() => toggle({ all: true })} title="All tasks"
                  style={{ padding: "6px 10px 6px 2px", fontWeight: 800, color: T.inkMuted, position: "sticky", left: 0, background: T.surface, zIndex: 1, cursor: "pointer" }}>Team / week</td>
                {weeks.map((w) => (
                  <td key={w} onClick={() => toggle({ week: w })} title={`Everyone · week of ${weekLabel(w)}`}
                    style={{ textAlign: "center", padding: "6px 8px", fontWeight: 700, color: sel?.week === w && !sel?.person ? T.roi.cyan : T.inkSecondary, fontVariantNumeric: "tabular-nums", cursor: "pointer" }}>{Math.round(weekTotal(w)) || "·"}</td>
                ))}
                <td onClick={() => toggle({ all: true })} title="All tasks"
                  style={{ textAlign: "center", padding: "6px 10px", fontWeight: 800, color: navy, fontVariantNumeric: "tabular-nums", position: "sticky", right: 0, background: T.surface, cursor: "pointer" }}>{Math.round(personTotalAll())}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Drill-down opens a full-screen breakdown of exactly the tasks behind
          whatever you clicked — grouped, with a summary and inline hours. */}
      {sel && (
        <DrillModal
          label={drillLabel(sel)}
          sel={sel}
          tasks={drillTasks}
          onSetHours={onSetHours}
          fromKantata={fromKantata && activeMode === "hours"}
          onClose={() => setSel(null)}
        />
      )}

      {/* Push to Kantata — only meaningful once there are hours */}
      {hasHours && onPublish && (() => {
        // Name the scope so the review is meaningful: how many person-weeks carry
        // hours, across how many people. The grid above IS the review — this
        // sends exactly what's shown, when the PM decides it's right.
        let cells = 0; const withHours = new Set<string>();
        for (const p of people) for (const w of weeks) if (hoursGrid.hoursFor(p, w) > 0) { cells += 1; withHours.add(p); }
        return <PushToKantata reservationCount={cells} peopleCount={withHours.size} onPublish={onPublish} />;
      })()}
    </div>
  );

  function personTotalAll(): number {
    // Hours: sum every week. Tasks: distinct across all weeks (not the sum of
    // per-week distinct counts, which would double-count multi-week tasks).
    return activeMode === "hours" ? weeks.reduce((s, w) => s + weekTotal(w), 0) : distinctTasks(() => true);
  }
}

function drillLabel(sel: NonNullable<Selection>): string {
  if (sel.needsHours) return "Tasks that need hours";
  if (sel.person && sel.week) return `${sel.person} · week of ${weekLabel(sel.week)}`;
  if (sel.person) return `${sel.person} · all weeks`;
  if (sel.week) return `Everyone · week of ${weekLabel(sel.week)}`;
  return "All scheduled tasks";
}

/** Weekly demand columns, clickable. */
function DemandTrend({ weeks, valueOf, unit, selectedWeek, onPick }: { weeks: string[]; valueOf: (w: string) => number; unit: string; selectedWeek?: string | undefined; onPick: (w: string) => void }) {
  const vals = weeks.map(valueOf);
  const max = Math.max(1, ...vals);
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "flex-end", height: 90, overflowX: "auto", paddingTop: 4 }}>
      {weeks.map((w, i) => {
        const v = vals[i]!;
        const h = Math.max(2, (v / max) * 72);
        const on = selectedWeek === w;
        return (
          <button key={w} type="button" onClick={() => onPick(w)} title={`${weekLabel(w)} · ${Math.round(v)}${unit}`}
            style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, border: 0, background: "transparent", cursor: "pointer", minWidth: 34 }}>
            <span style={{ fontSize: 9.5, color: on ? T.roi.cyan : T.inkMuted, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{v > 0 ? Math.round(v) : ""}</span>
            <span style={{ width: 20, height: h, borderRadius: "3px 3px 0 0", background: on ? T.roi.navy : v > 0 ? T.series1 : T.grid }} />
            <span style={{ fontSize: 9, color: on ? T.roi.cyan : T.inkMuted, whiteSpace: "nowrap", fontWeight: on ? 700 : 400 }}>{weekLabel(w)}</span>
          </button>
        );
      })}
    </div>
  );
}

/** A single task row with an inline hours estimate — shared by the drill modal. */
function DrillTaskRow({ t, onSetHours }: { t: Task; onSetHours: (taskId: string, hours: number | undefined) => void }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${T.grid}` }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontWeight: 600, fontSize: 13, color: T.ink, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
        <span style={{ fontSize: 11, color: T.inkMuted }}>
          {t.projectLabel ? `${t.projectLabel} · ` : ""}{t.ownerName ?? "—"}{t.due ? ` · due ${new Date(`${t.due}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}` : ""}
        </span>
      </span>
      <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: T.inkMuted, whiteSpace: "nowrap" }}>
        <input type="number" min={0} step={0.5} defaultValue={t.estimatedHours ?? ""} placeholder="0"
          onBlur={(e) => { const raw = e.target.value.trim(); const v = raw === "" ? undefined : Number(raw); if (raw === "" || Number.isFinite(v)) onSetHours(t.id, v); }}
          style={{ width: 62, textAlign: "right", border: `1px solid ${t.estimatedHours == null ? T.status.warning : T.grid}`, borderRadius: 6, padding: "6px 8px", fontSize: 12.5, fontFamily: "inherit" }} />
        h
      </label>
    </div>
  );
}

/**
 * Full-screen drill-down: click any KPI tile, heatmap cell, person or week and
 * you "go into" it here — a real breakdown of exactly those tasks, grouped
 * (by person, or by project when a single person is selected), with a summary
 * strip and inline hours. Backdrop / Esc / Close all dismiss.
 */
function DrillModal({ label, sel, tasks, onSetHours, fromKantata, onClose }: {
  label: string; sel: NonNullable<Selection>; tasks: Task[];
  onSetHours: (taskId: string, hours: number | undefined) => void;
  fromKantata: boolean; onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // When you've already narrowed to one person, grouping by person is useless —
  // group by project instead so you see where that person's load lives.
  const singlePerson = !!sel.person && !sel.all;
  const groupedBy = singlePerson ? "project" : "owner";
  const groups = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of tasks) {
      const key = singlePerson ? (t.projectLabel || "No project") : (t.ownerName || "Unassigned");
      const arr = m.get(key);
      if (arr) arr.push(t); else m.set(key, [t]);
    }
    return [...m.entries()]
      .map(([key, ts]) => ({ key, tasks: [...ts].sort((a, b) => (a.due ?? "").localeCompare(b.due ?? "")) }))
      .sort((a, b) => b.tasks.length - a.tasks.length || a.key.localeCompare(b.key));
  }, [tasks, singlePerson]);

  const totalHours = tasks.reduce((s, t) => s + (t.estimatedHours ?? 0), 0);
  const needHours = tasks.filter((t) => t.estimatedHours == null).length;

  return (
    <div role="dialog" aria-modal="true" onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(16,21,46,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 16px", overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: T.surface, borderRadius: 14, width: "min(880px, 100%)", maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 70px rgba(0,0,0,.35)" }}>
        {/* Header + summary strip */}
        <div style={{ padding: "16px 22px", borderBottom: `1px solid ${T.grid}` }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: T.roi.cyan, textTransform: "uppercase" }}>Resourcing drill-down</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: navy, marginTop: 2 }}>{label}</div>
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} style={{ whiteSpace: "nowrap" }}>Close ✕</button>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            <SummaryPill label="Tasks" value={String(tasks.length)} />
            <SummaryPill label="Estimated" value={totalHours > 0 ? `${Math.round(totalHours)}h` : "—"} />
            <SummaryPill label="Need hours" value={String(needHours)} warn={needHours > 0} />
            <SummaryPill label={`By ${groupedBy}`} value={String(groups.length)} />
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: "6px 22px 22px", overflowY: "auto" }}>
          {fromKantata && (
            <div style={{ fontSize: 11.5, color: "#16708f", background: "#f4fbfd", border: `1px solid ${T.roi.cyan}`, borderRadius: 8, padding: "8px 11px", margin: "12px 0 4px" }}>
              The hours in the grid are live Kantata Resource Center reservations — edit those in Kantata. The box below sets each task's own estimate (the derived plan), which is a separate number.
            </div>
          )}
          {tasks.length === 0 ? (
            <div style={{ fontSize: 12.5, color: T.inkMuted, padding: "18px 0" }}>
              {fromKantata
                ? "These hours come from Kantata's Resource Center for someone who owns no dated task here — there's no task-level breakdown to show. Edit the reservation in Kantata."
                : "No tasks fall on this selection."}
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.key} style={{ marginTop: 16 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 2, position: "sticky", top: 0, background: T.surface, paddingTop: 4, paddingBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: T.ink }}>{g.key}</span>
                  <span style={{ fontSize: 11, color: T.inkMuted }}>{g.tasks.length} task{g.tasks.length === 1 ? "" : "s"}</span>
                </div>
                {g.tasks.map((t) => <DrillTaskRow key={t.id} t={t} onSetHours={onSetHours} />)}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/** Small labeled stat chip for the drill-modal summary strip. */
function SummaryPill({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1, padding: "6px 12px", borderRadius: 9, background: warn ? "#fdf3e6" : "#f3f6fa", minWidth: 74 }}>
      <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.3, color: warn ? T.status.warning : T.inkMuted, textTransform: "uppercase" }}>{label}</span>
      <span style={{ fontSize: 16, fontWeight: 800, color: warn ? T.status.warning : navy, fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}

/** Push the derived weekly reservations back to Kantata (review-gated). */
function PushToKantata({ reservationCount, peopleCount, onPublish }: { reservationCount: number; peopleCount: number; onPublish: () => Promise<WriteResponse> }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<WriteResponse | null>(null);
  const run = async () => {
    setBusy(true);
    try { setResult(await onPublish()); }
    catch (err) { setResult({ dryRun: true, reason: err instanceof Error ? err.message : "publish failed", applied: 0, failed: 0, results: [] }); }
    finally { setBusy(false); }
  };
  const scope = `${reservationCount} weekly reservation${reservationCount === 1 ? "" : "s"} · ${peopleCount} ${peopleCount === 1 ? "person" : "people"}`;
  return (
    <div style={{ ...card, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void run()}>
        {busy ? "Sending…" : `Send ${scope} to Kantata →`}
      </button>
      <span style={{ fontSize: 11, color: T.inkMuted, flex: 1, minWidth: 200 }}>
        The grid above is your review — this sends exactly what's shown, when you decide it's right. Kantata stays the system of record; nothing goes until you click. Never duplicates an existing reservation.
      </span>
      {result && (
        <div style={{ width: "100%", padding: "8px 10px", borderRadius: 6, background: result.failed > 0 ? "#fdeced" : "#eaf6ee", fontSize: 11.5, color: T.ink }}>
          {result.dryRun
            ? <><strong>Staged — not sent (nothing you did is wrong).</strong> Kantata write-back is switched OFF on the server, so this is a safe preview. These {result.results.length || ""} reservations are valid and will post the moment an admin sets <code>KANTATA_WRITE_ENABLED=true</code>. {result.reason ?? ""}</>
            : <><strong>{result.applied} weekly reservation{result.applied === 1 ? "" : "s"} sent{result.failed > 0 ? `, ${result.failed} failed` : ""}.</strong> {result.failed > 0 ? result.results.filter((r) => !r.ok).map((r) => r.error).join(" · ") : "Kantata now reflects this plan."}</>}
        </div>
      )}
    </div>
  );
}

// ---- one-click Kantata hours check (in-context, this client's workspaces) ----

interface HoursWorkspace {
  workspaceId: string;
  allocations: number;
  allocationsHours: number;
  storiesWithHours: number;
  storyHours: number;
  verdict: "has_allocations" | "has_story_hours" | "no_hours" | "unknown";
}
interface HoursCheck {
  configured: boolean;
  message?: string;
  noKantataLink?: boolean;
  allocationsError?: string;
  workspaces?: HoursWorkspace[];
}

const VERDICT_TEXT: Record<HoursWorkspace["verdict"], { icon: string; color: string; bg: string; line: (w: HoursWorkspace) => string }> = {
  has_allocations: { icon: "✅", color: "#116a43", bg: "#e6f4ea", line: (w) => `Workspace ${w.workspaceId}: ${w.allocations} Resource Center allocations (~${w.allocationsHours}h) — the hours are in Kantata. If "By hours" is still empty, it's the account link, not the data — tell me and I'll fix the match.` },
  has_story_hours: { icon: "◑", color: "#8a6d1a", bg: "#faf3dc", line: (w) => `Workspace ${w.workspaceId}: no allocations, but ${w.storiesWithHours} stories carry estimated hours (~${w.storyHours}h) — the import can carry these onto tasks. Tell me and I'll wire it.` },
  no_hours: { icon: "⚠", color: T.inkSecondary, bg: "#eef0f4", line: (w) => `Workspace ${w.workspaceId}: no allocations and no story hours in Kantata — there's nothing to pull yet. The task view above is the honest picture until someone enters hours (in Kantata or here).` },
  unknown: { icon: "🔒", color: "#8a6d1a", bg: "#faf3dc", line: (w) => `Workspace ${w.workspaceId}: couldn't read Resource Center allocations — the Kantata token likely lacks resource-management (allocations) read scope. Ask Ren to add it, then re-check. (Story hours: ${w.storiesWithHours}.)` },
};

function KantataHoursCheckInline({ accountId, emphasize }: { accountId: string; emphasize: boolean }) {
  const [result, setResult] = useState<HoursCheck | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = () => {
    setBusy(true); setErr(null); setResult(null);
    // The check queries Kantata per workspace and has no server-side deadline,
    // so a slow/hung Kantata would leave the button stuck on "Checking…"
    // forever. Race it against a client timeout so the button ALWAYS resolves.
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("__timeout__")), 25000));
    Promise.race([msApiGetPlain<HoursCheck>(`/api/account-kantata-check?accountId=${encodeURIComponent(accountId)}`), timeout])
      .then((r) => setResult(r as HoursCheck))
      .catch((e) =>
        setErr(
          e instanceof MsApiError ? e.message
          : e instanceof Error && e.message === "__timeout__" ? "Kantata took too long to respond — try again."
          : "Check failed",
        ),
      )
      .finally(() => setBusy(false));
  };

  return (
    <>
      <button type="button" className={`btn btn-sm ${emphasize ? "btn-primary" : "btn-secondary"}`} style={{ whiteSpace: "nowrap" }} disabled={busy} onClick={run}>
        {busy ? "Checking Kantata…" : emphasize ? "Why no hours? Check Kantata" : "Check Kantata hours"}
      </button>
      {(result || err) && (
        <div style={{ width: "100%", marginTop: 4, display: "flex", flexDirection: "column", gap: 6 }}>
          {err && <div style={{ fontSize: 12, color: T.status.critical, background: "#fdecea", borderRadius: 8, padding: "8px 11px" }}>{err}</div>}
          {result && !result.configured && <div style={{ fontSize: 12, color: "#8a6d1a", background: "#faf3dc", borderRadius: 8, padding: "8px 11px" }}>{result.message ?? "Kantata isn't configured on the server."}</div>}
          {result?.noKantataLink && <div style={{ fontSize: 12, color: T.inkSecondary, background: "#eef0f4", borderRadius: 8, padding: "8px 11px" }}>This workspace isn't linked to a Kantata project yet — link it on the Admin tab, then re-check.</div>}
          {result?.allocationsError && <div style={{ fontSize: 11.5, color: "#8a6d1a", background: "#faf3dc", borderRadius: 8, padding: "8px 11px" }}>Kantata allocations pull error: {result.allocationsError} (a 403 means the token lacks resource-management scope).</div>}
          {(result?.workspaces ?? []).map((w) => {
            const v = VERDICT_TEXT[w.verdict];
            return <div key={w.workspaceId} style={{ fontSize: 12, color: v.color, background: v.bg, borderRadius: 8, padding: "8px 11px", lineHeight: 1.5 }}>{v.icon} {v.line(w)}</div>;
          })}
        </div>
      )}
    </>
  );
}
