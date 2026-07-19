import { T } from "../theme.js";
import { StatusBadge, TagChip } from "./bits.js";
import { daysUntil, type Milestone } from "../data/model.js";

function stateMeta(m: Milestone): { severity: "good" | "warning" | "serious" | "info"; label: string } {
  if (m.state === "completed") return { severity: "good", label: "Done" };
  const days = daysUntil(m.due);
  if (m.hard && days <= 90) return { severity: "serious", label: `${days}d — immovable` };
  if (days <= 21) return { severity: "warning", label: `${days}d` };
  return { severity: "info", label: `${days}d` };
}

export function Milestones({ milestones }: { milestones: Milestone[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {milestones.map((m, i) => (
        <div
          key={m.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "9px 2px",
            borderTop: i === 0 ? "none" : `1px solid ${T.grid}`,
          }}
        >
          <span style={{ fontSize: 11, color: T.inkMuted, fontVariantNumeric: "tabular-nums", width: 74 }}>{m.due}</span>
          <span
            style={{
              flex: 1,
              fontSize: 12.5,
              color: m.state === "completed" ? T.inkMuted : T.ink,
              textDecoration: m.state === "completed" ? "line-through" : "none",
              lineHeight: 1.3,
            }}
          >
            {m.title}
          </span>
          {m.hard && <TagChip>HARD DATE</TagChip>}
          <StatusBadge severity={stateMeta(m).severity} label={stateMeta(m).label} />
        </div>
      ))}
    </div>
  );
}
