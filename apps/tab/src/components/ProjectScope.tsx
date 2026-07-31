import { useState } from "react";
import { T } from "../theme.js";
import { SectionTitle } from "./bits.js";

/**
 * Which Kantata projects this workspace covers.
 *
 * Cara, on the pilot: "the workspace would align to one client project… although
 * all of these projects align to the PATNC client, they may have completely
 * different project teams and comingling them is not ideal. There are instances
 * where it would make sense to combine into one workspace — but this would be
 * the exception not the rule."
 *
 * So: pick the work this space is for. Covering the whole client stays
 * available, because she named it as the exception rather than removing it.
 */

export interface ScopeProject {
  id: string;
  title: string;
  dueDate?: string;
}

export function ProjectScope({
  clientName,
  projects,
  selectedIds,
  scoped,
  onApply,
}: {
  clientName: string;
  /** Every live project under this client — the pool to choose from. */
  projects: ScopeProject[];
  selectedIds: readonly string[];
  scoped: boolean;
  onApply: (projectIds: string[], scoped: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set(selectedIds));

  const start = () => {
    setPicked(new Set(scoped ? selectedIds : projects.map((p) => p.id)));
    setOpen(true);
  };
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const inScope = scoped ? projects.filter((p) => selectedIds.includes(p.id)) : projects;

  if (!open) {
    return (
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", fontSize: 12, color: T.inkSecondary }}>
        <span style={{ fontWeight: 700, color: T.ink }}>This workspace covers:</span>
        {scoped ? (
          <span>
            {inScope.length} of {projects.length} {clientName} project{projects.length === 1 ? "" : "s"}
            {inScope.length > 0 && inScope.length <= 2 ? ` — ${inScope.map((p) => p.title).join(", ")}` : ""}
          </span>
        ) : (
          <span>
            every {clientName} project ({projects.length})
          </span>
        )}
        <button type="button" className="btn-link" style={{ fontSize: 12 }} onClick={start}>
          Change
        </button>
      </div>
    );
  }

  return (
    <div style={{ border: `1px solid ${T.grid}`, borderRadius: 10, padding: "12px 14px", background: "#fff" }}>
      <SectionTitle>Which work is this workspace for?</SectionTitle>
      <div style={{ fontSize: 12, color: T.inkSecondary, marginTop: 2, marginBottom: 10, lineHeight: 1.5 }}>
        Projects under one client often have different teams. Pick the ones this space is for — the plan,
        dashboard, people and tasks all follow your choice.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 260, overflowY: "auto" }}>
        {projects.length === 0 ? (
          <div style={{ fontSize: 12, color: T.inkMuted }}>No live Kantata projects matched {clientName} yet.</div>
        ) : (
          projects.map((p) => {
            const on = picked.has(p.id);
            return (
              <label
                key={p.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "6px 8px",
                  borderRadius: 7,
                  cursor: "pointer",
                  background: on ? "#eef4fb" : "transparent",
                }}
              >
                <input type="checkbox" checked={on} onChange={() => toggle(p.id)} />
                <span style={{ fontSize: 12.5, color: T.ink, flex: 1, minWidth: 0 }}>{p.title}</span>
                {p.dueDate && <span style={{ fontSize: 11, color: T.inkMuted, flexShrink: 0 }}>{p.dueDate}</span>}
              </label>
            );
          })
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          // Selecting everything is the same thing as covering the client —
          // storing it as a scope would silently freeze out future projects.
          disabled={picked.size === 0}
          onClick={() => {
            const all = picked.size === projects.length;
            onApply([...picked], !all);
            setOpen(false);
          }}
        >
          Apply
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-link"
          style={{ fontSize: 11.5 }}
          onClick={() => setPicked(new Set(projects.map((p) => p.id)))}
        >
          Select all ({projects.length})
        </button>
        {picked.size === 0 && (
          <span style={{ fontSize: 11.5, color: T.inkMuted }}>Pick at least one — an empty workspace helps nobody.</span>
        )}
      </div>
    </div>
  );
}
