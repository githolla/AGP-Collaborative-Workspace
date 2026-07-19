import { card, T } from "../theme.js";
import { ProvenanceChip, SectionTitle, StatusBadge } from "./bits.js";
import { personName, weeks, type ProjectView } from "../data/model.js";

const WEEK_CAPACITY_MINUTES = 2400; // 40h

function heat(fraction: number): string {
  if (fraction <= 0) return "transparent";
  const idx = Math.min(T.seq.length - 1, Math.floor(fraction * T.seq.length));
  return T.seq[idx]!;
}

/**
 * Resource planner (SPEC 1b): weekly peaks-and-valleys grid. Heat shading is a
 * sequential single-hue ramp (magnitude); every cell carries its number, so
 * color never works alone. Over-capacity across ALL projects is flagged with
 * icon + label — a person is never silently over-assigned (Layer 4 rule).
 */
export function ResourcePlanner({ project, allProjects }: { project: ProjectView; allProjects: ProjectView[] }) {
  const team = [...new Set(project.allocations.map((a) => a.userId))];

  const minutesFor = (userId: string, week: string, scope: ProjectView[]) =>
    scope
      .flatMap((p) => p.allocations)
      .filter((a) => a.userId === userId && a.week === week)
      .reduce((sum, a) => sum + a.minutes, 0);

  const cellStyle: React.CSSProperties = {
    textAlign: "center",
    padding: "8px 4px",
    fontSize: 12,
    fontVariantNumeric: "tabular-nums",
    borderTop: `1px solid ${T.grid}`,
    minWidth: 58,
  };

  return (
    <div style={card}>
      <SectionTitle right={<ProvenanceChip source={`${project.allocations.length} allocations · Kantata (fixture)`} />}>
        Resource planner — weekly hours
      </SectionTitle>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={{ ...cellStyle, textAlign: "left", borderTop: "none", fontWeight: 600, color: T.inkMuted }}>
                Person
              </th>
              {weeks.map((w) => (
                <th key={w} style={{ ...cellStyle, borderTop: "none", fontWeight: 600, color: T.inkMuted }}>
                  {w.slice(5)}
                </th>
              ))}
              <th style={{ ...cellStyle, borderTop: "none", fontWeight: 600, color: T.inkMuted }}>Load</th>
            </tr>
          </thead>
          <tbody>
            {team.map((userId) => {
              const worstTotal = Math.max(...weeks.map((w) => minutesFor(userId, w, allProjects)));
              const overloaded = worstTotal > WEEK_CAPACITY_MINUTES;
              return (
                <tr key={userId}>
                  <td style={{ ...cellStyle, textAlign: "left", fontSize: 12.5, color: T.ink, whiteSpace: "nowrap" }}>
                    {personName(userId)}
                  </td>
                  {weeks.map((w) => {
                    const mins = minutesFor(userId, w, [project]);
                    const total = minutesFor(userId, w, allProjects);
                    const frac = mins / WEEK_CAPACITY_MINUTES;
                    return (
                      <td
                        key={w}
                        title={`${personName(userId)}, week of ${w}: ${(mins / 60).toFixed(1)}h on this project, ${(total / 60).toFixed(1)}h across all projects`}
                        style={{
                          ...cellStyle,
                          background: heat(frac),
                          color: frac > 0.55 ? "#fff" : T.ink,
                          border: `2px solid ${T.surface}`,
                          borderRadius: 4,
                        }}
                      >
                        {mins === 0 ? "—" : (mins / 60).toFixed(0)}
                      </td>
                    );
                  })}
                  <td style={cellStyle}>
                    {overloaded ? (
                      <StatusBadge severity="critical" label="Over" />
                    ) : worstTotal > WEEK_CAPACITY_MINUTES * 0.85 ? (
                      <StatusBadge severity="warning" label="High" />
                    ) : (
                      <StatusBadge severity="good" label="OK" />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 10, fontSize: 11, color: T.inkMuted }}>
        Cells show hours on this engagement; “Load” checks the person’s worst week across all
        engagements against 40h capacity. Draft what-if edits write to Kantata only on approve (M2
        write-back lands next).
      </div>
    </div>
  );
}
