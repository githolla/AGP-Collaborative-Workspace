import { useState } from "react";
import { T } from "../theme.js";
import { SectionTitle } from "./bits.js";
import { AS_OF_TODAY } from "../workspace/format.js";
import type { ClientAccount } from "../workspace/types.js";

/** One row of the sortable client directory — every client the app sees,
 * whether or not it has a workspace yet. Computed in App, passed as plain
 * data so this guest-visible file stays free of store/matcher imports. */
export interface DirectoryRow {
  name: string;
  vertical?: string;
  /** Live Kantata projects attributed to this client. */
  liveProjects: number;
  nextMilestone?: string;
  nextMilestoneDate?: string;
  /** Present when a workspace already exists for this client. */
  accountId?: string;
  /** The REAL Kantata delivery team on this client (participants), with role. */
  collaborators?: { name: string; role: string }[];
  /** Live campaigns in flight — what the team is collaborating on. */
  areas?: string[];
}

/** A CRM client that doesn't have a workspace yet — passed in as plain data. */
export interface ClientCandidate {
  name: string;
  vertical: string;
  /** HubSpot lifecycle stage; "customer" renders as a Client chip. */
  lifecycleStage?: string;
  /** How many campaigns a one-click create would import from Kantata/HubSpot. */
  workCount?: number;
  /** HubSpot BD-fit: target-account flag and ICP tier. */
  targetAccount?: boolean;
  icpTier?: string;
}

