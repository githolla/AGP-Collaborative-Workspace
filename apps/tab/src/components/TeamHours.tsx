import { T } from "../theme.js";
import type { Task } from "../workspace/types.js";
import { effectiveHours, primaryOwner } from "../workspace/taskAssignments.js";

/**
 * The team-and-hours editor for a task — Cara's card, in one reusable block so
 * it reads the same inline in a plan row and in the task drawer. Each person
 * carries their hour slice (even-split default, editable), a "make owner"
 * toggle, and a per-person DONE checkbox — so one person finishing doesn't
 * complete the task for everyone. Finance-free (hours + names only).
 */
export function TeamHoursEditor({
  task,
  onSetHours,
  onToggleDone,
  onSetPrimary,
}: {
  task: Task;
  onSetHours?: (taskId: string, name: string, hours: number | undefined) => void;
  onToggleDone?: (taskId: string, name: string, done: boolean) => void;
  onSetPrimary?: (taskId: string, name: string) => void;
}) {
  const assigns = task.assignments ?? [];
  if (assigns.length === 0) return null;
  const eff = effectiveHours(task);
  const primaryName = primaryOwner(task);
  return (
    <div>
      {assigns.map((as) => {
        const effH = eff.get(as.name) ?? 0;
        const isPrimary = primaryName === as.name;
        return (
          <div key={as.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderTop: `1px solid ${T.grid}` }}>
            <input
              type="checkbox"
              checked={as.done === true}
              disabled={!onToggleDone}
              onChange={(e) => onToggleDone?.(task.id, as.name, e.target.checked)}
              title={as.done ? "Mark this person's part not done" : "Mark this person's part done"}
              style={{ width: 15, height: 15, flexShrink: 0, cursor: onToggleDone ? "pointer" : "default" }}
            />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: T.ink, textDecoration: as.done ? "line-through" : "none" }}>{as.name}</span>
                {isPrimary ? (
                  <span title="Accountable owner" style={{ fontSize: 8.5, fontWeight: 800, color: T.roi.navy, background: "#eef2fb", borderRadius: 4, padding: "1px 5px", textTransform: "uppercase", letterSpacing: 0.4 }}>Owner</span>
                ) : onSetPrimary ? (
                  <button type="button" className="btn-link" style={{ fontSize: 10 }} onClick={() => onSetPrimary(task.id, as.name)} title="Make this person the accountable owner">make owner</button>
                ) : null}
                {as.role && <span style={{ fontSize: 10, color: T.inkMuted }}>· {as.role}</span>}
              </span>
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
              <input
                type="number"
                min={0}
                step={0.5}
                defaultValue={as.hours ?? ""}
                placeholder={String(effH)}
                disabled={!onSetHours}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  onSetHours?.(task.id, as.name, v === "" ? undefined : Number(v));
                }}
                title={as.hours == null ? `Even-split default: ${effH}h — type to override` : "This person's hours"}
                style={{ width: 50, textAlign: "right", fontSize: 12, padding: "3px 5px", border: `1px solid ${as.hours == null ? T.grid : T.roi.navy}`, borderRadius: 6, color: as.hours == null ? T.inkMuted : T.ink }}
              />
              <span style={{ fontSize: 10.5, color: T.inkMuted }}>h</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
