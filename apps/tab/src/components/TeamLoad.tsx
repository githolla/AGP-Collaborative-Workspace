import { useEffect, useState } from "react";
import { card, T } from "../theme.js";
import { fetchTeamLoad, setPersonCapacity, type TeamLoadData, type PersonLoad } from "../workspace/msAccountData.js";
import { MsApiError } from "../workspace/msApiFetch.js";

const navy = T.roi.navy;

function fmtWeek(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "numeric", day: "numeric", timeZone: "UTC" });
}

/** Utilization → cell colors. Mirrors the app's status palette: over = red,
 * near-full = amber, some = green, none = grey. */
function cellColors(hours: number, capacity: number): { bg: string; fg: string } {
  if (hours <= 0) return { bg: "#f1f3f7", fg: T.inkMuted };
  const ratio = capacity > 0 ? hours / capacity : 1;
  if (ratio > 1) return { bg: "#fde9e5", fg: "#b23824" };
  if (ratio >= 0.85) return { bg: "#fdf3e2", fg: "#9a6415" };
  return { bg: "#e7f6ee", fg: "#1f7a45" };
}

/**
 * Team Load — the cross-client resourcing view (Kellie/Cara). Every AGP person's
 * weekly hours across ALL clients, next 12 weeks, measured against their
 * capacity so over-allocation and idle time finally show. Demand is derived live
 * from Kantata task hours (RLS-scoped to what you can see); capacity is the one
 * new input — app admins set it inline. This answers what a per-client
 * Resourcing tab never could: "who's overloaded across everything, and who's free."
 */
