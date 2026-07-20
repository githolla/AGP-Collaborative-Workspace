import React, { useState } from "react";
import { card, T } from "../theme.js";
import { SectionTitle, TagChip } from "./bits.js";
import { TasksCard } from "./TasksCard.js";
import { Thread } from "./Thread.js";
import { Crumbs } from "./ui.js";
import { AS_OF_TODAY } from "../workspace/format.js";
import { composeClientDigest } from "../workspace/clientDigest.js";
import type { ClientAccount, ExternalMember, Task, TaskStatus } from "../workspace/types.js";

/**
 * Client-account workspace — built to the manager's wireframe: tabs Home /
 * Project Plan / Client Dashboard / Files / Discussions / Contractor Access,
 * with a personal Home (greeting + notifications, account overview, your
 * tasks, due this week, recent files, core documentation, latest discussions).
 *
 * HARD RULE enforced by construction: no internal financials (ROI, margin,
 * realism, human-in-the-loop) exist anywhere in this component tree.
 */

export type ClientTab = "home" | "plan" | "dashboard" | "files" | "discussions" | "access";

const TABS: { key: ClientTab; label: string }[] = [
  { key: "home", label: "Home" },
  { key: "plan", label: "Project Plan" },
  { key: "dashboard", label: "Client Dashboard" },
  { key: "files", label: "Files" },
  { key: "discussions", label: "Discussions" },
  { key: "access", label: "Contractor Access" },
];

const navy = T.roi.navy;

function fmtDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
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
  return (
    <button type="button" className="btn btn-primary btn-sm" onClick={onClick} style={{ alignSelf: "flex-start", marginTop: 8 }}>
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
  candidatesCount,
  goTo,
  onOpenReview,
}: {
  account: ClientAccount;
  tasks: Task[];
  candidatesCount: number;
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
            ? `Import this client's work — ${candidatesCount} campaign${candidatesCount === 1 ? "" : "s"} matched in Kantata & HubSpot`
            : "No Kantata/HubSpot work matched yet — add campaigns as they start",
      action: candidatesCount > 0 && onOpenReview ? { label: "Review & import", onClick: onOpenReview } : null,
    },
    {
      key: "access",
      done: account.externals.length > 0,
      label:
        account.externals.length > 0
          ? `Client & contractor access set (${account.externals.length})`
          : "Give the client (and any contractors) access",
      action: { label: "Open access", onClick: () => goTo("access") },
    },
    {
      key: "tasks",
      done: tasks.length > 0,
      label: tasks.length > 0 ? `Plan started (${tasks.length} task${tasks.length === 1 ? "" : "s"})` : "Add the first tasks with owners and due dates",
      action: { label: "Open plan", onClick: () => goTo("plan") },
    },
    {
      key: "files",
      done: account.files.length > 0,
      label: account.files.length > 0 ? `Files linked (${account.files.length})` : "Link the real files (SharePoint) behind the core docs",
      action: { label: "Open files", onClick: () => goTo("files") },
    },
  ];
  if (steps.every((s) => s.done)) return null;
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <div style={{ ...card, borderColor: navy, borderWidth: 1.5 }}>
      <SectionTitle right={<span style={{ fontSize: 11, color: T.inkMuted }}>{doneCount}/{steps.length} done</span>}>
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
// Home — the wireframe, zone for zone
// ---------------------------------------------------------------------------

