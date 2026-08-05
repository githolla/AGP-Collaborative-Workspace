import { T } from "../theme.js";
import type { Task } from "../workspace/types.js";
import { currentHandoffStep, effectiveHours, handoffSequence, primaryOwner } from "../workspace/taskAssignments.js";

/**
 * The team-and-hours editor for a task — Cara's card, in one reusable block so
 * it reads the same inline in a plan row and in the task drawer.
 *
 * It carries the whole ownership story for a task:
 *  - the HANDOFF PATH: people shown in order (1 starts → passes down → last
 *    marks done), reorderable, with whose turn it is now called out;
 *  - the HOURS split (even-split default, editable) that feeds resourcing;
 *  - the PRIMARY owner; and
 *  - PER-PERSON done, so one person finishing doesn't close it for everyone.
 * Finance-free (hours + names only).
 */
export function TeamHoursEditor({
  task,
  onSetHours,
  onToggleDone,
  onSetPrimary,
  onSetOrder,
}: {
  task: Task;
  onSetHours?: (taskId: string, name: string, hours: number | undefined) => void;
  onToggleDone?: (taskId: string, name: string, done: boolean) => void;
  onSetPrimary?: (taskId: string, name: string) => void;
  onSetOrder?: (taskId: string, orderedNames: string[]) => void;
}) {
  const seq = handoffSequence(task);
  if (seq.length === 0) return null;
  const eff = effectiveHours(task);
  const primaryName = primaryOwner(task);
  const step = currentHandoffStep(task);
  const names = seq.map((a) => a.name);

  // Move a person one slot up/down in the handoff order.
  const move = (name: string, dir: -1 | 1) => {
    const i = names.indexOf(name);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= names.length) return;
    const next = [...names];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onSetOrder?.(task.id, next);
  };

  return (
    <div>
      {step && seq.length > 1 && (
        <div style={{ fontSize: 10.5, color: T.roi.navy, fontWeight: 700, margin: "0 0 4px" }}>
          ➜ Now with <b>{step.name}</b>{step.name === primaryName ? " (owner)" : ""}
        </div>
      )}
      {seq.map((as, i) => {
        const effH = eff.get(as.name) ?? 0;
        const isPrimary = primaryName === as.name;
        const isStep = step?.name === as.name;
        return (
          <div key={as.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderTop: `1px solid ${T.grid}`, background: isStep ? "#f2f7ff" : "transparent" }}>
            {onSetOrder && seq.length > 1 && (
              <span style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
                <button type="button" onClick={() => move(as.name, -1)} disabled={i === 0} title="Earlier in the handoff" style={{ background: "none", border: "none", cursor: i === 0 ? "default" : "pointer", fontSize: 8, lineHeight: 1, color: i === 0 ? T.grid : T.inkMuted, padding: 0 }}>▲</button>
                <button type="button" onClick={() => move(as.name, 1)} disabled={i === seq.length - 1} title="Later in the handoff" style={{ background: "none", border: "none", cursor: i === seq.length - 1 ? "default" : "pointer", fontSize: 8, lineHeight: 1, color: i === seq.length - 1 ? T.grid : T.inkMuted, padding: 0 }}>▼</button>
              </span>
            )}
            <span style={{ fontSize: 10, fontWeight: 700, color: T.inkMuted, width: 14, textAlign: "right", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{i + 1}</span>
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
                // Key on the stored value so a store round-trip (rounding to
                // 0.1, or a remote merge) re-seeds the field instead of drifting.
                key={`${as.name}:${as.hours ?? "auto"}`}
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