export function TeamLoad({ canManage }: { canManage: boolean }) {
  const [data, setData] = useState<TeamLoadData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchTeamLoad()
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setErr(e instanceof MsApiError ? e.message : "couldn't load team resourcing"); });
    return () => { cancelled = true; };
  }, []);

  const saveCapacity = (name: string, weeklyHours: number) => {
    setData((prev) => prev ? { ...prev, people: recomputed(prev.people, prev.weeks, name, weeklyHours) } : prev);
    void setPersonCapacity(name, weeklyHours).catch(() => { /* best-effort; local view already updated */ });
  };

  if (err) return <div style={{ ...card, color: T.status.critical, fontSize: 12.5 }}>{err}</div>;
  if (!data) return <div style={{ ...card, color: T.inkMuted, fontSize: 12.5 }}>Loading team resourcing…</div>;

  const { weeks, people, defaultCapacity } = data;
  const firstWeek = weeks[0];
  const demandNow = firstWeek ? people.reduce((s, p) => s + (p.weekly[firstWeek] ?? 0), 0) : 0;
  const capacityNow = people.reduce((s, p) => s + p.capacity, 0);
  const overCount = people.filter((p) => p.overWeeks > 0).length;
  const idleCount = firstWeek ? people.filter((p) => (p.weekly[firstWeek] ?? 0) === 0).length : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ ...card, background: "#eef3f9", borderColor: navy }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: navy }}>Team Load — next 12 weeks, every client</div>
        <div style={{ fontSize: 12, color: T.inkSecondary, marginTop: 3, lineHeight: 1.5 }}>
          Weekly hours per person across all your clients vs. their capacity. This week:{" "}
          <b>{Math.round(demandNow)}h</b> booked of <b>{Math.round(capacityNow)}h</b> capacity
          {overCount > 0 ? <>, <span style={{ color: T.status.critical, fontWeight: 700 }}>{overCount} over-allocated</span></> : ""}
          {idleCount > 0 ? <>, {idleCount} idle</> : ""}. Hours come from Kantata; {canManage ? "set each person's capacity in the first column." : "capacity defaults to " + defaultCapacity + "h/week."}
        </div>
      </div>

      {people.length === 0 ? (
        <div style={{ ...card, textAlign: "center", padding: "26px 14px", color: T.inkMuted }}>
          <div style={{ fontSize: 22 }} aria-hidden>📊</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.inkSecondary, marginTop: 4 }}>No dated, hour-estimated tasks yet</div>
          <div style={{ fontSize: 11.5, marginTop: 2, lineHeight: 1.5 }}>
            Load shows once tasks in your workspaces have owners, due dates, and hours (set hours on the Resourcing tab).
          </div>
        </div>
      ) : (
        <div style={{ ...card, padding: 0, overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 11.5 }}>
            <thead>
              <tr>
                <th style={{ position: "sticky", left: 0, background: "#fff", zIndex: 2, textAlign: "left", padding: "8px 10px", borderBottom: `1px solid ${T.grid}`, minWidth: 170 }}>Person</th>
                <th style={{ position: "sticky", left: 170, background: "#fff", zIndex: 2, textAlign: "right", padding: "8px 6px", borderBottom: `1px solid ${T.grid}`, minWidth: 64 }}>Capacity</th>
                {weeks.map((w) => (
                  <th key={w} style={{ textAlign: "center", padding: "8px 6px", borderBottom: `1px solid ${T.grid}`, color: T.inkMuted, fontWeight: 600, minWidth: 44 }}>{fmtWeek(w)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.name}>
                  <td style={{ position: "sticky", left: 0, background: "#fff", zIndex: 1, padding: "6px 10px", borderBottom: `1px solid ${T.grid}`, whiteSpace: "nowrap" }}>
                    <span style={{ fontWeight: 600, color: T.ink }}>{p.name}</span>
                    {p.overWeeks > 0 && <span style={{ marginLeft: 6, fontSize: 10, color: T.status.critical, fontWeight: 700 }}>⚠ {p.overWeeks}w over</span>}
                  </td>
                  <td style={{ position: "sticky", left: 170, background: "#fff", zIndex: 1, textAlign: "right", padding: "6px 6px", borderBottom: `1px solid ${T.grid}` }}>
                    {canManage ? (
                      <input
                        type="number"
                        min={0}
                        max={168}
                        defaultValue={p.capacity}
                        onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v !== p.capacity) saveCapacity(p.name, v); }}
                        style={{ width: 48, fontSize: 11.5, padding: "2px 4px", borderRadius: 5, border: `1px solid ${T.grid}`, textAlign: "right" }}
                      />
                    ) : (
                      <span style={{ color: T.inkSecondary }}>{p.capacity}h</span>
                    )}
                  </td>
                  {weeks.map((w) => {
                    const h = p.weekly[w] ?? 0;
                    const c = cellColors(h, p.capacity);
                    return (
                      <td key={w} style={{ textAlign: "center", padding: "6px 4px", borderBottom: `1px solid ${T.grid}`, background: c.bg, color: c.fg, fontWeight: h > 0 ? 600 : 400, fontVariantNumeric: "tabular-nums" }}>
                        {h > 0 ? Math.round(h) : "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ fontSize: 11, color: T.inkMuted, display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
        <span>Legend:</span>
        <span><span style={{ display: "inline-block", width: 10, height: 10, background: "#e7f6ee", border: `1px solid ${T.grid}`, marginRight: 4, verticalAlign: "middle" }} />under capacity</span>
        <span><span style={{ display: "inline-block", width: 10, height: 10, background: "#fdf3e2", border: `1px solid ${T.grid}`, marginRight: 4, verticalAlign: "middle" }} />near full (≥85%)</span>
        <span><span style={{ display: "inline-block", width: 10, height: 10, background: "#fde9e5", border: `1px solid ${T.grid}`, marginRight: 4, verticalAlign: "middle" }} />over capacity</span>
        <span><span style={{ display: "inline-block", width: 10, height: 10, background: "#f1f3f7", border: `1px solid ${T.grid}`, marginRight: 4, verticalAlign: "middle" }} />idle</span>
      </div>
    </div>
  );
}

/** Recompute a person's over-weeks when their capacity changes (local, instant). */
function recomputed(people: PersonLoad[], weeks: string[], name: string, capacity: number): PersonLoad[] {
  return people.map((p) => {
    if (p.name !== name) return p;
    let overWeeks = 0;
    for (const w of weeks) { const h = p.weekly[w] ?? 0; if (capacity > 0 && h > capacity) overWeeks += 1; }
    return { ...p, capacity, overWeeks };
  });
}