/** "health_services" / "RELIGIOUS INSTITUTIONS" → "Health services". */
const pretty = (v: string) => {
  const s = v.replace(/_/g, " ").toLowerCase().trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/**
 * Full-width, searchable picker over the live book of business. With 100
 * clients from HubSpot, truncated names in a narrow column are useless —
 * full names, a search box, and client-vs-prospect chips are the point.
 */
function BookOfBusiness({
  candidates,
  live,
  onCreate,
  onCreateBlank,
}: {
  candidates: ClientCandidate[];
  live: boolean;
  onCreate: (name: string) => void;
  /** Manual creation for a client with no Kantata work yet — folded into the footer. */
  onCreateBlank: (name: string) => void;
}) {
  const [q, setQ] = useState("");
  const [view, setView] = useState<"ready" | "clients">("ready");
  const [manualName, setManualName] = useState("");

  // Kantata decides who's ACTIVE (has live projects); the directory only
  // names them. Prospects never reach this list (ADR 0008 + server filter).
  const readyCount = candidates.filter((c) => (c.workCount ?? 0) > 0).length;
  const restCount = candidates.length - readyCount;
  const effectiveView = view === "ready" && readyCount === 0 ? "clients" : view;

  const needle = q.trim().toLowerCase();
  const filtered = candidates
    .filter((c) => (effectiveView === "ready" ? (c.workCount ?? 0) > 0 : (c.workCount ?? 0) === 0))
    .filter((c) => !needle || c.name.toLowerCase().includes(needle) || c.vertical.toLowerCase().includes(needle));
  const shown = filtered.slice(0, 18);

  const viewChip = (key: "ready" | "clients", label: string) => (
    <button
      type="button"
      className={`chip-pick${effectiveView === key ? " active" : ""}`}
      aria-pressed={effectiveView === key}
      onClick={() => setView(key)}
    >
      {label}
    </button>
  );

  return (
    <div className="card" data-tour="book" style={{ padding: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 14.5, fontWeight: 800, color: T.roi.navy }}>Add a client workspace</div>
          <div style={{ fontSize: 12, color: T.inkSecondary, marginTop: 2 }}>
            Active clients only — Kantata decides who's active (live projects); prospects never
            appear here. Set up the standard workspace, then choose what imports — nothing lands
            without your review.
          </div>
        </div>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: live ? "#116a43" : T.inkMuted,
            background: live ? "#e3f4ec" : "#f0efec",
            borderRadius: 999,
            padding: "3px 10px",
            whiteSpace: "nowrap",
          }}
        >
          {live ? "● live from Kantata" : "demo data"}
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
        {viewChip("ready", `Active in Kantata (${readyCount})`)}
        {viewChip("clients", `Clients without live work (${restCount})`)}
        <input
          className="input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name or vertical…"
          style={{ flex: 1, minWidth: 220, fontSize: 12.5, padding: "8px 12px" }}
        />
      </div>

      {/* Zero-match honesty: say WHY nothing is ready instead of a bare 0. */}
      {readyCount === 0 && candidates.length > 0 && (
        <div style={{ fontSize: 11.5, color: "#8a6d1a", background: "#faf3dc", border: "1px solid #e7c66f", borderRadius: 8, padding: "8px 12px", marginTop: 10, lineHeight: 1.5 }}>
          No client matched any Kantata project yet. Clients come from Kantata itself: workspace
          groups with <strong>company/contact info</strong>, title prefixes (“ARMS: …”), and
          full-name titles. Click the <strong>⟳ Live</strong> pill (top right) to re-pull fresh
          data first — if it stays zero, the tenant's groups/titles don't carry client names and
          we tune the derivation.
        </div>
      )}

      {shown.length === 0 ? (
        <div style={{ fontSize: 12.5, color: T.inkMuted, padding: "16px 4px" }}>
          {needle ? `No companies match “${q}”.` : "Nothing in this view yet."}
        </div>
      ) : (
        // Divided by vertical — sections instead of one bunched grid.
        (() => {
          const sections = new Map<string, ClientCandidate[]>();
          for (const c of shown) {
            const key = c.vertical ? pretty(c.vertical) : "Other";
            sections.set(key, [...(sections.get(key) ?? []), c]);
          }
          const ordered = [...sections.entries()].sort(
            (a, b) => (a[0] === "Other" ? 1 : b[0] === "Other" ? -1 : b[1].length - a[1].length || a[0].localeCompare(b[0])),
          );
          return ordered.map(([sectionName, rows]) => (
            <div key={sectionName} style={{ marginTop: 12 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: T.inkMuted, textTransform: "uppercase", letterSpacing: 0.6, paddingBottom: 4, borderBottom: `2px solid ${T.grid}` }}>
                {sectionName} ({rows.length})
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: "0 28px" }}>
                {rows.map((c) => {
                  const work = c.workCount ?? 0;
                  return (
                    <div
                      key={c.name}
                      className="table-row-hover"
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 6px", borderBottom: `1px solid ${T.grid}`, borderRadius: 6 }}
                    >
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: T.ink, lineHeight: 1.35 }}>
                          {c.name}
                        </span>
                        <span style={{ display: "flex", gap: 5, marginTop: 3, flexWrap: "wrap", alignItems: "center" }}>
                          {c.lifecycleStage === "customer" && (
                            <span style={{ fontSize: 10, fontWeight: 800, color: "#116a43", background: "#e3f4ec", borderRadius: 999, padding: "1.5px 8px", textTransform: "uppercase", letterSpacing: 0.4 }}>
                              Client
                            </span>
                          )}
                          {(c.targetAccount || /tier_?1/i.test(c.icpTier ?? "")) && c.lifecycleStage !== "customer" && (
                            <span
                              title={c.icpTier ? `HubSpot ICP: ${pretty(c.icpTier)}` : "HubSpot target account"}
                              style={{ fontSize: 10, fontWeight: 800, color: "#7c3a00", background: "#fdeede", borderRadius: 999, padding: "1.5px 8px", textTransform: "uppercase", letterSpacing: 0.4 }}
                            >
                              ★ Target
                            </span>
                          )}
                          {work > 0 ? (
                            <span style={{ fontSize: 10.5, color: T.inkSecondary }}>
                              {work} campaign{work === 1 ? "" : "s"} found — you choose what imports
                            </span>
                          ) : (
                            <span style={{ fontSize: 10.5, color: T.inkMuted }}>no matched work yet</span>
                          )}
                        </span>
                      </span>
                      <button type="button" className="btn btn-secondary btn-sm" style={{ flexShrink: 0 }} onClick={() => onCreate(c.name)}>
                        Set up workspace →
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ));
        })()
      )}

      {filtered.length > shown.length && (
        <div style={{ fontSize: 11, color: T.inkMuted, marginTop: 10 }}>
          Showing {shown.length} of {filtered.length} — keep typing to narrow it down.
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 14, paddingTop: 12, borderTop: `1px solid ${T.grid}`, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11.5, color: T.inkMuted }}>Someone not in Kantata yet?</span>
        <input
          className="input"
          value={manualName}
          onChange={(e) => setManualName(e.target.value)}
          placeholder="Client name…"
          style={{ flex: 1, minWidth: 180, fontSize: 12.5, padding: "7px 11px" }}
        />
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={!manualName.trim()}
          onClick={() => {
            onCreateBlank(manualName.trim());
            setManualName("");
          }}
        >
          Create from the standard template
        </button>
      </div>
    </div>
  );
}

