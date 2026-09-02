import { Fragment, useEffect, useState } from "react";
import { card, T } from "../theme.js";
import { SectionTitle, TagChip } from "./bits.js";
import type { Task, TaskStatus } from "../workspace/types.js";
import { AS_OF_TODAY } from "../workspace/format.js";
import { TeamHoursEditor } from "./TeamHours.js";
import { blockingDeps } from "../workspace/taskAssignments.js";

/** "2026-04-13" → "Apr 13" (UTC, no weekday) for compact due labels. */
function shortDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
/** Whole days from `today` to `iso` (positive = future, negative = past). */
function daysUntil(iso: string, today: string): number {
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

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
  const today = AS_OF_TODAY();
  const overdue = status !== "done" && due < today;
  // Say HOW overdue, not a bare past date — so "due 04-13" on Jul 22 reads as
  // a stale carryover ("3 mo overdue"), not a deadline that makes no sense.
  let text: string;
  if (overdue) {
    const late = -daysUntil(due, today); // whole days past due
    text =
      late >= 60 ? `${Math.round(late / 30)} mo overdue`
      : late >= 14 ? `${Math.round(late / 7)} wk overdue`
      : late <= 1 ? "1 day overdue"
      : `${late} days overdue`;
  } else if (due === today) {
    text = "due today";
  } else {
    text = `due ${shortDay(due)}`;
  }
  return (
    <span title={`Due ${shortDay(due)}, ${due.slice(0, 4)}`} style={{ fontSize: 10.5, color: overdue ? T.status.critical : T.inkMuted, fontVariantNumeric: "tabular-nums", fontWeight: overdue ? 700 : 400, whiteSpace: "nowrap" }}>
      {overdue ? "⚠ " : ""}{text}
    </span>
  );
}

