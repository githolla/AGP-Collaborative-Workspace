import React, { useState } from "react";
import { card, T } from "../theme.js";
import { KantataChip, SectionTitle, TagChip } from "./bits.js";
import { TasksCard } from "./TasksCard.js";
import { Thread } from "./Thread.js";
import { Crumbs } from "./ui.js";
import { AS_OF_TODAY } from "../workspace/format.js";
import { composeClientDigest } from "../workspace/clientDigest.js";
import { deliveryQuiet, type AccountLiveContext } from "../workspace/campaignImport.js";
import { TEMPLATES, instantiateTemplate } from "../workspace/templates.js";
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

export type ClientTab = "home" | "plan" | "dashboard" | "files" | "discussions" | "sandbox" | "access";

const TABS: { key: ClientTab; label: string }[] = [
  { key: "home", label: "Home" },
  { key: "plan", label: "Project Plan" },
  { key: "dashboard", label: "Client Dashboard" },
  { key: "files", label: "Files" },
  { key: "discussions", label: "Discussions" },
  // The Sandbox lives INSIDE each client — ideas are tied to the client
  // they're for. Content is composed by App (internal-only modules never
  // enter this file's import graph — clientSafety.test.ts).
  { key: "sandbox", label: "Sandbox" },
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
  candidatesCount,
  taskCandidatesCount = 0,
  goTo,
  onOpenReview,
}: {
  account: ClientAccount;
  tasks: Task[];
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
      done: account.files.length > 0,
      label: account.files.length > 0 ? `Files linked (${account.files.length})` : "Link the real files (SharePoint) behind the core docs",
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

/** "health_services" → "Health services". */
const prettyValue = (v: string) => {
  const s = v.replace(/_/g, " ").toLowerCase().trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

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

/**
 * Kantata-first (2026-07-20 internal review, ADR 0008): HubSpot is
 * pre-acquisition CRM — its account intelligence came OFF this delivery
 * surface. This card shows what Kantata knows about the client's delivery;
 * HubSpot remains only the client directory behind workspace creation.
 */
function LiveSystemsCard({ context, live, clientName }: { context: AccountLiveContext; live: boolean; clientName: string }) {
  const today = AS_OF_TODAY();
  const hasAny = context.projects.length > 0;
  // Demo data with nothing to show: stay quiet rather than render an empty shell.
  if (!hasAny && !live) return null;

  const upcoming = (p: AccountLiveContext["projects"][number]) =>
    p.milestones.filter((m) => m.state !== "completed" && m.dueDate >= today);

  return (
    <div style={card} data-tour="live-systems">
      <SectionTitle
        right={
          <span style={{ fontSize: 10.5, fontWeight: 700, color: live ? "#116a43" : T.inkMuted, background: live ? "#e3f4ec" : "#f0efec", borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>
            {live ? "● live" : "demo data"}
          </span>
        }
      >
        Delivery — live from Kantata
      </SectionTitle>

      <div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.inkMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
            {context.projects.length} project{context.projects.length === 1 ? "" : "s"} in flight
          </div>
          {context.projects.length === 0 ? (
            <div style={{ fontSize: 12, color: T.inkMuted, padding: "4px 0 10px" }}>
              No Kantata project matched “{clientName}” — matching uses the workspace group, the
              client abbreviation as a title prefix, or the client name in the project title.
            </div>
          ) : (
            context.projects.slice(0, 5).map((p) => {
              const next = upcoming(p);
              const openTasks = p.tasks.filter((t) => t.state !== "completed").length;
              const hrs30 = p.minutes30d != null ? Math.round(p.minutes30d / 60) : null;
              return (
                <div key={p.title} style={{ padding: "6px 0", borderBottom: `1px solid ${T.grid}` }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: T.ink }}>{p.title}</span>
                    {p.status && <TagChip>{prettyValue(p.status)}</TagChip>}
                    {p.dueDate && <span style={{ fontSize: 11, color: T.inkSecondary }}>due {fmtDay(p.dueDate)}</span>}
                  </div>
                  {/* Delivery pulse: hours logged + who's on it — from time entries & participations. */}
                  {(hrs30 != null || openTasks > 0) && (
                    <div style={{ fontSize: 11, color: hrs30 === 0 ? "#8a6d1a" : T.inkSecondary, padding: "2px 0 0 12px" }}>
                      {hrs30 != null
                        ? hrs30 > 0
                          ? `⏱ ${hrs30} hrs logged in the last 30 days${p.people30d ? ` by ${p.people30d} ${p.people30d === 1 ? "person" : "people"}` : ""}`
                          : `⏱ no time logged in 30+ days${p.lastEntryDate ? ` (last: ${fmtDay(p.lastEntryDate)})` : ""}`
                        : ""}
                      {hrs30 != null && openTasks > 0 ? " · " : ""}
                      {openTasks > 0 ? `${openTasks} open task${openTasks === 1 ? "" : "s"} in Kantata` : ""}
                    </div>
                  )}
                  {p.team && p.team.length > 0 && (
                    <div style={{ fontSize: 11, color: T.inkSecondary, padding: "2px 0 0 12px" }}>
                      👥 {p.team.slice(0, 5).join(", ")}
                      {p.team.length > 5 ? ` +${p.team.length - 5} more` : ""}
                    </div>
                  )}
                  {next.slice(0, 3).map((m) => (
                    <div key={`${m.title}-${m.dueDate}`} style={{ fontSize: 11.5, color: T.inkSecondary, padding: "2px 0 0 12px" }}>
                      ◦ {m.title} — {fmtDay(m.dueDate)}
                      {m.hard ? <span style={{ color: "#8a6d1a", fontWeight: 700 }}> · hard date</span> : ""}
                    </div>
                  ))}
                  {next.length > 3 && (
                    <div style={{ fontSize: 10.5, color: T.inkMuted, padding: "2px 0 0 12px" }}>+{next.length - 3} more milestones</div>
                  )}
                </div>
              );
            })
          )}
          {deliveryQuiet(context.projects) && (
            <div style={{ fontSize: 11.5, color: "#8a6d1a", background: "#faf3dc", border: "1px solid #e7c66f", borderRadius: 8, padding: "8px 12px", marginTop: 8, lineHeight: 1.5 }}>
              <strong>Delivery quiet.</strong> Projects exist but nobody logged time in 30 days —
              worth checking whether the work is actually moving.
            </div>
          )}
          {context.projects.length > 5 && (
            <div style={{ fontSize: 10.5, color: T.inkMuted, padding: "4px 0" }}>+{context.projects.length - 5} more projects matched</div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Template picker (Collab Hub Must: "apply a template for consistent set
 * up"): AGP's service-line playbooks as dated task skeletons. Pick, set a
 * start date, see the shape, apply — re-applying never duplicates.
 */
const templateWeeks = (t: (typeof TEMPLATES)[number]) => Math.max(1, Math.round((t.tasks[t.tasks.length - 1]?.offsetDays ?? 0) / 7));

function TemplatePicker({ onApply }: { onApply: (templateKey: string, startDate: string) => void }) {
  const [key, setKey] = useState(TEMPLATES[0]?.key ?? "");
  const [start, setStart] = useState(AS_OF_TODAY());
  const [applied, setApplied] = useState(false);
  const tpl = TEMPLATES.find((t) => t.key === key);
  if (!tpl) return null;
  const preview = instantiateTemplate(tpl, start);
  const weeks = templateWeeks(tpl);

  return (
    <div style={card}>
      <SectionTitle right={<span style={{ fontSize: 10.5, color: T.inkMuted }}>the same playbook every time — consistent set up</span>}>
        Start from a template
      </SectionTitle>

      {/* Pick a playbook — tiles, not a dropdown, so the choice is visual. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
        {TEMPLATES.map((t) => {
          const on = t.key === key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => { setKey(t.key); setApplied(false); }}
              aria-pressed={on}
              style={{
                textAlign: "left",
                cursor: "pointer",
                borderRadius: 10,
                padding: "10px 12px",
                background: on ? "#eef2fb" : "#fff",
                border: `1.5px solid ${on ? T.roi.navy : T.grid}`,
                display: "flex",
                flexDirection: "column",
                gap: 3,
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span aria-hidden style={{ width: 13, height: 13, borderRadius: "50%", flexShrink: 0, border: `2px solid ${on ? T.roi.navy : T.border}`, background: on ? T.roi.navy : "transparent", boxShadow: on ? "inset 0 0 0 2px #fff" : "none" }} />
                <span style={{ fontSize: 13, fontWeight: 800, color: T.roi.navy }}>{t.name}</span>
              </span>
              <span style={{ fontSize: 10.5, color: T.inkMuted }}>{t.tasks.length} tasks · ~{templateWeeks(t)} weeks · {t.serviceLine}</span>
              <span style={{ fontSize: 11, color: T.inkSecondary, lineHeight: 1.4 }}>{t.description}</span>
            </button>
          );
        })}
      </div>

      {/* Start date + a mini timeline preview of what will land. */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
        <label style={{ fontSize: 11.5, color: T.inkSecondary, display: "flex", alignItems: "center", gap: 6, fontWeight: 700 }}>
          Start date
          <input type="date" className="input" value={start} onChange={(e) => { setStart(e.target.value); setApplied(false); }} style={{ padding: "7px 10px", fontSize: 12 }} />
        </label>
        <span style={{ fontSize: 11, color: T.inkMuted }}>
          {tpl.tasks.length} dated tasks over ~{weeks} weeks · ends {fmtDay(preview[preview.length - 1]?.due ?? start)}
        </span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
        {preview.slice(0, 5).map((t, i) => (
          <span key={i} style={{ display: "inline-flex", alignItems: "baseline", gap: 5, fontSize: 10.5, background: "#f4f6fa", borderRadius: 6, padding: "3px 8px", color: T.ink }}>
            <span style={{ fontWeight: 700, color: T.roi.navy, fontVariantNumeric: "tabular-nums" }}>{fmtDay(t.due).split(",")[0]}</span>
            <span style={{ color: T.inkSecondary }}>{t.title}</span>
          </span>
        ))}
        {preview.length > 5 && <span style={{ fontSize: 10.5, color: T.inkMuted, alignSelf: "center" }}>+{preview.length - 5} more</span>}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => { onApply(tpl.key, start); setApplied(true); }}
        >
          Apply “{tpl.name}” — add {tpl.tasks.length} tasks →
        </button>
        {applied && <span style={{ fontSize: 11.5, fontWeight: 700, color: "#116a43" }}>✓ Added to the plan — assign owners on the Project Plan tab</span>}
      </div>
      <div style={{ fontSize: 10.5, color: T.inkMuted, marginTop: 8 }}>
        Tasks land labeled “{tpl.name}”. Owners are added as the team firms up; already-existing titles are never duplicated, so you can apply more than one playbook safely.
      </div>
    </div>
  );
}

/** Activity feed (Collab Hub Must): the workspace's "what's new" — imports,
 * tasks, access changes, files — newest first. */
function WhatsNew({ account }: { account: ClientAccount }) {
  const recent = [...account.activity].reverse().slice(0, 6);
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

function Home({ account, tasks, userName, goTo, onOpenTask }: { account: ClientAccount; tasks: Task[]; userName: string; goTo: (t: ClientTab) => void; onOpenTask: (task: Task) => void }) {
  const today = AS_OF_TODAY();
  const weekOut = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const open = tasks.filter((t) => t.status !== "done");
  // Actually THIS week: due from today through the next 7 days. (Past-due
  // tasks are overdue, not "due this week" — they surface on the plan, not here.)
  const dueThisWeek = open
    .filter((t) => t.due && t.due >= today && t.due <= weekOut)
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
                      onClick={() => onOpenTask(t)}
                      title="See everything about this task"
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
              <RowButton key={t.id} onClick={() => onOpenTask(t)} title="See everything about this task" style={{ padding: "9px 4px" }}>
                <span aria-hidden style={{ width: 11, height: 11, background: squares[i % squares.length], borderRadius: 2, flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 12.5, fontWeight: 700, color: navy, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
                <span style={{ fontSize: 11.5, color: T.inkSecondary, whiteSpace: "nowrap" }}>{t.due ? fmtDay(t.due) : ""}</span>
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
          {account.files.length === 0 && (
            <EmptyZone label="No files yet — link the SharePoint files this account lives in" onClick={() => goTo("files")} />
          )}
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

function ClientDashboard({ account, tasks, liveContext }: { account: ClientAccount; tasks: Task[]; liveContext?: AccountLiveContext }) {
  const done = tasks.filter((t) => t.status === "done").length;
  const pct = tasks.length > 0 ? Math.round((done / tasks.length) * 100) : 0;
  const today = AS_OF_TODAY();
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

/** An open Kantata task not yet in this workspace's plan — user-gated. */
export interface TaskCandidate {
  title: string;
  status: TaskStatus;
  due?: string;
  project: string;
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
  const selected = candidates.filter((c) => !deselected.has(c.name));
  const selectedTasks = taskCandidates.filter((t) => !tasksDeselected.has(t.title));
  const toggle = (name: string) =>
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  const toggleTask = (title: string) =>
    setTasksDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
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
              key={t.title}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 4px", borderBottom: `1px solid ${T.grid}`, cursor: "pointer" }}
            >
              <input type="checkbox" checked={!tasksDeselected.has(t.title)} onChange={() => toggleTask(t.title)} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: T.ink }}>{t.title}</span>
                <span style={{ fontSize: 11, color: T.inkSecondary }}>
                  {t.status === "doing" ? "in progress" : "to do"}
                  {t.due ? ` · due ${fmtDay(t.due)}` : ""} · {t.project}
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
  account,
  people,
  onAddMember,
  onAddExternal,
  onPost,
  onOpenAccess,
  onClose,
}: {
  account: ClientAccount;
  people: { id: string; name: string; title: string }[];
  onAddMember?: (personId: string) => void;
  onAddExternal: (name: string, org: string, role: ExternalMember["role"], access: ExternalMember["access"]) => void;
  onPost: (body: string) => void;
  onOpenAccess: () => void;
  onClose: () => void;
}) {
  const [msg, setMsg] = useState("");
  const [invName, setInvName] = useState("");
  const [invOrg, setInvOrg] = useState("");
  const [invRole, setInvRole] = useState<ExternalMember["role"]>("client");
  const onAccount = new Set(account.members.map((m) => m.personId));
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

        <div style={label}>On this account ({account.members.length + account.externals.length})</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {account.members.map((m) => (
            <div key={m.personId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
              <Avatar name={m.name} size={24} />
              <span style={{ fontSize: 12.5, color: T.ink, flex: 1 }}>{m.name}<span style={{ color: T.inkMuted }}> · {m.title}</span></span>
            </div>
          ))}
          {account.externals.map((e) => (
            <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
              <Avatar name={e.name} size={24} />
              <span style={{ fontSize: 12.5, color: T.ink, flex: 1 }}>{e.name}<span style={{ color: T.inkMuted }}> · {e.org} ({e.role})</span></span>
            </div>
          ))}
        </div>

        {onAddMember && addable.length > 0 && (
          <>
            <div style={label}>Add an AGP teammate</div>
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
              <option value="" disabled>Choose a teammate…</option>
              {addable.map((p) => (
                <option key={p.id} value={p.id}>{p.name} — {p.title}</option>
              ))}
            </select>
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
              onAddExternal(invName.trim(), invOrg.trim(), invRole, "workspace");
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
  onStatus,
  onPost,
  goTo,
  onClose,
}: {
  task: Task;
  onStatus: (taskId: string, status: TaskStatus) => void;
  onPost: (body: string) => void;
  goTo: (t: ClientTab) => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState("");
  const fromKantata = task.label === "from Kantata";
  const overdue = task.status !== "done" && !!task.due && task.due < AS_OF_TODAY();
  const statusLabel: Record<TaskStatus, string> = { todo: "To do", doing: "In progress", done: "Done" };
  const field = (k: string, v: React.ReactNode) => (
    <div style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: `1px solid ${T.grid}` }}>
      <span style={{ width: 92, flexShrink: 0, fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: T.inkMuted }}>{k}</span>
      <span style={{ fontSize: 12.5, color: T.ink, lineHeight: 1.5 }}>{v}</span>
    </div>
  );
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(16,21,46,0.28)", zIndex: 60 }} />
      <div
        role="dialog"
        aria-label={`Task — ${task.title}`}
        style={{ position: "fixed", top: 0, right: 0, height: "100vh", width: 380, maxWidth: "94vw", background: "#fff", color: T.ink, boxShadow: "-14px 0 40px rgba(16,21,46,0.22)", zIndex: 61, padding: 20, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: T.inkMuted }}>Task</span>
          <button type="button" className="btn-link" style={{ fontSize: 12 }} onClick={onClose}>Close ✕</button>
        </div>
        <h3 style={{ fontSize: 16, fontWeight: 800, color: navy, margin: "2px 0 10px", lineHeight: 1.3 }}>{task.title}</h3>

        {field("Status", statusLabel[task.status])}
        {field("Owner", task.ownerName || <span style={{ color: T.inkMuted }}>Unassigned</span>)}
        {field("Due", task.due ? <span style={{ color: overdue ? T.status.critical : T.ink, fontWeight: overdue ? 700 : 400 }}>{overdue ? "⚠ " : ""}{fmtDay(task.due)}</span> : <span style={{ color: T.inkMuted }}>No date</span>)}
        {task.label && field("Label", fromKantata ? <KantataChip /> : <TagChip>{task.label}</TagChip>)}
        {task.phaseKey && field("Phase", <TagChip>{task.phaseKey}</TagChip>)}
        {field("Source", fromKantata ? "Synced from Kantata" : task.source === "plan" ? "From a linked build plan" : "Added here")}

        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: T.inkMuted, margin: "14px 0 6px" }}>Move to</div>
        <div style={{ display: "flex", gap: 6 }}>
          {(["todo", "doing", "done"] as TaskStatus[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onStatus(task.id, s)}
              className={task.status === s ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm"}
              style={{ flex: 1 }}
            >
              {statusLabel[s]}
            </button>
          ))}
        </div>

        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: T.inkMuted, margin: "16px 0 6px" }}>Raise it with the team</div>
        <textarea
          className="textarea"
          rows={3}
          style={{ width: "100%", fontSize: 12.5 }}
          placeholder={`Ask a question or flag a blocker on “${task.title.slice(0, 40)}”…`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button
          type="button"
          className="btn btn-primary btn-sm"
          style={{ marginTop: 6, alignSelf: "flex-start" }}
          disabled={!note.trim()}
          onClick={() => {
            onPost(`**Re: ${task.title}** — ${note.trim()}`);
            setNote("");
            onClose();
            goTo("discussions");
          }}
        >
          Post to Discussions
        </button>
        <div style={{ fontSize: 10.5, color: T.inkMuted, marginTop: 8 }}>
          The note lands in this account's Discussions with the task quoted — everyone on the account sees it.
        </div>
      </div>
    </>
  );
}

/** The project conversation from Kantata — posts on the client's workspaces
 * and stories, read-only. The team's real back-and-forth, in one place. */
function KantataConversation({ posts }: { posts: AccountLiveContext["posts"] }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? posts : posts.slice(0, 6);
  return (
    <div style={card}>
      <SectionTitle right={<KantataChip />}>Project conversation · from Kantata</SectionTitle>
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
  onApplyTemplate,
  sandboxContent,
  sandboxCount = 0,
  people = [],
  onAddMember,
}: {
  account: ClientAccount;
  /** AGP roster to add to the account (plain data — guest-safe). */
  people?: { id: string; name: string; title: string }[];
  /** Add an AGP teammate to this account from anywhere in the workspace. */
  onAddMember?: (personId: string) => void;
  /** The shared plan: account tasks + client-visible tasks from linked builds. */
  sharedTasks: { task: Task; fromInternal: boolean }[];
  userName: string;
  onBack: () => void;
  /** New Kantata/HubSpot matches not yet in this workspace — user-gated. */
  importCandidates?: ImportCandidate[];
  /** Open Kantata tasks not yet in the plan — user-gated, like campaigns. */
  taskCandidates?: TaskCandidate[];
  onImportTasks?: (selected: TaskCandidate[]) => void;
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
  /** Apply a service-line template: dated task skeleton from a start date. */
  onApplyTemplate?: (templateKey: string, startDate: string) => void;
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
  onPost: (body: string) => void;
  onAddLink: (name: string, kind: "file" | "doc", url?: string) => void;
  onAddExternal: (name: string, org: string, role: ExternalMember["role"], access: ExternalMember["access"]) => void;
  onRemoveExternal: (externalId: string) => void;
  onOffboardEverywhere: (personName: string) => void;
}) {
  const [tab, setTab] = useState<ClientTab>("home");
  // Collaborate hub: add people / post an update from ANY tab (the navy band
  // is persistent, so this popover is always reachable).
  const [hubOpen, setHubOpen] = useState(false);
  // Click any task to see everything about it (detail drawer, additive overlay).
  const [openTask, setOpenTask] = useState<Task | null>(null);
  // A fresh workspace with matched work opens the review panel by itself —
  // the next action should be on screen, not hidden behind a corner button.
  const [reviewOpen, setReviewOpen] = useState(
    () =>
      (importCandidates.length > 0 && account.campaigns.length === 0) ||
      (taskCandidates.length > 0 && account.tasks.length === 0 && account.campaigns.length === 0),
  );
  const matchCount = importCandidates.length + taskCandidates.length;
  // Mirrored internal tasks get a display label so their origin is visible.
  const tasks: Task[] = sharedTasks.map(({ task, fromInternal }) =>
    fromInternal && !task.label ? { ...task, label: "shared from internal plan" } : task,
  );
  const owners = [...new Set(tasks.map((t) => t.ownerName).filter((o): o is string => !!o))];

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
            {TABS.filter((t) => t.key !== "sandbox" || sandboxContent).map((t) => {
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
              {account.members.slice(0, 3).map((m, i) => (
                <span key={m.personId} style={{ marginLeft: i === 0 ? 0 : -8, borderRadius: "50%", border: "2px solid #fff", display: "inline-flex" }}>
                  <Avatar name={m.name} size={28} />
                </span>
              ))}
              <span aria-hidden style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, marginLeft: 6, borderRadius: "50%", border: "1.5px dashed rgba(255,255,255,0.6)", color: "#fff", fontSize: 15, fontWeight: 700 }}>+</span>
            </button>
            {hubOpen && (
              <CollaborateHub
                account={account}
                people={people}
                {...(onAddMember ? { onAddMember } : {})}
                onAddExternal={onAddExternal}
                onPost={onPost}
                onOpenAccess={() => { setHubOpen(false); setTab("access"); }}
                onClose={() => setHubOpen(false)}
              />
            )}
          </div>
        </div>

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
          hasImportedWork={account.campaigns.length > 0}
          onRelink={onRelink}
          onLinkProjects={onLinkProjects}
        />
      )}

      {reviewOpen && onImportCampaigns && onRemoveCampaign && onClearCampaigns && (
        <ImportReview
          candidates={importCandidates}
          taskCandidates={taskCandidates}
          campaigns={account.campaigns}
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
              account={account}
              tasks={tasks}
              candidatesCount={importCandidates.length}
              taskCandidatesCount={taskCandidates.length}
              goTo={setTab}
              onOpenReview={() => setReviewOpen(true)}
            />
          )}
          <Home account={account} tasks={tasks} userName={userName} goTo={setTab} onOpenTask={setOpenTask} />
          {/* Below the wireframe: our additions side by side, not stacked. */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(440px, 1fr))", gap: 14, alignItems: "start" }}>
            {liveContext && <LiveSystemsCard context={liveContext} live={liveDataOn} clientName={account.clientName} />}
            <WhatsNew account={account} />
          </div>
        </div>
      )}
      {tab === "plan" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {onApplyTemplate && <TemplatePicker onApply={onApplyTemplate} />}
          <TasksCard tasks={tasks} owners={owners} onAdd={onAddTask} onStatus={onTaskStatus} onOpenTask={setOpenTask} />
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
      {tab === "dashboard" && <ClientDashboard account={account} tasks={tasks} {...(liveContext ? { liveContext } : {})} />}
      {tab === "files" && <FilesTab account={account} onAddLink={onAddLink} />}
      {tab === "discussions" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <DigestComposer account={account} tasks={tasks} onPost={onPost} />
          <Thread messages={account.thread} onPost={onPost} />
          {liveContext && liveContext.posts.length > 0 && <KantataConversation posts={liveContext.posts} />}
          <div style={{ fontSize: 11, color: T.inkMuted }}>
            Tip: “@FirstName” in a message notifies that person in Team Notifications on Home —
            works for the AGP team and external members alike.
          </div>
        </div>
      )}
      {tab === "sandbox" && sandboxContent}
      {tab === "access" && (
        <AccessTab account={account} onAdd={onAddExternal} onRemove={onRemoveExternal} onOffboardEverywhere={onOffboardEverywhere} />
      )}
      {openTask && (
        <TaskDetail
          task={openTask}
          onStatus={(id, s) => { onTaskStatus(id, s); setOpenTask((t) => (t && t.id === id ? { ...t, status: s } : t)); }}
          onPost={onPost}
          goTo={setTab}
          onClose={() => setOpenTask(null)}
        />
      )}
    </div>
  );
}