/** Client-account list: one workspace per client, no cross-visibility. */
/** Live per-workspace pulse: matches waiting for review + the next date. */
export interface AccountPulse {
  waiting: number;
  nextMilestone?: string;
  nextMilestoneDate?: string;
}

export function ClientList({
  accounts,
  archivedAccounts = [],
  candidates = [],
  candidatesLive = false,
  directory = [],
  directoryStats,
  onOpen,
  onCreate,
  onCreateFromClient,
  onRestore,
  onClearAll,
}: {
  accounts: ClientAccount[];
  /** Archive every active workspace at once (start-clean). */
  onClearAll?: () => void;
  /** Every client the app sees (workspaces + derived), for the sortable list. */
  directory?: DirectoryRow[];
  /** Projects by title convention — shown so the client count self-explains. */
  directoryStats?: { colon: number; dash: number; verbatim: number };
  /** Archived workspaces — history retained, restorable. */
  archivedAccounts?: ClientAccount[];
  onRestore?: (id: string) => void;
  /** clientName → live Kantata pulse (waiting imports, next milestone). */
  pulse?: Record<string, AccountPulse>;
  /** Clients from the HubSpot/Kantata mirror without a workspace yet. */
  candidates?: ClientCandidate[];
  /** True when the candidate list comes from the live pull, not demo data. */
  candidatesLive?: boolean;
  /** Workspace names with NO matching company in the live book (demo leftovers). */
  onOpen: (id: string) => void;
  onCreate: (clientName: string) => void;
  onCreateFromClient?: (clientName: string) => void;
}) {
  const [name, setName] = useState("");
  const today = AS_OF_TODAY();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* One surface: the client directory, focused on how the team works
          together. Clear-all lives here (no Cards toggle any more). */}
      {onClearAll && accounts.length > 0 && (
        <div style={{ display: "flex", alignItems: "center" }}>
          <button
            type="button"
            className="btn-link"
            style={{ marginLeft: "auto", fontSize: 11.5, color: T.status.critical }}
            title="Archive every workspace to start clean — history is retained and each is restorable from Archived."
            onClick={() => {
              if (window.confirm(`Archive all ${accounts.length} workspace${accounts.length === 1 ? "" : "s"} to start clean? They move to Archived (restorable). This affects the shared team workspace.`)) {
                onClearAll();
              }
            }}
          >
            Clear all workspaces
          </button>
        </div>
      )}

      {directory.length > 0 ? (
        <ClientDirectory rows={directory} accounts={accounts} today={today} live={candidatesLive} {...(directoryStats ? { stats: directoryStats } : {})} onOpen={onOpen} onCreate={onCreateFromClient ?? onCreate} />
      ) : (
        // No directory yet (offline/empty) — a minimal manual create so the
        // page is never a dead end.
        <div className="card card-dashed" style={{ display: "flex", flexDirection: "column", gap: 8, justifyContent: "center", maxWidth: 460 }}>
          <SectionTitle>New client workspace</SectionTitle>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Client name, e.g. “Riverside Food Bank”"
            className="input"
          />
          <button
            type="button"
            disabled={!name.trim()}
            onClick={() => {
              onCreate(name.trim());
              setName("");
            }}
            className="btn btn-primary"
          >
            Create from the standard template
          </button>
        </div>
      )}

      {/* Add a client workspace — the searchable book of business, kept below
          the directory (a list, not stat cards). */}
      {candidates.length > 0 && onCreateFromClient && (
        <BookOfBusiness candidates={candidates} live={candidatesLive} onCreate={onCreateFromClient} onCreateBlank={onCreate} />
      )}

      {archivedAccounts.length > 0 && (
        <ArchivedList accounts={archivedAccounts} onRestore={onRestore} />
      )}
    </div>
  );
}


type SortKey = "active" | "open" | "people" | "projects" | "name" | "vertical";

