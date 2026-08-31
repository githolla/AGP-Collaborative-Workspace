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

import { useMemo, useState } from "react";
import { card, T } from "../theme.js";
import { StatTile, SectionTitle } from "./bits.js";
import type { Task } from "../workspace/types.js";
import type { WriteResponse } from "../workspace/kantataWrite.js";
import {
  weeklyLoad, weeklyReservations, gridFrom, allocationGrid, weekLabel,
  type ResourceTask, type ResourceReservation, type AllocationGrid, type WeekLoadCell,
} from "../workspace/resourcing.js";

const navy = T.roi.navy;

type Mode = "tasks" | "hours";
type Selection = { person?: string; week?: string } | null;

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
}: {
  tasks: Task[];
  reservations?: readonly ResourceReservation[];
  toResourceTasks: (tasks: Task[]) => ResourceTask[];
  onSetHours: (taskId: string, hours: number | undefined) => void;
  onPublish?: (() => Promise<WriteResponse>) | undefined;
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
  // If hours arrive later (import lands), don't fight a manual choice — but if
  // the user never chose and hours show up, prefer hours.
  const activeMode: Mode = mode === "hours" && !hasHours ? "tasks" : mode;

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

  // cell value in the active unit
  const cellValue = (p: string, w: string): number =>
    activeMode === "hours" ? hoursGrid.hoursFor(p, w) : (loadCell.get(`${p}|${w}`)?.taskCount ?? 0);
  const maxCell = useMemo(() => Math.max(1, ...people.flatMap((p) => weeks.map((w) => cellValue(p, w)))), [people, weeks, activeMode]);
  const weekTotal = (w: string) => people.reduce((s, p) => s + cellValue(p, w), 0);
  const personTotal = (p: string) => weeks.reduce((s, w) => s + cellValue(p, w), 0);
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
    return [...ids].map((id) => taskById.get(id)).filter((t): t is Task => !!t)
      .sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""));
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
      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
        <StatTile label="People on the account" value={String(people.length)} detail={`${candidates.length} tasks in play`} />
        <StatTile label={activeMode === "hours" ? "Scheduled hours" : "Tasks scheduled"} value={`${Math.round(personTotalAll())}${unit}`} detail="across the weeks below" />
        <StatTile label="Busiest week" value={busiest.v > 0 ? `${Math.round(busiest.v)}${unit}` : "—"} {...(busiest.w ? { detail: weekLabel(busiest.w) } : {})} />
        <StatTile label="Need hours" value={String(missingHours)} detail={missingHours > 0 ? "add to unlock the hours view" : "all set"} {...(missingHours > 0 ? { detailColor: T.status.warning } : { detailColor: T.status.good })} />
      </div>

      {/* Mode toggle + source note */}
      <div style={{ ...card, padding: "10px 14px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", background: "#f4fbfd", borderColor: T.roi.cyan }}>
        <div style={{ display: "inline-flex", gap: 3, background: "#fff", border: `1px solid ${T.grid}`, borderRadius: 8, padding: 3 }}>
          {(["tasks", "hours"] as const).map((m) => {
            const disabled = m === "hours" && !hasHours;
            return (
              <button key={m} type="button" disabled={disabled}
                onClick={() => setMode(m)}
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
                  <td style={{ textAlign: "center", padding: "6px 10px", fontWeight: 800, color: navy, fontVariantNumeric: "tabular-nums", position: "sticky", right: 0, background: T.surface }}>{Math.round(personTotal(p))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: `2px solid ${T.grid}` }}>
                <td style={{ padding: "6px 10px 6px 2px", fontWeight: 800, color: T.inkMuted, position: "sticky", left: 0, background: T.surface, zIndex: 1 }}>Team / week</td>
                {weeks.map((w) => (
                  <td key={w} style={{ textAlign: "center", padding: "6px 8px", fontWeight: 700, color: T.inkSecondary, fontVariantNumeric: "tabular-nums" }}>{Math.round(weekTotal(w)) || "·"}</td>
                ))}
                <td style={{ textAlign: "center", padding: "6px 10px", fontWeight: 800, color: navy, fontVariantNumeric: "tabular-nums", position: "sticky", right: 0, background: T.surface }}>{Math.round(personTotalAll())}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Drill panel */}
      {sel && (
        <DrillPanel
          label={drillLabel(sel)}
          tasks={drillTasks}
          onSetHours={onSetHours}
          onClose={() => setSel(null)}
        />
      )}

      {/* Push to Kantata — only meaningful once there are hours */}
      {hasHours && onPublish && <PushToKantata fromKantata={fromKantata} onPublish={onPublish} />}
    </div>
  );

  function personTotalAll(): number {
    return weeks.reduce((s, w) => s + weekTotal(w), 0);
  }
}

