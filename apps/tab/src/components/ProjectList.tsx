import { T } from "../theme.js";
import { TagChip } from "./bits.js";
import { labelOf, type ProjectView } from "../data/model.js";

export function ProjectList({
  projects,
  selectedId,
  onSelect,
}: {
  projects: ProjectView[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <nav aria-label="Projects" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: T.inkMuted, textTransform: "uppercase" }}>
        Active engagements
      </div>
      {projects.map((p) => {
        const selected = p.id === selectedId;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelect(p.id)}
            style={{
              textAlign: "left",
              background: selected ? T.surface : "transparent",
              border: `1px solid ${selected ? T.series1 : "transparent"}`,
              borderRadius: 10,
              padding: "10px 12px",
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <span style={{ fontSize: 12.5, fontWeight: 600, color: T.ink, lineHeight: 1.3 }}>{p.client.name}</span>
            <span style={{ fontSize: 11.5, color: T.inkSecondary, lineHeight: 1.3 }}>
              {p.title.split("— ")[1] ?? p.title}
            </span>
            <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              <TagChip>{labelOf.vertical(p.client.vertical)}</TagChip>
              <TagChip>{labelOf.service(p.serviceLine)}</TagChip>
              <TagChip>{labelOf.model(p.model)}</TagChip>
            </span>
          </button>
        );
      })}
    </nav>
  );
}
