import { Fragment, useEffect, useState } from "react";
import { card, T } from "../theme.js";
import { KantataChip, SectionTitle, TagChip } from "./bits.js";
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

  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const taskLine = (t: Task, compact = false, showProject = false) => {
    const teamOpen = !compact && expandedTeamId === t.id;
    const blockers = t.status !== "done" ? blockingDeps(t, (id) => taskById.get(id)) : [];
    return (
    <Fragment key={t.id}>
    <div
      id={`taskrow-${t.id}`}
      style={{
        display: "flex",
        alignItems: compact ? "flex-start" : "center",
        flexDirection: compact ? "column" : "row",
        gap: compact ? 4 : 10,
        padding: compact ? "8px 10px" : "8px 2px",
        borderTop: compact ? "none" : `1px solid ${T.grid}`,
        // Deep-link flash: a soft highlight + ring so the person's eye lands on
        // the exact task the Teams message sent them to.
        background: flashId === t.id ? "#fff7d6" : compact ? T.surface : "transparent",
        border: flashId === t.id ? `1px solid ${T.roi.cyan}` : compact ? `1px solid ${T.border}` : undefined,
        borderRadius: flashId === t.id || compact ? 8 : 0,
        transition: "background 400ms ease",
      }}
    >
      {onOpenTask ? (
        <button
          type="button"
          onClick={() => onOpenTask(t)}
          title="See everything about this task"
          className="table-row-hover"
          style={{ flex: 1, textAlign: "left", background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12, color: t.status === "done" ? T.inkMuted : T.ink, textDecoration: t.status === "done" ? "line-through" : "none", lineHeight: 1.4 }}
        >
          {t.title}
        </button>
      ) : (
        <span style={{ flex: 1, fontSize: 12, color: t.status === "done" ? T.inkMuted : T.ink, textDecoration: t.status === "done" ? "line-through" : "none", lineHeight: 1.4 }}>
          {t.title}
        </span>
      )}
      <span style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        {showProject && t.projectLabel && (
          <span title={`Project: ${t.projectLabel}`} style={{ fontSize: 9.5, fontWeight: 700, color: T.roi.navy, background: "#eef2fb", borderRadius: 4, padding: "1px 6px", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.projectLabel}</span>
        )}
        {t.assignments && t.assignments.length > 0 ? (
          (() => {
            // Show the TEAM, not one person (Kellie). The accountable owner
            // leads; the rest ride in "+N" with a per-person done count. Click
            // to expand the team + hours INLINE in the row (Josh) — no hover.
            const owner = t.assignments.find((x) => x.primary) ?? t.assignments[0]!;
            const others = t.assignments.length - 1;
            const doneN = t.assignments.filter((x) => x.done).length;
            const isOpen = expandedTeamId === t.id;
            const summary = (
              <>
                <span style={{ fontWeight: 600 }}>{owner.name}{others > 0 ? ` +${others}` : ""}</span>
                <span style={{ color: doneN === t.assignments.length ? "#116a43" : T.inkMuted }}> · {doneN}/{t.assignments.length} done</span>
              </>
            );
            // Board cards have no room to expand the inline panel — show the
            // team as static text there; only the list view gets the toggle.
            if (compact) return <span style={{ fontSize: 11, color: T.inkSecondary }}>{summary}</span>;
            return (
              <button
                type="button"
                onClick={() => {
                  const next = isOpen ? null : t.id;
                  // Persist the team the first time it's opened, so inline
                  // hour/done/owner edits have something to write to.
                  if (next && t.assignments?.length) onSetTaskAssignments?.(t.id, t.assignments.map((x) => x.name));
                  setExpandedTeamId(next);
                }}
                title={isOpen ? "Hide the team" : "Show the team & hours"}
                style={{ display: "inline-flex", alignItems: "center", gap: 5, background: isOpen ? "#eef2fb" : "none", border: isOpen ? `1px solid ${T.grid}` : "1px solid transparent", borderRadius: 6, padding: "2px 7px", cursor: "pointer", fontSize: 11, color: T.inkSecondary, whiteSpace: "nowrap" }}
              >
                <span aria-hidden style={{ fontSize: 8.5, color: T.inkMuted, transform: isOpen ? "none" : "rotate(-90deg)", transition: "transform 120ms" }}>▼</span>
                {summary}
              </button>
            );
          })()
        ) : t.ownerName && !compact && onSetTaskAssignments ? (
          // Single-owner tasks are interactive too: clicking seeds a one-person
          // team so hours/done/status can be set in the row (add more people in
          // the full card). No more dead, un-clickable owner names.
          (() => {
            const isOpen = expandedTeamId === t.id;
            return (
              <button
                type="button"
                onClick={() => {
                  const next = isOpen ? null : t.id;
                  if (next && t.ownerName) onSetTaskAssignments?.(t.id, [t.ownerName]);
                  setExpandedTeamId(next);
                }}
                title={isOpen ? "Hide" : "Set hours, mark done, or split across a team"}
                style={{ display: "inline-flex", alignItems: "center", gap: 5, background: isOpen ? "#eef2fb" : "none", border: isOpen ? `1px solid ${T.grid}` : "1px solid transparent", borderRadius: 6, padding: "2px 7px", cursor: "pointer", fontSize: 11, color: T.inkSecondary, whiteSpace: "nowrap" }}
              >
                <span aria-hidden style={{ fontSize: 8.5, color: T.inkMuted, transform: isOpen ? "none" : "rotate(-90deg)", transition: "transform 120ms" }}>▼</span>
                {t.ownerName}
              </button>
            );
          })()
        ) : (
          t.ownerName && <span style={{ fontSize: 11, color: T.inkSecondary }}>{t.ownerName}</span>
        )}
        {blockers.length > 0 && (
          <span title={`Waiting on: ${blockers.map((b) => b.title).join(", ")}`} style={{ fontSize: 9.5, fontWeight: 700, color: "#8a5a00", background: "#fdf2d8", border: "1px solid #f0d68a", borderRadius: 4, padding: "1px 6px", whiteSpace: "nowrap" }}>
            ⛓ waiting on {blockers.length}
          </span>
        )}
        {t.label && (t.label === "from Kantata" ? <KantataChip /> : <TagChip>{t.label}</TagChip>)}
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
    const phases: { label: string | null; tasks: Task[] }[] = [];
    const idx = new Map<string, number>();
    for (const t of groupTasks) {
      const key = t.phaseLabel ?? " ";
      if (!idx.has(key)) { idx.set(key, phases.length); phases.push({ label: t.phaseLabel ?? null, tasks: [] }); }
      phases[idx.get(key)!]!.tasks.push(t);
    }
    // No real phases (everything sits straight under the job) → flat list.
    if (phases.length === 1 && phases[0]!.label === null) return groupTasks.map((t) => taskLine(t));
    return phases.map((ph) => (
      <div key={ph.label ?? "__none"} style={{ marginLeft: ph.label ? 4 : 0 }}>
        {ph.label && (
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, margin: "6px 0 0", padding: "3px 0 3px 10px", borderLeft: `3px solid ${T.roi.cyan}` }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: T.inkSecondary }}>{ph.label}</span>
            <span style={{ fontSize: 10, color: T.inkMuted }}>{ph.tasks.filter((t) => t.status !== "done").length} open</span>
          </div>
        )}
        <div style={ph.label ? { paddingLeft: 10 } : undefined}>{ph.tasks.map((t) => taskLine(t))}</div>
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

      {view === "list" ? (
        groupByProject ? (
          // Grouped by project (Kantata milestone): a fiscal-year contract runs
          // many projects at once, so a flat list is unreadable. Each project
          // is a headed section; tasks keep their within-section date order.
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
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
