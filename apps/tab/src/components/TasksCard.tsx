import { useState } from "react";
import { card, T } from "../theme.js";
import { SectionTitle, TagChip } from "./bits.js";
import type { Task, TaskStatus } from "../workspace/types.js";
import { AS_OF_TODAY } from "../workspace/format.js";

/**
 * Shared tasks (Collab Hub Must): owners, due dates, status; list + board
 * views with owner/status filters; quick-add. Plan-seeded tasks carry a phase
 * chip — the plan is the source, so AMs never maintain two lists.
 */

const STATUS_LABEL: Record<TaskStatus, string> = { todo: "To do", doing: "Doing", done: "Done" };
const NEXT_STATUS: Record<TaskStatus, TaskStatus> = { todo: "doing", doing: "done", done: "todo" };
const STATUS_COLOR: Record<TaskStatus, { bg: string; fg: string }> = {
  todo: { bg: "#f0efec", fg: T.inkSecondary },
  doing: { bg: "#e8f4fa", fg: "#16708f" },
  done: { bg: "#e3f4ec", fg: "#116a43" },
};

function StatusChip({ task, onAdvance }: { task: Task; onAdvance: () => void }) {
  const c = STATUS_COLOR[task.status];
  return (
    <button
      type="button"
      onClick={onAdvance}
      title={`Click to move to “${STATUS_LABEL[NEXT_STATUS[task.status]]}”`}
      style={{
        fontSize: 10.5,
        fontWeight: 700,
        color: c.fg,
        background: c.bg,
        border: "none",
        borderRadius: 5,
        padding: "3px 9px",
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {STATUS_LABEL[task.status]}
    </button>
  );
}

function DueBadge({ due, status }: { due?: string; status: TaskStatus }) {
  if (!due) return null;
  const overdue = status !== "done" && due < AS_OF_TODAY();
  return (
    <span style={{ fontSize: 10.5, color: overdue ? T.status.critical : T.inkMuted, fontVariantNumeric: "tabular-nums", fontWeight: overdue ? 700 : 400 }}>
      {overdue ? "⚠ " : ""}due {due.slice(5)}
    </span>
  );
}

export function TasksCard({
  tasks,
  owners,
  onAdd,
  onStatus,
  onToggleClientVisible,
}: {
  tasks: Task[];
  owners: string[];
  onAdd: (title: string, ownerName?: string, due?: string, label?: string) => void;
  onStatus: (taskId: string, status: TaskStatus) => void;
  /** Layer 0.3: present only on builds linked to a client account. */
  onToggleClientVisible?: (taskId: string) => void;
}) {
  const [view, setView] = useState<"list" | "board">("list");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | TaskStatus>("");
  const [labelFilter, setLabelFilter] = useState("");
  const [dueFilter, setDueFilter] = useState<"" | "overdue" | "week">("");
  const [newTitle, setNewTitle] = useState("");
  const [newOwner, setNewOwner] = useState("");
  const [newDue, setNewDue] = useState("");
  const [newLabel, setNewLabel] = useState("");

  const labels = [...new Set(tasks.map((t) => t.label).filter((l): l is string => !!l))];
  const today = AS_OF_TODAY();
  const weekOut = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

  const filtered = tasks.filter(
    (t) =>
      (!ownerFilter || t.ownerName === ownerFilter) &&
      (!statusFilter || t.status === statusFilter) &&
      (!labelFilter || t.label === labelFilter) &&
      (!dueFilter ||
        (dueFilter === "overdue" && !!t.due && t.due < today && t.status !== "done") ||
        (dueFilter === "week" && !!t.due && t.due >= today && t.due <= weekOut)),
  );
  const done = tasks.filter((t) => t.status === "done").length;

  const controls: React.CSSProperties = { fontSize: 11.5, padding: "5px 8px" };

  const taskLine = (t: Task, compact = false) => (
    <div
      key={t.id}
      style={{
        display: "flex",
        alignItems: compact ? "flex-start" : "center",
        flexDirection: compact ? "column" : "row",
        gap: compact ? 4 : 10,
        padding: compact ? "8px 10px" : "8px 2px",
        borderTop: compact ? "none" : `1px solid ${T.grid}`,
        background: compact ? T.surface : "transparent",
        border: compact ? `1px solid ${T.border}` : undefined,
        borderRadius: compact ? 8 : 0,
      }}
    >
      <span style={{ flex: 1, fontSize: 12, color: t.status === "done" ? T.inkMuted : T.ink, textDecoration: t.status === "done" ? "line-through" : "none", lineHeight: 1.4 }}>
        {t.title}
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        {t.ownerName && <span style={{ fontSize: 11, color: T.inkSecondary }}>{t.ownerName}</span>}
        {t.label && <TagChip>{t.label}</TagChip>}
        {t.phaseKey && <TagChip>{t.phaseKey}</TagChip>}
        {onToggleClientVisible && (
          <button
            type="button"
            onClick={() => onToggleClientVisible(t.id)}
            title={t.clientVisible ? "On the client-shared plan — click to make internal-only" : "Internal-only — click to share to the client plan"}
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: 999,
              cursor: "pointer",
              border: `1px solid ${t.clientVisible ? T.roi.confirmed : T.grid}`,
              background: t.clientVisible ? "#e3f4ec" : "transparent",
              color: t.clientVisible ? "#116a43" : T.inkMuted,
            }}
          >
            {t.clientVisible ? "client ✓" : "→ client"}
          </button>
        )}
        <DueBadge {...(t.due ? { due: t.due } : {})} status={t.status} />
        <StatusChip task={t} onAdvance={() => onStatus(t.id, NEXT_STATUS[t.status])} />
      </span>
    </div>
  );

  return (
    <div style={card}>
      <SectionTitle
        right={
          <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 11, color: T.inkMuted }}>
              {done}/{tasks.length} done
            </span>
            {(["list", "board"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`nav-pill${view === v ? " active" : ""}`}
                style={{ fontSize: 10.5, padding: "3px 10px" }}
              >
                {v === "list" ? "List" : "Board"}
              </button>
            ))}
          </span>
        }
      >
        Tasks
      </SectionTitle>

      {/* Filters only make sense once there are tasks to filter. */}
      {tasks.length > 0 && (
      <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)} className="select" style={controls}>
          <option value="">All owners</option>
          {owners.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "" | TaskStatus)} className="select" style={controls}>
          <option value="">All statuses</option>
          {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select value={dueFilter} onChange={(e) => setDueFilter(e.target.value as "" | "overdue" | "week")} className="select" style={controls}>
          <option value="">Any due date</option>
          <option value="overdue">Overdue</option>
          <option value="week">Due this week</option>
        </select>
        {labels.length > 0 && (
          <select value={labelFilter} onChange={(e) => setLabelFilter(e.target.value)} className="select" style={controls}>
            <option value="">All labels</option>
            {labels.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        )}
      </div>
      )}

      {view === "list" ? (
        <div>{filtered.map((t) => taskLine(t))}</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((status) => (
            <div key={status} style={{ background: "#f4f3ef", borderRadius: 8, padding: 8, display: "flex", flexDirection: "column", gap: 6, minHeight: 60 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: T.inkMuted, textTransform: "uppercase", letterSpacing: 0.5 }}>
                {STATUS_LABEL[status]} ({filtered.filter((t) => t.status === status).length})
              </div>
              {filtered.filter((t) => t.status === status).map((t) => taskLine(t, true))}
            </div>
          ))}
        </div>
      )}
      {tasks.length === 0 && (
        <div style={{ textAlign: "center", padding: "22px 12px", color: T.inkMuted }}>
          <div style={{ fontSize: 20 }} aria-hidden>☑</div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: T.inkSecondary, marginTop: 4 }}>No tasks yet</div>
          <div style={{ fontSize: 11.5, marginTop: 2, lineHeight: 1.5 }}>
            Add the first one below — or promote an idea from the Sandbox and its plan arrives here as tasks.
          </div>
        </div>
      )}
      {tasks.length > 0 && filtered.length === 0 && (
        <div style={{ fontSize: 12, color: T.inkMuted, padding: "8px 0", display: "flex", alignItems: "center", gap: 8 }}>
          No tasks match these filters.
          <button
            type="button"
            className="btn-link"
            style={{ fontSize: 11.5 }}
            onClick={() => {
              setOwnerFilter("");
              setStatusFilter("");
              setLabelFilter("");
              setDueFilter("");
            }}
          >
            Clear filters
          </button>
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="Add a task…"
          style={{ ...controls, flex: 2, minWidth: 160 }}
        />
        <select value={newOwner} onChange={(e) => setNewOwner(e.target.value)} className="select" style={controls}>
          <option value="">Owner…</option>
          {owners.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <input type="date" value={newDue} onChange={(e) => setNewDue(e.target.value)} className="input" style={controls} />
        <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Label" style={{ ...controls, width: 90 }} />
        <button
          type="button"
          disabled={!newTitle.trim()}
          onClick={() => {
            onAdd(newTitle.trim(), newOwner || undefined, newDue || undefined, newLabel.trim() || undefined);
            setNewTitle("");
            setNewOwner("");
            setNewDue("");
            setNewLabel("");
          }}
          className="btn btn-primary btn-sm"
        >
          Add
        </button>
      </div>
    </div>
  );
}
