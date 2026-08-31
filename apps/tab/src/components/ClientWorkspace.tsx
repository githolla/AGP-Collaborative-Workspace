import React, { useEffect, useMemo, useRef, useState } from "react";
import { card, T } from "../theme.js";
import { KantataChip, SectionTitle, StatTile, TagChip } from "./bits.js";
import { ProjectScope } from "./ProjectScope.js";
import { TasksCard } from "./TasksCard.js";
import { Thread } from "./Thread.js";
import { MentionTextarea, type MentionPerson } from "./MentionTextarea.js";
import { Crumbs } from "./ui.js";
import { AS_OF_TODAY } from "../workspace/format.js";
import { composeClientDigest } from "../workspace/clientDigest.js";
import { deliveryQuiet, type AccountLiveContext } from "../workspace/campaignImport.js";
import type { PendingWrite, WriteResponse } from "../workspace/kantataWrite.js";
import { HANDOFFS, personalizeHandoff, suggestHandoff } from "../workspace/handoffs.js";
import type { ClientAccount, ExternalMember, Task, TaskStatus, ThreadMessage } from "../workspace/types.js";
/** Where a shared file stands, in one word — the client-facing states this
 * app has ever needed. Was `clientApproval.ts`'s own `ApprovalState`; that
 * file's concrete functions were all built for the retired
 * `ClientFileLink.clientShare` model and are gone with it (Phase 7 cutover),
 * but the type itself is still load-bearing here. */
type ApprovalState = "fyi" | "pending" | "approved" | "changes";
import { allocationGrid, gridFrom, weeklyReservations, weekLabel, type ResourceReservation, type ResourceTask, type AllocationGrid } from "../workspace/resourcing.js";
import { assignmentProgress, blockingDeps, effectiveHours, isOnPersonList } from "../workspace/taskAssignments.js";
import { TeamHoursEditor } from "./TeamHours.js";
import { fetchAllAccounts, fetchAccountCollabData, toOldTask, toOldCampaign, type MsAccountData, type MsAccountFileApproval, type MsAccountActivity, type WorkspaceAccountPayload } from "../workspace/msAccountData.js";
import { createAccount } from "../workspace/msPeople.js";
import { tabVisibleForTier, type ViewTier } from "../workspace/roles.js";
import { postMessage, editMessage, deleteMessage, setMessageVisibility } from "../workspace/msMessages.js";
import { listFolder, uploadFile, type FileListing, type FileListItem } from "../workspace/msFiles.js";
import { type FolderTreeNode } from "../workspace/msFolderTree.js";
import { ClientAdminPanel, FolderTreePicker } from "./ClientAdminPanel.js";

/**
 * Client-account workspace — built to the manager's wireframe: tabs Home /
 * Project Plan / Client Dashboard / Files / Discussions / Admin,
 * with a personal Home (greeting + notifications, account overview, your
 * tasks, due this week, recent files, core documentation, latest discussions).
 *
 * HARD RULE enforced by construction: no internal financials (ROI, margin,
 * realism, human-in-the-loop) exist anywhere in this component tree.
 */

/** "COH: FY27 DM#1" / "COH - FY27" -> "COH". Local to keep this guest-visible
 * file free of the matcher's import graph (clientSafety.test.ts). */
const titlePrefix = (title: string): string => {
  const t = title.replace(/^\s*\d[\d.-]*\s+/, "").trim();
  const colon = t.indexOf(":");
  if (colon >= 2) return t.slice(0, colon);
  const dash = t.split(/\s+[—–|]\s+|\s+-\s+/);
  return dash.length >= 2 ? (dash[0] ?? "") : t;
};
const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

export type ClientTab = "home" | "plan" | "resourcing" | "dashboard" | "files" | "discussions" | "sandbox" | "access";

const TABS: { key: ClientTab; label: string }[] = [
  { key: "home", label: "Home" },
  { key: "plan", label: "Project Plan" },
  // Resourcing: hours by person by week, derived from the plan and kept current
  // as timelines shift. Internal (hours, never rates). Its own tab so it's a
  // place you can go — and where the Teams "adjust these" links land.
  { key: "resourcing", label: "Resourcing" },
  { key: "dashboard", label: "Client Dashboard" },
  { key: "files", label: "Files" },
  { key: "discussions", label: "Discussions" },
  // Sandbox tab removed per Kellie's pilot feedback (2026-08-19): "We don't need
  // this page." The type + render path stay (harmless when no tab points here)
  // so nothing else that references "sandbox" breaks.
  // Key stays "access" — deep links (#c/<id>/access), pageContext.ts's
  // ACCOUNT record, and SetupChecklist/CollaborateHub's goTo("access")
  // calls all already target this key. Only the label and rendered
  // content changed when this became the Client Admin tab.
  { key: "access", label: "Admin" },
];

const navy = T.roi.navy;

/** Colour for a client-share status chip. */
function clientShareChip(state: ApprovalState): React.CSSProperties {
  const map: Record<ApprovalState, [string, string, string]> = {
    fyi: [T.inkSecondary, "#eef2f8", T.grid],
    pending: ["#8a6d1a", "#faf3dc", "#e7c66f"],
    approved: ["#116a43", "#e8f5ee", "#bfe3d0"],
    changes: ["#9b2c2c", "#fdeced", "#f3c2c4"],
  };
  const [color, background, border] = map[state];
  return { color, background, border: `1px solid ${border}`, fontSize: 10, fontWeight: 700, borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" };
}

function fmtDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/** The @mention roster: people already on the account first (onAccount), then
 * the rest of the live AGP roster (off-account — quick-addable on mention).
 * Reads `collabData.members`/`.externals` (Postgres) — the OLD
 * `account.members`/`.externals` are a separate, now-stale roster that only
 * CollaborateHub's un-migrated quick-add ever wrote to. */
function buildMentionRoster(
  members: WorkspaceAccountPayload["members"],
  externals: WorkspaceAccountPayload["externals"],
  roster: { id: string; name: string; title: string }[],
): MentionPerson[] {
  const onAccount = new Map<string, string>();
  for (const m of members) onAccount.set(m.name, m.title ?? "");
  for (const e of externals) onAccount.set(e.name, `${e.role} · ${e.org}`);
  const list: MentionPerson[] = [...onAccount].map(([name, sub]) => ({ name, onAccount: true, ...(sub ? { sub } : {}) }));
  for (const p of roster) {
    if (onAccount.has(p.name)) continue;
    list.push({ name: p.name, onAccount: false, ...(p.title ? { sub: p.title } : {}) });
  }
  return list;
}

function timeAgo(iso: string): string {
  const days = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

function Avatar({ name, size = 30 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, borderRadius: "50%", background: "#e6e4ee", color: navy, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.38, fontWeight: 700, flexShrink: 0 }}
    >
      {name.split(" ").map((w) => w[0]).join("").slice(0, 2)}
    </span>
  );
}

function ViewAll({ label, onClick }: { label: string; onClick: () => void }) {
  // Bottom-right, as drawn in the wireframe.
  return (
    <button type="button" className="btn btn-primary btn-sm" onClick={onClick} style={{ alignSelf: "flex-end", marginTop: "auto", paddingTop: 8 }}>
      {label} ›
    </button>
  );
}

/** Clickable empty-state row: a dead zone becomes the next action. */
function EmptyZone({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="table-row-hover"
      style={{ background: "none", border: `1px dashed ${T.grid}`, borderRadius: 8, padding: "12px 14px", fontSize: 12, color: T.inkSecondary, textAlign: "left", cursor: "pointer", marginTop: 4 }}
    >
      {label} ›
    </button>
  );
}

/** Every row on the Home page is a door: click it, land on the full view. */
function RowButton({ onClick, title, children, style }: { onClick: () => void; title: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="table-row-hover"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        textAlign: "left",
        background: "none",
        border: "none",
        borderBottom: `1px solid ${T.grid}`,
        padding: "8px 4px",
        cursor: "pointer",
        ...style,
      }}
    >
      {children}
      <span aria-hidden style={{ color: T.inkMuted, fontSize: 13, flexShrink: 0 }}>›</span>
    </button>
  );
}

const fileGlyph: Record<string, string> = { pptx: "🟥", xlsx: "🟩", docx: "🟦", default: "📄" };
function glyphFor(name: string): string {
  const ext = name.split(".").pop() ?? "";
  return fileGlyph[ext] ?? fileGlyph.default!;
}

// ---------------------------------------------------------------------------
// Setup checklist — a fresh workspace walks you through going live. Rows
// check themselves off as the workspace fills in; the card disappears when
// everything's done.
// ---------------------------------------------------------------------------

function SetupChecklist({
  account,
  tasks,
  fileApprovals,
  externals,
  candidatesCount,
  taskCandidatesCount = 0,
  goTo,
  onOpenReview,
}: {
  account: ClientAccount;
  tasks: Task[];
  fileApprovals: MsAccountFileApproval[];
  externals: WorkspaceAccountPayload["externals"];
  candidatesCount: number;
  taskCandidatesCount?: number;
  goTo: (t: ClientTab) => void;
  onOpenReview?: () => void;
}) {
  const steps = [
    {
      key: "import",
      done: account.campaigns.length > 0,
      label:
        account.campaigns.length > 0
          ? `Campaigns imported (${account.campaigns.length})`
          : candidatesCount > 0
            ? `Import this client's work — ${candidatesCount} campaign${candidatesCount === 1 ? "" : "s"} matched in Kantata`
            : "No Kantata work matched yet — add campaigns as they start",
      action: candidatesCount > 0 && onOpenReview ? { label: "Review & import", onClick: onOpenReview } : null,
    },
    {
      key: "access",
      done: externals.length > 0,
      label:
        externals.length > 0
          ? `Client & contractor access set (${externals.length})`
          : "Give the client (and any contractors) access",
      action: { label: "Open access", onClick: () => goTo("access") },
    },
    {
      key: "tasks",
      done: tasks.length > 0,
      label:
        tasks.length > 0
          ? `Plan started (${tasks.length} task${tasks.length === 1 ? "" : "s"})`
          : taskCandidatesCount > 0
            ? `Start the plan — ${taskCandidatesCount} open Kantata task${taskCandidatesCount === 1 ? "" : "s"} ready to import`
            : "Add the first tasks with owners and due dates",
      action:
        taskCandidatesCount > 0 && onOpenReview && tasks.length === 0
          ? { label: "Review & import", onClick: onOpenReview }
          : { label: "Open plan", onClick: () => goTo("plan") },
    },
    {
      key: "files",
      done: fileApprovals.length > 0,
      label: fileApprovals.length > 0 ? `Files shared with the client (${fileApprovals.length})` : "Share a file from the account's folder with the client",
      action: { label: "Open files", onClick: () => goTo("files") },
    },
  ];
  if (steps.every((s) => s.done)) return null;
  const doneCount = steps.filter((s) => s.done).length;

  return <SetupChecklistShell doneCount={doneCount} total={steps.length} steps={steps} />;
}

/** Fresh workspace (nothing done) → expanded guide. Any progress → a slim
 * one-line bar, so Cara's wireframe stays the page, not the checklist. */