/** Collaboration stats for a client, derived from its workspace (if any). */
interface CollabStat {
  people: number;
  open: number;
  overdue: number;
  discussions: number;
  last: string;
  lead: string;
}

/** Short relative time — "3d", "2w", "—". Presentation only. */
function ago(iso: string, today: string): string {
  if (!iso) return "—";
  const then = Date.parse(iso.length <= 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(then)) return "—";
  const days = Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - then) / 86_400_000));
  if (days <= 0) return "today";
  if (days === 1) return "1d";
  if (days < 14) return `${days}d`;
  if (days < 60) return `${Math.round(days / 7)}w`;
  return `${Math.round(days / 30)}mo`;
}

/** Deterministic pastel for an initials chip — no data, just a stable hue. */
function hue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

/** Overlapping initials chips for the people on an account. */
function PeopleCluster({ names }: { names: string[] }) {
  if (names.length === 0) return <span style={{ fontSize: 11, color: T.inkMuted }}>—</span>;
  const shown = names.slice(0, 3);
  return (
    <span style={{ display: "inline-flex", alignItems: "center" }}>
      {shown.map((n, i) => {
        const initials = n.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
        return (
          <span
            key={n + i}
            title={n}
            style={{ width: 22, height: 22, marginLeft: i === 0 ? 0 : -7, borderRadius: "50%", border: "2px solid #fff", background: `hsl(${hue(n)} 42% 62%)`, color: "#fff", fontSize: 9, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
          >
            {initials}
          </span>
        );
      })}
      {names.length > 3 && <span style={{ marginLeft: 4, fontSize: 10.5, color: T.inkMuted, fontWeight: 700 }}>+{names.length - 3}</span>}
    </span>
  );
}

/**
 * Client directory, laid out like the Client-Health board but focused on
 * COLLABORATION: sort and filter by the signals that matter for working
 * together — activity, open tasks, people, projects — not budget or score.
 * Pure presentation: rows arrive as data, stats are read off each workspace.
 * No financials ever render here (guest-visible surface).
 */
function ClientDirectory({
  rows,
  accounts,
  today,
  live,
  stats,
  onOpen,
  onCreate,
}: {
  rows: DirectoryRow[];
  accounts: ClientAccount[];
  today: string;
  live: boolean;
  stats?: { colon: number; dash: number; verbatim: number };
  onOpen: (id: string) => void;
  onCreate: (name: string) => void;
}) {
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("active");
  const [verticalFilter, setVerticalFilter] = useState("");
  const [leadFilter, setLeadFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "workspace" | "setup">("");
  const [copied, setCopied] = useState(false);

  // Collaboration stats per client. Collaborators & areas are LIVE from
  // Kantata (row data — the delivery team on the client's projects). Open
  // tasks / discussions / last-update come from the workspace itself.
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const collabOf = (r: DirectoryRow) => r.collaborators ?? [];
  const areasOf = (r: DirectoryRow) => r.areas ?? [];
  const statOf = (r: DirectoryRow): CollabStat => {
    const collab = collabOf(r);
    const lead = collab[0]?.name ?? "";
    const a = r.accountId ? byId.get(r.accountId) : undefined;
    if (!a) return { people: collab.length, open: 0, overdue: 0, discussions: 0, last: "", lead };
    const open = a.tasks.filter((t) => t.status !== "done");
    const times = [...a.activity.map((e) => e.at), ...a.thread.map((m) => m.at)].filter(Boolean).sort();
    return {
      people: collab.length,
      open: open.length,
      overdue: open.filter((t) => t.due && t.due < today).length,
      discussions: a.thread.length,
      last: times[times.length - 1] ?? "",
      lead,
    };
  };
  const st = new Map(rows.map((r) => [r.name, statOf(r)]));
  const maxOpen = Math.max(1, ...rows.map((r) => st.get(r.name)!.open));

  // Distinct filter values (collaboration lenses).
  const verticals = [...new Set(rows.map((r) => (r.vertical ? pretty(r.vertical) : "")).filter(Boolean))].sort();
  const leads = [...new Set([...st.values()].map((s) => s.lead).filter(Boolean))].sort();

  const needle = q.trim().toLowerCase();
  const filtered = rows.filter((r) => {
    const s = st.get(r.name)!;
    if (needle && !r.name.toLowerCase().includes(needle) && !(r.vertical ?? "").toLowerCase().includes(needle)) return false;
    if (verticalFilter && (r.vertical ? pretty(r.vertical) : "") !== verticalFilter) return false;
    if (leadFilter && s.lead !== leadFilter) return false;
    if (statusFilter === "workspace" && !r.accountId) return false;
    if (statusFilter === "setup" && r.accountId) return false;
    return true;
  });
  const sorted = [...filtered].sort((a, b) => {
    const sa = st.get(a.name)!;
    const sb = st.get(b.name)!;
    let d = 0;
    switch (sortKey) {
      case "active": d = (sa.last || "").localeCompare(sb.last || ""); break; // most-recent first
      case "open": d = sa.open - sb.open; break;
      case "people": d = sa.people - sb.people; break;
      case "projects": d = a.liveProjects - b.liveProjects; break;
      case "name": return a.name.localeCompare(b.name);
      case "vertical": return (a.vertical ?? "").localeCompare(b.vertical ?? "") || a.name.localeCompare(b.name);
    }
    return -(d || a.name.localeCompare(b.name)); // high → low for the numeric/recency lenses
  });

  // The single most-collaborative client gets a "TOP" tag, like the board.
  const topName = [...rows].sort((a, b) => {
    const sa = st.get(a.name)!;
    const sb = st.get(b.name)!;
    return sb.people + sb.open + sb.discussions - (sa.people + sa.open + sa.discussions);
  })[0]?.name;

  const withWorkspace = rows.filter((r) => r.accountId).length;

  const SORTS: { key: SortKey; label: string }[] = [
    { key: "active", label: "Active" },
    { key: "open", label: "Open tasks" },
    { key: "people", label: "People" },
    { key: "projects", label: "Projects" },
    { key: "name", label: "Name" },
    { key: "vertical", label: "Vertical" },
  ];
  const sortTab = (key: SortKey, label: string) => (
    <button
      key={key}
      type="button"
      onClick={() => setSortKey(key)}
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 0.4,
        textTransform: "uppercase",
        padding: "5px 12px",
        borderRadius: 7,
        border: "none",
        cursor: "pointer",
        whiteSpace: "nowrap",
        background: sortKey === key ? T.roi.navy : "transparent",
        color: sortKey === key ? "#fff" : T.inkMuted,
      }}
    >
      {label}
    </button>
  );

  const filterBox = (label: string, value: string, set: (v: string) => void, options: { v: string; label: string }[]) => (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 7, border: `1px solid ${T.border}`, borderRadius: 8, padding: "5px 10px", background: T.surface }}>
      <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: T.inkMuted }}>{label}</span>
      <select value={value} onChange={(e) => set(e.target.value)} style={{ border: "none", background: "none", fontSize: 12, fontWeight: 600, color: T.ink, cursor: "pointer", outline: "none" }}>
        {options.map((o) => (
          <option key={o.v} value={o.v}>{o.label}</option>
        ))}
      </select>
    </label>
  );

  const th = (label: string, align: "left" | "right" | "center" = "left") => (
    <th style={{ textAlign: align, padding: "8px 12px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: T.inkMuted, whiteSpace: "nowrap", position: "sticky", top: 0, background: T.surface, borderBottom: `1px solid ${T.grid}` }}>
      {label}
    </th>
  );

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      {/* Title + provenance + copy/search */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap", padding: "14px 16px 10px" }}>
        <div>
          <div style={{ fontSize: 14.5, fontWeight: 800, color: T.roi.navy }}>
            Client directory — {rows.length} {rows.length === 1 ? "client" : "clients"}
          </div>
          <div style={{ fontSize: 12, color: T.inkSecondary, marginTop: 2 }}>
            {withWorkspace} with a workspace · {rows.length - withWorkspace} not set up yet.
            {live ? " Live from Kantata." : " Demo data."} Sort & filter by how the team collaborates.
          </div>
          {stats && (
            <div style={{ fontSize: 11, color: T.inkMuted, marginTop: 3 }}>
              From project titles: {stats.colon} “Client:” prefix · {stats.dash} name-dash
              {stats.verbatim > 0 ? ` · ${stats.verbatim} with no prefix (not counted as clients)` : ""}
            </div>
          )}
        </div>
        <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            title="Copy the full client list (name · projects · workspace) — paste it to tune the matching"
            onClick={() => {
              const text = [
                `Client directory — ${rows.length} clients${stats ? ` (${stats.colon} colon · ${stats.dash} dash · ${stats.verbatim} no-prefix uncounted)` : ""}`,
                ...[...rows]
                  .sort((a, b) => b.liveProjects - a.liveProjects || a.name.localeCompare(b.name))
                  .map((r) => `${r.liveProjects}\t${r.name}${r.accountId ? "\t(workspace)" : ""}`),
              ].join("\n");
              void navigator.clipboard?.writeText(text).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2500);
              });
            }}
          >
            {copied ? "✓ Copied" : "⧉ Copy list"}
          </button>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by name or vertical…"
            className="input"
            style={{ maxWidth: 220 }}
          />
        </span>
      </div>

      {/* Sort tab strip + collaboration filter dropdowns — the Client-Health control bar. */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "0 16px 12px", borderBottom: `1px solid ${T.grid}` }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: T.inkMuted }}>Sort</span>
        <span style={{ display: "inline-flex", gap: 2, background: T.grid, borderRadius: 9, padding: 3 }}>
          {SORTS.map((s) => sortTab(s.key, s.label))}
        </span>
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
          {filterBox("Vertical", verticalFilter, setVerticalFilter, [{ v: "", label: "All" }, ...verticals.map((v) => ({ v, label: v }))])}
          {leads.length > 0 && filterBox("Lead", leadFilter, setLeadFilter, [{ v: "", label: "All" }, ...leads.map((l) => ({ v: l, label: l }))])}
          {filterBox("Status", statusFilter, (v) => setStatusFilter(v as "" | "workspace" | "setup"), [
            { v: "", label: "All" },
            { v: "workspace", label: "Has workspace" },
            { v: "setup", label: "Not set up" },
          ])}
        </span>
      </div>

      <div style={{ overflowX: "auto", maxHeight: 620, overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr>
              {th("Client")}
              {th("Open", "center")}
              {th("Who's collaborating")}
              {th("Working on")}
              {th("Activity")}
              {th("Last update", "right")}
              {th("Proj", "right")}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const s = st.get(r.name)!;
              const a = r.accountId ? byId.get(r.accountId) : undefined;
              const go = () => (r.accountId ? onOpen(r.accountId) : onCreate(r.name));
              const openColor = s.overdue > 0 ? T.status.critical : s.open > 0 ? "#8a6d1a" : T.inkMuted;
              const openBg = s.overdue > 0 ? "#fbe4e4" : s.open > 0 ? "#faf3dc" : "#f0efec";
              return (
                <tr
                  key={r.name}
                  className="table-row-hover"
                  onClick={go}
                  style={{ borderTop: `1px solid ${T.grid}`, cursor: "pointer" }}
                >
                  {/* Client — colored activity rail + name + TOP tag + vertical */}
                  <td style={{ padding: "9px 12px 9px 14px", position: "relative" }}>
                    <span aria-hidden style={{ position: "absolute", left: 0, top: 6, bottom: 6, width: 3, borderRadius: 2, background: r.accountId ? (s.last && ago(s.last, today).endsWith("d") ? "#3aa66f" : T.roi.navy) : T.grid }} />
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontWeight: 800, color: T.roi.navy }}>{r.name}</span>
                      {r.name === topName && (
                        <span style={{ fontSize: 9, fontWeight: 800, color: "#116a43", background: "#e3f4ec", borderRadius: 4, padding: "1px 6px", letterSpacing: 0.4 }}>TOP</span>
                      )}
                    </span>
                    <span style={{ display: "block", fontSize: 10.5, color: T.inkMuted, marginTop: 1 }}>{r.vertical ? pretty(r.vertical) : (r.accountId ? "Client workspace" : "Not set up")}</span>
                  </td>
                  {/* Open tasks — the numeric chip */}
                  <td style={{ padding: "9px 12px", textAlign: "center" }}>
                    <span style={{ display: "inline-block", minWidth: 30, fontSize: 12, fontWeight: 800, color: openColor, background: openBg, borderRadius: 7, padding: "3px 8px", fontVariantNumeric: "tabular-nums" }}>
                      {r.accountId ? s.open : "—"}
                    </span>
                  </td>
                  {/* Who's collaborating — the LIVE Kantata delivery team */}
                  <td style={{ padding: "9px 12px", minWidth: 190 }}>
                    {collabOf(r).length > 0 ? (
                      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <PeopleCluster names={collabOf(r).map((c) => c.name)} />
                        <span style={{ fontSize: 11, color: T.inkSecondary, lineHeight: 1.3, minWidth: 0 }}>
                          {collabOf(r).slice(0, 2).map((c) => c.name).join(", ")}
                          {collabOf(r).length > 2 ? ` +${collabOf(r).length - 2}` : ""}
                          {(() => {
                            const roles = [...new Set(collabOf(r).map((c) => c.role).filter(Boolean))].slice(0, 3).join(" · ");
                            return roles ? (
                              <span style={{ display: "block", fontSize: 10, color: T.inkMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 150 }}>{roles}</span>
                            ) : null;
                          })()}
                        </span>
                      </span>
                    ) : (
                      <span style={{ fontSize: 11, color: T.inkMuted }}>—</span>
                    )}
                  </td>
                  {/* Working on — the live Kantata campaigns in flight */}
                  <td style={{ padding: "9px 12px", minWidth: 170, maxWidth: 260 }}>
                    {areasOf(r).length > 0 ? (
                      <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {areasOf(r).slice(0, 2).map((name, i) => (
                          <span key={i} style={{ fontSize: 10.5, fontWeight: 600, color: T.roi.navy, background: "#eef2fb", borderRadius: 5, padding: "2px 7px", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {name}
                          </span>
                        ))}
                        {areasOf(r).length > 2 && <span style={{ fontSize: 10.5, color: T.inkMuted, alignSelf: "center" }}>+{areasOf(r).length - 2}</span>}
                      </span>
                    ) : (
                      <span style={{ fontSize: 11, color: T.inkMuted }}>—</span>
                    )}
                  </td>
                  {/* Activity bar — open tasks scaled to the busiest client */}
                  <td style={{ padding: "9px 12px", minWidth: 130 }}>
                    {r.accountId ? (
                      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ flex: 1, height: 6, background: T.grid, borderRadius: 999, overflow: "hidden", minWidth: 54 }}>
                          <span style={{ display: "block", height: "100%", width: `${Math.round((s.open / maxOpen) * 100)}%`, background: s.overdue > 0 ? T.status.critical : T.roi.navy, borderRadius: 999 }} />
                        </span>
                        <span style={{ fontSize: 10.5, color: T.inkMuted, whiteSpace: "nowrap" }}>{s.discussions} msg</span>
                      </span>
                    ) : (
                      <span style={{ fontSize: 11, color: T.inkMuted }}>not set up</span>
                    )}
                  </td>
                  {/* Last update */}
                  <td style={{ padding: "9px 12px", textAlign: "right", color: s.last ? T.inkSecondary : T.inkMuted, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                    {r.accountId ? ago(s.last, today) : "—"}
                  </td>
                  {/* Projects */}
                  <td style={{ padding: "9px 14px 9px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: r.liveProjects > 0 ? T.ink : T.inkMuted, whiteSpace: "nowrap" }}>
                    {r.liveProjects}p
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: "18px 12px", color: T.inkMuted, textAlign: "center" }}>
                  No clients match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Archived workspaces — closed but never gone (Collab Hub "Archiving"). */
function ArchivedList({ accounts, onRestore }: { accounts: ClientAccount[]; onRestore?: ((id: string) => void) | undefined }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ fontSize: 12, color: T.inkMuted }}>
      <button type="button" className="btn-link" style={{ fontSize: 12 }} onClick={() => setOpen((o) => !o)}>
        {open ? "▾" : "▸"} Archived ({accounts.length}) — history retained
      </button>
      {open &&
        accounts.map((a) => (
          <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 4px", borderBottom: `1px solid ${T.grid}` }}>
            <span style={{ flex: 1, fontSize: 12.5, color: T.inkSecondary }}>{a.clientName}</span>
            <span style={{ fontSize: 11 }}>
              {a.campaigns.length} campaigns · {a.tasks.length} tasks · {a.thread.length} discussions
            </span>
            {onRestore && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => onRestore(a.id)}>
                Restore
              </button>
            )}
          </div>
        ))}
    </div>
  );
}