function Home({ account, tasks, userName, goTo }: { account: ClientAccount; tasks: Task[]; userName: string; goTo: (t: ClientTab) => void }) {
  const today = AS_OF_TODAY();
  const weekOut = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const open = tasks.filter((t) => t.status !== "done");
  const dueThisWeek = open
    .filter((t) => t.due && t.due <= weekOut)
    .sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""));
  const byStatus = (s: TaskStatus) => tasks.filter((t) => t.status === s);
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
            {account.notifications.map((n) => (
              <RowButton key={n.id} onClick={() => goTo("discussions")} title="Open Discussions" style={{ padding: "5px 4px" }}>
                <span aria-hidden style={{ width: 5, height: 5, borderRadius: "50%", background: navy, flexShrink: 0 }} />
                <span style={{ fontSize: 12.5, color: T.inkSecondary, lineHeight: 1.5 }}>{n.text}</span>
              </RowButton>
            ))}
          </div>
        </div>
      </div>

      <div className="home-row-1">
        {/* Account overview */}
        <div style={card}>
          <SectionTitle>Account Overview</SectionTitle>
          {(
            [
              { label: "Active Campaigns", value: account.campaigns.filter((c) => c.status === "active").length, tab: "dashboard" as ClientTab, hint: "Open Client Dashboard" },
              { label: "Upcoming Tasks", value: open.length, tab: "plan" as ClientTab, hint: "Open Project Plan" },
              { label: "Client Contacts", value: account.clientContacts, tab: "access" as ClientTab, hint: "Open Contractor Access" },
            ]
          ).map((row) => (
            <RowButton key={row.label} onClick={() => goTo(row.tab)} title={row.hint} style={{ padding: "8px 4px" }}>
              <span style={{ flex: 1, fontSize: 12.5, color: T.inkSecondary }}>{row.label}:</span>
              <span style={{ fontSize: 20, fontWeight: 800, color: navy, fontVariantNumeric: "tabular-nums" }}>{row.value}</span>
            </RowButton>
          ))}
          {milestones.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.inkMuted, textTransform: "uppercase", letterSpacing: 0.5, margin: "10px 0 2px" }}>
                Upcoming milestones
              </div>
              {milestones.map((c) => (
                <RowButton key={c.id} onClick={() => goTo("dashboard")} title="Open Client Dashboard" style={{ padding: "5px 4px", borderBottom: "none" }}>
                  <span style={{ fontSize: 11.5, color: T.inkSecondary, lineHeight: 1.45 }}>
                    <span style={{ color: navy, fontWeight: 700 }}>{c.nextMilestone}</span> — {c.name}
                    <span style={{ color: T.inkMuted }}> · {c.nextMilestoneDate ? fmtDay(c.nextMilestoneDate) : ""}</span>
                  </span>
                </RowButton>
              ))}
            </>
          )}
        </div>

        {/* Your tasks — mini board */}
        <div style={{ ...card, display: "flex", flexDirection: "column" }}>
          <SectionTitle>Your Tasks</SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
            {boardCols.map((col) => (
              <div key={col.key}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: navy, borderRadius: "6px 6px 0 0", padding: "5px 8px" }}>{col.label}</div>
                <div style={{ border: `1px solid ${T.grid}`, borderTop: "none", borderRadius: "0 0 6px 6px", padding: 6, display: "flex", flexDirection: "column", gap: 6, minHeight: 90 }}>
                  {byStatus(col.key).slice(0, 2).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => goTo("plan")}
                      title="Open in Project Plan"
                      className="table-row-hover"
                      style={{ fontSize: 11.5, textAlign: "left", background: "none", border: "none", padding: "2px 3px", borderRadius: 4, cursor: "pointer" }}
                    >
                      <div style={{ fontWeight: 600, color: col.key === "done" ? T.inkMuted : navy, lineHeight: 1.3 }}>{t.title}</div>
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
          <ViewAll label="View All Tasks" onClick={() => goTo("plan")} />
        </div>

        {/* Due this week */}
        <div style={card}>
          <SectionTitle>Due This Week</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {dueThisWeek.map((t, i) => (
              <RowButton key={t.id} onClick={() => goTo("plan")} title="Open in Project Plan" style={{ padding: "9px 4px" }}>
                <span aria-hidden style={{ width: 11, height: 11, background: squares[i % squares.length], borderRadius: 2, flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 12.5, fontWeight: 700, color: navy, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
                <span style={{ fontSize: 11.5, color: T.inkSecondary, whiteSpace: "nowrap" }}>{t.due ? fmtDay(t.due) : ""}</span>
              </RowButton>
            ))}
            {dueThisWeek.length === 0 && (
              <div style={{ fontSize: 12, color: T.inkMuted, paddingTop: 6 }}>
                {today ? "Nothing due this week." : ""}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="home-row-2">
        {/* Recent files */}
        <div style={{ ...card, display: "flex", flexDirection: "column" }}>
          <SectionTitle>Recent Files</SectionTitle>
          {account.files.slice(0, 4).map((f) => (
            <RowButton
              key={f.id}
              onClick={() => (f.url ? window.open(f.url, "_blank", "noreferrer") : goTo("files"))}
              title={f.url ? "Open the file" : "Open Files"}
            >
              <span aria-hidden style={{ fontSize: 13 }}>{glyphFor(f.name)}</span>
              <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: navy, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
            </RowButton>
          ))}
          <ViewAll label="View All Files" onClick={() => goTo("files")} />
        </div>

        {/* Core documentation */}
        <div style={{ ...card, display: "flex", flexDirection: "column" }}>
          <SectionTitle>Core Documentation</SectionTitle>
          {account.docs.map((d) => (
            <RowButton
              key={d.id}
              onClick={() => (d.url ? window.open(d.url, "_blank", "noreferrer") : goTo("files"))}
              title={d.url ? "Open the document" : "Open Files"}
              style={{ padding: "9px 4px" }}
            >
              <span aria-hidden style={{ width: 14, height: 14, background: navy, borderRadius: 3, opacity: 0.75, flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 12.5, color: T.ink }}>{d.name}</span>
            </RowButton>
          ))}
          <ViewAll label="View All Docs" onClick={() => goTo("files")} />
        </div>

        {/* Latest discussions */}
        <div style={card}>
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
          <ViewAll label="View All Discussions" onClick={() => goTo("discussions")} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Client dashboard — the client-safe view
// ---------------------------------------------------------------------------

function ClientDashboard({ account, tasks }: { account: ClientAccount; tasks: Task[] }) {
  const done = tasks.filter((t) => t.status === "done").length;
  const pct = tasks.length > 0 ? Math.round((done / tasks.length) * 100) : 0;
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
      <div style={card}>
        <SectionTitle>Delivery progress</SectionTitle>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1, height: 12, background: "#f0efec", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: navy, borderRadius: 4 }} />
          </div>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: T.ink }}>{done}/{tasks.length} tasks complete</span>
        </div>
      </div>
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
}

function ImportReview({
  candidates,
  campaigns,
  onImport,
  onRemoveCampaign,
  onClearCampaigns,
  onClose,
}: {
  candidates: ImportCandidate[];
  campaigns: ClientAccount["campaigns"];
  onImport: (selected: ImportCandidate[]) => void;
  onRemoveCampaign: (campaignId: string) => void;
  onClearCampaigns: () => void;
  onClose: () => void;
}) {
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const selected = candidates.filter((c) => !deselected.has(c.name));
  const toggle = (name: string) =>
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <div style={{ ...card, borderColor: navy, borderWidth: 1.5 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <SectionTitle>Review import — nothing lands until you say so</SectionTitle>
        <button type="button" className="btn-link" style={{ fontSize: 11.5 }} onClick={onClose}>
          Close
        </button>
      </div>

      {candidates.length === 0 ? (
        <div style={{ fontSize: 12.5, color: T.inkMuted, padding: "6px 0" }}>
          Nothing new matched this client in Kantata or HubSpot. If work exists under a different
          name or abbreviation, fix the HubSpot “Client Abbreviation” field and refresh (⟳ pill,
          top right).
        </div>
      ) : (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.inkMuted, textTransform: "uppercase", letterSpacing: 0.5, margin: "4px 0 6px" }}>
            Matched in Kantata &amp; HubSpot — uncheck anything that isn't this client's
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
  );
}

// ---------------------------------------------------------------------------
// Weekly digest composer — AI drafts, the account manager approves.
// Research-backed (docs/research-best-practices.md): AI status drafting is
// the highest-ROI AI feature in the category, and draft-then-approve is the
// pattern behind every liked implementation. Composed only from client-safe
// account data.
// ---------------------------------------------------------------------------

function DigestComposer({ account, tasks, onPost }: { account: ClientAccount; tasks: Task[]; onPost: (body: string) => void }) {
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
            onPost(draft);
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

function FilesTab({ account, onAddLink }: { account: ClientAccount; onAddLink: (name: string, kind: "file" | "doc", url?: string) => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"file" | "doc">("file");
  const [url, setUrl] = useState("");
  const list = (title: string, items: ClientAccount["files"]) => (
    <div style={card}>
      <SectionTitle>{title}</SectionTitle>
      {items.map((f) => (
        <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: `1px solid ${T.grid}` }}>
          <span aria-hidden style={{ fontSize: 13 }}>{glyphFor(f.name)}</span>
          {f.url ? (
            <a href={f.url} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, fontWeight: 600, color: navy }}>{f.name}</a>
          ) : (
            <span style={{ fontSize: 12.5, fontWeight: 600, color: T.ink }}>{f.name}</span>
          )}
          <span style={{ marginLeft: "auto", fontSize: 10.5, color: T.inkMuted }}>{f.addedAt.slice(0, 10)}</span>
        </div>
      ))}
      {items.length === 0 && <div style={{ fontSize: 12, color: T.inkMuted }}>Nothing here yet.</div>}
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="home-row-1" style={{ gridTemplateColumns: "1fr 1fr" }}>
        {list("Files", account.files)}
        {list("Core Documentation", account.docs)}
      </div>
      <div style={card}>
        <SectionTitle>Link a file or document</SectionTitle>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Fall_Package_v2.pptx" className="input" style={{flex: 2, minWidth: 180 }} />
          <select value={kind} onChange={(e) => setKind(e.target.value as "file" | "doc")} className="select">
            <option value="file">File</option>
            <option value="doc">Core doc</option>
          </select>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="SharePoint link (optional)" className="input" style={{flex: 2, minWidth: 160 }} />
          <button
            type="button"
            disabled={!name.trim()}
            onClick={() => {
              onAddLink(name.trim(), kind, url.trim() || undefined);
              setName("");
              setUrl("");
            }}
            className="btn btn-primary btn-sm"
          >
            Add
          </button>
        </div>
        <div style={{ fontSize: 11, color: T.inkMuted, marginTop: 8 }}>
          Storage itself lives in SharePoint/Teams Files (single source of truth, versioning) per
          the M365 mapping — this workspace links to it, never forks it.
        </div>
      </div>
    </div>
  );
}