function drillLabel(sel: NonNullable<Selection>): string {
  if (sel.person && sel.week) return `${sel.person} · week of ${weekLabel(sel.week)}`;
  if (sel.person) return `${sel.person} · all weeks`;
  if (sel.week) return `Everyone · week of ${weekLabel(sel.week)}`;
  return "Tasks";
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

/** The tasks behind a selected cell/row/column — hours validated inline. */
function DrillPanel({ label, tasks, onSetHours, onClose }: { label: string; tasks: Task[]; onSetHours: (taskId: string, hours: number | undefined) => void; onClose: () => void }) {
  return (
    <div style={{ ...card, borderColor: T.roi.navy }}>
      <SectionTitle right={<button type="button" className="btn-link" style={{ fontSize: 11.5 }} onClick={onClose}>Clear ✕</button>}>
        {label} <span style={{ fontSize: 12, color: T.inkMuted, fontWeight: 600 }}>· {tasks.length} task{tasks.length === 1 ? "" : "s"}</span>
      </SectionTitle>
      {tasks.length === 0
        ? <div style={{ fontSize: 12.5, color: T.inkMuted }}>No tasks here.</div>
        : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {tasks.map((t) => (
              <div key={t.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "7px 0", borderBottom: `1px solid ${T.grid}` }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 600, fontSize: 13, color: T.ink, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
                  <span style={{ fontSize: 11, color: T.inkMuted }}>
                    {t.projectLabel ? `${t.projectLabel} · ` : ""}{t.ownerName ?? "—"}{t.due ? ` · due ${new Date(`${t.due}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}` : ""}
                  </span>
                </span>
                <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: T.inkMuted, whiteSpace: "nowrap" }}>
                  <input type="number" min={0} step={0.5} defaultValue={t.estimatedHours ?? ""} placeholder="0"
                    onBlur={(e) => { const raw = e.target.value.trim(); const v = raw === "" ? undefined : Number(raw); if (raw === "" || Number.isFinite(v)) onSetHours(t.id, v); }}
                    style={{ width: 60, textAlign: "right", border: `1px solid ${t.estimatedHours == null ? T.status.warning : T.grid}`, borderRadius: 6, padding: "5px 7px", fontSize: 12.5, fontFamily: "inherit" }} />
                  h
                </label>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}

/** Push the derived weekly reservations back to Kantata (review-gated). */
function PushToKantata({ fromKantata, onPublish }: { fromKantata: boolean; onPublish: () => Promise<WriteResponse> }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<WriteResponse | null>(null);
  const run = async () => {
    setBusy(true);
    try { setResult(await onPublish()); }
    catch (err) { setResult({ dryRun: true, reason: err instanceof Error ? err.message : "publish failed", applied: 0, failed: 0, results: [] }); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ ...card, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void run()}>
        {busy ? "Sending…" : fromKantata ? "Update Kantata with this plan →" : "Send weekly reservations to Kantata →"}
      </button>
      <span style={{ fontSize: 11, color: T.inkMuted, flex: 1, minWidth: 200 }}>
        Reserves each person's hours on the weeks they fall — the weekly picture, back in Kantata. Never duplicates an existing reservation.
      </span>
      {result && (
        <div style={{ width: "100%", padding: "8px 10px", borderRadius: 6, background: result.failed > 0 ? "#fdeced" : "#eaf6ee", fontSize: 11.5, color: T.ink }}>
          {result.dryRun
            ? <><strong>Preview only — nothing was sent.</strong> {result.reason ?? ""} These reservations are valid and will post once writing to Kantata is switched on.</>
            : <><strong>{result.applied} weekly reservation{result.applied === 1 ? "" : "s"} sent{result.failed > 0 ? `, ${result.failed} failed` : ""}.</strong> {result.failed > 0 ? result.results.filter((r) => !r.ok).map((r) => r.error).join(" · ") : "Kantata now reflects this plan."}</>}
        </div>
      )}
    </div>
  );
}