export function TasksCard({
  tasks,
  owners,
  onAdd,
  onStatus,
  onToggleClientVisible,
  onToggleContractorVisible,
  onOpenTask,
  onDiscuss,
  onSetTaskAssignments,
  onSetAssignmentHours,
  onToggleAssignmentDone,
  onSetAssignmentPrimary,
  onSetAssignmentOrder,
  focusTaskId,
}: {
  tasks: Task[];
  owners: string[];
  onAdd: (title: string, ownerName?: string, due?: string, label?: string) => void;
  onStatus: (taskId: string, status: TaskStatus) => void;
  /** Layer 0.3: present only on builds linked to a client account. */
  onToggleClientVisible?: (taskId: string) => void;
  /** Share a task onto the contractor's scoped plan (spec 5.3/5.5). */
  onToggleContractorVisible?: (taskId: string) => void;
  /** Click the task title to see everything about it (detail drawer). */
  onOpenTask?: (task: Task) => void;
  /** Start a discussion scoped to a project or task — Kellie's "route the
   * project-plan line straight to Discussions", context already set. */
  onDiscuss?: (topic: string) => void;
  /** Seed the persisted team (idempotent) when the inline panel first opens. */
  onSetTaskAssignments?: (taskId: string, names: string[]) => void;
  /** Per-person hour/owner/done edits — power the inline team panel in a row. */
  onSetAssignmentHours?: (taskId: string, name: string, hours: number | undefined) => void;
  onToggleAssignmentDone?: (taskId: string, name: string, done: boolean) => void;
  onSetAssignmentPrimary?: (taskId: string, name: string) => void;
  /** Reorder the handoff sequence for a task's team. */
  onSetAssignmentOrder?: (taskId: string, orderedNames: string[]) => void;
  /**
   * Deep-link target: scroll to this task and flash it. Hours entry itself
   * lives on the Resourcing tab now; this stays as a plan-side landing fallback.
   */
  focusTaskId?: string;
}) {
  const [view, setView] = useState<"list" | "board">("list");
  const [flashId, setFlashId] = useState<string | null>(null);
  // Which task's team panel is expanded inline in the row (Josh: put the team
  // in the row itself, not a clunky hover). One at a time.
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);
  // Land a deep link on the exact task: scroll it into view, flash it so the
  // eye catches it, and focus its hours field so the person can adjust
  // immediately. Keyed on task count so it fires once the plan has loaded.
  useEffect(() => {
    if (!focusTaskId) return;
    const el = document.getElementById(`taskrow-${focusTaskId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlashId(focusTaskId);
    const input = el.querySelector<HTMLInputElement>('input[data-hours="1"]');
    if (input) {
      input.focus();
      input.select();
    }
    const timer = setTimeout(() => setFlashId(null), 2800);
    return () => clearTimeout(timer);
  }, [focusTaskId, tasks.length]);
  const [ownerFilter, setOwnerFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | TaskStatus>("");
  const [labelFilter, setLabelFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [dueFilter, setDueFilter] = useState<"" | "overdue" | "week">("");
  const [newTitle, setNewTitle] = useState("");
  const [newOwner, setNewOwner] = useState("");
  const [newDue, setNewDue] = useState("");
  const [newLabel, setNewLabel] = useState("");
  // Collapsed project sections — Kellie asked to fold away the phases/time-
  // tracking tasks nobody converses at, so the eye lands on what matters.
  // DEFAULT COLLAPSED (Josh): the plan opens compact — a list of projects —
  // and the PM expands the one they're working in.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [userToggled, setUserToggled] = useState(false);
  const toggleGroup = (key: string) => {
    setUserToggled(true);
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const labels = [...new Set(tasks.map((t) => t.label).filter((l): l is string => !!l))];
  // The real projects (Kantata milestones) present in this list. At AGP one
  // workspace is a fiscal-year contract, so a plan routinely spans 10+ of
  // these — grouping by them is what makes the list legible (Kellie's ask).
  const projects = [...new Set(tasks.map((t) => t.projectLabel).filter((p): p is string => !!p))].sort();
  const today = AS_OF_TODAY();
  const weekOut = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

  const filtered = tasks.filter(
    (t) =>
      (!ownerFilter || t.ownerName === ownerFilter) &&
      (!statusFilter || t.status === statusFilter) &&
      (!labelFilter || t.label === labelFilter) &&
      (!projectFilter || t.projectLabel === projectFilter) &&
      (!dueFilter ||
        (dueFilter === "overdue" && !!t.due && t.due < today && t.status !== "done") ||
        (dueFilter === "week" && !!t.due && t.due >= today && t.due <= weekOut)),
  );
  const done = tasks.filter((t) => t.status === "done").length;
  const overdueCount = tasks.filter((t) => t.status !== "done" && !!t.due && t.due < today).length;

  // Read top-to-bottom in the order a person cares about: what's past due
  // first (most overdue first), then what's coming up by date, then undated,
  // then done at the bottom. Import order is meaningless; this isn't.
  const rank = (t: Task): number => {
    if (t.status === "done") return 3;
    if (t.due && t.due < today) return 0; // overdue, needs attention
    if (t.due) return 1; // scheduled ahead
    return 2; // no date
  };
  const ordered = [...filtered].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (a.due && b.due) return a.due.localeCompare(b.due); // oldest/soonest first
    if (a.due) return -1;
    if (b.due) return 1;
    return 0;
  });

  // Group when there's more than one project and the person hasn't already
  // narrowed to one. A single-project plan reads fine as a flat list.
  const groupByProject = view === "list" && projects.length > 1 && !projectFilter;
  const projectGroups = (() => {
    if (!groupByProject) return [];
    const groups = new Map<string, { key: string; label: string; tasks: Task[] }>();
    for (const t of ordered) {
      const key = t.projectLabel ?? "\u{10FFFF}"; // undated project sorts last
      if (!groups.has(key)) groups.set(key, { key, label: t.projectLabel ?? "No project", tasks: [] });
      groups.get(key)!.tasks.push(t);
    }
    return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
  })();

  // Open collapsed: until the PM expands something, every project section is
  // folded, so the plan reads as a short list of projects. Re-seeds if the set
  // of projects changes, but never fights a manual expand/collapse.
  const groupKeys = projectGroups.map((g) => g.key).join("§");
  useEffect(() => {
    if (userToggled || !groupByProject) return;
    setCollapsedGroups(new Set(groupKeys ? groupKeys.split("§") : []));
  }, [groupKeys, userToggled, groupByProject]);

  const controls: React.CSSProperties = { fontSize: 11.5, padding: "5px 8px" };

  // Shared column template so the header and every row line up vertically —
  // the difference between a real SaaS table and scattered text. Task flexes;
  // Team / Due / Status hold fixed widths; Contractor / Client are optional
  // trailing share-toggle icons.
  const showContractorCol = !!onToggleContractorVisible;
  const showClientCol = !!onToggleClientVisible;
  const listCols = ["minmax(0,1fr)", "184px", "96px", "96px", showContractorCol ? "64px" : null, showClientCol ? "52px" : null]
    .filter(Boolean)
    .join(" ");

  const taskById = new Map(tasks.map((t) => [t.id, t]));

  // The team / owner control — one accountable lead, "+N" for the rest, a
  // per-person done count. Click expands the hours panel inline. Shared by the
  // list rows and (static) board cards.
  const teamControl = (t: Task, interactive: boolean) => {
    const isOpen = expandedTeamId === t.id;
    if (t.assignments && t.assignments.length > 0) {
      const owner = t.assignments.find((x) => x.primary) ?? t.assignments[0]!;
      const others = t.assignments.length - 1;
      const doneN = t.assignments.filter((x) => x.done).length;
      const allDone = doneN === t.assignments.length;
      const summary = (
        <>
          <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{owner.name}{others > 0 ? ` +${others}` : ""}</span>
          <span style={{ color: allDone ? "#116a43" : T.inkMuted, flexShrink: 0 }}> · {doneN}/{t.assignments.length}</span>
        </>
      );
      if (!interactive) return <span style={{ display: "inline-flex", minWidth: 0, fontSize: 11.5, color: T.inkSecondary }}>{summary}</span>;
      return (
        <button
          type="button"
          onClick={() => {
            const next = isOpen ? null : t.id;
            if (next && t.assignments?.length) onSetTaskAssignments?.(t.id, t.assignments.map((x) => x.name));
            setExpandedTeamId(next);
          }}
          title={isOpen ? "Hide the team" : "Show the team & hours"}
          style={{ display: "inline-flex", alignItems: "center", gap: 5, maxWidth: "100%", minWidth: 0, background: isOpen ? "#eef2fb" : "none", border: isOpen ? `1px solid ${T.grid}` : "1px solid transparent", borderRadius: 6, padding: "3px 7px", cursor: "pointer", fontSize: 11.5, color: T.inkSecondary }}
        >
          <span aria-hidden style={{ fontSize: 8, color: T.inkMuted, flexShrink: 0, transform: isOpen ? "none" : "rotate(-90deg)", transition: "transform 120ms" }}>▼</span>
          {summary}
        </button>
      );
    }
    if (t.ownerName && interactive && onSetTaskAssignments) {
      return (
        <button
          type="button"
          onClick={() => {
            const next = isOpen ? null : t.id;
            if (next && t.ownerName) onSetTaskAssignments?.(t.id, [t.ownerName]);
            setExpandedTeamId(next);
          }}
          title={isOpen ? "Hide" : "Set hours, mark done, or split across a team"}
          style={{ display: "inline-flex", alignItems: "center", gap: 5, maxWidth: "100%", minWidth: 0, background: isOpen ? "#eef2fb" : "none", border: isOpen ? `1px solid ${T.grid}` : "1px solid transparent", borderRadius: 6, padding: "3px 7px", cursor: "pointer", fontSize: 11.5, color: T.inkSecondary }}
        >
          <span aria-hidden style={{ fontSize: 8, color: T.inkMuted, flexShrink: 0, transform: isOpen ? "none" : "rotate(-90deg)", transition: "transform 120ms" }}>▼</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.ownerName}</span>
        </button>
      );
    }
    if (t.ownerName) return <span style={{ fontSize: 11.5, color: T.inkSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.ownerName}</span>;
    return <span style={{ fontSize: 11.5, color: T.inkMuted }}>—</span>;
  };

  const clientToggle = (t: Task) =>
    onToggleClientVisible ? (
      <button
        type="button"
        onClick={() => onToggleClientVisible(t.id)}
        title={t.clientVisible ? "On the client-shared plan — click to make internal-only" : "Internal-only — click to share to the client plan"}
        style={{ width: 26, height: 22, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 700, border: `1px solid ${t.clientVisible ? T.roi.confirmed : T.grid}`, background: t.clientVisible ? "#e3f4ec" : "transparent", color: t.clientVisible ? "#116a43" : T.inkMuted }}
      >
        {t.clientVisible ? "✓" : "→"}
      </button>
    ) : null;

  // Contractor share — a separate axis from client (spec 5.3/5.5). Distinct
  // cyan accent so the two toggles never read as the same thing.
  const contractorToggle = (t: Task) =>
    onToggleContractorVisible ? (
      <button
        type="button"
        onClick={() => onToggleContractorVisible(t.id)}
        title={t.contractorVisible ? "On the contractor plan — click to make internal-only" : "Internal-only — click to share to the contractor plan"}
        style={{ width: 26, height: 22, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 700, border: `1px solid ${t.contractorVisible ? "#16708f" : T.grid}`, background: t.contractorVisible ? "#e6f3f8" : "transparent", color: t.contractorVisible ? "#0f5a74" : T.inkMuted }}
      >
        {t.contractorVisible ? "✓" : "→"}
      </button>
    ) : null;

  const taskLine = (t: Task, compact = false, showProject = false, indent = false) => {
    const teamOpen = !compact && expandedTeamId === t.id;
    const blockers = t.status !== "done" ? blockingDeps(t, (id) => taskById.get(id)) : [];
    const realLabel = t.label && t.label !== "from Kantata" ? t.label : null;
    const flash = flashId === t.id;

    // ── Board card: a compact stacked tile (no columns to align) ──
    if (compact) {
      return (
        <div
          key={t.id}
          id={`taskrow-${t.id}`}
          style={{ display: "flex", flexDirection: "column", gap: 5, padding: "9px 11px", background: flash ? "#fff7d6" : T.surface, border: `1px solid ${flash ? T.roi.cyan : T.border}`, borderRadius: 8, transition: "background 400ms ease" }}
        >
          {onOpenTask ? (
            <button type="button" onClick={() => onOpenTask(t)} title="See everything about this task" className="table-row-hover" style={{ textAlign: "left", background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12, color: t.status === "done" ? T.inkMuted : T.ink, textDecoration: t.status === "done" ? "line-through" : "none", lineHeight: 1.4 }}>{t.title}</button>
          ) : (
            <span style={{ fontSize: 12, color: t.status === "done" ? T.inkMuted : T.ink, textDecoration: t.status === "done" ? "line-through" : "none", lineHeight: 1.4 }}>{t.title}</span>
          )}
          {showProject && t.projectLabel && (
            <span title={`Project: ${t.projectLabel}`} style={{ fontSize: 9.5, fontWeight: 700, color: T.roi.navy, background: "#eef2fb", borderRadius: 4, padding: "1px 6px", alignSelf: "flex-start", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.projectLabel}</span>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {teamControl(t, false)}
            <span style={{ marginLeft: "auto" }}><DueBadge {...(t.due ? { due: t.due } : {})} status={t.status} /></span>
          </div>
        </div>
      );
    }

    // ── List row: a real table row on the shared column grid ──
    return (
    <Fragment key={t.id}>
    <div
      id={`taskrow-${t.id}`}
      className="table-row-hover"
      style={{
        display: "grid",
        gridTemplateColumns: listCols,
        alignItems: "center",
        columnGap: 12,
        padding: "9px 8px",
        borderTop: `1px solid ${T.grid}`,
        // Deep-link flash: soft highlight + inset ring (no border, so the grid
        // never shifts) to land the eye on the exact task.
        background: flash ? "#fff7d6" : "transparent",
        boxShadow: flash ? `inset 0 0 0 1px ${T.roi.cyan}` : undefined,
        borderRadius: flash ? 8 : 0,
        transition: "background 400ms ease",
      }}
    >
      {/* Task */}
      <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 8, paddingLeft: indent ? 14 : 0 }}>
        {onOpenTask ? (
          <button
            type="button"
            onClick={() => onOpenTask(t)}
            title={t.title}
            style={{ minWidth: 0, textAlign: "left", background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12.5, color: t.status === "done" ? T.inkMuted : T.ink, textDecoration: t.status === "done" ? "line-through" : "none", lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {t.title}
          </button>
        ) : (
          <span style={{ minWidth: 0, fontSize: 12.5, color: t.status === "done" ? T.inkMuted : T.ink, textDecoration: t.status === "done" ? "line-through" : "none", lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
        )}
        {showProject && t.projectLabel && (
          <span title={`Project: ${t.projectLabel}`} style={{ flexShrink: 0, fontSize: 9.5, fontWeight: 700, color: T.roi.navy, background: "#eef2fb", borderRadius: 4, padding: "1px 6px", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.projectLabel}</span>
        )}
        {realLabel && <span style={{ flexShrink: 0 }}><TagChip>{realLabel}</TagChip></span>}
        {blockers.length > 0 && (
          <span title={`Waiting on: ${blockers.map((b) => b.title).join(", ")}`} style={{ flexShrink: 0, fontSize: 9.5, fontWeight: 700, color: "#8a5a00", background: "#fdf2d8", border: "1px solid #f0d68a", borderRadius: 4, padding: "1px 6px", whiteSpace: "nowrap" }}>⛓ {blockers.length}</span>
        )}
      </div>
      {/* Team */}
      <div style={{ minWidth: 0, display: "flex", alignItems: "center" }}>{teamControl(t, true)}</div>
      {/* Due */}
      <div style={{ textAlign: "right" }}><DueBadge {...(t.due ? { due: t.due } : {})} status={t.status} /></div>
      {/* Status */}
      <div style={{ display: "flex", justifyContent: "flex-start" }}><StatusChip task={t} onAdvance={() => onStatus(t.id, NEXT_STATUS[t.status])} /></div>
      {/* Contractor (optional) */}
      {showContractorCol && <div style={{ display: "flex", justifyContent: "center" }}>{contractorToggle(t)}</div>}
      {/* Client (optional) */}
      {showClientCol && <div style={{ display: "flex", justifyContent: "center" }}>{clientToggle(t)}</div>}
    </div>
    {teamOpen && (
      <div style={{ padding: "6px 10px 10px 24px", background: "#f7f9fd", borderBottom: `1px solid ${T.grid}` }}>
        {/* Status, right here — move the task without leaving the plan. */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: T.inkMuted, textTransform: "uppercase", letterSpacing: 0.4 }}>Status</span>
          {(["todo", "doing", "done"] as TaskStatus[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onStatus(t.id, s)}
              className={t.status === s ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm"}
              style={{ fontSize: 10.5, padding: "3px 10px" }}
            >
              {STATUS_LABEL[s]}
            </button>
          ))}
          {onOpenTask && (
            <button type="button" className="btn-link" style={{ fontSize: 10.5, marginLeft: "auto" }} onClick={() => onOpenTask(t)} title="Open the full task card — handoffs, dependencies, discussion">Full card ↗</button>
          )}
        </div>
        <div style={{ fontSize: 10, color: T.inkMuted, margin: "2px 0 3px", lineHeight: 1.5 }}>
          Order the handoff (▲▼), split the hours (blank = even split), tag the owner; each person checks off their own part.
        </div>
        <TeamHoursEditor
          task={t}
          {...(onSetAssignmentHours ? { onSetHours: onSetAssignmentHours } : {})}
          {...(onToggleAssignmentDone ? { onToggleDone: onToggleAssignmentDone } : {})}
          {...(onSetAssignmentPrimary ? { onSetPrimary: onSetAssignmentPrimary } : {})}
          {...(onSetAssignmentOrder ? { onSetOrder: onSetAssignmentOrder } : {})}
        />
      </div>
    )}
    </Fragment>
    );
  };

  // Within a project section, nest tasks under their PHASE (nested milestone)
  // so the plan reads project → phase → task, not a flat list (Kellie). Tasks
  // with no phase render directly under the project. Phase order follows the
  // first task's position (already date-sorted upstream).
  const renderGroupTasks = (groupTasks: Task[]) => {
    // Full nested path (project child down to the nearest phase), so a job nested
    // deeper than one phase shows every level (Kellie: "as far nested as they go").
    // Falls back to the single phaseLabel when only the nearest phase is known.
    const pathOf = (t: Task): string[] =>
      t.phasePath && t.phasePath.length > 0 ? t.phasePath : t.phaseLabel ? [t.phaseLabel] : [];
    const phases: { path: string[]; key: string; tasks: Task[] }[] = [];
    const idx = new Map<string, number>();
    for (const t of groupTasks) {
      const path = pathOf(t);
      const key = path.length > 0 ? path.join(" › ") : " ";
      if (!idx.has(key)) { idx.set(key, phases.length); phases.push({ path, key, tasks: [] }); }
      phases[idx.get(key)!]!.tasks.push(t);
    }
    // No real phases (everything sits straight under the job) → flat list.
    if (phases.length === 1 && phases[0]!.path.length === 0) return groupTasks.map((t) => taskLine(t));
    // Phase rows stay on the SAME column grid as everything else — the phase
    // shows as a slim sub-header and its tasks carry a small title indent, so
    // Team/Due/Status never drift out of alignment.
    return phases.map((ph) => (
      <div key={ph.key || "__none"}>
        {ph.path.length > 0 && (
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, margin: "8px 0 0", padding: "4px 0 4px 8px", borderLeft: `3px solid ${T.roi.cyan}` }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: T.inkSecondary, textTransform: "uppercase", letterSpacing: 0.3 }}>{ph.path.join(" › ")}</span>
            <span style={{ fontSize: 10, color: T.inkMuted }}>{ph.tasks.filter((t) => t.status !== "done").length} open</span>
          </div>
        )}
        {ph.tasks.map((t) => taskLine(t, false, false, ph.path.length > 0))}
      </div>
    ));
  };

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
        {projects.length > 1 && (
          <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className="select" style={controls} title="Filter to one project (Kantata milestone)">
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        )}
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

      {/* Column header — anchors the shared grid so every row reads as a table. */}
      {view === "list" && filtered.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: listCols, columnGap: 12, alignItems: "center", padding: "0 8px 6px", borderBottom: `1px solid ${T.grid}` }}>
          {(() => {
            const h: React.CSSProperties = { fontSize: 9.5, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: T.inkMuted };
            return (
              <>
                <span style={h}>Task</span>
                <span style={h}>Team</span>
                <span style={{ ...h, textAlign: "right" }}>Due</span>
                <span style={h}>Status</span>
                {showContractorCol && <span style={{ ...h, textAlign: "center" }}>Contractor</span>}
                {showClientCol && <span style={{ ...h, textAlign: "center" }}>Client</span>}
              </>
            );
          })()}
        </div>
      )}

      {view === "list" ? (
        groupByProject ? (
          // Grouped by project (Kantata milestone): a fiscal-year contract runs
          // many projects at once, so a flat list is unreadable. Each project
          // is a headed section; tasks keep their within-section date order.
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {projectGroups.map((g) => {
              const isCollapsed = collapsedGroups.has(g.key);
              const openCount = g.tasks.filter((t) => t.status !== "done").length;
              return (
                <div key={g.key}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6, margin: "12px 0 2px", paddingBottom: 4, borderBottom: `2px solid ${T.roi.navy}` }}>
                    <button
                      type="button"
                      onClick={() => toggleGroup(g.key)}
                      title={isCollapsed ? "Expand this project" : "Collapse this project"}
                      style={{ display: "flex", alignItems: "baseline", gap: 8, flex: 1, minWidth: 0, textAlign: "left", cursor: "pointer", background: "none", border: "none", padding: 0 }}
                    >
                      <span aria-hidden style={{ fontSize: 10, color: T.roi.navy, transform: isCollapsed ? "rotate(-90deg)" : "none", transition: "transform 120ms ease", display: "inline-block", width: 10 }}>▼</span>
                      <span style={{ fontSize: 12.5, fontWeight: 800, color: T.roi.navy }}>{g.label}</span>
                      <span style={{ fontSize: 10.5, color: T.inkMuted }}>
                        {openCount} open · {g.tasks.length} total
                      </span>
                    </button>
                    {onDiscuss && g.label !== "No project" && (
                      <button type="button" className="btn-link" style={{ fontSize: 11, whiteSpace: "nowrap" }} title={`Discuss ${g.label} — opens Discussions scoped to this project`} onClick={() => onDiscuss(g.label)}>💬 Discuss</button>
                    )}
                  </div>
                  {!isCollapsed && renderGroupTasks(g.tasks)}
                </div>
              );
            })}
          </div>
        ) : (
          <div>{ordered.map((t) => taskLine(t, false, projects.length > 0))}</div>
        )
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((status) => (
            <div key={status} style={{ background: "#f4f3ef", borderRadius: 8, padding: 8, display: "flex", flexDirection: "column", gap: 6, minHeight: 60 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: T.inkMuted, textTransform: "uppercase", letterSpacing: 0.5 }}>
                {STATUS_LABEL[status]} ({filtered.filter((t) => t.status === status).length})
              </div>
              {filtered.filter((t) => t.status === status).map((t) => taskLine(t, true, true))}
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
      {view === "list" && overdueCount > 0 && (
        <div style={{ fontSize: 11, color: T.inkMuted, padding: "10px 2px 0", lineHeight: 1.5 }}>
          {overdueCount} past-due {overdueCount === 1 ? "item is" : "items are"} open in Kantata with a due date that has passed —
          mark {overdueCount === 1 ? "it" : "them"} Done here (or close in Kantata) and {overdueCount === 1 ? "it" : "they"} clear.
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
              setProjectFilter("");
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