function AccessTab({
  account,
  onAdd,
  onRemove,
  onOffboardEverywhere,
}: {
  account: ClientAccount;
  onAdd: (name: string, org: string, role: ExternalMember["role"], access: ExternalMember["access"]) => void;
  onRemove: (externalId: string) => void;
  onOffboardEverywhere: (personName: string) => void;
}) {
  const [name, setName] = useState("");
  const [org, setOrg] = useState("");
  const [role, setRole] = useState<ExternalMember["role"]>("contractor");
  const [access, setAccess] = useState<ExternalMember["access"]>("files-only");
  // Entra access-review pattern (docs/research-best-practices.md): flag
  // guests with no activity in 30+ days so the account lead re-attests them.
  const staleCutoff = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const isStale = (e: ExternalMember) => !!e.lastActive && e.lastActive.slice(0, 10) < staleCutoff;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={card}>
        <SectionTitle>AGP team</SectionTitle>
        {account.members.map((m) => (
          <div key={m.personId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: `1px solid ${T.grid}` }}>
            <Avatar name={m.name} />
            <span style={{ fontSize: 12.5, fontWeight: 600, color: T.ink }}>{m.name}</span>
            <span style={{ fontSize: 11.5, color: T.inkMuted }}>{m.title}</span>
          </div>
        ))}
      </div>

      <div style={card}>
        <SectionTitle>External access — clients & contractors</SectionTitle>
        {account.externals.map((e) => (
          <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${T.grid}`, flexWrap: "wrap" }}>
            <Avatar name={e.name} />
            <span style={{ fontSize: 12.5, fontWeight: 600, color: T.ink }}>{e.name}</span>
            <span style={{ fontSize: 11.5, color: T.inkMuted }}>{e.org}</span>
            <TagChip>{e.role}</TagChip>
            <TagChip>{e.access}</TagChip>
            <span style={{ fontSize: 10.5, color: T.inkMuted }}>
              invited by {e.invitedBy ?? "—"} · last active {e.lastActive ?? "—"}
            </span>
            {isStale(e) && (
              <span
                title="No activity in 30+ days — confirm this person still needs access, or remove them"
                style={{ fontSize: 10, fontWeight: 800, color: "#8a6d1a", background: "#faf3dc", border: "1px solid #e7c66f", borderRadius: 999, padding: "2px 9px", textTransform: "uppercase", letterSpacing: 0.4 }}
              >
                ⚠ review access
              </span>
            )}
            <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              <button
                type="button"
                onClick={() => onRemove(e.id)}
                title="Removal revokes access across this workspace immediately"
                className="btn btn-danger btn-sm"
              >
                Remove — revokes immediately
              </button>
              <button
                type="button"
                onClick={() => onOffboardEverywhere(e.name)}
                title="One click removes this person from every client workspace, audit-logged"
                className="btn btn-danger-solid btn-sm"
              >
                Offboard everywhere
              </button>
            </span>
          </div>
        ))}
        {account.externals.length === 0 && <div style={{ fontSize: 12, color: T.inkMuted }}>No external members.</div>}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="input" style={{flex: 1, minWidth: 130 }} />
          <input value={org} onChange={(e) => setOrg(e.target.value)} placeholder="Organization" className="input" style={{flex: 1, minWidth: 130 }} />
          <select value={role} onChange={(e) => setRole(e.target.value as ExternalMember["role"])} className="select">
            <option value="client">Client</option>
            <option value="contractor">Contractor</option>
          </select>
          <select value={access} onChange={(e) => setAccess(e.target.value as ExternalMember["access"])} className="select">
            <option value="workspace">Full workspace</option>
            <option value="files-only">Files only</option>
            <option value="tasks-only">Tasks only</option>
          </select>
          <button
            type="button"
            disabled={!name.trim() || !org.trim()}
            onClick={() => {
              onAdd(name.trim(), org.trim(), role, access);
              setName("");
              setOrg("");
            }}
            className="btn btn-primary btn-sm"
          >
            Grant access
          </button>
        </div>
        <div style={{ fontSize: 11, color: T.inkMuted, marginTop: 8 }}>
          Guests see only what their level allows; internal financials are never visible to
          external roles. Real identity enforcement lands with Entra guest accounts / Supabase RLS.
        </div>
      </div>

      <div style={card}>
        <SectionTitle>Access log</SectionTitle>
        {[...account.activity].reverse().filter((a) => a.kind === "team").slice(0, 8).map((a) => (
          <div key={a.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12, color: T.inkSecondary, padding: "5px 0" }}>
            <span>{a.text}</span>
            <span style={{ color: T.inkMuted, fontVariantNumeric: "tabular-nums" }}>{a.at.slice(0, 10)}</span>
          </div>
        ))}
      </div>
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
  onPost,
  onAddLink,
  onAddExternal,
  onRemoveExternal,
  onOffboardEverywhere,
  importCandidates = [],
  onImportCampaigns,
  onRemoveCampaign,
  onClearCampaigns,
}: {
  account: ClientAccount;
  /** The shared plan: account tasks + client-visible tasks from linked builds. */
  sharedTasks: { task: Task; fromInternal: boolean }[];
  userName: string;
  onBack: () => void;
  /** New Kantata/HubSpot matches not yet in this workspace — user-gated. */
  importCandidates?: ImportCandidate[];
  onImportCampaigns?: (selected: ImportCandidate[]) => void;
  onRemoveCampaign?: (campaignId: string) => void;
  onClearCampaigns?: () => void;
  onAddTask: (title: string, ownerName?: string, due?: string, label?: string) => void;
  onTaskStatus: (taskId: string, status: TaskStatus) => void;
  onPost: (body: string) => void;
  onAddLink: (name: string, kind: "file" | "doc", url?: string) => void;
  onAddExternal: (name: string, org: string, role: ExternalMember["role"], access: ExternalMember["access"]) => void;
  onRemoveExternal: (externalId: string) => void;
  onOffboardEverywhere: (personName: string) => void;
}) {
  const [tab, setTab] = useState<ClientTab>("home");
  // A fresh workspace with matched work opens the review panel by itself —
  // the next action should be on screen, not hidden behind a corner button.
  const [reviewOpen, setReviewOpen] = useState(
    () => importCandidates.length > 0 && account.campaigns.length === 0,
  );
  // Mirrored internal tasks get a display label so their origin is visible.
  const tasks: Task[] = sharedTasks.map(({ task, fromInternal }) =>
    fromInternal && !task.label ? { ...task, label: "shared from internal plan" } : task,
  );
  const owners = [...new Set(tasks.map((t) => t.ownerName).filter((o): o is string => !!o))];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <Crumbs trail={[{ label: "Clients", onClick: onBack }, { label: account.clientName }]} />
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 6, flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 18, fontWeight: 800, color: navy }}>{account.clientName}</h1>
          <TagChip>Client account</TagChip>
          {onImportCampaigns && (
            <button
              type="button"
              className={`btn btn-sm ${importCandidates.length > 0 ? "btn-primary" : "btn-secondary"}`}
              style={{ marginLeft: "auto" }}
              title="See what matched this client in Kantata & HubSpot and choose what to bring in. Nothing imports until you approve it."
              onClick={() => setReviewOpen((o) => !o)}
            >
              Review import{importCandidates.length > 0 ? ` (${importCandidates.length} matched)` : ""}
            </button>
          )}
        </div>
        <div role="tablist" aria-label="Client workspace" data-tour="client-tabs" style={{ display: "flex", gap: 2, marginTop: 12, borderBottom: `2px solid ${navy}`, flexWrap: "wrap" }}>
          {TABS.map((t) => {
            const active = t.key === tab;
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={active}
                type="button"
                className="ws-tab"
                onClick={() => setTab(t.key)}
                {...(t.key === "access" ? { "data-tour": "client-access" } : {})}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {reviewOpen && onImportCampaigns && onRemoveCampaign && onClearCampaigns && (
        <ImportReview
          candidates={importCandidates}
          campaigns={account.campaigns}
          onImport={onImportCampaigns}
          onRemoveCampaign={onRemoveCampaign}
          onClearCampaigns={onClearCampaigns}
          onClose={() => setReviewOpen(false)}
        />
      )}

      {tab === "home" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {onImportCampaigns && (
            <SetupChecklist
              account={account}
              tasks={tasks}
              candidatesCount={importCandidates.length}
              goTo={setTab}
              onOpenReview={() => setReviewOpen(true)}
            />
          )}
          <Home account={account} tasks={tasks} userName={userName} goTo={setTab} />
        </div>
      )}
      {tab === "plan" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <TasksCard tasks={tasks} owners={owners} onAdd={onAddTask} onStatus={onTaskStatus} />
          <div style={{ fontSize: 11, color: T.inkMuted }}>
            One list, no double entry: tasks shared from a linked build appear here automatically
            and status changes flow back to the internal plan. Two-way Advanced Planner sync
            arrives with the M365 layer on this same shape.
          </div>
        </div>
      )}
      {tab === "dashboard" && <ClientDashboard account={account} tasks={tasks} />}
      {tab === "files" && <FilesTab account={account} onAddLink={onAddLink} />}
      {tab === "discussions" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <DigestComposer account={account} tasks={tasks} onPost={onPost} />
          <Thread messages={account.thread} onPost={onPost} />
        </div>
      )}
      {tab === "access" && (
        <AccessTab account={account} onAdd={onAddExternal} onRemove={onRemoveExternal} onOffboardEverywhere={onOffboardEverywhere} />
      )}
    </div>
  );
}
