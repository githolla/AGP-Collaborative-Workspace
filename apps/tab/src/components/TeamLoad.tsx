import { useEffect, useMemo, useState } from "react";
import { card, T } from "../theme.js";
import { StatTile } from "./bits.js";
import { fetchTeamLoad, setPersonCapacity, type TeamLoadData, type PersonLoad } from "../workspace/msAccountData.js";
import { MsApiError } from "../workspace/msApiFetch.js";

const navy = T.roi.navy;

function fmtWeek(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "numeric", day: "numeric", timeZone: "UTC" });
}

/** Is this week over capacity (incl. any load with zero capacity)? */
function over(hours: number, capacity: number): boolean {
  return hours > 0 && (capacity <= 0 || hours > capacity);
}

/** Bar/pill color for a utilization ratio (status semantics). */
function utilColor(ratio: number): string {
  if (ratio > 1) return T.status.critical;
  if (ratio >= 0.85) return T.status.warning;
  return T.series1;
}

/** Heatmap cell color: idle grey, over red, near-full amber, else a sequential
 * teal step by intensity (magnitude). Text stays legible on each. */
function cellStyle(hours: number, capacity: number): { bg: string; fg: string } {
  if (hours <= 0) return { bg: "#f4f6f9", fg: T.inkMuted };
  if (over(hours, capacity)) return { bg: T.status.critical, fg: "#fff" };
  const ratio = capacity > 0 ? hours / capacity : 1;
  if (ratio >= 0.85) return { bg: T.status.warning, fg: "#3d2e05" };
  // 0..0.85 → first 7 steps of the teal ramp (light→mid); dark steps get white text.
  const idx = Math.min(6, Math.max(0, Math.round((ratio / 0.85) * 6)));
  const bg = T.seq[idx] ?? T.seq[0]!;
  return { bg, fg: idx >= 5 ? "#fff" : T.ink };
}

/**
 * Team Load — the cross-client resourcing command center (Kellie/Cara). Every
 * AGP person's weekly hours across ALL clients for the next 12 weeks, measured
 * against capacity so over-allocation and idle time finally show. Demand is
 * derived live from Kantata task hours; capacity is the one input admins set.
 * Charts (all hand-built in the app's div-bar idiom): a portfolio KPI row +
 * capacity-vs-demand bar + 12-week trend (board-ready for Cara), a per-person
 * utilization ranking, a "who's free" list, and the detailed week × person
 * heatmap.
 */