function SetupChecklistShell({
  doneCount,
  total,
  steps,
}: {
  doneCount: number;
  total: number;
  steps: { key: string; done: boolean; label: string; action: { label: string; onClick: () => void } | null }[];
}) {
  const [open, setOpen] = useState(doneCount === 0);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="table-row-hover"
        style={{ ...card, borderColor: navy, borderWidth: 1.5, padding: "9px 16px", display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", cursor: "pointer" }}
      >
        <span style={{ fontSize: 12, fontWeight: 800, color: navy }}>Get this workspace live</span>
        <span aria-hidden style={{ flex: 1, height: 6, background: "#f0efec", borderRadius: 3, overflow: "hidden", maxWidth: 220 }}>
          <span style={{ display: "block", width: `${(doneCount / total) * 100}%`, height: "100%", background: navy }} />
        </span>
        <span style={{ fontSize: 11.5, color: T.inkMuted, whiteSpace: "nowrap" }}>{doneCount}/{total} done · show steps ▾</span>
      </button>
    );
  }

  return (
    <div style={{ ...card, borderColor: navy, borderWidth: 1.5 }}>
      <SectionTitle
        right={
          <button type="button" className="btn-link" style={{ fontSize: 11 }} onClick={() => setOpen(false)}>
            {doneCount}/{total} done · hide ▴
          </button>
        }
      >
        Get this workspace live
      </SectionTitle>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {steps.map((s) => (
          <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 2px", borderBottom: `1px solid ${T.grid}` }}>
            <span
              aria-hidden
              style={{
                width: 20,
                height: 20,
                borderRadius: "50%",
                flexShrink: 0,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                fontWeight: 800,
                background: s.done ? "#e3f4ec" : "#f0efec",
                color: s.done ? "#116a43" : T.inkMuted,
              }}
            >
              {s.done ? "✓" : "○"}
            </span>
            <span style={{ flex: 1, fontSize: 12.5, color: s.done ? T.inkMuted : T.ink, fontWeight: s.done ? 400 : 600 }}>{s.label}</span>
            {!s.done && s.action && (
              <button type="button" className="btn btn-primary btn-sm" style={{ flexShrink: 0 }} onClick={s.action.onClick}>
                {s.action.label} ›
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live systems card — what HubSpot & Kantata actually know about THIS client.
// Rendered from plain props (App computes the context); Cara's wireframe
// zones stay untouched — this card sits below them, and the internal-only
// account intelligence is labeled as such.
// ---------------------------------------------------------------------------


/**
 * Project Finder — the fix that always works: search EVERY live Kantata
 * project title, hand-pick this client's work, one click links it forever
 * (and imports the campaigns). No naming convention required.
 */
function ProjectFinder({
  projects,
  onLink,
}: {
  projects: AccountLiveContext["searchable"];
  onLink: (ids: string[]) => void;
}) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const needle = q.trim().toLowerCase();
  const results =
    needle.length >= 2
      ? projects
          .filter((p) => p.title.toLowerCase().includes(needle) || (p.clientGroup ?? "").toLowerCase().includes(needle))
          .slice(0, 10)
      : [];
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const pickedTitles = projects.filter((p) => picked.has(p.id));

  return (
    <div style={{ marginTop: 10, background: "#fff", border: `1px solid ${T.grid}`, borderRadius: 8, padding: "10px 12px" }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: T.roi.navy, marginBottom: 6 }}>
        Find this client's Kantata projects
      </div>
      <input
        className="input"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`Search ${projects.length} live project titles — part of a name, an abbreviation, anything…`}
        style={{ width: "100%", fontSize: 12.5, padding: "8px 12px" }}
      />
      {results.map((p) => (
        <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 2px", borderBottom: `1px solid ${T.grid}`, cursor: "pointer" }}>
          <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} />
          <span style={{ flex: 1, fontSize: 12, color: T.ink, fontWeight: 600 }}>{p.title}</span>
          {p.clientGroup && <span style={{ fontSize: 10.5, color: T.inkMuted }}>{p.clientGroup}</span>}
          {p.dueDate && <span style={{ fontSize: 10.5, color: T.inkMuted, whiteSpace: "nowrap" }}>due {p.dueDate}</span>}
        </label>
      ))}
      {needle.length >= 2 && results.length === 0 && (
        <div style={{ fontSize: 11.5, color: T.inkMuted, padding: "8px 2px" }}>
          No live project title contains “{q}”. Try a shorter fragment or an abbreviation.
        </div>
      )}
      {picked.size > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => onLink([...picked])}>
            Link {picked.size} project{picked.size === 1 ? "" : "s"} to this workspace →
          </button>
          <span style={{ fontSize: 10.5, color: T.inkMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 420 }}>
            {pickedTitles.map((p) => p.title).join(" · ")}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Link doctor — when live data is on but a workspace attached to nothing,
 * this banner (on EVERY tab) says exactly what was pulled, what didn't
 * match, and how to fix it. A blank workspace with no explanation is a
 * product failure; this is the anti-blank.
 */
function LinkDoctor({
  context,
  clientName,
  suggestions,
  hasImportedWork,
  onRelink,
  onLinkProjects,
}: {
  context: AccountLiveContext;
  clientName: string;
  suggestions: string[];
  /** Campaigns already live here — a "nothing matched" banner would lie. */
  hasImportedWork: boolean;
  onRelink?: ((name: string) => void) | undefined;
  onLinkProjects?: ((ids: string[]) => void) | undefined;
}) {
  const { projects, deals, book } = context;
  if (projects.length > 0 || deals.length > 0) return null; // linked + matched — healthy
  if (hasImportedWork) return null; // work already imported — nothing to diagnose

  return (
    <div style={{ background: "#faf3dc", border: "1.5px solid #e7c66f", borderRadius: 10, padding: "12px 16px", fontSize: 12.5, color: "#6b5410", lineHeight: 1.6 }}>
      <strong>Couldn’t auto-match “{clientName}” to its Kantata projects.</strong> The matcher
      knows {book.projects} live projects but none of their names line up with this workspace —
      so find them yourself below: search, tick the ones that are this client’s, link once,
      done forever.
      {suggestions.length > 0 && (
        <span style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
          <span style={{ fontWeight: 700 }}>Or is this them?</span>
          {suggestions.map((s) => (
            <button key={s} type="button" className="btn btn-primary btn-sm" onClick={() => onRelink?.(s)}>
              Link to “{s}” →
            </button>
          ))}
        </span>
      )}
      {onLinkProjects && context.searchable.length > 0 && (
        <ProjectFinder projects={context.searchable} onLink={onLinkProjects} />
      )}
    </div>
  );
}


/** Activity feed (Collab Hub Must): the workspace's "what's new" — imports,
 * tasks, access changes, files — newest first. Reads `collab.activity`
 * (already fetched newest-first by GET /api/workspace), migrated off the
 * old model's `account.activity`. */
function WhatsNew({ activity }: { activity: MsAccountActivity[] }) {
  const recent = activity.slice(0, 6);
  if (recent.length === 0) return null;
  return (
    <div style={card}>
      <SectionTitle>What’s new</SectionTitle>
      {recent.map((ev) => (
        <div key={ev.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12, color: T.inkSecondary, padding: "6px 0", borderBottom: `1px solid ${T.grid}`, lineHeight: 1.5 }}>
          <span>{ev.text}</span>
          <span style={{ color: T.inkMuted, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{ev.at.slice(0, 10)}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Home — the wireframe, zone for zone
// ---------------------------------------------------------------------------

function Home({ account, tasks, fileApprovals, activity, userName, goTo, onOpenTask }: { account: ClientAccount; tasks: Task[]; fileApprovals: MsAccountFileApproval[]; activity: MsAccountActivity[]; userName: string; goTo: (t: ClientTab) => void; onOpenTask: (task: Task) => void }) {
  const today = AS_OF_TODAY();
  const weekOut = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  // MY tasks: the ones I actually carry hours on (or own) — the mechanism that
  // makes a personal list meaningful instead of "every task I'm cc'd on"
  // (Cara/Kellie). Falls back to all tasks for a viewer who's on none of them
  // (e.g. a client), so the home never looks empty by accident.
  const [mineOnly, setMineOnly] = useState(true);
  const myTasks = tasks.filter((t) => isOnPersonList(t, userName));
  const scoped = mineOnly && myTasks.length > 0 ? myTasks : tasks;
  const open = scoped.filter((t) => t.status !== "done");
  // Actually THIS week: due from today through the next 7 days. (Past-due
  // tasks are overdue, not "due this week" — they surface on the plan, not here.)
  const dueThisWeek = open
    .filter((t) => t.due && t.due >= today && t.due <= weekOut)
    .sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""));
  const byStatus = (s: TaskStatus) => scoped.filter((t) => t.status === s);
  const milestones = account.campaigns
    .filter((c) => c.nextMilestone && c.nextMilestoneDate && c.nextMilestoneDate >= today)
    .sort((a, b) => (a.nextMilestoneDate ?? "").localeCompare(b.nextMilestoneDate ?? ""))
    .slice(0, 3);
  const boardCols: { key: TaskStatus; label: string }[] = [
    { key: "todo", label: "To Do" },
    { key: "doing", label: "In Progress" },
    { key: "done", label: "Completed" },
  ];
  const squares = ["#2a78d6", "#1f9d6b", "#1f9d6b", "#eb6834"];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Greeting + team notifications */}
      <div style={{ ...card, display: "flex", gap: 16 }}>
        <Avatar name={userName} size={54} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: navy }}>Hi {userName.split(" ")[0]}!</div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: navy, margin: "8px 0 4px" }}>Team Notifications</div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {activity.filter((a) => a.kind === "team").slice(0, 5).map((n) => (
              <RowButton key={n.id} onClick={() => goTo("access")} title="Open Admin" style={{ padding: "5px 4px" }}>
                <span aria-hidden style={{ width: 5, height: 5, borderRadius: "50%", background: navy, flexShrink: 0 }} />
                <span style={{ fontSize: 12.5, color: T.inkSecondary, lineHeight: 1.5 }}>{n.text}</span>
              </RowButton>
            ))}
          </div>
        </div>
      </div>

      {/* Account Overview removed per Kellie's pilot feedback (2026-08-19) — the
          Tasks sections span wider without it, which is easier to read. */}
      <div className="home-row-1">
        {/* Your tasks — mini board, scoped to the tasks you actually own hours on */}
        <div style={{ ...card, display: "flex", flexDirection: "column" }}>
          <SectionTitle
            right={
              myTasks.length > 0 ? (
                <span style={{ display: "flex", gap: 4 }}>
                  <button type="button" onClick={() => setMineOnly(true)} className={`nav-pill${mineOnly ? " active" : ""}`} style={{ fontSize: 10, padding: "3px 9px" }} title="Only tasks you carry hours on">Mine</button>
                  <button type="button" onClick={() => setMineOnly(false)} className={`nav-pill${!mineOnly ? " active" : ""}`} style={{ fontSize: 10, padding: "3px 9px" }} title="Everyone's tasks">All</button>
                </span>
              ) : undefined
            }
          >
            Your Tasks
          </SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
            {boardCols.map((col) => (
              <div key={col.key}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: navy, borderRadius: "6px 6px 0 0", padding: "5px 8px" }}>{col.label}</div>
                <div style={{ border: `1px solid ${T.grid}`, borderTop: "none", borderRadius: "0 0 6px 6px", padding: 6, display: "flex", flexDirection: "column", gap: 6, minHeight: 90 }}>
                  {byStatus(col.key).slice(0, 2).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => onOpenTask(t)}
                      title="See everything about this task"
                      className="table-row-hover"
                      style={{ fontSize: 11.5, textAlign: "left", background: "none", border: "none", padding: "2px 3px", borderRadius: 4, cursor: "pointer" }}
                    >
                      <div style={{ fontWeight: 600, color: col.key === "done" ? T.inkMuted : navy, lineHeight: 1.3 }}>{t.title}</div>
                      {t.projectLabel && (
                        <div style={{ color: T.roi.navy, fontSize: 9.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.projectLabel}</div>
                      )}
                      {col.key !== "done" && (
                        <div style={{ color: T.inkMuted, fontSize: 10.5 }}>
                          {t.ownerName} {t.due ? `· Due ${fmtDay(t.due).split(", ")[1]}` : ""}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {tasks.length === 0 && (
            <EmptyZone label="No tasks yet — review & import Kantata tasks, or add the first one on the plan" onClick={() => goTo("plan")} />
          )}
          <ViewAll label="View All Tasks" onClick={() => goTo("plan")} />
        </div>

        {/* Due this week */}
        <div style={card}>
          <SectionTitle>Due This Week</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {dueThisWeek.map((t, i) => (
              <RowButton key={t.id} onClick={() => onOpenTask(t)} title="See everything about this task" style={{ padding: "9px 4px", alignItems: "flex-start" }}>
                <span aria-hidden style={{ width: 11, height: 11, marginTop: 3, background: squares[i % squares.length], borderRadius: 2, flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: navy, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
                  {/* Which real project (Kantata milestone) — so a task from a
                      year-long contract isn't floating with no context. */}
                  {t.projectLabel && <span style={{ display: "block", fontSize: 10.5, color: T.inkMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.projectLabel}</span>}
                </span>
                <span style={{ fontSize: 11.5, color: T.inkSecondary, whiteSpace: "nowrap", marginTop: 1 }}>{t.due ? fmtDay(t.due) : ""}</span>
              </RowButton>
            ))}
            {/* Nothing due → the next real dates: campaign milestones. */}
            {dueThisWeek.length === 0 && milestones.length > 0 && (
              <>
                <div style={{ fontSize: 11, color: T.inkMuted, padding: "4px 0 2px" }}>No tasks due — next milestones:</div>
                {milestones.map((c, i) => (
                  <RowButton key={c.id} onClick={() => goTo("dashboard")} title="Open Client Dashboard" style={{ padding: "9px 4px" }}>
                    <span aria-hidden style={{ width: 11, height: 11, background: squares[i % squares.length], borderRadius: 2, flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5 }}>
                      <span style={{ fontWeight: 700, color: navy }}>{c.nextMilestone}</span>
                      <span style={{ color: T.inkMuted }}> — {c.name}</span>
                    </span>
                    {c.source === "kantata" && <KantataChip compact />}
                    <span style={{ fontSize: 11.5, color: T.inkSecondary, whiteSpace: "nowrap" }}>{c.nextMilestoneDate ? fmtDay(c.nextMilestoneDate) : ""}</span>
                  </RowButton>
                ))}
              </>
            )}
            {dueThisWeek.length === 0 && milestones.length === 0 && (
              <EmptyZone label="Nothing due this week — open the plan to add dated tasks" onClick={() => goTo("plan")} />
            )}
          </div>
        </div>
      </div>

      <div className="home-row-2">
        {/* Recently shared files */}
        <div style={{ ...card, display: "flex", flexDirection: "column" }}>
          <SectionTitle>Recently Shared Files</SectionTitle>
          {[...fileApprovals].reverse().slice(0, 4).map((f) => (
            <RowButton key={f.id} onClick={() => goTo("files")} title="Open Files">
              <span aria-hidden style={{ fontSize: 13 }}>{glyphFor(f.name)}</span>
              <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: navy, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
              <span style={clientShareChip(fileApprovalState(f))}>{fileApprovalLabel(f)}</span>
            </RowButton>
          ))}
          {fileApprovals.length === 0 && (
            <EmptyZone label="Nothing shared with the client yet — browse the account's files" onClick={() => goTo("files")} />
          )}
          <ViewAll label="View All Files" onClick={() => goTo("files")} />
        </div>

        {/* Awaiting the client's decision */}
        <div style={{ ...card, display: "flex", flexDirection: "column" }}>
          <SectionTitle>Awaiting Client Decision</SectionTitle>
          {fileApprovals.filter((f) => fileApprovalState(f) === "pending").map((f) => (
            <RowButton key={f.id} onClick={() => goTo("files")} title="Open Files" style={{ padding: "9px 4px" }}>
              <span aria-hidden style={{ width: 14, height: 14, background: navy, borderRadius: 3, opacity: 0.75, flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 12.5, color: T.ink }}>{f.name}</span>
            </RowButton>
          ))}
          {fileApprovals.filter((f) => fileApprovalState(f) === "pending").length === 0 && (
            <EmptyZone label="Nothing awaiting the client's decision" onClick={() => goTo("files")} />
          )}
          <ViewAll label="View All Files" onClick={() => goTo("files")} />
        </div>

        {/* Latest discussions */}
        <div style={{ ...card, display: "flex", flexDirection: "column" }}>
          <SectionTitle>Latest Discussions</SectionTitle>
          {[...account.thread].reverse().slice(0, 3).map((m) => {
            const [title, ...rest] = m.body.split(" — ");
            return (
              <RowButton key={m.id} onClick={() => goTo("discussions")} title="Open Discussions" style={{ alignItems: "flex-start", padding: "8px 4px" }}>
                <Avatar name={m.author} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: navy, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
                  <span style={{ display: "block", fontSize: 11, color: T.inkSecondary }}>{m.author}</span>
                  {rest.length > 0 && <span style={{ display: "block", fontSize: 11, color: T.inkMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{rest.join(" — ")}</span>}
                </span>
                <span style={{ fontSize: 10.5, color: T.inkMuted, whiteSpace: "nowrap" }}>{timeAgo(m.at)}</span>
              </RowButton>
            );
          })}
          {account.thread.length === 0 && (
            <EmptyZone label="No discussions yet — post the kickoff note, or let the Copilot draft the weekly update" onClick={() => goTo("discussions")} />
          )}
          <ViewAll label="View All Discussions" onClick={() => goTo("discussions")} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Client dashboard — the client-safe view
// ---------------------------------------------------------------------------

/**
 * Weekly resourcing — the answer to Kellie's #1 pain. The PM validates hours on
 * each task (in the plan above); this view DERIVES the weekly picture from those
 * hours and each task's current due date. So when a timeline shifts, the weeks
 * re-fill automatically — no expand-all-and-redistribute every Thursday.
 *
 * Deliberately read-only + visibility: it shows the peaks and valleys and pushes
 * them to Kantata. It is NOT a leveling tool — reconciling over-allocation is a
 * higher-level job (managers + resource), out of scope by explicit decision.
 */
/**
 * A roomy hours field for the resourcing list — the PM's estimate for a task's
 * owner. Commits on Enter/blur; empty clears. `autoFocusMe` lets a deep link
 * put the cursor straight here on arrival.
 */
function BigHoursInput({ hours, onSet, autoFocusMe }: { hours?: number; onSet: (h: number | undefined) => void; autoFocusMe?: boolean }) {
  const [val, setVal] = useState(hours != null ? String(hours) : "");
  const commit = () => {
    const n = Number(val);
    onSet(val.trim() === "" || !Number.isFinite(n) || n <= 0 ? undefined : n);
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <input
        data-hours="1"
        autoFocus={autoFocusMe}
        value={val}
        onChange={(e) => setVal(e.target.value.replace(/[^0-9.]/g, ""))}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") { commit(); (e.target as HTMLInputElement).blur(); } }}
        placeholder="—"
        inputMode="decimal"
        title="Estimated hours for this task's owner"
        style={{
          width: 54, textAlign: "right", fontSize: 13, fontWeight: 700, padding: "5px 7px", borderRadius: 6,
          border: `1px solid ${hours != null ? T.roi.cyan : T.grid}`, color: hours != null ? T.ink : T.inkMuted,
          background: hours != null ? "#eef8fc" : T.surface,
        }}
      />
      <span style={{ fontSize: 11, color: T.inkMuted }}>h</span>
    </span>
  );
}

/**
 * The Resourcing tab — a place PMs can GO (nav or deep link), purpose-built for
 * the two things Cara and Kellie asked for and nothing else:
 *   1. Validate the hours on each task (grouped by project, roomy, uncluttered).
 *   2. See the weekly picture that DERIVES from those hours + current due dates,
 *      and push it to Kantata.
 * Timeline shifts flow through on their own. No leveling here — by decision.
 */
/** Plan tasks → the resourcing engine's shape: per-person EFFECTIVE hours with
 * finished portions dropped. Shared by the weekly grid and the resourcing
 * charts so they always agree. */
function toResourceTasks(tasks: Task[]): ResourceTask[] {
  return tasks.map((t) => {
    const eff = t.assignments && t.assignments.length > 0 ? effectiveHours(t) : null;
    return {
      id: t.id,
      status: t.status,
      ...(t.ownerName ? { ownerName: t.ownerName } : {}),
      ...(t.startDate ? { start: t.startDate } : {}),
      ...(t.due ? { due: t.due } : {}),
      ...(t.estimatedHours != null ? { estimatedHours: t.estimatedHours } : {}),
      ...(t.projectLabel ? { projectLabel: t.projectLabel } : {}),
      ...(eff ? { assignments: [...eff].filter(([name]) => !t.assignments!.some((a) => a.name === name && a.done)).map(([name, hours]) => ({ name, hours })) } : {}),
    };
  });
}

/** Heatmap cell shade by magnitude (this client's hours), on the theme's
 * sequential teal ramp — replaces the old hardcoded 20/40 bands. */
function resSeqCell(hours: number, max: number): { bg: string; fg: string } {
  if (hours <= 0) return { bg: "transparent", fg: T.grid };
  const idx = Math.min(9, Math.max(1, Math.round((hours / (max || 1)) * 9)));
  return { bg: T.seq[idx] ?? T.seq[1]!, fg: idx >= 6 ? "#fff" : T.ink };
}

/** KPI stat row for the Resourcing tab. */
function ResourcingKpis({ grid, missingHours, blocked }: { grid: AllocationGrid; missingHours: number; blocked: number }) {
  const total = grid.weeks.reduce((s, w) => s + grid.weekTotal(w), 0);
  const busiest = grid.weeks.reduce((best, w) => { const h = grid.weekTotal(w); return h > best.h ? { w, h } : best; }, { w: "", h: 0 });
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
      <StatTile label="Scheduled hours" value={`${Math.round(total)}h`} detail={`${grid.people.length} ${grid.people.length === 1 ? "person" : "people"}`} />
      <StatTile label="Busiest week" value={busiest.h > 0 ? `${Math.round(busiest.h)}h` : "—"} {...(busiest.w ? { detail: weekLabel(busiest.w) } : {})} />
      <StatTile label="Needs hours" value={`${missingHours}`} detail="owned, dated tasks" {...(missingHours > 0 ? { detailColor: T.status.warning } : {})} />
      <StatTile label="Not resourceable" value={`${blocked}`} detail="need owner + date" {...(blocked > 0 ? { detailColor: T.status.warning } : {})} />
    </div>
  );
}

/** This client's demand across its weeks — columns vs the busiest-week peak. */
function ClientDemandTrend({ grid }: { grid: AllocationGrid }) {
  if (grid.weeks.length < 2) return null;
  const totals = grid.weeks.map((w) => grid.weekTotal(w));
  const max = Math.max(1, ...totals);
  const H = 72;
  return (
    <div style={{ ...card }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.inkMuted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>Hours by week</div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: H }}>
        {grid.weeks.map((w, i) => {
          const h = (totals[i]! / max) * H;
          return (
            <div key={w} title={`${weekLabel(w)} · ${Math.round(totals[i]!)}h`} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", height: "100%" }}>
              <div style={{ width: "78%", height: Math.max(2, h), background: T.series1, borderRadius: "3px 3px 0 0" }} />
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9.5, color: T.inkMuted, marginTop: 3 }}>
        <span>{weekLabel(grid.weeks[0]!)}</span>
        <span>{weekLabel(grid.weeks[grid.weeks.length - 1]!)}</span>
      </div>
    </div>
  );
}

/** Which project (job) is eating the hours — horizontal bar per project. Uses
 * the SAME effective (post-done, post-split) hours the weekly grid does, so the
 * two panels reconcile. */
function ProjectBreakdown({ resTasks }: { resTasks: ResourceTask[] }) {
  const byProject = new Map<string, { hours: number; count: number }>();
  for (const t of resTasks) {
    if (t.status === "done" || !t.due) continue;
    const hours = t.assignments && t.assignments.length > 0 ? t.assignments.reduce((s, a) => s + a.hours, 0) : (t.estimatedHours ?? 0);
    if (!(hours > 0)) continue;
    const label = t.projectLabel ?? "No project";
    const cur = byProject.get(label) ?? { hours: 0, count: 0 };
    cur.hours += hours;
    cur.count += 1;
    byProject.set(label, cur);
  }
  const rows = [...byProject.entries()].map(([label, v]) => ({ label, hours: v.hours, count: v.count })).sort((a, b) => b.hours - a.hours);
  if (rows.length < 2) return null;
  const max = Math.max(1, ...rows.map((r) => r.hours));
  return (
    <div style={{ ...card }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.inkMuted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>Hours by project</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {rows.map((r) => (
          <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
            <span style={{ width: 190, flexShrink: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: T.ink }} title={r.label}>{r.label}</span>
            <span style={{ flex: 1, height: 12, background: "#f0efec", borderRadius: 4, overflow: "hidden" }}>
              <span style={{ display: "block", height: "100%", width: `${(r.hours / max) * 100}%`, background: T.series1, borderRadius: 4 }} />
            </span>
            <span style={{ width: 74, flexShrink: 0, textAlign: "right", fontVariantNumeric: "tabular-nums", color: T.inkSecondary }}>{Math.round(r.hours)}h · {r.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ResourcingView({
  tasks,
  reservations = [],
  onSetHours,
  onPublish,
  focusTaskId,
}: {
  tasks: Task[];
  /** Real Kantata Resource Center reservations — the hours the PM already keeps. */
  reservations?: readonly ResourceReservation[];
  onSetHours: (taskId: string, hours: number | undefined) => void;
  onPublish?: (() => Promise<WriteResponse>) | undefined;
  focusTaskId?: string;
}) {
  const [flashId, setFlashId] = useState<string | null>(null);
  const [personFilter, setPersonFilter] = useState("");
  const [needsHoursOnly, setNeedsHoursOnly] = useState(false);
  // Collapse the per-project hour groups too (Josh) — open collapsed, expand
  // the project you're validating. A ref-guarded default so it doesn't fight
  // a manual toggle or re-collapse on every keystroke.
  const [collapsedRes, setCollapsedRes] = useState<Set<string>>(new Set());
  const [resToggled, setResToggled] = useState(false);
  const toggleRes = (key: string) => {
    setResToggled(true);
    setCollapsedRes((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  };

  // Land a deep link exactly on the task to adjust: scroll, flash, focus hours.
  useEffect(() => {
    if (!focusTaskId) return;
    const el = document.getElementById(`res-${focusTaskId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlashId(focusTaskId);
    const input = el.querySelector<HTMLInputElement>('input[data-hours="1"]');
    if (input) { input.focus(); input.select(); }
    const timer = setTimeout(() => setFlashId(null), 2800);
    return () => clearTimeout(timer);
  }, [focusTaskId, tasks.length]);

  // Only open, OWNED, DATED tasks can sit on a week — those are the resourcing
  // candidates. Tasks missing an owner or a date are surfaced as a count so the
  // gap is visible, not silently dropped.
  const candidates = tasks.filter((t) => t.status !== "done" && t.ownerName && t.due);
  const people = [...new Set(candidates.map((t) => t.ownerName).filter((o): o is string => !!o))].sort();
  const shown = candidates
    .filter((t) => (!personFilter || t.ownerName === personFilter) && (!needsHoursOnly || t.estimatedHours == null))
    .sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""));
  const missingHours = candidates.filter((t) => t.estimatedHours == null).length;
  const blocked = tasks.filter((t) => t.status !== "done" && (!t.ownerName || !t.due)).length;

  // Group the hours list by project (milestone) — the same grouping as the plan.
  const groups = new Map<string, Task[]>();
  for (const t of shown) {
    const key = t.projectLabel ?? "\u{10FFFF}";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }
  const orderedGroups = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const resKeys = orderedGroups.map(([k]) => k).join("§");
  useEffect(() => {
    if (resToggled) return;
    setCollapsedRes(new Set(resKeys ? resKeys.split("§") : []));
  }, [resKeys, resToggled]);
  const labelOf = (t: Task) => t.projectLabel ?? "No project";

  // Derived weekly grid (always computed so it can be pushed back to Kantata);
  // the SHOWN grid prefers live Kantata reservations when present.
  const resTasks = toResourceTasks(tasks);
  const derivedGrid = allocationGrid(resTasks);
  const grid = reservations.length > 0 ? gridFrom(weeklyReservations(reservations)) : derivedGrid;
  const unestimated = candidates.filter((t) => t.estimatedHours == null).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ ...card, background: "#eef8fc", borderColor: T.roi.cyan }}>
        <span style={{ fontSize: 12.5, color: "#16708f", fontWeight: 600 }}>
          Hours come from Kantata — you just validate or fine-tune them here. The weekly view spreads each
          task's hours across its dates and re-figures on its own when a timeline shifts, so nobody
          redistributes by hand every week. Send it back to Kantata when it's right.
        </span>
      </div>

      {grid.weeks.length > 0 && <ResourcingKpis grid={grid} missingHours={missingHours} blocked={blocked} />}
      {grid.weeks.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
          <ClientDemandTrend grid={grid} />
          <ProjectBreakdown resTasks={resTasks} />
        </div>
      )}

      {/* The payoff: the weekly picture + push. */}
      <WeeklyResourcing grid={grid} derivedWeeks={derivedGrid.weeks.length} fromKantata={reservations.length > 0} unestimated={unestimated} {...(onPublish ? { onPublish } : {})} />

      {/* Validate hours — clean, grouped by project, roomy input. */}
      <div style={card}>
        <SectionTitle
          right={
            <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              {people.length > 1 && (
                <select value={personFilter} onChange={(e) => setPersonFilter(e.target.value)} className="select" style={{ fontSize: 11, padding: "4px 7px" }} title="Focus one person">
                  <option value="">Everyone</option>
                  {people.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              )}
              <button
                type="button"
                onClick={() => setNeedsHoursOnly((v) => !v)}
                className={`nav-pill${needsHoursOnly ? " active" : ""}`}
                style={{ fontSize: 10.5, padding: "4px 10px" }}
                title="Show only tasks that still need hours"
              >
                Needs hours{missingHours > 0 ? ` (${missingHours})` : ""}
              </button>
            </span>
          }
        >
          Hours by task
        </SectionTitle>

        {shown.length === 0 ? (
          <div style={{ fontSize: 12, color: T.inkMuted, padding: "8px 0" }}>
            {candidates.length === 0
              ? "No open, owned, dated tasks to resource yet."
              : "Nothing matches — clear the filters above."}
          </div>
        ) : (
          orderedGroups.map(([key, groupTasks]) => {
            const resCollapsed = collapsedRes.has(key);
            return (
            <div key={key} style={{ marginBottom: 6 }}>
              <button
                type="button"
                onClick={() => toggleRes(key)}
                title={resCollapsed ? "Expand this project" : "Collapse this project"}
                style={{ display: "flex", alignItems: "baseline", gap: 8, width: "100%", textAlign: "left", cursor: "pointer", background: "none", border: "none", margin: "12px 0 2px", padding: "0 0 4px", borderBottom: `2px solid ${T.roi.navy}` }}
              >
                <span aria-hidden style={{ fontSize: 9, color: T.roi.navy, transform: resCollapsed ? "rotate(-90deg)" : "none", display: "inline-block", width: 10 }}>▼</span>
                <span style={{ fontSize: 12.5, fontWeight: 800, color: T.roi.navy }}>{labelOf(groupTasks[0]!)}</span>
                <span style={{ fontSize: 10.5, color: T.inkMuted }}>
                  {groupTasks.reduce((s, t) => s + (t.estimatedHours ?? 0), 0)}h across {groupTasks.length}
                </span>
              </button>
              {!resCollapsed && groupTasks.map((t) => (
                <div
                  key={t.id}
                  id={`res-${t.id}`}
                  style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "8px 6px",
                    borderBottom: `1px solid ${T.grid}`, borderRadius: flashId === t.id ? 8 : 0,
                    background: flashId === t.id ? "#fff7d6" : "transparent", transition: "background 400ms ease",
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: T.ink }}>{t.title}</span>
                    <span style={{ fontSize: 11, color: T.inkSecondary }}>
                      {t.ownerName}
                      {/* Show the START→DUE bracket the hours spread across, not
                          just the due date — that's how Kellie's team scopes it. */}
                      {t.startDate && t.due
                        ? ` · ${fmtDay(t.startDate)} → ${fmtDay(t.due)}`
                        : t.due
                          ? ` · due ${fmtDay(t.due)}`
                          : ""}
                    </span>
                  </span>
                  <BigHoursInput {...(t.estimatedHours != null ? { hours: t.estimatedHours } : {})} onSet={(h) => onSetHours(t.id, h)} autoFocusMe={false} />
                </div>
              ))}
            </div>
            );
          })
        )}

        {blocked > 0 && (
          <div style={{ fontSize: 11, color: "#8a6d1a", marginTop: 10, lineHeight: 1.5 }}>
            {blocked} open task{blocked === 1 ? "" : "s"} can't be resourced yet — {blocked === 1 ? "it needs" : "they need"} an owner and a due date in Kantata first.
          </div>
        )}
      </div>
    </div>
  );
}

function WeeklyResourcing({ grid, derivedWeeks, fromKantata, unestimated, onPublish }: {
  grid: AllocationGrid;
  /** Weeks in the DERIVED plan — gates the push (can push even when showing live Kantata). */
  derivedWeeks: number;
  fromKantata: boolean;
  unestimated: number;
  onPublish?: () => Promise<WriteResponse>;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<WriteResponse | null>(null);
  const canPush = !!onPublish && derivedWeeks > 0;

  const run = async () => {
    if (!onPublish) return;
    setBusy(true);
    try {
      setResult(await onPublish());
    } catch (err) {
      setResult({ dryRun: true, reason: err instanceof Error ? err.message : "publish failed", applied: 0, failed: 0, results: [] });
    } finally {
      setBusy(false);
    }
  };

  if (grid.weeks.length === 0) {
    return (
      <div style={{ ...card, padding: 14 }}>
        <SectionTitle>Weekly resourcing</SectionTitle>
        <div style={{ fontSize: 12, color: T.inkSecondary, lineHeight: 1.5 }}>
          Add hours to the tasks above and the weekly picture builds itself here — and stays current as
          due dates move, so you never redistribute by hand. {unestimated > 0 ? `${unestimated} owned, dated task${unestimated === 1 ? "" : "s"} still need hours.` : ""}
        </div>
      </div>
    );
  }

  // Most-loaded person first; deepest cell drives the shade scale.
  const people = [...grid.people].sort((a, b) => grid.personTotal(b) - grid.personTotal(a));
  const maxCell = Math.max(1, ...grid.people.flatMap((p) => grid.weeks.map((w) => grid.hoursFor(p, w))));

  return (
    <div style={{ ...card, padding: 14 }}>
      <SectionTitle right={<span style={{ fontSize: 10.5, color: T.inkMuted }}>{fromKantata ? "live from Kantata · Resource Center" : "hours by person · by week — derived, always current"}</span>}>
        Weekly resourcing
      </SectionTitle>
      <div style={{ fontSize: 11.5, color: T.inkSecondary, marginBottom: 10, lineHeight: 1.5 }}>
        {fromKantata
          ? <>Your Kantata Resource Center reservations, pulled in live — not re-entered. Deeper teal = heavier weeks; for who's over capacity across every client, see <b>Team Load</b>.</>
          : <>Built from the hours you set on tasks above, placed in the weeks each task spans. Move a timeline and it re-figures on its own — no weekly redistribute. Deeper teal = heavier weeks; cross-client over-allocation lives on <b>Team Load</b>.</>}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 11.5, minWidth: 480, width: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "6px 10px 6px 2px", color: T.inkMuted, fontWeight: 700, position: "sticky", left: 0, background: T.surface, zIndex: 2 }}>Person</th>
              {grid.weeks.map((w) => (
                <th key={w} style={{ textAlign: "center", padding: "6px 8px", color: T.inkMuted, fontWeight: 700, whiteSpace: "nowrap" }}>{weekLabel(w)}</th>
              ))}
              <th style={{ textAlign: "center", padding: "6px 10px", color: T.roi.navy, fontWeight: 800, position: "sticky", right: 0, background: T.surface, zIndex: 2 }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p} style={{ borderTop: `1px solid ${T.grid}` }}>
                <td style={{ padding: "6px 10px 6px 2px", fontWeight: 600, color: T.ink, whiteSpace: "nowrap", position: "sticky", left: 0, background: T.surface, zIndex: 1 }}>{p}</td>
                {grid.weeks.map((w) => {
                  const h = grid.hoursFor(p, w);
                  const c = resSeqCell(h, maxCell);
                  return (
                    <td key={w} title={`${p} · ${weekLabel(w)} · ${h}h`} style={{ textAlign: "center", padding: "6px 8px", fontVariantNumeric: "tabular-nums", color: h === 0 ? T.grid : c.fg, fontWeight: h > 0 ? 600 : 400, background: c.bg }}>
                      {h === 0 ? "·" : h}
                    </td>
                  );
                })}
                <td style={{ textAlign: "center", padding: "6px 10px", fontWeight: 800, color: T.roi.navy, fontVariantNumeric: "tabular-nums", position: "sticky", right: 0, background: T.surface }}>{grid.personTotal(p)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: `2px solid ${T.grid}` }}>
              <td style={{ padding: "6px 10px 6px 2px", fontWeight: 800, color: T.inkMuted, position: "sticky", left: 0, background: T.surface, zIndex: 1 }}>Team / week</td>
              {grid.weeks.map((w) => (
                <td key={w} style={{ textAlign: "center", padding: "6px 8px", fontWeight: 700, color: T.inkSecondary, fontVariantNumeric: "tabular-nums" }}>{Math.round(grid.weekTotal(w)) || "·"}</td>
              ))}
              <td style={{ textAlign: "center", padding: "6px 10px", fontWeight: 800, color: T.roi.navy, fontVariantNumeric: "tabular-nums", position: "sticky", right: 0, background: T.surface }}>
                {Math.round(grid.weeks.reduce((s, w) => s + grid.weekTotal(w), 0))}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {fromKantata && (
        <div style={{ fontSize: 11, color: T.inkMuted, marginTop: 12, lineHeight: 1.5 }}>
          Live from Kantata's Resource Center — no double entry. As task timelines shift, this stays the single place
          the weekly picture is kept current.
        </div>
      )}
      {canPush && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void run()}>
            {busy ? "Sending…" : fromKantata ? "Update Kantata with this plan →" : "Send weekly reservations to Kantata →"}
          </button>
          <span style={{ fontSize: 11, color: T.inkMuted }}>
            {fromKantata
              ? "Pushes the plan's per-person hours back to Kantata — updates the existing reservation, doesn't duplicate."
              : "Reserves each person's hours on the week they fall — accurate per person, not split evenly across a task."}
          </span>
        </div>
      )}
      {!fromKantata && unestimated > 0 && (
        <div style={{ fontSize: 11, color: "#8a6d1a", marginTop: 6 }}>
          {unestimated} owned, dated task{unestimated === 1 ? "" : "s"} still {unestimated === 1 ? "has" : "have"} no hours — {unestimated === 1 ? "it isn't" : "they aren't"} in the numbers above yet.
        </div>
      )}
      {result && (
        <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 6, background: result.failed > 0 ? "#fdeced" : "#eaf6ee", fontSize: 11.5, color: T.ink }}>
          {result.dryRun ? (
            <><strong>Preview only — nothing was sent.</strong> {result.reason ?? ""} These reservations are valid and will post once writing to Kantata is switched on.</>
          ) : (
            <><strong>{result.applied} weekly reservation{result.applied === 1 ? "" : "s"} sent{result.failed > 0 ? `, ${result.failed} failed` : ""}.</strong> {result.failed > 0 ? result.results.filter((r) => !r.ok).map((r) => r.error).join(" · ") : "Kantata now reflects this plan."}</>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The client-facing document surface: what's been shared with the client, and
 * anything waiting on their decision. Approval requests lead; the client can
 * approve or ask for changes with a note. Opens light up only once SharePoint
 * is connected — until then the card says so rather than implying silence.
 */
/** Same idea as clientApproval.ts's `approvalState`/`approvalLabel`, over
 * `collab.file_approval`'s own flat shape (`MsAccountFileApproval`) instead
 * of the retired `ClientShare` — kept separate rather than reshaping one
 * into the other, since clientApproval.ts still serves the OLD model until
 * Phase 7's final cutover. */
function fileApprovalState(a: MsAccountFileApproval): ApprovalState {
  if (a.purpose === "fyi") return "fyi";
  if (a.decision === "approved") return "approved";
  if (a.decision === "changes") return "changes";
  return "pending";
}
function fileApprovalLabel(a: MsAccountFileApproval): string {
  switch (fileApprovalState(a)) {
    case "fyi":
      return "Shared to review";
    case "approved":
      return `Approved ${(a.decidedAt ?? "").slice(0, 10)}`.trim();
    case "changes":
      return "Changes requested";
    default:
      return "Awaiting your approval";
  }
}

function ClientDocuments({ approvals, onDecision }: { approvals: MsAccountFileApproval[]; onDecision?: (approvalId: string, decision: "approved" | "changes", note?: string) => void }) {
  const [changingId, setChangingId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const awaiting = approvals.filter((a) => fileApprovalState(a) === "pending");
  if (approvals.length === 0) return null;

  const row = (f: MsAccountFileApproval) => {
    const st = fileApprovalState(f);
    const canDecide = onDecision && st === "pending";
    return (
      <div key={f.id} style={{ padding: "9px 0", borderBottom: `1px solid ${T.grid}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span aria-hidden style={{ fontSize: 13 }}>{glyphFor(f.name)}</span>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: T.ink }}>{f.name}</span>
          <span style={clientShareChip(st)}>{fileApprovalLabel(f)}</span>
          {f.note && st === "changes" && <span style={{ fontSize: 11, color: "#9b2c2c" }}>“{f.note}”</span>}
          {canDecide && (
            <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              <button type="button" className="btn btn-primary btn-sm" style={{ fontSize: 10.5 }} onClick={() => onDecision(f.id, "approved")}>Approve</button>
              <button type="button" className="btn btn-sm" style={{ fontSize: 10.5 }} onClick={() => { setChangingId(f.id); setNote(""); }}>Request changes</button>
            </span>
          )}
        </div>
        {changingId === f.id && canDecide && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, paddingLeft: 22 }}>
            <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="What should change?" className="input" style={{ flex: 1, minWidth: 160, fontSize: 11.5, padding: "4px 8px" }} />
            <button type="button" className="btn btn-primary btn-sm" disabled={!note.trim()} onClick={() => { onDecision(f.id, "changes", note.trim()); setChangingId(null); setNote(""); }}>Send</button>
            <button type="button" className="btn-link" style={{ fontSize: 11 }} onClick={() => setChangingId(null)}>Cancel</button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ ...card, ...(awaiting.length > 0 ? { borderLeft: `3px solid #e7c66f` } : {}) }}>
      <SectionTitle right={awaiting.length > 0 ? <span style={clientShareChip("pending")}>{awaiting.length} awaiting you</span> : undefined}>
        Documents shared with you
      </SectionTitle>
      {approvals.map(row)}
      <div style={{ fontSize: 10.5, color: T.inkMuted, marginTop: 8, lineHeight: 1.5 }}>
        Approvals and change requests are recorded with who and when. Whether a document has been
        opened will show here once the SharePoint connection is switched on.
      </div>
    </div>
  );
}

/**
 * The AI weekly update, on the client dashboard — Josh's offer on the call. It
 * drafts a plain-language "where your project is" note from the CLIENT-VISIBLE
 * deliverables (never internal tasks or any hours), the PM edits it, and posts
 * it so it reaches the client in Discussions. Draft-then-approve: the client
 * only ever sees what the PM sends.
 */
function WeeklyClientUpdate({ account, deliverables, onPost }: { account: ClientAccount; deliverables: Task[]; onPost?: (body: string, topic?: string) => void }) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const generate = () => { setDraft(composeClientDigest(account, deliverables, AS_OF_TODAY())); setOpen(true); setSent(false); };
  return (
    <div style={{ ...card, borderColor: T.roi.cyan, background: "#f2fbfd" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: "#16708f" }}>📣 Weekly update for the client</span>
        {!open && (
          <button type="button" className="btn btn-ai btn-sm" onClick={generate}>Draft this week's update →</button>
        )}
      </div>
      <div style={{ fontSize: 11, color: T.inkMuted, marginTop: 4, lineHeight: 1.5 }}>
        AI drafts it from the deliverables the client can already see — you edit, then post. Nothing internal, no hours.
      </div>
      {open && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={10} style={{ width: "100%", fontSize: 12, lineHeight: 1.5, padding: 10, border: `1px solid ${T.grid}`, borderRadius: 8, fontFamily: "inherit", resize: "vertical" }} />
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" className="btn btn-primary btn-sm" disabled={!onPost || !draft.trim() || sent} onClick={() => { onPost?.(draft.trim(), "Weekly update"); setSent(true); setOpen(false); }}>
              {sent ? "✓ Posted to Discussions" : "Post to the client →"}
            </button>
            <button type="button" className="btn-link" style={{ fontSize: 11 }} onClick={generate}>Regenerate</button>
            <button type="button" className="btn-link" style={{ fontSize: 11 }} onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
      {sent && <div style={{ fontSize: 11, color: "#116a43", marginTop: 8 }}>Posted — the client sees it in Discussions.</div>}
    </div>
  );
}

function ClientDashboard({ account, tasks, fileApprovals, liveContext, onRemindDeliverable, onToggleClientVisible, onPost, onClientDecision, onDiscuss, mentionRoster = [], goTo }: { account: ClientAccount; tasks: Task[]; fileApprovals: MsAccountFileApproval[]; liveContext?: AccountLiveContext; onRemindDeliverable?: (taskId: string) => void; onToggleClientVisible?: (taskId: string) => void; onPost?: (body: string, topic?: string) => void; onClientDecision?: (approvalId: string, decision: "approved" | "changes", note?: string) => void; onDiscuss?: (topic: string) => void; mentionRoster?: readonly MentionPerson[]; goTo?: (tab: ClientTab) => void }) {
  const done = tasks.filter((t) => t.status === "done").length;
  const pct = tasks.length > 0 ? Math.round((done / tasks.length) * 100) : 0;
  const today = AS_OF_TODAY();
  // The curated client view (client call — Kellie): clients see only the
  // deliverables flagged for them, not every internal step. Sorted by date so
  // it reads as "when copy comes, when feedback's due, when designs land".
  const deliverables = tasks
    .filter((t) => t.clientVisible)
    .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));
  const openDeliverables = deliverables.filter((t) => t.status !== "done");
  const nextUp = openDeliverables.find((t) => t.due && t.due >= today) ?? openDeliverables[0];
  const overdueCount = deliverables.filter((t) => t.status !== "done" && t.due && t.due < today).length;
  const dvDone = deliverables.filter((t) => t.status === "done").length;
  const dvPct = deliverables.length > 0 ? Math.round((dvDone / deliverables.length) * 100) : 0;
  const [dash, setDash] = useState("");
  // Client-safe by content: milestone titles and dates only — the full
  // schedule Kantata holds, not just each campaign's next milestone.
  const schedule = (liveContext?.projects ?? [])
    .flatMap((p) =>
      p.milestones
        .filter((m) => m.state !== "completed" && m.dueDate >= today)
        .map((m) => ({ ...m, project: p.title })),
    )
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  // Click a campaign to unfold everything the workspace knows about it.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const relatedTo = (campaignName: string) => {
    const words = campaignName.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    return {
      tasks: tasks.filter((t) => words.some((w) => t.title.toLowerCase().includes(w))),
      messages: account.thread.filter((m) => words.some((w) => m.body.toLowerCase().includes(w))),
    };
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ ...card, background: "#eef3f9", borderColor: navy }}>
        <span style={{ fontSize: 12, color: navy, fontWeight: 600 }}>
          Everything on this page is client-visible. Internal AGP financials never appear in client
          workspaces — by rule, not by discipline.
        </span>
      </div>

      {/* The AI weekly update — drafted from client deliverables, PM posts it. */}
      <WeeklyClientUpdate account={account} deliverables={deliverables} {...(onPost ? { onPost } : {})} />

      {/* Documents shared with the client — the thing a client actually acts on
          (Cara: files shared with the client, some for approval). Their files
          live here; delivery progress sits below. */}
      <ClientDocuments approvals={fileApprovals} {...(onClientDecision ? { onDecision: onClientDecision } : {})} />

      {/* Status summary — the "job tracker" read the client wanted at a glance. */}
      {deliverables.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
          <div style={{ ...card, padding: "12px 14px" }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: T.inkMuted }}>Progress</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: navy, marginTop: 2 }}>{dvPct}%</div>
            <div style={{ height: 6, background: T.grid, borderRadius: 999, overflow: "hidden", marginTop: 6 }}>
              <span style={{ display: "block", height: "100%", width: `${dvPct}%`, background: "#1f9457" }} />
            </div>
            <div style={{ fontSize: 10.5, color: T.inkMuted, marginTop: 5 }}>{dvDone} of {deliverables.length} delivered</div>
          </div>
          <div style={{ ...card, padding: "12px 14px" }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: T.inkMuted }}>Next up</div>
            {nextUp ? (
              <>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, marginTop: 4, lineHeight: 1.3 }}>{nextUp.title}</div>
                <div style={{ fontSize: 11, color: T.inkSecondary, marginTop: 3 }}>{nextUp.due ? fmtDay(nextUp.due) : "no date set"}</div>
              </>
            ) : <div style={{ fontSize: 12, color: T.inkMuted, marginTop: 4 }}>All caught up 🎉</div>}
          </div>
          <div style={{ ...card, padding: "12px 14px" }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: T.inkMuted }}>Needs attention</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: overdueCount > 0 ? T.status.critical : "#1f9457", marginTop: 2 }}>{overdueCount}</div>
            <div style={{ fontSize: 10.5, color: T.inkMuted, marginTop: 5 }}>{overdueCount === 0 ? "nothing past due" : `past due — ${overdueCount === 1 ? "1 item" : `${overdueCount} items`}`}</div>
          </div>
        </div>
      )}

      {/* Curated deliverables — the limited status view the client sees. */}
      <div style={card}>
        <SectionTitle right={<span style={{ fontSize: 10.5, color: T.inkMuted }}>{deliverables.length} shared with the client</span>}>
          Deliverables — what the client sees
        </SectionTitle>
        {deliverables.length === 0 ? (
          <div style={{ fontSize: 12, color: T.inkMuted, lineHeight: 1.55 }}>
            Nothing is shared with the client yet. On the <button type="button" className="btn-link" style={{ fontSize: 12 }} onClick={() => goTo?.("plan")}>Project Plan</button>, mark a task
            “→ client” to flag it as a deliverable — so the client sees when copy comes, when their feedback is due, and when designs land, without the full peek behind the curtain.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {deliverables.map((t) => {
              const overdue = t.status !== "done" && !!t.due && t.due < today;
              return (
                <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: `1px solid ${T.grid}` }}>
                  <span aria-hidden style={{ fontSize: 12, color: t.status === "done" ? "#1f9457" : overdue ? T.status.critical : T.inkMuted }}>{t.status === "done" ? "✓" : "○"}</span>
                  <span style={{ flex: 1, fontSize: 12.5, color: t.status === "done" ? T.inkMuted : T.ink, textDecoration: t.status === "done" ? "line-through" : "none" }}>{t.title}</span>
                  {t.due && (
                    <span style={{ fontSize: 11, fontWeight: overdue ? 700 : 400, color: overdue ? T.status.critical : T.inkSecondary, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                      {overdue ? "⚠ " : ""}{fmtDay(t.due)}
                    </span>
                  )}
                  {onDiscuss && (
                    <button type="button" className="btn-link" style={{ fontSize: 11, whiteSpace: "nowrap" }} title={`Discuss "${t.title}" — opens Discussions scoped to it`} onClick={() => onDiscuss(t.title)}>💬</button>
                  )}
                  {onRemindDeliverable && t.status !== "done" && t.due && (
                    <button type="button" className="btn btn-secondary btn-sm" title="Send the client a reminder about this deliverable" onClick={() => onRemindDeliverable(t.id)}>⏰ Remind</button>
                  )}
                  {onToggleClientVisible && (
                    <button type="button" className="btn-link" style={{ fontSize: 11 }} title="Stop sharing this with the client" onClick={() => onToggleClientVisible(t.id)}>Hide</button>
                  )}
                </div>
              );
            })}
            <div style={{ fontSize: 10.5, color: T.inkMuted, marginTop: 8, lineHeight: 1.5 }}>
              This is the client-facing subset — flag deliverables on the Project Plan with “→ client”. Auto-reminders when a client hasn't opened a document arrive with the M365 layer.
            </div>
          </div>
        )}
      </div>

      <div style={card}>
        <SectionTitle>Campaigns</SectionTitle>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                {["Campaign", "Status", "Next milestone", "Date"].map((h) => (
                  <th key={h} style={{ textAlign: "left", fontSize: 11, color: T.inkMuted, fontWeight: 700, padding: "6px 8px", borderBottom: `1px solid ${T.grid}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {account.campaigns.map((c) => {
                const isOpen = expandedId === c.id;
                const rel = isOpen ? relatedTo(c.name) : null;
                return (
                  <React.Fragment key={c.id}>
                    <tr
                      className="table-row-hover"
                      onClick={() => setExpandedId(isOpen ? null : c.id)}
                      title={isOpen ? "Collapse" : "Show campaign detail"}
                      style={{ cursor: "pointer" }}
                    >
                      <td style={{ fontSize: 12.5, color: T.ink, fontWeight: 600, padding: "8px" }}>
                        <span aria-hidden style={{ display: "inline-block", width: 14, color: T.inkMuted, transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s ease" }}>›</span>
                        {c.name}
                        {c.source === "kantata" && (
                          <span style={{ marginLeft: 8 }}>
                            <KantataChip compact />
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "8px" }}><TagChip>{c.status}</TagChip></td>
                      <td style={{ fontSize: 12, color: T.inkSecondary, padding: "8px" }}>{c.nextMilestone ?? "—"}</td>
                      <td style={{ fontSize: 12, color: T.inkSecondary, padding: "8px", fontVariantNumeric: "tabular-nums" }}>{c.nextMilestoneDate ? fmtDay(c.nextMilestoneDate) : "—"}</td>
                    </tr>
                    {isOpen && rel && (
                      <tr>
                        <td colSpan={4} style={{ padding: "0 8px 12px 22px" }}>
                          <div style={{ background: "#f7f9fc", border: `1px solid ${T.grid}`, borderRadius: 8, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: T.inkMuted, textTransform: "uppercase", letterSpacing: 0.5 }}>
                              Campaign detail
                            </div>
                            <div style={{ fontSize: 12, color: T.inkSecondary }}>
                              {c.nextMilestone
                                ? <>Next milestone: <strong style={{ color: T.ink }}>{c.nextMilestone}</strong>{c.nextMilestoneDate ? ` — ${fmtDay(c.nextMilestoneDate)}` : ""}.</>
                                : "No milestone scheduled."}{" "}
                              Status: {c.status}.
                            </div>
                            {rel.tasks.length > 0 && (
                              <div>
                                <div style={{ fontSize: 11, fontWeight: 700, color: T.inkMuted, marginBottom: 3 }}>Related tasks</div>
                                {rel.tasks.map((t) => (
                                  <div key={t.id} style={{ fontSize: 12, color: T.inkSecondary, padding: "2px 0" }}>
                                    {t.status === "done" ? "✓ " : "○ "}
                                    {t.title}
                                    {t.ownerName ? ` — ${t.ownerName}` : ""}
                                    {t.due ? ` · due ${fmtDay(t.due)}` : ""}
                                  </div>
                                ))}
                              </div>
                            )}
                            {rel.messages.length > 0 && (
                              <div>
                                <div style={{ fontSize: 11, fontWeight: 700, color: T.inkMuted, marginBottom: 3 }}>Mentioned in discussions</div>
                                {rel.messages.slice(-2).map((m) => (
                                  <div key={m.id} style={{ fontSize: 12, color: T.inkSecondary, padding: "2px 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    <strong style={{ color: T.ink }}>{m.author}:</strong> {m.body}
                                  </div>
                                ))}
                              </div>
                            )}
                            {rel.tasks.length === 0 && rel.messages.length === 0 && (
                              <div style={{ fontSize: 12, color: T.inkMuted }}>No tasks or discussions reference this campaign yet.</div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {schedule.length > 0 && (
        <div style={card}>
          <SectionTitle
            right={<span style={{ fontSize: 10.5, fontWeight: 700, color: "#116a43", background: "#e3f4ec", borderRadius: 999, padding: "2px 9px" }}>from Kantata</span>}
          >
            Milestone schedule
          </SectionTitle>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  {["Milestone", "Campaign", "Date"].map((h) => (
                    <th key={h} style={{ textAlign: "left", fontSize: 11, color: T.inkMuted, fontWeight: 700, padding: "6px 8px", borderBottom: `1px solid ${T.grid}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {schedule.slice(0, 10).map((m) => (
                  <tr key={`${m.project}-${m.title}-${m.dueDate}`}>
                    <td style={{ fontSize: 12.5, color: T.ink, fontWeight: 600, padding: "7px 8px" }}>
                      {m.title}
                      {m.hard && (
                        <span title="Hard date — cannot move" style={{ fontSize: 9.5, fontWeight: 800, color: "#8a6d1a", background: "#faf3dc", border: "1px solid #e7c66f", borderRadius: 999, padding: "1px 7px", marginLeft: 8, textTransform: "uppercase", letterSpacing: 0.4 }}>
                          hard date
                        </span>
                      )}
                    </td>
                    <td style={{ fontSize: 12, color: T.inkSecondary, padding: "7px 8px" }}>{m.project}</td>
                    <td style={{ fontSize: 12, color: T.inkSecondary, padding: "7px 8px", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{fmtDay(m.dueDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {schedule.length > 10 && (
            <div style={{ fontSize: 10.5, color: T.inkMuted, marginTop: 6 }}>+{schedule.length - 10} more scheduled dates</div>
          )}
        </div>
      )}
      <div style={card}>
        <SectionTitle>Delivery progress</SectionTitle>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1, height: 12, background: "#f0efec", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: navy, borderRadius: 4 }} />
          </div>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: T.ink }}>{done}/{tasks.length} tasks complete</span>
        </div>
      </div>

      {/* Discussion right on the dashboard — the client and team talk here too. */}
      {onPost && (
        <div style={card}>
          <SectionTitle right={goTo ? <button type="button" className="btn-link" style={{ fontSize: 11 }} onClick={() => goTo("discussions")}>Open all discussions →</button> : undefined}>
            Discussion
          </SectionTitle>
          {account.thread.length === 0 ? (
            <div style={{ fontSize: 12, color: T.inkMuted, marginBottom: 8 }}>No messages yet — post an update or a question for the team.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflowY: "auto", marginBottom: 8 }}>
              {account.thread.slice(-4).map((m) => (
                <div key={m.id} style={{ background: "#f7f6f3", borderLeft: `3px solid ${T.grid}`, borderRadius: 6, padding: "7px 9px" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: T.ink }}>{m.author}</span>
                    {m.topic && <span style={{ fontSize: 9, fontWeight: 800, color: navy, background: "#eef2fb", borderRadius: 4, padding: "1px 6px" }}>{m.topic}</span>}
                    <span style={{ fontSize: 10, color: T.inkMuted }}>{m.at.slice(0, 10)}</span>
                  </div>
                  <div style={{ fontSize: 12, color: T.inkSecondary, marginTop: 2, whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{m.body}</div>
                </div>
              ))}
            </div>
          )}
          <MentionTextarea
            value={dash}
            onChange={setDash}
            roster={mentionRoster}
            onSubmit={() => { if (dash.trim()) { onPost(dash.trim()); setDash(""); } }}
            rows={2}
            placeholder="Post an update or question… (@ to mention, Ctrl+Enter to post)"
          />
          <button type="button" className="btn btn-primary btn-sm" style={{ marginTop: 6 }} disabled={!dash.trim()} onClick={() => { onPost(dash.trim()); setDash(""); }}>
            Post
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Review import — the user populates the workspace when THEY choose.
// Candidates arrive as plain data (guest graph stays clean); nothing lands
// until "Import selected" is clicked. Existing campaigns are removable here
// too — the undo for a bad import.
// ---------------------------------------------------------------------------

export interface ImportCandidate {
  name: string;
  status: "active" | "planned" | "complete";
  nextMilestone?: string;
  nextMilestoneDate?: string;
  /** Kantata workspace id, when this candidate came from a matched project
   * (never set for a HubSpot deal) — mirrors campaignImport.ts's
   * ImportedCampaign, which this type is structurally kept in sync with. */
  kantataProjectId?: string;
}

/** An open Kantata task not yet in this workspace's plan — user-gated. */
export interface TaskCandidate {
  title: string;
  status: TaskStatus;
  due?: string;
  project: string;
  /** Kantata story id — carried so edits after import can be written back. */
  kantataStoryId?: string;
  kantataProjectId?: string;
  /** The milestone (real project) this task belongs to. */
  projectLabel?: string;
  kantataMilestoneId?: string;
  /** Scheduled hours + start from Kantata — so resourcing populates on import. */
  estimatedHours?: number;
  startDate?: string;
}

// ---------------------------------------------------------------------------
// Push to Kantata — the write half, and the mirror image of Review import.
// Reads flow in automatically; writes NEVER do. Every proposed change is shown
// as from → to, ticked by a person, and only then sent. See
// workspace/kantataWrite.ts and api/kantata-write.ts.
// ---------------------------------------------------------------------------

function KantataPush({
  writes,
  onPush,
}: {
  writes: PendingWrite[];
  onPush: (refs: string[]) => Promise<WriteResponse>;
}) {
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<WriteResponse | null>(null);

  const chosen = writes.filter((w) => !skipped.has(w.ref));
  const toggle = (ref: string) =>
    setSkipped((s) => {
      const next = new Set(s);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });

  const run = async () => {
    setBusy(true);
    try {
      setResult(await onPush(chosen.map((w) => w.ref)));
    } catch (err) {
      setResult({
        dryRun: true,
        reason: err instanceof Error ? err.message : "push failed",
        applied: 0,
        failed: chosen.length,
        results: [],
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ ...card, padding: 14, marginBottom: 14, borderLeft: `3px solid ${T.series1}` }}>
      <SectionTitle>Send these changes to Kantata</SectionTitle>
      <div style={{ fontSize: 12, color: T.inkSecondary, margin: "2px 0 10px" }}>
        {writes.length} {writes.length === 1 ? "task differs" : "tasks differ"} from Kantata. Nothing is sent until you
        choose it — Kantata stays the system of record for capacity.
      </div>

      {writes.map((w) => (
        <label
          key={w.ref}
          style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 4px", borderBottom: `1px solid ${T.grid}`, cursor: "pointer" }}
        >
          <input type="checkbox" checked={!skipped.has(w.ref)} onChange={() => toggle(w.ref)} style={{ marginTop: 3 }} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: T.ink }}>{w.taskTitle}</span>
            <span style={{ display: "block", fontSize: 11, color: T.inkMuted, marginBottom: 2 }}>{w.project}</span>
            {w.changes.map((c) => (
              <span key={c.field} style={{ display: "block", fontSize: 11.5, color: T.inkSecondary }}>
                {c.field}: <span style={{ textDecoration: "line-through", color: T.inkMuted }}>{c.from}</span> →{" "}
                <strong style={{ color: T.ink }}>{c.to}</strong>
              </span>
            ))}
          </span>
        </label>
      ))}

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-primary" disabled={busy || chosen.length === 0} onClick={() => void run()}>
          {busy ? "Sending…" : `Send to Kantata (${chosen.length}) →`}
        </button>
        <span style={{ fontSize: 11, color: T.inkMuted }}>Every send is logged with who sent it and when.</span>
      </div>

      {result && (
        <div
          style={{
            marginTop: 10,
            padding: "8px 10px",
            borderRadius: 6,
            background: result.failed > 0 ? "#fdeced" : "#eaf6ee",
            fontSize: 11.5,
            color: T.ink,
          }}
        >
          {result.dryRun ? (
            <>
              <strong>Preview only — nothing was sent.</strong> {result.reason ?? ""} The changes above are valid and will
              go through once writing is switched on.
            </>
          ) : (
            <>
              <strong>
                {result.applied} sent{result.failed > 0 ? `, ${result.failed} failed` : ""}.
              </strong>{" "}
              {result.failed > 0
                ? result.results.filter((r) => !r.ok).map((r) => r.error).join(" · ")
                : "Kantata now matches this plan."}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ImportReview({
  candidates,
  taskCandidates,
  campaigns,
  onImport,
  onImportTasks,
  onImportAll,
  onRemoveCampaign,
  onClearCampaigns,
  onClose,
}: {
  candidates: ImportCandidate[];
  taskCandidates: TaskCandidate[];
  campaigns: ClientAccount["campaigns"];
  onImport: (selected: ImportCandidate[]) => void;
  onImportTasks?: ((selected: TaskCandidate[]) => void) | undefined;
  onImportAll?: (() => void) | undefined;
  onRemoveCampaign: (campaignId: string) => void;
  onClearCampaigns: () => void;
  onClose: () => void;
}) {
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const [tasksDeselected, setTasksDeselected] = useState<Set<string>>(new Set());
  // A task's identity is its Kantata story id, NOT its title. At AGP every
  // milestone under a fiscal-year contract carries the same phase names
  // ("Create Copy Document" ×10), so keying by title would collapse ten real
  // tasks into one. Fall back to project+title only for tasks with no id.
  const taskKey = (t: TaskCandidate): string => t.kantataStoryId ?? `${t.projectLabel ?? t.project}::${t.title}`;
  const selected = candidates.filter((c) => !deselected.has(c.name));
  const selectedTasks = taskCandidates.filter((t) => !tasksDeselected.has(taskKey(t)));
  const toggle = (name: string) =>
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  const toggleTask = (key: string) =>
    setTasksDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    // Modal overlay — floats above the current tab so opening Review import
    // never disturbs Home (or whatever tab you're on). Click the backdrop or
    // Close to dismiss; the panel itself scrolls if the candidate list is long.
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Review import"
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(16,21,46,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 16px", overflowY: "auto" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ ...card, borderColor: navy, borderWidth: 1.5, maxWidth: 900, width: "100%", maxHeight: "calc(100vh - 80px)", overflowY: "auto", boxShadow: "0 12px 40px rgba(0,0,0,0.25)" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <SectionTitle>Review import — nothing lands until you say so</SectionTitle>
          <button type="button" className="btn-link" style={{ fontSize: 11.5 }} onClick={onClose}>
            Close
          </button>
        </div>

      {candidates.length + taskCandidates.length > 0 && onImportAll && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0 10px", borderBottom: `1px solid ${T.grid}`, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              onImportAll();
              onClose();
            }}
          >
            ⚡ Import everything ({candidates.length} campaign{candidates.length === 1 ? "" : "s"} · {taskCandidates.length} task{taskCandidates.length === 1 ? "" : "s"}) →
          </button>
          <span style={{ fontSize: 11, color: T.inkMuted }}>
            All Kantata data for this client, one click — or pick selectively below. Remove is always one click away.
          </span>
        </div>
      )}

      {candidates.length === 0 && taskCandidates.length === 0 ? (
        <div style={{ fontSize: 12.5, color: T.inkMuted, padding: "6px 0" }}>
          Nothing new matched this client in Kantata. If their work is titled under a different
          name or abbreviation, refresh (⟳ pill, top right) — and if it stays empty, send us one
          real project title and we tune the matcher to it.
        </div>
      ) : candidates.length === 0 ? null : (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.inkMuted, textTransform: "uppercase", letterSpacing: 0.5, margin: "4px 0 6px" }}>
            Matched in Kantata — uncheck anything that isn't this client's
          </div>
          {candidates.map((c) => (
            <label
              key={c.name}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 4px", borderBottom: `1px solid ${T.grid}`, cursor: "pointer" }}
            >
              <input type="checkbox" checked={!deselected.has(c.name)} onChange={() => toggle(c.name)} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: T.ink }}>{c.name}</span>
                <span style={{ fontSize: 11, color: T.inkSecondary }}>
                  {c.status}
                  {c.nextMilestone && c.nextMilestoneDate ? ` · next: ${c.nextMilestone} (${fmtDay(c.nextMilestoneDate)})` : ""}
                </span>
              </span>
              <KantataChip compact />
            </label>
          ))}
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={selected.length === 0}
              onClick={() => {
                onImport(selected);
                onClose();
              }}
            >
              Import selected ({selected.length}) →
            </button>
            <span style={{ fontSize: 11, color: T.inkMuted }}>
              Milestones ride along and land on Home &amp; the dashboard.
            </span>
          </div>
        </>
      )}

      {taskCandidates.length > 0 && onImportTasks && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.inkMuted, textTransform: "uppercase", letterSpacing: 0.5, margin: "16px 0 6px" }}>
            Open tasks in Kantata — bring them into the project plan
          </div>
          {taskCandidates.map((t) => (
            <label
              key={taskKey(t)}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 4px", borderBottom: `1px solid ${T.grid}`, cursor: "pointer" }}
            >
              <input type="checkbox" checked={!tasksDeselected.has(taskKey(t))} onChange={() => toggleTask(taskKey(t))} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: T.ink }}>{t.title}</span>
                <span style={{ fontSize: 11, color: T.inkSecondary }}>
                  {t.status === "doing" ? "in progress" : "to do"}
                  {t.due ? ` · due ${fmtDay(t.due)}` : ""}
                  {/* Prefer the real project (milestone) over the workspace
                      title, so an imported task carries the project it's under. */}
                  {" · "}{t.projectLabel ?? t.project}
                </span>
              </span>
            </label>
          ))}
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={selectedTasks.length === 0}
              onClick={() => {
                onImportTasks(selectedTasks);
                onClose();
              }}
            >
              Import tasks ({selectedTasks.length}) →
            </button>
            <span style={{ fontSize: 11, color: T.inkMuted }}>
              They land on the Project Plan labeled “from Kantata” — one list, no double entry.
            </span>
          </div>
        </>
      )}

      {campaigns.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.inkMuted, textTransform: "uppercase", letterSpacing: 0.5, margin: "16px 0 6px" }}>
            Already in this workspace
          </div>
          {campaigns.map((c) => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 4px", borderBottom: `1px solid ${T.grid}` }}>
              <span style={{ flex: 1, fontSize: 12.5, color: T.ink }}>{c.name}</span>
              <span style={{ fontSize: 11, color: T.inkMuted }}>{c.status}</span>
              <button type="button" title="Remove this campaign" className="btn btn-danger btn-sm" onClick={() => onRemoveCampaign(c.id)}>
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ marginTop: 8 }}
            onClick={() => {
              if (window.confirm(`Remove all ${campaigns.length} campaigns from this workspace?`)) onClearCampaigns();
            }}
          >
            Remove all ({campaigns.length})
          </button>
        </>
      )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Weekly digest composer — AI drafts, the account manager approves.
// Research-backed (docs/research-best-practices.md): AI status drafting is
// the highest-ROI AI feature in the category, and draft-then-approve is the
// pattern behind every liked implementation. Composed only from client-safe
// account data.
// ---------------------------------------------------------------------------

/**
 * People & collaboration hub — reachable from the navy band on EVERY tab.
 * Add an AGP teammate, invite the client/contractor, or post an update
 * without leaving whatever you're doing. This is what makes "wherever I am
 * in the client, I can collaborate" true.
 */
function CollaborateHub({
  members,
  externals,
  people,
  onAddMember,
  onAddNewMember,
  onAddExternal,
  onPost,
  onOpenAccess,
  onClose,
}: {
  members: WorkspaceAccountPayload["members"];
  externals: WorkspaceAccountPayload["externals"];
  people: { id: string; name: string; title: string }[];
  onAddMember?: (personId: string) => void;
  onAddNewMember?: (name: string, title: string) => void;
  onAddExternal: (name: string, org: string, role: ExternalMember["role"]) => void;
  onPost: (body: string, topic?: string) => void;
  onOpenAccess: () => void;
  onClose: () => void;
}) {
  const [msg, setMsg] = useState("");
  const [invName, setInvName] = useState("");
  const [invOrg, setInvOrg] = useState("");
  const [invRole, setInvRole] = useState<ExternalMember["role"]>("client");
  const [newName, setNewName] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [addingNew, setAddingNew] = useState(false);
  const onAccount = new Set(members.map((m) => m.personId));
  const addable = people.filter((p) => !onAccount.has(p.id));

  const label = { fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase" as const, color: T.inkMuted, margin: "12px 0 5px" };
  return (
    <>
      {/* click-away backdrop */}
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 55 }} />
      <div
        role="dialog"
        aria-label="People and collaboration"
        style={{ position: "absolute", top: 40, right: 0, width: 320, maxHeight: "76vh", overflowY: "auto", background: "#fff", color: T.ink, border: `1px solid ${T.grid}`, borderRadius: 12, boxShadow: "0 14px 40px rgba(16,21,46,0.24)", padding: 16, zIndex: 56, textAlign: "left" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontSize: 13.5, fontWeight: 800, color: T.roi.navy }}>People & collaboration</span>
          <button type="button" className="btn-link" style={{ fontSize: 11 }} onClick={onClose}>Close</button>
        </div>

        <div style={label}>On this account ({members.length + externals.length})</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {members.map((m) => (
            <div key={m.personId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
              <Avatar name={m.name} size={24} />
              <span style={{ fontSize: 12.5, color: T.ink, flex: 1 }}>{m.name}{m.title ? <span style={{ color: T.inkMuted }}> · {m.title}</span> : null}</span>
            </div>
          ))}
          {externals.map((e) => (
            <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
              <Avatar name={e.name} size={24} />
              <span style={{ fontSize: 12.5, color: T.ink, flex: 1 }}>{e.name}<span style={{ color: T.inkMuted }}> · {e.org} ({e.role})</span></span>
            </div>
          ))}
        </div>

        {(onAddMember || onAddNewMember) && (
          <>
            <div style={label}>Add a team member</div>
            {onAddMember && addable.length > 0 && (
              <select
                className="select"
                defaultValue=""
                style={{ width: "100%", fontSize: 12.5 }}
                onChange={(e) => {
                  if (e.target.value) {
                    onAddMember(e.target.value);
                    e.target.value = "";
                  }
                }}
              >
                <option value="" disabled>Choose from the Kantata roster…</option>
                {addable.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} — {p.title}</option>
                ))}
              </select>
            )}
            {onAddNewMember && !addingNew && (
              <button type="button" className="btn-link" style={{ fontSize: 11, marginTop: 5 }} onClick={() => setAddingNew(true)}>
                + Add someone not in Kantata
              </button>
            )}
            {onAddNewMember && addingNew && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
                <input className="input" style={{ fontSize: 12.5 }} placeholder="Name" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
                <input className="input" style={{ fontSize: 12.5 }} placeholder="Role / title (e.g. Freelance Designer)" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={!newName.trim()}
                    onClick={() => {
                      onAddNewMember(newName.trim(), newTitle.trim());
                      setNewName("");
                      setNewTitle("");
                      setAddingNew(false);
                    }}
                  >
                    Add to team
                  </button>
                  <button type="button" className="btn-link" style={{ fontSize: 11 }} onClick={() => setAddingNew(false)}>Cancel</button>
                </div>
              </div>
            )}
          </>
        )}

        <div style={label}>Invite client / contractor</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <input className="input" style={{ fontSize: 12.5 }} placeholder="Name" value={invName} onChange={(e) => setInvName(e.target.value)} />
          <div style={{ display: "flex", gap: 6 }}>
            <input className="input" style={{ fontSize: 12.5, flex: 1 }} placeholder="Organization" value={invOrg} onChange={(e) => setInvOrg(e.target.value)} />
            <select className="select" style={{ fontSize: 12.5 }} value={invRole} onChange={(e) => setInvRole(e.target.value as ExternalMember["role"])}>
              <option value="client">Client</option>
              <option value="contractor">Contractor</option>
            </select>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={!invName.trim() || !invOrg.trim()}
            onClick={() => {
              onAddExternal(invName.trim(), invOrg.trim(), invRole);
              setInvName("");
              setInvOrg("");
            }}
          >
            Grant access
          </button>
          <button type="button" className="btn-link" style={{ fontSize: 11, alignSelf: "flex-start" }} onClick={onOpenAccess}>
            Manage all access & offboarding →
          </button>
        </div>

        <div style={label}>Post an update to the team</div>
        <textarea
          className="textarea"
          rows={2}
          style={{ width: "100%", fontSize: 12.5 }}
          placeholder="Write to everyone on this account…"
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
        />
        <button
          type="button"
          className="btn btn-primary btn-sm"
          style={{ marginTop: 6 }}
          disabled={!msg.trim()}
          onClick={() => {
            onPost(msg.trim());
            setMsg("");
            onClose();
          }}
        >
          Post to the team
        </button>
        <div style={{ fontSize: 10, color: T.inkMuted, marginTop: 8 }}>
          Tip: “@FirstName” notifies that person. Reachable from every tab.
        </div>
      </div>
    </>
  );
}

/**
 * Task detail — click any task to see everything about it, and act on it
 * without leaving the page. A right-side drawer (additive overlay, no layout
 * change): status, owner, due, provenance, plus quick actions — advance the
 * status or raise it with the team. This is the "clickable to see more" the
 * plan needed: a task is no longer a dead line of text.
 */
function TaskDetail({
  task,
  messages = [],
  clientName = "the client",
  mentionRoster = [],
  onStatus,
  onPost,
  goTo,
  onClose,
  onDiscuss,
  onSetTaskAssignments,
  onSetAssignmentHours,
  onToggleAssignmentDone,
  onSetAssignmentPrimary,
  onSetAssignmentOrder,
  onSetTaskDependencies,
  allTasks = [],
}: {
  task: Task;
  /** Every task in the account — the pool this task can depend on. */
  allTasks?: Task[];
  /** The account thread — the task's own discussion history is filtered from it. */
  messages?: ThreadMessage[];
  /** The client — personalizes the handoff templates surfaced on this task. */
  clientName?: string;
  /** Roster for @mention autocomplete + the "add people" chips. */
  mentionRoster?: readonly MentionPerson[];
  onStatus: (taskId: string, status: TaskStatus) => void;
  onPost: (body: string, topic?: string) => void;
  goTo: (t: ClientTab) => void;
  onClose: () => void;
  /** Open Discussions scoped to this task's conversation. */
  onDiscuss?: (topic: string) => void;
  onSetTaskAssignments?: (taskId: string, names: string[]) => void;
  onSetAssignmentHours?: (taskId: string, name: string, hours: number | undefined) => void;
  onToggleAssignmentDone?: (taskId: string, name: string, done: boolean) => void;
  onSetAssignmentPrimary?: (taskId: string, name: string) => void;
  onSetAssignmentOrder?: (taskId: string, orderedNames: string[]) => void;
  onSetTaskDependencies?: (taskId: string, dependsOn: string[]) => void;
}) {
  const [note, setNote] = useState("");
  const [tab, setTab] = useState<"work" | "handoff" | "discussion">("work");
  const suggested = suggestHandoff(task.title);
  // Append "@Name" so a person is on the handoff/note (add one or several).
  const addPerson = (name: string) => setNote((n) => (new RegExp(`@${name.split(" ")[0]}\\b`, "i").test(n) ? n : `${n}${n && !n.endsWith(" ") ? " " : ""}@${name} `));
  // This task's own conversation — tied back by topic, oldest first.
  const history = messages.filter((m) => m.topic === task.title);
  const fromKantata = task.label === "from Kantata";
  const overdue = task.status !== "done" && !!task.due && task.due < AS_OF_TODAY();
  // The team on this task (Cara's card): who, their hour slice, primary, done.
  const assigns = (task.assignments ?? []).map((a) => ({ ...a, id: a.name }));
  const hasTeam = assigns.length > 0;
  const progress = assignmentProgress(task);
  // What this task is waiting on — the open dependencies that block it.
  const depById = new Map(allTasks.map((x) => [x.id, x]));
  const blockers = task.status !== "done" ? blockingDeps(task, (id) => depById.get(id)) : [];
  // Persist the team (seeded from Kantata's assignees for display) the first
  // time a task with a team is opened, so per-person edits have something to
  // write to. Idempotent in the store — a no-op once the names already match.
  const teamKey = assigns.map((a) => a.name).join("|");
  // Fire only when the task or its team actually changes — NOT on the handler's
  // identity (it's a fresh closure each render; including it would loop, since
  // mutateAccount always yields new state). The store guard makes the seed a
  // one-time write per task.
  const seedRef = useRef(onSetTaskAssignments);
  seedRef.current = onSetTaskAssignments;
  useEffect(() => {
    if (teamKey) seedRef.current?.(task.id, teamKey.split("|"));
  }, [task.id, teamKey]);
  const statusLabel: Record<TaskStatus, string> = { todo: "To do", doing: "In progress", done: "Done" };
  const sourceLabel = fromKantata ? "Synced from Kantata" : task.source === "plan" ? "From a linked build plan" : "Added here";
  const draftHandoff = (h: (typeof HANDOFFS)[number]) => {
    setNote(personalizeHandoff(h, { clientName, taskTitle: task.title, ...(task.due ? { dueDate: task.due } : {}), ...(task.ownerName ? { ownerName: task.ownerName } : {}) }));
    setTab("discussion");
  };
  const tabs: { key: typeof tab; label: string; badge?: React.ReactNode }[] = [
    { key: "work", label: "Work", ...(blockers.length > 0 ? { badge: <span style={{ color: "#b8791a" }}> ⛓</span> } : {}) },
    { key: "handoff", label: "Handoff" },
    { key: "discussion", label: "Discussion", ...(history.length > 0 ? { badge: <span style={{ color: T.inkMuted }}> {history.length}</span> } : {}) },
  ];

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(16,21,46,0.32)", zIndex: 60 }} />
      <div
        role="dialog"
        aria-label={`Task — ${task.title}`}
        style={{ position: "fixed", top: 0, right: 0, height: "100vh", width: 480, maxWidth: "96vw", background: "#fff", color: T.ink, boxShadow: "-14px 0 40px rgba(16,21,46,0.22)", zIndex: 61, display: "flex", flexDirection: "column" }}
      >
        {/* ── Header: identity, key facts, and status-as-control ── */}
        <div style={{ padding: "16px 20px 14px", borderBottom: `1px solid ${T.grid}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              {(task.projectLabel || fromKantata) && (
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 5 }}>
                  {task.projectLabel && (
                    <span style={{ fontSize: 9.5, fontWeight: 700, color: T.roi.navy, background: "#eef2fb", borderRadius: 4, padding: "1px 6px" }}>
                      {task.projectLabel}{task.phaseLabel ? ` · ${task.phaseLabel}` : ""}
                    </span>
                  )}
                  {fromKantata && <KantataChip />}
                </div>
              )}
              <h3 style={{ fontSize: 16.5, fontWeight: 800, color: navy, margin: 0, lineHeight: 1.3 }}>{task.title}</h3>
              <div style={{ fontSize: 11.5, color: T.inkMuted, marginTop: 5 }}>
                <span style={{ color: overdue ? T.status.critical : T.inkMuted, fontWeight: overdue ? 700 : 400 }}>
                  {task.due ? <>{overdue ? "⚠ " : ""}Due {fmtDay(task.due)}</> : "No due date"}
                </span>
                {hasTeam ? ` · ${progress.done}/${progress.total} done` : task.ownerName ? ` · ${task.ownerName}` : ""}
                {` · ${sourceLabel}`}
              </div>
            </div>
            <button type="button" onClick={onClose} title="Close" style={{ flexShrink: 0, background: "none", border: "none", cursor: "pointer", fontSize: 18, color: T.inkMuted, lineHeight: 1, padding: 2 }}>✕</button>
          </div>
          {/* Status is the primary action — the pills ARE the move-to control. */}
          <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
            {(["todo", "doing", "done"] as TaskStatus[]).map((s) => (
              <button key={s} type="button" onClick={() => onStatus(task.id, s)} className={task.status === s ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm"} style={{ flex: 1 }}>
                {statusLabel[s]}
              </button>
            ))}
          </div>
        </div>

        {/* ── Tabs: one section at a time, not a wall ── */}
        <div style={{ display: "flex", gap: 4, padding: "8px 16px 0", borderBottom: `1px solid ${T.grid}` }}>
          {tabs.map((tb) => (
            <button key={tb.key} type="button" onClick={() => setTab(tb.key)} className={`nav-pill${tab === tb.key ? " active" : ""}`} style={{ fontSize: 11.5, padding: "5px 12px" }}>
              {tb.label}{tb.badge}
            </button>
          ))}
        </div>

        {/* ── Content ── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px 22px" }}>
          {tab === "work" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <div>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: T.inkMuted }}>Team &amp; hours</span>
                  {hasTeam && (
                    <span style={{ fontSize: 10.5, color: progress.done === progress.total && progress.total > 0 ? "#116a43" : T.inkMuted, fontWeight: 700 }}>
                      {progress.done}/{progress.total} done{task.estimatedHours != null ? ` · ${task.estimatedHours}h` : ""}
                    </span>
                  )}
                </div>
                {hasTeam ? (
                  <TeamHoursEditor
                    task={task}
                    {...(onSetAssignmentHours ? { onSetHours: onSetAssignmentHours } : {})}
                    {...(onToggleAssignmentDone ? { onToggleDone: onToggleAssignmentDone } : {})}
                    {...(onSetAssignmentPrimary ? { onSetPrimary: onSetAssignmentPrimary } : {})}
                    {...(onSetAssignmentOrder ? { onSetOrder: onSetAssignmentOrder } : {})}
                  />
                ) : (
                  <div style={{ fontSize: 12, color: T.inkMuted, lineHeight: 1.5 }}>
                    {task.ownerName ? <>Owned by <b style={{ color: T.ink }}>{task.ownerName}</b>. Add teammates below to split the hours and track a handoff.</> : "No one is assigned yet."}
                    {mentionRoster.length > 0 && onSetTaskAssignments && (
                      <div style={{ marginTop: 8 }}>
                        <AddPeopleControl roster={mentionRoster} onAdd={(name) => onSetTaskAssignments(task.id, [...(task.ownerName ? [task.ownerName] : []), name])} />
                      </div>
                    )}
                  </div>
                )}
                {hasTeam && mentionRoster.length > 0 && onSetTaskAssignments && (
                  <div style={{ marginTop: 10 }}>
                    <AddPeopleControl
                      roster={mentionRoster.filter((p) => !assigns.some((a) => a.name === p.name))}
                      onAdd={(name) => onSetTaskAssignments(task.id, [...assigns.map((a) => a.name), name])}
                    />
                  </div>
                )}
              </div>

              {onSetTaskDependencies && allTasks.length > 1 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: T.inkMuted, marginBottom: 6 }}>Waiting on</div>
                  {blockers.length > 0 && (
                    <div style={{ fontSize: 11.5, color: "#8a5a00", background: "#fdf2d8", border: "1px solid #f0d68a", borderRadius: 8, padding: "7px 10px", marginBottom: 8, lineHeight: 1.5 }}>
                      ⛓ Blocked until {blockers.length === 1 ? "this finishes" : "these finish"}: {blockers.map((b) => b.title).join(", ")}
                    </div>
                  )}
                  <DependencyPicker task={task} allTasks={allTasks} onSet={onSetTaskDependencies} />
                </div>
              )}
            </div>
          )}

          {tab === "handoff" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {task.status === "done" && suggested && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: "#e9f6ef", border: "1px solid #cfe9da", borderRadius: 8, padding: "10px 12px" }}>
                  <span style={{ fontSize: 12, color: "#1c5a3c", flex: 1, minWidth: 150, lineHeight: 1.4 }}>
                    ✓ This step is done — send the <b>{suggested.name}</b> handoff to the next person?
                  </span>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => draftHandoff(suggested)}>Draft it</button>
                </div>
              )}
              <div style={{ fontSize: 12, color: T.inkSecondary, lineHeight: 1.5 }}>
                Pick the email for this step — it drops a personalized draft into the Discussion tab, ready to adjust and post.
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {[...(suggested ? [suggested] : []), ...HANDOFFS.filter((h) => h.key !== suggested?.key)].map((h) => (
                  <button
                    key={h.key}
                    type="button"
                    onClick={() => draftHandoff(h)}
                    style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, textAlign: "left", padding: "9px 12px", borderRadius: 8, border: `1px solid ${h.key === suggested?.key ? T.roi.navy : T.grid}`, background: h.key === suggested?.key ? "#f3f6fd" : "#fff", cursor: "pointer" }}
                  >
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: h.key === suggested?.key ? T.roi.navy : T.ink }}>{h.key === suggested?.key ? "★ " : ""}{h.name}</span>
                    <span style={{ fontSize: 10.5, color: T.inkMuted }}>{h.when}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {tab === "discussion" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: T.inkMuted }}>On this task</span>
                {history.length > 0 && (
                  <button type="button" className="btn-link" style={{ fontSize: 11 }} onClick={() => { onClose(); if (onDiscuss) onDiscuss(task.title); else goTo("discussions"); }}>Open in Discussions →</button>
                )}
              </div>
              {history.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 260, overflowY: "auto" }}>
                  {history.map((m) => (
                    <div key={m.id} style={{ background: "#f7f6f3", borderLeft: `3px solid ${T.grid}`, borderRadius: 6, padding: "8px 10px" }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: T.ink }}>{m.author}</span>
                        <span style={{ fontSize: 10, color: T.inkMuted }}>{m.at.slice(0, 10)}</span>
                      </div>
                      <div style={{ fontSize: 12, color: T.inkSecondary, marginTop: 2, whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{m.body}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 11.5, color: T.inkMuted }}>No discussion yet — start one below. It stays tied to this task.</div>
              )}
              <MentionTextarea
                value={note}
                onChange={setNote}
                roster={mentionRoster}
                rows={3}
                placeholder={`Ask a question, flag a blocker, or send a handoff on “${task.title.slice(0, 30)}”… (@ to mention)`}
              />
              {mentionRoster.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: T.inkMuted, textTransform: "uppercase", letterSpacing: 0.4 }}>Mention</span>
                  {mentionRoster.slice(0, 6).map((p) => {
                    const on = new RegExp(`@${(p.name.split(" ")[0] ?? p.name)}\\b`, "i").test(note);
                    return (
                      <button key={p.name} type="button" onClick={() => addPerson(p.name)} title={p.sub} className="btn btn-secondary btn-sm" style={on ? { borderColor: T.roi.navy, color: T.roi.navy, fontWeight: 700, padding: "3px 9px", fontSize: 11 } : { padding: "3px 9px", fontSize: 11 }}>
                        {on ? "✓ " : "+ "}{p.name.split(" ")[0]}
                      </button>
                    );
                  })}
                </div>
              )}
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <button type="button" className="btn btn-primary btn-sm" disabled={!note.trim()} onClick={() => { onPost(note.trim(), task.title); setNote(""); }}>
                  Post
                </button>
                <span style={{ fontSize: 10.5, color: T.inkMuted }}>Filed under this task — @mentioned people are notified.</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * A compact "+ add a person" dropdown — replaces the wall of teammate chips.
 * One control that opens a short searchable list, instead of ten buttons.
 */
function AddPeopleControl({ roster, onAdd }: { roster: readonly MentionPerson[]; onAdd: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  if (roster.length === 0) return null;
  const matches = roster.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())).slice(0, 8);
  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button type="button" className="btn btn-secondary btn-sm" style={{ fontSize: 11, padding: "3px 10px" }} onClick={() => setOpen((o) => !o)}>+ Add a person</button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 62 }} />
          <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 63, width: 220, background: "#fff", border: `1px solid ${T.grid}`, borderRadius: 10, boxShadow: "0 10px 30px rgba(16,21,46,0.18)", padding: 6 }}>
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the team…" style={{ width: "100%", fontSize: 12, padding: "5px 8px", border: `1px solid ${T.grid}`, borderRadius: 6, marginBottom: 4 }} />
            <div style={{ maxHeight: 200, overflowY: "auto" }}>
              {matches.length === 0 ? (
                <div style={{ fontSize: 11.5, color: T.inkMuted, padding: "6px 8px" }}>No match</div>
              ) : (
                matches.map((p) => (
                  <button key={p.name} type="button" onClick={() => { onAdd(p.name); setOpen(false); setQ(""); }} className="table-row-hover" style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: "6px 8px", borderRadius: 6, fontSize: 12, color: T.ink }}>
                    {p.name}{p.sub ? <span style={{ color: T.inkMuted, fontSize: 10.5 }}> · {p.sub}</span> : ""}
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** The dependency picker, folded to a searchable popover so it isn't a long
 * always-open checklist competing with the rest of the card. */
function DependencyPicker({ task, allTasks, onSet }: { task: Task; allTasks: Task[]; onSet: (taskId: string, dependsOn: string[]) => void }) {
  const [q, setQ] = useState("");
  const current = task.dependsOn ?? [];
  const chosen = allTasks.filter((o) => current.includes(o.id));
  const candidates = allTasks.filter((o) => o.id !== task.id && !current.includes(o.id) && o.title.toLowerCase().includes(q.toLowerCase())).slice(0, 6);
  return (
    <div>
      {chosen.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 6 }}>
          {chosen.map((o) => (
            <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: o.status === "done" ? T.inkMuted : T.ink }}>{o.status === "done" ? "✓ " : "○ "}{o.title}</span>
              <button type="button" className="btn-link" style={{ fontSize: 11 }} onClick={() => onSet(task.id, current.filter((d) => d !== o.id))}>remove</button>
            </div>
          ))}
        </div>
      )}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add a task this waits on…" style={{ width: "100%", fontSize: 12, padding: "5px 8px", border: `1px solid ${T.grid}`, borderRadius: 6 }} />
      {q && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 4 }}>
          {candidates.length === 0 ? (
            <div style={{ fontSize: 11.5, color: T.inkMuted, padding: "4px 2px" }}>No match</div>
          ) : (
            candidates.map((o) => (
              <button key={o.id} type="button" onClick={() => { onSet(task.id, [...current, o.id]); setQ(""); }} className="table-row-hover" style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: "5px 6px", borderRadius: 6, fontSize: 12, color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                + {o.title}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** The project conversation from Kantata — posts on the client's workspaces
 * and stories, read-only. The team's real back-and-forth, in one place. */
function KantataConversation({ posts }: { posts: AccountLiveContext["posts"] }) {
  const [showAll, setShowAll] = useState(false);
  // Collapsed by default: AGP's teams don't use Kantata's project conversation
  // ("not used or needed" — Cara, pilot feedback). It stays reachable rather
  // than deleted, because one person's "we don't use it" isn't everyone's.
  const [open, setOpen] = useState(false);
  const shown = showAll ? posts : posts.slice(0, 6);
  if (!open) {
    return (
      <button type="button" className="btn-link" style={{ fontSize: 11.5, alignSelf: "flex-start" }} onClick={() => setOpen(true)}>
        Kantata project posts ({posts.length}) — not the account conversation
      </button>
    );
  }
  return (
    <div style={card}>
      <SectionTitle right={<KantataChip />}>Project conversation · from Kantata</SectionTitle>
      <div style={{ fontSize: 11.5, color: T.inkMuted, marginTop: -4, marginBottom: 8, lineHeight: 1.5 }}>
        Posts made inside Kantata. The account's Teams room is the conversation people actually use —
        connecting it is pending the Microsoft setup.
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {shown.map((p, i) => (
          <div key={i} style={{ display: "flex", gap: 10, padding: "9px 0", borderBottom: i < shown.length - 1 ? `1px solid ${T.grid}` : "none" }}>
            <Avatar name={p.author || "Kantata"} size={28} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: T.ink }}>{p.author || "Kantata user"}</span>
                {p.createdAt && <span style={{ fontSize: 10.5, color: T.inkMuted }}>{timeAgo(p.createdAt)}</span>}
              </div>
              <div style={{ fontSize: 12.5, color: T.inkSecondary, lineHeight: 1.5, marginTop: 2, whiteSpace: "pre-wrap" }}>{p.message}</div>
            </div>
          </div>
        ))}
      </div>
      {posts.length > 6 && (
        <button type="button" className="btn-link" style={{ fontSize: 11.5, marginTop: 8 }} onClick={() => setShowAll((s) => !s)}>
          {showAll ? "Show less" : `Show all ${posts.length} from Kantata`}
        </button>
      )}
      <div style={{ fontSize: 10.5, color: T.inkMuted, marginTop: 8 }}>
        Read-only mirror of Kantata comments. Two-way posting lands with the write-back layer.
      </div>
    </div>
  );
}

/**
 * Handoff composer (client call — Kellie): standard phase-transition messages
 * with the links that always go with them, so a handoff is one consistent
 * post to the project thread instead of a hand-built email every time.
 */
function HandoffComposer({ account, topics, mentionRoster = [], onPost }: { account: ClientAccount; topics: string[]; mentionRoster?: readonly MentionPerson[]; onPost: (body: string, topic?: string) => void }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [topic, setTopic] = useState("");
  const active = HANDOFFS.find((h) => h.key === openKey);
  const addPerson = (name: string) => setDraft((n) => (new RegExp(`@${name.split(" ")[0]}\\b`, "i").test(n) ? n : `${n}${n && !n.endsWith(" ") ? " " : ""}@${name} `));

  return (
    <div style={card}>
      <SectionTitle right={<span style={{ fontSize: 10.5, color: T.inkMuted }}>consistent handoffs, every time</span>}>
        Send a handoff
      </SectionTitle>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {HANDOFFS.map((h) => (
          <button
            key={h.key}
            type="button"
            onClick={() => { setOpenKey(h.key); setDraft(personalizeHandoff(h, { clientName: account.clientName, ...(topic ? { project: topic } : {}) })); }}
            aria-pressed={openKey === h.key}
            style={{ textAlign: "left", cursor: "pointer", borderRadius: 9, padding: "9px 12px", minWidth: 180, flex: "1 1 200px", background: openKey === h.key ? "#eef2fb" : "#fff", border: `1.5px solid ${openKey === h.key ? T.roi.navy : T.grid}` }}
          >
            <span style={{ display: "block", fontSize: 12.5, fontWeight: 800, color: T.roi.navy }}>{h.name}</span>
            <span style={{ display: "block", fontSize: 10.5, color: T.inkMuted, marginTop: 2 }}>{h.when}</span>
          </button>
        ))}
      </div>

      {active && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: T.inkSecondary }}>Attach these:</span>
            {active.include.map((i) => (
              <span key={i} style={{ fontSize: 10.5, fontWeight: 700, color: "#8a6d1a", background: "#faf3dc", borderRadius: 999, padding: "3px 10px" }}>{i}</span>
            ))}
          </div>
          {mentionRoster.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: T.inkMuted, textTransform: "uppercase", letterSpacing: 0.4 }}>Send to</span>
              {mentionRoster.slice(0, 10).map((p) => {
                const on = new RegExp(`@${(p.name.split(" ")[0] ?? p.name)}\\b`, "i").test(draft);
                return (
                  <button key={p.name} type="button" onClick={() => addPerson(p.name)} title={p.sub} className="btn btn-secondary btn-sm" style={on ? { borderColor: T.roi.navy, color: T.roi.navy, fontWeight: 700 } : { padding: "3px 9px", fontSize: 11 }}>
                    {on ? "✓ " : "+ "}{p.name}
                  </button>
                );
              })}
            </div>
          )}
          <MentionTextarea value={draft} onChange={setDraft} roster={mentionRoster} rows={9} style={{ fontSize: 12.5, lineHeight: 1.5 }} />
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {topics.length > 0 && (
              <select className="select" value={topic} onChange={(e) => { const v = e.target.value; setTopic(v); if (active) setDraft(personalizeHandoff(active, { clientName: account.clientName, ...(v ? { project: v } : {}) })); }} title="Which project is this handoff for?" style={{ fontSize: 11.5, padding: "5px 8px" }}>
                <option value="">General</option>
                {topics.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            )}
            <button type="button" className="btn btn-primary btn-sm" disabled={!draft.trim()} onClick={() => { onPost(draft.trim(), topic || undefined); setOpenKey(null); setDraft(""); setTopic(""); }}>
              Post handoff to Discussions →
            </button>
            <button type="button" className="btn-link" style={{ fontSize: 11 }} onClick={() => { setOpenKey(null); setDraft(""); }}>Cancel</button>
          </div>
          <div style={{ fontSize: 10.5, color: T.inkMuted }}>
            Paste the real links in place of the placeholders before posting. The message files under the project you choose.
          </div>
        </div>
      )}
    </div>
  );
}

function DigestComposer({ account, tasks, onPost }: { account: ClientAccount; tasks: Task[]; onPost: (body: string, topic?: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);

  if (draft === null) {
    return (
      <div style={{ ...card, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, color: T.inkSecondary }}>
          <strong style={{ color: T.ink }}>Weekly update, drafted for you.</strong> The Copilot writes
          the client status from campaigns, milestones, and tasks — you review, edit, and post it.
          Nothing reaches the client until you say so.
        </span>
        <button type="button" className="btn btn-ai" onClick={() => setDraft(composeClientDigest(account, tasks, AS_OF_TODAY()))}>
          ✍ Draft weekly update
        </button>
      </div>
    );
  }

  return (
    <div style={card}>
      <SectionTitle>Review the draft — you're the author</SectionTitle>
      <textarea
        className="textarea"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={16}
        style={{ width: "100%", fontSize: 12.5, lineHeight: 1.55, padding: "12px 14px" }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            onPost(draft, "Weekly update");
            setDraft(null);
          }}
        >
          Post to Discussions →
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDraft(null)}>
          Discard
        </button>
        <span style={{ fontSize: 11, color: T.inkMuted }}>
          Drafted from this workspace's campaigns, milestones, and tasks — edit freely before posting.
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Files / Access tabs
// ---------------------------------------------------------------------------

function FileShareControl({ approval, onShare, onUnshare }: { approval?: MsAccountFileApproval | undefined; onShare: (purpose: "fyi" | "approval") => void; onUnshare: (approvalId: string) => void }) {
  const [open, setOpen] = useState(false);
  if (approval) {
    const st = fileApprovalState(approval);
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span title={approval.purpose === "approval" ? "Shared with the client for approval" : "Shared with the client to review"} style={clientShareChip(st)}>
          {fileApprovalLabel(approval)}
        </span>
        <button type="button" className="btn-link" style={{ fontSize: 10.5 }} title="Stop sharing this with the client" onClick={() => onUnshare(approval.id)}>
          Unshare
        </button>
      </span>
    );
  }
  if (!open) {
    return (
      <button type="button" className="btn-link" style={{ fontSize: 11, fontWeight: 700 }} title="Share this document into the client space" onClick={() => setOpen(true)}>
        → Share to client
      </button>
    );
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <button type="button" className="btn btn-sm" style={{ fontSize: 10.5 }} title="Share to read / collaborate" onClick={() => { onShare("fyi"); setOpen(false); }}>
        To review
      </button>
      <button type="button" className="btn btn-primary btn-sm" style={{ fontSize: 10.5 }} title="Ask the client to approve or request changes" onClick={() => { onShare("approval"); setOpen(false); }}>
        For approval
      </button>
      <button type="button" className="btn-link" style={{ fontSize: 10.5 }} onClick={() => setOpen(false)}>Cancel</button>
    </span>
  );
}

/** One live Graph item in the browsed folder — the replacement for the old
 * hand-typed `FileRow`. Folders themselves aren't shareable/discussable here
 * (drill into them via the tree above instead); only real files get the
 * share/discuss controls. */
function FileBrowserRow({ item, approval, onShare, onUnshare, onDiscuss }: { item: FileListItem; approval?: MsAccountFileApproval | undefined; onShare: (msItemId: string, name: string, purpose: "fyi" | "approval") => void; onUnshare: (approvalId: string) => void; onDiscuss?: (name: string, note: string) => void }) {
  const [discussing, setDiscussing] = useState(false);
  const [note, setNote] = useState("");
  const [posted, setPosted] = useState(false);
  return (
    <div style={{ borderBottom: `1px solid ${T.grid}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0" }}>
        <span aria-hidden style={{ fontSize: 13 }}>{item.isFolder ? "📁" : glyphFor(item.name)}</span>
        {item.webUrl ? (
          <a href={item.webUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, fontWeight: 600, color: navy }}>{item.name}</a>
        ) : (
          <span style={{ fontSize: 12.5, fontWeight: 600, color: T.ink }}>{item.name}</span>
        )}
        {!item.isFolder && (
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10.5, color: T.inkMuted }}>{(item.size / 1024).toFixed(0)} KB</span>
            <FileShareControl {...(approval ? { approval } : {})} onShare={(purpose) => onShare(item.id, item.name, purpose)} onUnshare={onUnshare} />
            {onDiscuss && (
              <button type="button" onClick={() => { setDiscussing((d) => !d); setPosted(false); }} title={`Discuss “${item.name}” — files it under this document in Discussions`} className="btn-link" style={{ fontSize: 11, fontWeight: 700 }}>💬 Discuss</button>
            )}
          </span>
        )}
      </div>
      {discussing && onDiscuss && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "0 0 10px 22px" }}>
          {posted ? (
            <span style={{ fontSize: 11.5, fontWeight: 700, color: "#116a43" }}>✓ Filed under “{item.name}” in Discussions</span>
          ) : (
            <>
              <textarea className="textarea" rows={2} autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder={`Start a discussion about “${item.name}”…`} style={{ width: "100%", fontSize: 12 }} />
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button type="button" className="btn btn-primary btn-sm" disabled={!note.trim()} onClick={() => { onDiscuss(item.name, note.trim()); setNote(""); setPosted(true); }}>Post to Discussions</button>
                <button type="button" className="btn-link" style={{ fontSize: 11 }} onClick={() => { setDiscussing(false); setNote(""); }}>Cancel</button>
                <span style={{ fontSize: 10, color: T.inkMuted }}>Everyone on the account sees it, filed under this document.</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SharedFilesList({ approvals, onUnshare }: { approvals: MsAccountFileApproval[]; onUnshare: (approvalId: string) => void }) {
  return (
    <div style={card}>
      <SectionTitle right={<span style={{ fontSize: 10.5, color: T.inkMuted }}>{approvals.length} {approvals.length === 1 ? "item" : "items"}</span>}>Shared with client</SectionTitle>
      {approvals.map((a) => {
        const st = fileApprovalState(a);
        return (
          <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${T.grid}`, flexWrap: "wrap" }}>
            <span aria-hidden style={{ fontSize: 13 }}>{glyphFor(a.name)}</span>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: T.ink }}>{a.name}</span>
            <span style={clientShareChip(st)}>{fileApprovalLabel(a)}</span>
            {a.note && st === "changes" && <span style={{ fontSize: 11, color: "#9b2c2c" }}>“{a.note}”</span>}
            <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 10.5, color: T.inkMuted }}>{a.sharedAt.slice(0, 10)}</span>
              <button type="button" className="btn-link" style={{ fontSize: 10.5 }} onClick={() => onUnshare(a.id)}>Unshare</button>
            </span>
          </div>
        );
      })}
      {approvals.length === 0 && (
        <div style={{ fontSize: 11.5, color: T.inkMuted, lineHeight: 1.5, paddingTop: 4 }}>
          Nothing shared with the client yet — browse the account's files below and share one.
        </div>
      )}
    </div>
  );
}

/** "The folder IS the file list" (docs/api-spec-workspace-mutations.md) —
 * a live Graph browse/upload of the account's real SharePoint folder tree
 * (same `FolderTreePicker`/`listFolder`/`uploadFile` ClientAdminPanel.tsx's
 * Admin-tab Files panel already uses), plus which of those real files are
 * shared into the client space. Replaces the old hand-typed `ClientFileLink`
 * list entirely — there is no app-side file inventory to add/rename/remove
 * a row from anymore. */
function FilesTab({ accountId, loginHintEmail, fileApprovals, onShareFile, onUnshareFile, onDiscussFile }: { accountId?: string | null | undefined; loginHintEmail?: string | undefined; fileApprovals: MsAccountFileApproval[]; onShareFile: (msItemId: string, name: string, purpose: "fyi" | "approval") => void; onUnshareFile: (approvalId: string) => void; onDiscussFile: (name: string, note: string) => void }) {
  const [selectedNode, setSelectedNode] = useState<FolderTreeNode | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [listing, setListing] = useState<FileListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);

  const selectedKantataId = selectedNode?.kantataId ?? "";
  const approvalByItemId = new Map(fileApprovals.map((a) => [a.msItemId, a] as const));

  async function reload(kantataId: string) {
    if (!accountId) return;
    setLoading(true);
    setErr(null);
    try {
      setListing(await listFolder(accountId, kantataId, loginHintEmail));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed to list folder");
    } finally {
      setLoading(false);
    }
  }

  if (!accountId) {
    return (
      <div style={card}>
        <SectionTitle>Files</SectionTitle>
        <div style={{ fontSize: 11.5, color: T.inkMuted, lineHeight: 1.5 }}>
          This workspace isn't linked to the shared account record yet — open the Admin tab to set it up.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={card}>
        <SectionTitle right={listing?.folderWebUrl ? <a href={listing.folderWebUrl} target="_blank" rel="noreferrer" className="btn-link" style={{ fontSize: 12 }}>Open in SharePoint ↗</a> : undefined}>
          Files
        </SectionTitle>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setBrowsing((b) => !b)}>
              {browsing ? "Hide folders" : "Browse folders"}
            </button>
            <span style={{ fontSize: 12.5, color: T.inkMuted }}>{selectedNode ? `Selected: ${selectedNode.name}` : "No folder selected"}</span>
            {selectedKantataId && (
              <label className="btn btn-secondary btn-sm" style={{ cursor: "pointer" }}>
                {uploadPct !== null ? `Uploading… ${uploadPct}%` : "Upload"}
                <input
                  type="file"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    setUploadPct(0);
                    uploadFile(accountId, selectedKantataId, file, { ...(loginHintEmail ? { loginHintEmail } : {}), onProgress: (p) => setUploadPct(Math.round((p.bytesSent / p.totalBytes) * 100)) })
                      .then(() => reload(selectedKantataId))
                      .catch((e2) => setErr(e2 instanceof Error ? e2.message : "upload failed"))
                      .finally(() => setUploadPct(null));
                  }}
                />
              </label>
            )}
          </div>
          {browsing && (
            <FolderTreePicker
              accountId={accountId}
              {...(loginHintEmail ? { loginHintEmail } : {})}
              selectedKantataId={selectedKantataId}
              onSelect={(node) => {
                setSelectedNode(node);
                setListing(null);
                void reload(node.kantataId);
              }}
            />
          )}
        </div>
        {loading && <div style={{ fontSize: 12.5, color: T.inkMuted }}>Loading…</div>}
        {err && <div style={{ fontSize: 12.5, color: T.status.critical }}>{err}</div>}
        {listing && listing.items.length === 0 && <div style={{ fontSize: 11.5, color: T.inkMuted }}>Empty.</div>}
        {listing?.items.map((item) => (
          <FileBrowserRow key={item.id} item={item} {...(approvalByItemId.get(item.id) ? { approval: approvalByItemId.get(item.id) } : {})} onShare={onShareFile} onUnshare={onUnshareFile} onDiscuss={onDiscussFile} />
        ))}
        {!listing && !loading && (
          <div style={{ fontSize: 11.5, color: T.inkMuted, lineHeight: 1.5, paddingTop: 4 }}>
            Browse folders above to see the real files in SharePoint/Teams — nothing is typed in by hand here anymore.
          </div>
        )}
      </div>
      <SharedFilesList approvals={fileApprovals} onUnshare={onUnshareFile} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Admin — the Client Admin panel (teams-provisioning-plan.md B3-B7),
// embedded here instead of its old standalone route, scoped automatically
// to this client. `ClientAdminPanel.tsx` (formerly `MsWorkspacePanel.tsx`)
// operates on `collab.client_account` rows — a completely separate
// Postgres schema from this file's whole JSON-document `ClientAccount`
// model, with its own unrelated uuid. The only usable join between the two
// is `clientName`, case-insensitive, and it isn't unique — same bridge
// pattern as store.ts's `bridgeKantataProjectIds`: an ambiguous or missing
// match is surfaced clearly here, never guessed or silently created,
// because a zero-match state can mean "genuinely doesn't exist yet" just
// as easily as "exists, but this viewer isn't a member of it yet."
// ---------------------------------------------------------------------------

function ClientAdminTab({
  clientName,
  loginHintEmail,
  collabAccountId,
  collabData,
  collabDataError,
  onReloadCollabData,
  onAccountCreated,
  canManage,
}: {
  clientName: string;
  loginHintEmail?: string | undefined;
  /** Super-admin (app admin) — gates the role-based View Tiers config card. */
  canManage: boolean;
  /** The enclosing ClientWorkspace already resolved this client's collab
   * account (same clientName bridge this tab used to redo independently)
   * and fetched its data — reused here instead of a second `fetchAllAccounts()`
   * call and a second, thinner fetch of the same row. Only `null` collapses
   * "still loading"/"no match"/"ambiguous" into one value (matching
   * `resolveAccountIdByName`'s own contract), so this tab still falls back
   * to its own richer resolve() to tell those apart for its messaging. */
  collabAccountId: string | null | undefined;
  collabData: WorkspaceAccountPayload | null | undefined;
  /** True when the PARENT's own resolve/fetch attempt failed (not just
   * "still in flight") — the signal this tab needs to actually fall back to
   * its own resolve() instead of waiting on collabData forever. Without it,
   * `collabAccountId` alone can't distinguish "data's still loading" from
   * "the parent already gave up," and this tab would show a permanent
   * "Loading…" for the latter. */
  collabDataError: boolean;
  onReloadCollabData: () => Promise<void>;
  /** Tell the parent a brand-new collab account now exists for this
   * clientName — its own resolve effect is keyed on clientName, which
   * hasn't changed, so it won't re-run on its own after this tab's own
   * "Create Client Admin record" button succeeds. */
  onAccountCreated: () => void;
}) {
  type Resolution =
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "none" }
    | { kind: "ambiguous"; count: number }
    | { kind: "found"; account: MsAccountData };
  const [state, setState] = useState<Resolution>({ kind: "loading" });
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);

  // Latest clientName, checked after this tab's own fetchAllAccounts() call
  // resolves — this component is never remounted on an account switch (no
  // `key` at its call site), so a slow resolve() started for a PREVIOUS
  // clientName can otherwise land after a newer one already rendered,
  // overwriting it with the wrong client's Admin data.
  const clientNameRef = useRef(clientName);
  useEffect(() => {
    clientNameRef.current = clientName;
  }, [clientName]);

  async function resolve() {
    const forName = clientName;
    setState({ kind: "loading" });
    try {
      const { accounts } = await fetchAllAccounts();
      if (clientNameRef.current !== forName) return;
      const matches = accounts.filter((a) => a.clientName.toLowerCase() === forName.toLowerCase());
      if (matches.length === 0) {
        setState({ kind: "none" });
        return;
      }
      if (matches.length > 1) {
        setState({ kind: "ambiguous", count: matches.length });
        return;
      }
      // fetchAllAccounts() is the LIST branch of GET /api/workspace, which
      // deliberately omits msTeam/kantataProjectIds/scopedToProjects (that
      // endpoint's own documented scope) — ClientAdminPanel dereferences
      // those fields unconditionally, so this account still needs the same
      // single-account fetch the parent's own resolve does before it's
      // handed off, or ClientAdminPanel crashes on account.msTeam.teamId.
      const full = await fetchAccountCollabData(matches[0]!.id);
      if (clientNameRef.current !== forName) return;
      const account = full.accounts.find((a) => a.id === matches[0]!.id);
      if (!account) {
        setState({ kind: "none" });
        return;
      }
      setState({ kind: "found", account });
    } catch (err) {
      if (clientNameRef.current !== forName) return;
      setState({ kind: "error", message: err instanceof Error ? err.message : "failed to load Client Admin data" });
    }
  }

  useEffect(() => {
    // The parent already has a single resolved match, and its own fetch
    // hasn't failed — nothing to re-derive; `fromParent` below picks it up
    // once collabData lands. If the parent's attempt DID fail, fall back to
    // this tab's own resolve() rather than waiting on a collabData that will
    // never arrive.
    if (collabAccountId && !collabDataError) return;
    void resolve();
  }, [clientName, collabAccountId, collabDataError]);

  const fromParent = collabAccountId ? collabData?.accounts.find((a) => a.id === collabAccountId) : undefined;
  if (fromParent) {
    return <ClientAdminPanel account={fromParent} loginHintEmail={loginHintEmail} onAccountChanged={onReloadCollabData} canManage={canManage} />;
  }

  if (state.kind === "loading") return <div style={{ fontSize: 13, color: T.inkMuted }}>Loading…</div>;
  if (state.kind === "error") return <div style={{ fontSize: 13, color: T.status.critical }}>{state.message}</div>;
  if (state.kind === "ambiguous") {
    return (
      <div style={{ fontSize: 13, color: T.status.critical }}>
        Multiple Client Admin records named "{clientName}" found ({state.count}) — this needs an app admin to resolve.
      </div>
    );
  }
  if (state.kind === "found") {
    return <ClientAdminPanel account={state.account} loginHintEmail={loginHintEmail} onAccountChanged={() => void resolve()} canManage={canManage} />;
  }

  // state.kind === "none"
  return (
    <div style={{ fontSize: 13, color: T.inkSecondary, lineHeight: 1.6 }}>
      <p>
        No Client Admin record found for "{clientName}". If you believe one already exists, ask an app admin to add you to
        it — otherwise:
      </p>
      <button
        type="button"
        className="btn btn-primary btn-sm"
        disabled={creating}
        onClick={() => {
          setCreating(true);
          setCreateErr(null);
          createAccount(clientName)
            .then(() => {
              onAccountCreated();
              return resolve();
            })
            .catch((err) => setCreateErr(err instanceof Error ? err.message : "failed to create"))
            .finally(() => setCreating(false));
        }}
      >
        {creating ? "Creating…" : "Create Client Admin record"}
      </button>
      {createErr && <div style={{ color: T.status.critical, fontSize: 12, marginTop: 8 }}>{createErr}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The workspace shell
// ---------------------------------------------------------------------------

export function ClientWorkspace({
  account,
  sharedTasks,
  userName,
  onBack,
  onAddTask,
  onTaskStatus,
  onAddExternal,
  onToggleClientVisible,
  onToggleContractorVisible,
  onRemindDeliverable,
  onTabChange,
  loginHintEmail,
  onSetProjectScope,
  collabAccountId,
  collabData,
  collabDataError = false,
  onReloadCollabData,
  onAccountCreated,
  taskError,
  importCandidates = [],
  taskCandidates = [],
  onImportCampaigns,
  onImportTasks,
  onImportAll,
  onRemoveCampaign,
  onClearCampaigns,
  liveContext,
  liveDataOn = false,
  linkSuggestions = [],
  onRelink,
  onLinkProjects,
  onArchive,
  sandboxContent,
  sandboxCount = 0,
  people = [],
  onAddMember,
  onAddNewMember,
  pendingKantataWrites = [],
  onPushToKantata,
  onShareFile,
  onUnshareFile,
  onClientDecision,
  onSetTaskHours,
  onPublishResourcing,
  onSetTaskAssignments,
  onSetAssignmentHours,
  onToggleAssignmentDone,
  onSetAssignmentPrimary,
  onSetAssignmentOrder,
  onSetTaskDependencies,
  initialTab,
  focusTaskId,
  showResourcing = true,
  canManage = false,
  viewTier = "project_manager",
}: {
  account: ClientAccount;
  /**
   * Resourcing is AGP-internal (hours). Shown only to AGP people — a client
   * looped into a workspace shouldn't see the resourcing tab unless AGP decides
   * to. Gated on the AGP email domain upstream.
   */
  showResourcing?: boolean;
  /** The signed-in user can manage this workspace (app admin or workspace
   * admin / PM). Gates the Kantata task write-back — Kellie's pilot ask. */
  canManage?: boolean;
  /** Role-based view tier (Kellie/Cara pilot). "account" (default) sees every
   * tab; "delivery" sees only Home, Project Plan, Discussions and Files — no
   * Client Dashboard or Admin. Resolved in App.tsx from the account's
   * viewConfig; app admins are always "account". */
  viewTier?: ViewTier;
  /** Deep-link target: open on this tab (Teams/email drives people here). */
  initialTab?: ClientTab;
  /** Deep-link target: highlight this task and focus its hours field. */
  focusTaskId?: string;
  /** AGP roster to add to the account (plain data — guest-safe). */
  people?: { id: string; name: string; title: string }[];
  /** Add an AGP teammate to this account from anywhere in the workspace. */
  onAddMember?: (personId: string) => void;
  /** Add a teammate who isn't in the Kantata roster (name + role). */
  onAddNewMember?: (name: string, title: string) => void;
  /** The shared plan: account tasks + client-visible tasks from linked builds. */
  sharedTasks: { task: Task; fromInternal: boolean }[];
  userName: string;
  onBack: () => void;
  /** New Kantata/HubSpot matches not yet in this workspace — user-gated. */
  importCandidates?: ImportCandidate[];
  /** Open Kantata tasks not yet in the plan — user-gated, like campaigns. */
  taskCandidates?: TaskCandidate[];
  onImportTasks?: (selected: TaskCandidate[]) => void;
  /**
   * Workspace edits that Kantata hasn't got yet — the write-back's review
   * queue. Computed in App from the mirror; rendered here as plain data.
   */
  pendingKantataWrites?: PendingWrite[];
  /** Send the ticked changes. Resolves with what actually landed. */
  onPushToKantata?: (refs: string[]) => Promise<WriteResponse>;
  /** Share a real SharePoint item (by its Graph item id) into the client
   * space — to review, or for approval. */
  onShareFile: (msItemId: string, name: string, purpose: "fyi" | "approval") => void;
  /** Stop sharing a document with the client. */
  onUnshareFile: (approvalId: string) => void;
  /** The client's decision on a shared document — approve or request changes.
   * Also used for an internal staffer to record a decision on the client's
   * behalf (e.g. relayed by phone/email). */
  onClientDecision?: (approvalId: string, decision: "approved" | "changes", note?: string) => void;
  /** Set the PM's hour estimate on a task — feeds weekly resourcing. */
  onSetTaskHours?: (taskId: string, hours: number | undefined) => void;
  /** Publish the derived weekly reservations to Kantata (review-gated). */
  onPublishResourcing?: () => Promise<WriteResponse>;
  /** Set (or seed) the people on a task — the task card's team. */
  onSetTaskAssignments?: (taskId: string, names: string[]) => void;
  /** Set one person's hour slice on a task (undefined = even-split default). */
  onSetAssignmentHours?: (taskId: string, name: string, hours: number | undefined) => void;
  /** Mark one person's part done — the task completes only when all are done. */
  onToggleAssignmentDone?: (taskId: string, name: string, done: boolean) => void;
  /** Name the single accountable owner on a task. */
  onSetAssignmentPrimary?: (taskId: string, name: string) => void;
  /** Reorder a task's handoff sequence (who starts → next → last). */
  onSetAssignmentOrder?: (taskId: string, orderedNames: string[]) => void;
  /** Set which tasks this one waits on (dependencies). */
  onSetTaskDependencies?: (taskId: string, dependsOn: string[]) => void;
  /** One click: EVERYTHING Kantata has for this client (campaigns + tasks). */
  onImportAll?: () => void;
  /** Everything the mirror knows about this client — plain data from App. */
  liveContext?: AccountLiveContext;
  /** True when the mirror is the live pull, not demo data. */
  liveDataOn?: boolean;
  /** Closest live-book client names when this workspace matched nothing. */
  linkSuggestions?: string[];
  /** One-click relink: rename this workspace to a real CRM client. */
  onRelink?: (name: string) => void;
  /** Project Finder: hand-link picked Kantata project ids to this client. */
  onLinkProjects?: (ids: string[]) => void;
  /** Archive: hide from the list, keep all history (auditability). */
  onArchive?: () => void;
  /** This client's Sandbox tab, composed by App — keeps internal-only
   * modules (ROI, copilot) out of this file's import graph. Absent = tab
   * hidden (e.g. a guest build passes nothing). */
  sandboxContent?: React.ReactNode;
  /** Idea count shown on the Sandbox tab label. */
  sandboxCount?: number;
  onImportCampaigns?: (selected: ImportCandidate[]) => void;
  onRemoveCampaign?: (campaignId: string) => void;
  onClearCampaigns?: () => void;
  onAddTask: (title: string, ownerName?: string, due?: string, label?: string) => void;
  onTaskStatus: (taskId: string, status: TaskStatus) => void;
  onAddExternal: (name: string, org: string, role: ExternalMember["role"]) => void;
  /** Flag a task as a client-facing deliverable (curated client view). */
  onToggleClientVisible: (taskId: string) => void;
  /** Flag a task onto the contractor's scoped plan (spec 5.3/5.5). */
  onToggleContractorVisible?: (taskId: string) => void;
  /** Nudge the client about a deliverable that's due. */
  onRemindDeliverable: (taskId: string) => void;
  /** Set which Kantata projects this workspace covers (Cara's pilot ask). */
  onSetProjectScope?: (projectIds: string[], scoped: boolean) => void;
  /** This client's real Postgres account id, resolved once in App.tsx by
   * matching clientName (no shared id between the two account universes) —
   * `null` while unresolved (no match, or ambiguous). `undefined` briefly
   * while the very first lookup is still in flight. */
  collabAccountId?: string | null | undefined;
  /** The resolved account's live collab-schema data (thread/tasks/
   * campaigns/etc, docs/api-spec-workspace-mutations.md) — `null` until
   * `collabAccountId` resolves and the first fetch lands. */
  collabData?: WorkspaceAccountPayload | null | undefined;
  /** True when App.tsx's own resolve-or-fetch attempt failed — lets
   * ClientAdminTab fall back to its own resolve() instead of waiting
   * forever on a collabData that will never arrive. Defaults false. */
  collabDataError?: boolean | undefined;
  /** Re-fetch `collabData` after a mutation — App.tsx owns the fetch, this
   * component only ever triggers a refresh through it. */
  onReloadCollabData: () => Promise<void>;
  /** Tell App.tsx a brand-new collab account now exists for this client
   * (the Admin tab's "Create Client Admin record" button) — its own
   * clientName-keyed resolve effect won't re-fire on its own since the name
   * didn't change. */
  onAccountCreated: () => void;
  /** A task/campaign/import mutation that failed server-side (a stale
   * `expectedUpdatedAt` conflict, a network error) — App.tsx owns the
   * mutations themselves, this only surfaces the result. */
  taskError?: string | null | undefined;
  /** Report the visible tab upward, so the page-level feedback button can ask
   * about the surface the person is actually looking at. Optional: nothing
   * inside this component depends on anyone listening. */
  onTabChange?: (tab: ClientTab) => void;
  /** Login hint for the M365 MSAL popup, threaded to the Admin tab's Client
   * Admin panel — the same signed-in email already used everywhere else. */
  loginHintEmail?: string | undefined;
}) {
  const [tab, setTab] = useState<ClientTab>(initialTab ?? "home");
  // Follow a deep link that changes target while the workspace is already open
  // (e.g. a second Teams message points at a different tab/task).
  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab, focusTaskId]);
  // Never leave a hidden tab active — a delivery-tier person who deep-links to
  // the Client Dashboard / Admin, OR a non-AGP-domain internal user who deep-
  // links to Resourcing (hidden by showResourcing but visible to their tier),
  // falls back to Home so the workspace body can't render blank.
  useEffect(() => {
    if (!tabVisibleForTier(viewTier, tab) || (tab === "resourcing" && !showResourcing)) setTab("home");
  }, [viewTier, tab, showResourcing]);
  useEffect(() => {
    onTabChange?.(tab);
  }, [tab, onTabChange]);

  // The picker must offer every project under the client, not just the ones
  // already in scope — otherwise you could narrow a workspace but never widen
  // it again. `searchable` is the unscoped list the finder uses.
  const clientKey = squash(account.clientName);
  const clientProjects = (liveContext?.searchable ?? [])
    .filter((p) => squash(p.clientGroup ?? "") === clientKey || squash(titlePrefix(p.title)) === clientKey)
    .map((p) => ({ id: p.id, title: p.title, ...(p.dueDate ? { dueDate: p.dueDate } : {}) }));
  // Anything already in scope stays offered even if its title stopped matching
  // — a workspace must never lose the ability to un-pick its own project.
  for (const id of account.kantataProjectIds ?? []) {
    if (!clientProjects.some((p) => p.id === id)) {
      const found = (liveContext?.searchable ?? []).find((p) => p.id === id);
      if (found) clientProjects.push({ id: found.id, title: found.title, ...(found.dueDate ? { dueDate: found.dueDate } : {}) });
    }
  }

  // Collaborate hub: add people / post an update from ANY tab (the navy band
  // is persistent, so this popover is always reachable).
  const [hubOpen, setHubOpen] = useState(false);
  // Click any task to see everything about it (detail drawer, additive overlay).
  const [openTask, setOpenTask] = useState<Task | null>(null);
  // Context-aware discussions: a "Discuss" click anywhere sets the topic and
  // jumps to Discussions, where the composer + history open scoped to it — so
  // the conversation already knows the spot it's about (Josh's ask).
  const [discussTopic, setDiscussTopic] = useState<string | null>(null);
  const startDiscussion = (topic: string) => { setDiscussTopic(topic); setTab("discussions"); };
  // A fresh workspace with matched work opens the review panel by itself —
  // the next action should be on screen, not hidden behind a corner button.
  // Campaigns/tasks now live in Postgres (`collabData`, fetched async by
  // App.tsx), which is still null on this component's first render — a
  // plain useState(() => ...) lazy initializer would always see it as
  // empty and misfire. Deferred into an effect that waits for the first
  // real `collabData`, decided once (`reviewDecided`), same one-shot intent
  // the lazy initializer used to have.
  const [reviewOpen, setReviewOpen] = useState(false);
  const reviewDecided = useRef(false);
  useEffect(() => {
    if (reviewDecided.current || !collabData) return;
    reviewDecided.current = true;
    if (
      (importCandidates.length > 0 && collabData.campaigns.length === 0) ||
      (taskCandidates.length > 0 && collabData.tasks.length === 0 && collabData.campaigns.length === 0)
    ) {
      setReviewOpen(true);
    }
  }, [collabData, importCandidates.length, taskCandidates.length]);
  const matchCount = importCandidates.length + taskCandidates.length;
  // Mirrored internal tasks get a display label so their origin is visible.
  const tasks: Task[] = sharedTasks.map(({ task, fromInternal }) =>
    fromInternal && !task.label ? { ...task, label: "shared from internal plan" } : task,
  );
  const owners = [...new Set(tasks.map((t) => t.ownerName).filter((o): o is string => !!o))];

  // Topics a discussion can be filed under. Kellie's ask: file conversation by
  // PROJECT, not just campaign — at AGP the projects are the Kantata
  // milestones. So the list is the real projects (milestone titles + any
  // project label a task carries) with campaign names after, deduped.
  const projectTopics = [
    ...new Set([
      ...(liveContext?.projects ?? []).flatMap((p) => p.milestones.map((m) => m.title)),
      ...tasks.map((t) => t.projectLabel).filter((l): l is string => !!l),
      ...(collabData ? collabData.campaigns.map((c) => c.name) : account.campaigns.map((c) => c.name)),
    ]),
  ];
  // The real projects (Kantata milestones) discussions are organized by, and a
  // roll-up from any post's topic to its project. Kellie's call: project level
  // only — a task's replies roll up to the task's project, nothing finer.
  const discussionProjects = [
    ...new Set([
      ...(liveContext?.projects ?? []).flatMap((p) => p.milestones.map((m) => m.title)),
      ...tasks.map((t) => t.projectLabel).filter((l): l is string => !!l),
    ]),
  ];
  const projectSet = new Set(discussionProjects.map((p) => p.toLowerCase()));
  const taskProject = new Map<string, string>();
  for (const t of tasks) if (t.projectLabel) taskProject.set(t.title.toLowerCase(), t.projectLabel);
  const projectOfTopic = (topic: string | undefined): string | undefined => {
    if (!topic) return undefined;
    const key = topic.toLowerCase();
    if (projectSet.has(key)) return topic;
    return taskProject.get(key);
  };

  // JSON-document migration (docs/api-spec-workspace-mutations.md): the
  // discussion thread, tasks and campaigns now live in Postgres
  // (collab.thread_message/task/campaign), not account.thread/tasks/
  // campaigns — resolved once, in App.tsx (bridged by matching clientName,
  // no shared id between the two account universes), and handed down here
  // as `collabAccountId`/`collabData` rather than re-resolved/re-fetched in
  // this component too. Every message-posting spot on this page (Home's
  // preview, Dashboard's inline post box, CollaborateHub, TaskDetail, and
  // Discussions itself) reads/writes through this ONE resolved thread, so a
  // message posted from any of them shows up in all of them immediately.
  const [threadError, setThreadError] = useState<string | null>(null);
  const rawMessages = collabData?.thread ?? [];

  // Memoized: Thread.tsx's own topic/author aggregations are useMemo'd keyed
  // on `[messages]` by reference — a fresh array here every render would
  // silently defeat that memoization even when nothing actually changed.
  const liveMessages: ThreadMessage[] = useMemo(
    () =>
      rawMessages.map((m) => ({
        id: m.id,
        author: m.author,
        kind: m.kind,
        at: m.createdAt,
        body: m.body,
        ...(m.topic ? { topic: m.topic } : {}),
        ...(m.editedAt ? { editedAt: m.editedAt } : {}),
        clientVisible: m.clientVisible,
        contractorVisible: m.contractorVisible,
        ...(m.kantataId ? { kantataId: m.kantataId } : {}),
        ...(m.kantataLevel ? { kantataLevel: m.kantataLevel } : {}),
      })),
    [rawMessages],
  );
  // Computed once and reused everywhere `Campaign[]` is needed (the shadow
  // account below, and ImportReview's own `campaigns` prop further down) —
  // not recomputed a second time from the same `collabData.campaigns`.
  const liveTasks = useMemo(() => (collabData ? collabData.tasks.map(toOldTask) : null), [collabData]);
  const liveCampaigns = useMemo(() => (collabData ? collabData.campaigns.map(toOldCampaign) : null), [collabData]);
  // Home/ClientDashboard/DigestComposer read `.thread`/`.tasks`/`.campaigns`
  // off the whole `account` object they already take, rather than separate
  // props — this shadow view lets all three pick up live Postgres data with
  // no signature change to any of them.
  const accountWithLiveData: ClientAccount = useMemo(
    () => ({
      ...account,
      thread: liveMessages,
      ...(liveTasks && liveCampaigns ? { tasks: liveTasks, campaigns: liveCampaigns } : {}),
    }),
    [account, liveMessages, liveTasks, liveCampaigns],
  );

  async function handlePostMessage(body: string, topic?: string) {
    if (!collabAccountId) {
      setThreadError("This workspace isn't linked to the shared discussion system yet — open the Admin tab to check its setup.");
      return;
    }
    try {
      await postMessage(collabAccountId, body, topic);
      await onReloadCollabData();
    } catch (e) {
      setThreadError(e instanceof Error ? e.message : "failed to post");
    }
  }
  async function handleEditMessage(messageId: string, body: string) {
    const existing = rawMessages.find((m) => m.id === messageId);
    if (!existing) return;
    try {
      await editMessage(messageId, body, existing.updatedAt);
      await onReloadCollabData();
    } catch (e) {
      setThreadError(e instanceof Error ? e.message : "failed to save edit");
    }
  }
  async function handleDeleteMessage(messageId: string) {
    try {
      await deleteMessage(messageId);
      await onReloadCollabData();
    } catch (e) {
      setThreadError(e instanceof Error ? e.message : "failed to delete");
    }
  }
  async function handleToggleMessageContractorVisible(messageId: string) {
    const existing = rawMessages.find((m) => m.id === messageId);
    if (!existing) return;
    try {
      await setMessageVisibility(messageId, { contractorVisible: !existing.contractorVisible });
      await onReloadCollabData();
    } catch (e) {
      setThreadError(e instanceof Error ? e.message : "failed to change visibility");
    }
  }
  async function handleToggleMessageClientVisible(messageId: string) {
    const existing = rawMessages.find((m) => m.id === messageId);
    if (!existing) return;
    try {
      await setMessageVisibility(messageId, { clientVisible: !existing.clientVisible });
      await onReloadCollabData();
    } catch (e) {
      setThreadError(e instanceof Error ? e.message : "failed to change visibility");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <Crumbs trail={[{ label: "Clients", onClick: onBack }, { label: account.clientName }]} />
        {/* Cara's wireframe header, exactly: a navy band with the workspace
            name, the tabs INLINE, and the team's avatars on the right. */}
        <div
          style={{ display: "flex", alignItems: "stretch", gap: 18, background: navy, borderRadius: 10, padding: "0 18px", marginTop: 8, flexWrap: "wrap", minHeight: 52 }}
        >
          <h1 style={{ fontSize: 16.5, fontWeight: 800, color: "#fff", alignSelf: "center", whiteSpace: "nowrap", padding: "10px 0" }}>
            {account.clientName}
          </h1>
          <div role="tablist" aria-label="Client workspace" data-tour="client-tabs" style={{ display: "flex", gap: 4, flex: 1, flexWrap: "wrap", alignItems: "stretch" }}>
            {TABS.filter((t) => (t.key !== "sandbox" || sandboxContent) && (t.key !== "resourcing" || showResourcing) && tabVisibleForTier(viewTier, t.key)).map((t) => {
              const active = t.key === tab;
              return (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={active}
                  type="button"
                  onClick={() => setTab(t.key)}
                  style={{
                    background: "none",
                    border: "none",
                    borderBottom: active ? "3px solid #fff" : "3px solid transparent",
                    color: active ? "#fff" : "rgba(255,255,255,0.72)",
                    fontSize: 12.5,
                    fontWeight: active ? 800 : 600,
                    padding: "16px 10px 13px",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                  {...(t.key === "access" ? { "data-tour": "client-access" } : {})}
                  {...(t.key === "sandbox" ? { "data-tour": "client-sandbox" } : {})}
                >
                  {t.key === "sandbox" && sandboxCount > 0 ? `${t.label} (${sandboxCount})` : t.label}
                </button>
              );
            })}
          </div>
          <div style={{ position: "relative", alignSelf: "center" }}>
            <button
              type="button"
              title="People & collaboration — add teammates, invite the client, post an update"
              aria-expanded={hubOpen}
              onClick={() => setHubOpen((o) => !o)}
              style={{ display: "flex", alignItems: "center", background: "none", border: "none", cursor: "pointer", padding: 0 }}
            >
              {(collabData?.members ?? []).slice(0, 3).map((m, i) => (
                <span key={m.personId} style={{ marginLeft: i === 0 ? 0 : -8, borderRadius: "50%", border: "2px solid #fff", display: "inline-flex" }}>
                  <Avatar name={m.name} size={28} />
                </span>
              ))}
              <span aria-hidden style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, marginLeft: 6, borderRadius: "50%", border: "1.5px dashed rgba(255,255,255,0.6)", color: "#fff", fontSize: 15, fontWeight: 700 }}>+</span>
            </button>
            {hubOpen && (
              <CollaborateHub
                members={collabData?.members ?? []}
                externals={collabData?.externals ?? []}
                people={people}
                {...(onAddMember ? { onAddMember } : {})}
                {...(onAddNewMember ? { onAddNewMember } : {})}
                onAddExternal={onAddExternal}
                onPost={handlePostMessage}
                onOpenAccess={() => { setHubOpen(false); setTab("access"); }}
                onClose={() => setHubOpen(false)}
              />
            )}
          </div>
        </div>

        {taskError && (
          <div style={{ fontSize: 12, color: T.status.critical, background: "#fdeced", border: "1px solid #f3c2c4", borderRadius: 8, padding: "8px 12px", marginTop: 8 }}>
            {taskError}
          </div>
        )}

        {/* Our additions live BELOW the wireframe band: internal facts left,
            workspace actions right. */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
          {/* Kantata-first (ADR 0008): delivery facts only — HubSpot CRM
              intelligence came off this surface per the internal review. */}
          {liveContext && liveContext.projects.length > 0 && (
            <>
            <TagChip>
              Kantata: {liveContext.projects.length} project{liveContext.projects.length === 1 ? "" : "s"}
            </TagChip>
            {(() => {
              const mins = liveContext.projects.reduce((s, p) => s + (p.minutes30d ?? 0), 0);
              return mins > 0 ? <TagChip>⏱ {Math.round(mins / 60)} hrs · 30d</TagChip> : null;
            })()}
            {(() => {
              const team = [...new Set(liveContext.projects.flatMap((p) => p.team ?? []))];
              return team.length > 0 ? <TagChip>👥 {team.length} on delivery</TagChip> : null;
            })()}
            {deliveryQuiet(liveContext.projects) && (
              <span style={{ fontSize: 10, fontWeight: 800, color: "#8a6d1a", background: "#faf3dc", border: "1px solid #e7c66f", borderRadius: 999, padding: "2px 9px", textTransform: "uppercase", letterSpacing: 0.4 }}>
                ⚠ delivery quiet
              </span>
            )}
            </>
          )}
          <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            {onArchive && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                title="Hide this workspace from the Clients list — all history is retained and it can be restored"
                onClick={() => {
                  if (window.confirm(`Archive “${account.clientName}”? History is kept; restore any time from the Clients page.`)) onArchive();
                }}
              >
                Archive
              </button>
            )}
            {onImportCampaigns && (
              <button
                type="button"
                className={`btn btn-sm ${matchCount > 0 ? "btn-primary" : "btn-secondary"}`}
                data-tour="review-import"
                title="See what matched this client in Kantata and choose what to bring in. Nothing imports until you approve it."
                onClick={() => setReviewOpen((o) => !o)}
              >
                Review import{matchCount > 0 ? ` (${matchCount} matched)` : ""}
              </button>
            )}
          </span>
        </div>
      </div>

      {liveDataOn && liveContext && (
        <LinkDoctor
          context={liveContext}
          clientName={account.clientName}
          suggestions={linkSuggestions}
          hasImportedWork={(liveCampaigns?.length ?? account.campaigns.length) > 0}
          onRelink={onRelink}
          onLinkProjects={onLinkProjects}
        />
      )}

      {/* "Send these changes to Kantata" — PM-only per Kellie's pilot feedback
          (2026-08-19): PMs maintain tasks in Kantata, so pushing task/timeline
          changes back is theirs alone; the rest of the team never sees it.
          (Resourcing's separate write-back stays available to everyone.) */}
      {pendingKantataWrites.length > 0 && onPushToKantata && canManage && (
        <KantataPush writes={pendingKantataWrites} onPush={onPushToKantata} />
      )}

      {reviewOpen && onImportCampaigns && onRemoveCampaign && onClearCampaigns && (
        <ImportReview
          candidates={importCandidates}
          taskCandidates={taskCandidates}
          campaigns={liveCampaigns ?? account.campaigns}
          onImport={onImportCampaigns}
          onImportTasks={onImportTasks}
          onImportAll={onImportAll}
          onRemoveCampaign={onRemoveCampaign}
          onClearCampaigns={onClearCampaigns}
          onClose={() => setReviewOpen(false)}
        />
      )}

      {tab === "home" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {onImportCampaigns && (
            <SetupChecklist
              account={accountWithLiveData}
              tasks={tasks}
              fileApprovals={collabData?.fileApprovals ?? []}
              externals={collabData?.externals ?? []}
              candidatesCount={importCandidates.length}
              taskCandidatesCount={taskCandidates.length}
              goTo={setTab}
              onOpenReview={() => setReviewOpen(true)}
            />
          )}
          {onSetProjectScope && liveContext && liveContext.searchable.length > 0 && (
            <div style={{ ...card, padding: "12px 14px" }}>
              <ProjectScope
                clientName={account.clientName}
                projects={clientProjects}
                selectedIds={account.kantataProjectIds ?? []}
                scoped={account.scopedToProjects === true}
                onApply={(ids, scoped) => onSetProjectScope(ids, scoped)}
              />
            </div>
          )}
          <Home account={accountWithLiveData} tasks={tasks} fileApprovals={collabData?.fileApprovals ?? []} activity={collabData?.activity ?? []} userName={userName} goTo={setTab} onOpenTask={setOpenTask} />
          {/* "Delivery — live from Kantata" (LiveSystemsCard) removed from Home per
              Kellie's pilot feedback (2026-08-19). */}
          <WhatsNew activity={collabData?.activity ?? []} />
        </div>
      )}
      {tab === "plan" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* "Add a service-line playbook" removed per Kellie's pilot feedback
              (2026-08-19): timeline/template building stays in Kantata for
              consistency, not in this tool. */}
          <TasksCard tasks={tasks} owners={owners} onAdd={onAddTask} onStatus={onTaskStatus} onOpenTask={setOpenTask} onToggleClientVisible={onToggleClientVisible} {...(onToggleContractorVisible ? { onToggleContractorVisible } : {})} onDiscuss={startDiscussion} {...(onSetTaskAssignments ? { onSetTaskAssignments } : {})} {...(onSetAssignmentHours ? { onSetAssignmentHours } : {})} {...(onToggleAssignmentDone ? { onToggleAssignmentDone } : {})} {...(onSetAssignmentPrimary ? { onSetAssignmentPrimary } : {})} {...(onSetAssignmentOrder ? { onSetAssignmentOrder } : {})} {...(focusTaskId && tab === "plan" ? { focusTaskId } : {})} />
          {onSetTaskHours && showResourcing && (
            <RowButton onClick={() => setTab("resourcing")} title="Open Resourcing" style={{ padding: "10px 12px", border: `1px solid ${T.roi.cyan}`, borderRadius: 8, background: "#eef8fc" }}>
              <span style={{ fontSize: 12.5, color: "#16708f", fontWeight: 600 }}>
                Set hours &amp; see weekly resourcing → <strong>Resourcing tab</strong>
              </span>
            </RowButton>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={tasks.length === 0}
              title="Download this plan as CSV (opens in Excel)"
              onClick={() => {
                const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
                const rows = [
                  ["Task", "Owner", "Due", "Status", "Label"],
                  ...tasks.map((t) => [t.title, t.ownerName ?? "", t.due ?? "", t.status, t.label ?? ""]),
                ];
                const url = URL.createObjectURL(
                  new Blob([rows.map((r) => r.map(esc).join(",")).join("\n")], { type: "text/csv" }),
                );
                const link = document.createElement("a");
                link.href = url;
                link.download = `${account.clientName.replace(/[^\w]+/g, "-")}-tasks.csv`;
                link.click();
                URL.revokeObjectURL(url);
              }}
            >
              ⬇ Export CSV
            </button>
            <span style={{ fontSize: 11, color: T.inkMuted }}>
              One list, no double entry: tasks shared from a linked build appear here automatically
              and status changes flow back to the internal plan. Two-way Advanced Planner sync
              arrives with the M365 layer on this same shape.
            </span>
          </div>
        </div>
      )}
      {tab === "resourcing" && showResourcing && onSetTaskHours && (
        <ResourcingView
          tasks={tasks}
          reservations={liveContext?.reservations ?? []}
          onSetHours={onSetTaskHours}
          onPublish={onPublishResourcing}
          {...(focusTaskId ? { focusTaskId } : {})}
        />
      )}
      {tab === "dashboard" && <ClientDashboard account={accountWithLiveData} tasks={tasks} fileApprovals={collabData?.fileApprovals ?? []} onRemindDeliverable={onRemindDeliverable} onToggleClientVisible={onToggleClientVisible} onPost={handlePostMessage} onDiscuss={startDiscussion} {...(onClientDecision ? { onClientDecision } : {})} mentionRoster={buildMentionRoster(collabData?.members ?? [], collabData?.externals ?? [], people)} goTo={setTab} {...(liveContext ? { liveContext } : {})} />}
      {tab === "files" && (
        <FilesTab
          accountId={collabAccountId}
          {...(loginHintEmail ? { loginHintEmail } : {})}
          fileApprovals={collabData?.fileApprovals ?? []}
          onShareFile={onShareFile}
          onUnshareFile={onUnshareFile}
          onDiscussFile={(fileName, note) => { void handlePostMessage(note, fileName); setTab("discussions"); }}
        />
      )}
      {tab === "discussions" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {threadError && (
            <div style={{ fontSize: 12, color: T.status.critical, background: "#fdeced", border: "1px solid #f3c2c4", borderRadius: 8, padding: "8px 12px" }}>
              {threadError}
            </div>
          )}
          <DigestComposer account={accountWithLiveData} tasks={tasks} onPost={handlePostMessage} />
          <HandoffComposer account={account} topics={projectTopics} mentionRoster={buildMentionRoster(collabData?.members ?? [], collabData?.externals ?? [], people)} onPost={handlePostMessage} />
          <Thread
            messages={liveMessages}
            onPost={handlePostMessage}
            userName={userName}
            onEdit={handleEditMessage}
            onDelete={handleDeleteMessage}
            onToggleContractor={handleToggleMessageContractorVisible}
            onToggleClient={handleToggleMessageClientVisible}
            topics={projectTopics}
            projectOptions={discussionProjects}
            projectOf={projectOfTopic}
            {...(discussTopic ? { initialTopic: discussTopic } : {})}
            taskTitles={tasks.map((t) => t.title)}
            fileNames={(collabData?.fileApprovals ?? []).map((f) => f.name)}
            mentionRoster={buildMentionRoster(collabData?.members ?? [], collabData?.externals ?? [], people)}
            onQuickAdd={(name) => {
              const person = people.find((p) => p.name === name);
              if (person) onAddMember?.(person.id);
              else onAddNewMember?.(name, "");
            }}
            onOpenTopic={(topic, kind) => {
              if (kind === "task") { const t = tasks.find((x) => x.title === topic); if (t) setOpenTask(t); }
              else if (kind === "file") setTab("files");
              else if (kind === "project") setTab("dashboard");
            }}
          />
          {liveContext && liveContext.posts.length > 0 && <KantataConversation posts={liveContext.posts} />}
          <div style={{ fontSize: 11, color: T.inkMuted }}>
            Tip: “@FirstName” in a message notifies that person in Team Notifications on Home —
            works for the AGP team and external members alike.
          </div>
        </div>
      )}
      {tab === "sandbox" && sandboxContent}
      {tab === "access" && (
        <ClientAdminTab
          clientName={account.clientName}
          loginHintEmail={loginHintEmail}
          collabAccountId={collabAccountId}
          collabData={collabData}
          collabDataError={collabDataError}
          onReloadCollabData={onReloadCollabData}
          onAccountCreated={onAccountCreated}
          canManage={canManage}
        />
      )}
      {openTask && (
        <TaskDetail
          // Always render the freshest copy from the plan, so per-person edits
          // (hours, done, owner) show immediately without local patching.
          task={tasks.find((t) => t.id === openTask.id) ?? openTask}
          messages={liveMessages}
          clientName={account.clientName}
          mentionRoster={buildMentionRoster(collabData?.members ?? [], collabData?.externals ?? [], people)}
          onStatus={(id, s) => { onTaskStatus(id, s); setOpenTask((t) => (t && t.id === id ? { ...t, status: s } : t)); }}
          onPost={handlePostMessage}
          goTo={setTab}
          onClose={() => setOpenTask(null)}
          onDiscuss={startDiscussion}
          allTasks={tasks}
          {...(onSetTaskAssignments ? { onSetTaskAssignments } : {})}
          {...(onSetAssignmentHours ? { onSetAssignmentHours } : {})}
          {...(onToggleAssignmentDone ? { onToggleAssignmentDone } : {})}
          {...(onSetAssignmentPrimary ? { onSetAssignmentPrimary } : {})}
          {...(onSetAssignmentOrder ? { onSetAssignmentOrder } : {})}
          {...(onSetTaskDependencies ? { onSetTaskDependencies } : {})}
        />
      )}
    </div>
  );
}