export function TeamLoad({ canManage }: { canManage: boolean }) {
  const [data, setData] = useState<TeamLoadData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [capErr, setCapErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchTeamLoad()
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setErr(e instanceof MsApiError ? e.message : "couldn't load team resourcing"); });
    return () => { cancelled = true; };
  }, []);

  const m = useMemo(() => data ? derive(data) : null, [data]);

  const saveCapacity = (name: string, raw: number) => {
    const weeklyHours = Math.round(raw);
    setCapErr(null);
    if (!Number.isFinite(weeklyHours) || weeklyHours < 0 || weeklyHours > 168) {
      setCapErr(`Capacity for ${name} must be 0–168 hours.`);
      return;
    }
    const prev = data;
    setData((d) => d ? { ...d, people: applyCapacity(d.people, d.weeks, name, weeklyHours) } : d);
    void setPersonCapacity(name, weeklyHours).catch((e) => {
      setData(prev); // roll back the optimistic change
      setCapErr(`Couldn't save capacity for ${name}: ${e instanceof MsApiError ? e.message : "try again"}.`);
    });
  };

  if (err) return <div style={{ ...card, color: T.status.critical, fontSize: 12.5 }}>{err}</div>;
  if (!data || !m) return <div style={{ ...card, color: T.inkMuted, fontSize: 12.5 }}>Loading team resourcing…</div>;

  const { weeks, people } = data;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* ---- Portfolio Summary (board-ready) ---------------------------------- */}
      <div className="team-load-report" style={{ ...card }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: navy }}>Team resourcing — next 12 weeks</div>
            <div style={{ fontSize: 11.5, color: T.inkMuted }}>Across every client · demand live from Kantata · week of {fmtWeek(weeks[0] ?? "")}</div>
          </div>
          <button type="button" className="btn-link no-print" style={{ fontSize: 11.5 }} onClick={() => window.print()}>🖨 Print / Save PDF</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 14 }}>
          <StatTile label="Team capacity / wk" value={`${Math.round(m.capacityTotal)}h`} detail={`${m.peopleCount} people`} />
          <StatTile label="Booked this week" value={`${Math.round(m.utilPct * 100)}%`} detail={`${Math.round(m.demandNow)}h of ${Math.round(m.capacityTotal)}h`} {...(m.utilPct > 1 ? { detailColor: T.status.critical } : {})} />
          <StatTile label="Over-allocated" value={`${m.overNow}`} detail="this week" detailColor={m.overNow > 0 ? T.status.critical : T.status.good} />
          <StatTile label="Available" value={`${m.freeNow.length}`} detail={`${Math.round(m.spareNow)}h spare this week`} detailColor={T.status.good} />
        </div>

        {/* Capacity vs demand, this week */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.inkMuted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>Capacity vs demand — this week</div>
          <CapacityDemandBar demand={m.demandNow} capacity={m.capacityTotal} />
        </div>

        {/* 12-week demand trend */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.inkMuted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>Demand by week vs capacity</div>
          <DemandTrend weeks={weeks} demandByWeek={m.demandByWeek} capacity={m.capacityTotal} />
        </div>
        {m.unsetCount > 0 && (
          <div style={{ fontSize: 11, color: T.inkMuted, marginTop: 10 }}>
            ⚠ {m.unsetCount} {m.unsetCount === 1 ? "person is" : "people are"} on the default {data.defaultCapacity}h/week — set their real capacity below for accurate totals.
          </div>
        )}
      </div>

      {/* ---- Who's free ------------------------------------------------------- */}
      {m.freeNow.length > 0 && (
        <div style={card}>
          <div style={{ fontSize: 13.5, fontWeight: 800, color: navy, marginBottom: 8 }}>Who's free this week</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {m.freeNow.slice(0, 12).map((p) => (
              <span key={p.name} style={{ fontSize: 12, background: "#e9f7ef", color: "#1f7a45", borderRadius: 999, padding: "4px 10px", fontWeight: 600 }}>
                {p.name} · {Math.round(p.capacity - p.thisWeek)}h spare
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ---- Per-person utilization ranking ---------------------------------- */}
      <div style={card}>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: navy, marginBottom: 8 }}>Workload by person — peak week</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {people.map((p) => {
            const ratio = p.capacity > 0 ? p.peak / p.capacity : (p.peak > 0 ? 1.5 : 0);
            return (
              <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
                <span style={{ width: 150, flexShrink: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: T.ink }}>
                  {p.name}{p.isDefaultCapacity ? <span title="capacity not set — using default" style={{ color: T.inkMuted }}> ·(default)</span> : null}
                </span>
                <span style={{ flex: 1, position: "relative", height: 14, background: "#f0efec", borderRadius: 4, overflow: "hidden" }}>
                  <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.min(100, ratio * 100)}%`, background: utilColor(ratio), borderRadius: 4 }} />
                  {/* capacity reference tick at 100% */}
                  <span style={{ position: "absolute", left: "100%", top: -1, bottom: -1, width: 0, borderLeft: `1px dashed ${T.inkMuted}` }} />
                </span>
                <span style={{ width: 96, flexShrink: 0, textAlign: "right", fontVariantNumeric: "tabular-nums", color: ratio > 1 ? T.status.critical : T.inkSecondary, fontWeight: ratio > 1 ? 700 : 400 }}>
                  {Math.round(ratio * 100)}%{p.overWeeks > 0 ? ` · ${p.overWeeks}w over` : ""}
                </span>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 10.5, color: T.inkMuted, marginTop: 8 }}>Bar = busiest week vs capacity. Dashed line = 100%. Sorted most-loaded first.</div>
      </div>

      {/* ---- Detailed heatmap ------------------------------------------------- */}
      <div style={{ ...card, padding: 0, overflowX: "auto" }}>
        <div style={{ padding: "12px 14px 6px", fontSize: 13.5, fontWeight: 800, color: navy }}>Week-by-week detail</div>
        {capErr && <div style={{ padding: "0 14px 8px", fontSize: 11.5, color: T.status.critical }}>{capErr}</div>}
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 11.5 }}>
          <thead>
            <tr>
              <th style={{ position: "sticky", left: 0, background: "#fff", zIndex: 2, textAlign: "left", padding: "8px 10px", borderBottom: `1px solid ${T.grid}`, minWidth: 170 }}>Person</th>
              <th style={{ position: "sticky", left: 170, background: "#fff", zIndex: 2, textAlign: "right", padding: "8px 6px", borderBottom: `1px solid ${T.grid}`, minWidth: 70 }}>Cap/wk</th>
              {weeks.map((w) => (
                <th key={w} style={{ textAlign: "center", padding: "8px 6px", borderBottom: `1px solid ${T.grid}`, color: T.inkMuted, fontWeight: 600, minWidth: 40 }}>{fmtWeek(w)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.name}>
                <td style={{ position: "sticky", left: 0, background: "#fff", zIndex: 1, padding: "6px 10px", borderBottom: `1px solid ${T.grid}`, whiteSpace: "nowrap" }}>
                  <span style={{ fontWeight: 600, color: T.ink }}>{p.name}</span>
                  {p.overWeeks > 0 && <span style={{ marginLeft: 6, fontSize: 10, color: T.status.critical, fontWeight: 700 }}>⚠ {p.overWeeks}w</span>}
                </td>
                <td style={{ position: "sticky", left: 170, background: "#fff", zIndex: 1, textAlign: "right", padding: "6px 6px", borderBottom: `1px solid ${T.grid}` }}>
                  {canManage ? (
                    <input
                      type="number" min={0} max={168} defaultValue={p.capacity}
                      onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v !== p.capacity) saveCapacity(p.name, v); }}
                      style={{ width: 52, fontSize: 11.5, padding: "2px 4px", borderRadius: 5, border: `1px solid ${p.isDefaultCapacity ? T.status.warning : T.grid}`, textAlign: "right" }}
                      title={p.isDefaultCapacity ? "default — not set for this person" : "this person's weekly capacity"}
                    />
                  ) : (
                    <span style={{ color: p.isDefaultCapacity ? T.status.warning : T.inkSecondary }}>{p.capacity}h{p.isDefaultCapacity ? "*" : ""}</span>
                  )}
                </td>
                {weeks.map((w) => {
                  const h = p.weekly[w] ?? 0;
                  const c = cellStyle(h, p.capacity);
                  return (
                    <td key={w} title={`${p.name} · week of ${fmtWeek(w)} · ${Math.round(h)}h of ${p.capacity}h`}
                        style={{ textAlign: "center", padding: "6px 4px", borderBottom: `1px solid ${T.grid}`, background: c.bg, color: c.fg, fontWeight: h > 0 ? 600 : 400, fontVariantNumeric: "tabular-nums" }}>
                      {h > 0 ? Math.round(h) : "·"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ padding: "8px 14px 12px", fontSize: 11, color: T.inkMuted, display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
          <span>Legend:</span>
          <span><Swatch bg={T.seq[2]!} />under capacity</span>
          <span><Swatch bg={T.status.warning} />near full (≥85%)</span>
          <span><Swatch bg={T.status.critical} />over capacity</span>
          <span><Swatch bg="#f4f6f9" />idle</span>
          <span>* default capacity (not set)</span>
        </div>
      </div>
    </div>
  );
}

function Swatch({ bg }: { bg: string }) {
  return <span style={{ display: "inline-block", width: 10, height: 10, background: bg, border: `1px solid ${T.grid}`, marginRight: 4, verticalAlign: "middle" }} />;
}

/** This-week capacity track with a demand fill; the segment past 100% is red. */
function CapacityDemandBar({ demand, capacity }: { demand: number; capacity: number }) {
  const cap = Math.max(capacity, 1);
  const within = Math.min(demand, cap);
  const overflow = Math.max(0, demand - cap);
  const total = Math.max(cap, demand);
  return (
    <div>
      <div style={{ display: "flex", height: 22, borderRadius: 5, overflow: "hidden", background: "#f0efec" }}>
        <div style={{ width: `${(within / total) * 100}%`, background: demand > cap ? T.status.warning : T.series1 }} />
        {overflow > 0 && <div style={{ width: `${(overflow / total) * 100}%`, background: T.status.critical, marginLeft: 2 }} />}
      </div>
      <div style={{ fontSize: 11, color: T.inkSecondary, marginTop: 4 }}>
        {Math.round(demand)}h booked of {Math.round(capacity)}h capacity
        {overflow > 0 ? <span style={{ color: T.status.critical, fontWeight: 700 }}> · {Math.round(overflow)}h over</span> : ` · ${Math.round(capacity - demand)}h to spare`}
      </div>
    </div>
  );
}

/** 12 vertical columns = total demand per week, with a dashed capacity line. */
function DemandTrend({ weeks, demandByWeek, capacity }: { weeks: string[]; demandByWeek: Record<string, number>; capacity: number }) {
  const max = Math.max(capacity, ...weeks.map((w) => demandByWeek[w] ?? 0), 1);
  const H = 90;
  const capY = H - (capacity / max) * H;
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "flex-end", gap: 4, height: H, borderBottom: `1px solid ${T.grid}` }}>
      {/* capacity reference line */}
      <div style={{ position: "absolute", left: 0, right: 0, top: capY, borderTop: `1px dashed ${T.inkMuted}`, pointerEvents: "none" }} />
      {weeks.map((w) => {
        const d = demandByWeek[w] ?? 0;
        const h = (d / max) * H;
        const isOver = d > capacity;
        return (
          <div key={w} title={`Week of ${fmtWeek(w)} · ${Math.round(d)}h vs ${Math.round(capacity)}h`} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", height: "100%" }}>
            <div style={{ width: "80%", height: Math.max(2, h), background: isOver ? T.status.critical : T.series1, borderRadius: "3px 3px 0 0" }} />
          </div>
        );
      })}
    </div>
  );
}

interface Derived {
  peopleCount: number;
  capacityTotal: number;
  demandNow: number;
  utilPct: number;
  overNow: number;
  freeNow: PersonLoad[];
  spareNow: number;
  unsetCount: number;
  demandByWeek: Record<string, number>;
}

function derive(data: TeamLoadData): Derived {
  const { people, weeks } = data;
  const capacityTotal = people.reduce((s, p) => s + p.capacity, 0);
  const demandNow = people.reduce((s, p) => s + p.thisWeek, 0);
  const overNow = people.filter((p) => over(p.thisWeek, p.capacity)).length;
  const freeNow = people
    .filter((p) => p.capacity - p.thisWeek > 0)
    .sort((a, b) => (b.capacity - b.thisWeek) - (a.capacity - a.thisWeek));
  const spareNow = freeNow.reduce((s, p) => s + (p.capacity - p.thisWeek), 0);
  const unsetCount = people.filter((p) => p.isDefaultCapacity).length;
  const demandByWeek: Record<string, number> = {};
  for (const w of weeks) demandByWeek[w] = people.reduce((s, p) => s + (p.weekly[w] ?? 0), 0);
  return {
    peopleCount: people.length,
    capacityTotal,
    demandNow,
    utilPct: capacityTotal > 0 ? demandNow / capacityTotal : 0,
    overNow,
    freeNow,
    spareNow,
    unsetCount,
    demandByWeek,
  };
}

/** Recompute a person's capacity-dependent fields after an inline capacity edit. */
function applyCapacity(people: PersonLoad[], weeks: string[], name: string, capacity: number): PersonLoad[] {
  return people.map((p) => {
    if (p.name !== name) return p;
    let overWeeks = 0;
    for (const w of weeks) { const h = p.weekly[w] ?? 0; if (over(h, capacity)) overWeeks += 1; }
    return { ...p, capacity, isDefaultCapacity: false, overWeeks };
  });
}
