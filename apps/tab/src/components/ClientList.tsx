import { useState } from "react";
import { T } from "../theme.js";
import { SectionTitle, TagChip } from "./bits.js";
import { AS_OF_TODAY } from "../workspace/format.js";
import type { ClientAccount } from "../workspace/types.js";

/** A CRM client that doesn't have a workspace yet — passed in as plain data. */
export interface ClientCandidate {
  name: string;
  vertical: string;
  /** HubSpot lifecycle stage; "customer" renders as a Client chip. */
  lifecycleStage?: string;
  /** How many campaigns a one-click create would import from Kantata/HubSpot. */
  workCount?: number;
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
  /** Manual creation for a client not in the CRM — folded into the footer. */
  onCreateBlank: (name: string) => void;
}) {
  const [q, setQ] = useState("");
  const [view, setView] = useState<"ready" | "clients" | "all">("ready");
  const [manualName, setManualName] = useState("");

  const readyCount = candidates.filter((c) => (c.workCount ?? 0) > 0).length;
  const clientCount = candidates.filter((c) => c.lifecycleStage === "customer").length;
  // "Ready" is the useful default view — but only when something is ready.
  const effectiveView = view === "ready" && readyCount === 0 ? "all" : view;

  const needle = q.trim().toLowerCase();
  const filtered = candidates
    .filter((c) =>
      effectiveView === "ready" ? (c.workCount ?? 0) > 0 : effectiveView === "clients" ? c.lifecycleStage === "customer" : true,
    )
    .filter((c) => !needle || c.name.toLowerCase().includes(needle) || c.vertical.toLowerCase().includes(needle));
  const shown = filtered.slice(0, 18);

  const viewChip = (key: "ready" | "clients" | "all", label: string) => (
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
    <div className="card" style={{ padding: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 14.5, fontWeight: 800, color: T.roi.navy }}>Add clients from your book of business</div>
          <div style={{ fontSize: 12, color: T.inkSecondary, marginTop: 2 }}>
            Set up the standard workspace, then choose what to import from Kantata &amp; HubSpot —
            nothing lands without your review.
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
          {live ? "● live from HubSpot & Kantata" : "demo data"}
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
        {viewChip("ready", `With matched work (${readyCount})`)}
        {viewChip("clients", `Active clients (${clientCount})`)}
        {viewChip("all", `All (${candidates.length})`)}
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
          No client matched any Kantata project yet. Matching uses Kantata <strong>workspace
          groups</strong> (group name = client), the HubSpot <strong>client abbreviation</strong>,
          or the client's name in the project title. Click the <strong>⟳ Live</strong> pill (top
          right) to re-pull fresh data first — if it stays zero, Kantata's groups/titles don't
          carry client names, and the tenant grounding doc's join mapping is the fix.
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
        <span style={{ fontSize: 11.5, color: T.inkMuted }}>Someone not in the CRM?</span>
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
export function ClientList({
  accounts,
  candidates = [],
  candidatesLive = false,
  onOpen,
  onCreate,
  onCreateFromClient,
}: {
  accounts: ClientAccount[];
  /** Clients from the HubSpot/Kantata mirror without a workspace yet. */
  candidates?: ClientCandidate[];
  /** True when the candidate list comes from the live pull, not demo data. */
  candidatesLive?: boolean;
  onOpen: (id: string) => void;
  onCreate: (clientName: string) => void;
  onCreateFromClient?: (clientName: string) => void;
}) {
  const [name, setName] = useState("");
  const today = AS_OF_TODAY();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="cards-grid">
        {accounts.map((a) => {
          const open = a.tasks.filter((t) => t.status !== "done");
          const overdue = open.filter((t) => t.due && t.due < today).length;
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => onOpen(a.id)}
              className="card card-hover"
              style={{ display: "flex", flexDirection: "column", gap: 8 }}
            >
              <span style={{ fontSize: 14, fontWeight: 800, color: T.roi.navy, lineHeight: 1.3 }}>{a.clientName}</span>
              <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                <TagChip>{a.campaigns.filter((c) => c.status === "active").length} active campaigns</TagChip>
                <TagChip>{a.externals.length} external</TagChip>
              </span>
              <span style={{ fontSize: 12, color: T.inkSecondary }}>
                {open.length} open task{open.length === 1 ? "" : "s"}
                {overdue > 0 && <span style={{ color: T.status.critical, fontWeight: 700 }}> · {overdue} overdue</span>}
              </span>
              <span style={{ fontSize: 11, color: T.inkMuted }}>
                {a.thread.length} discussion{a.thread.length === 1 ? "" : "s"} · {a.files.length + a.docs.length} files & docs
              </span>
            </button>
          );
        })}

        {/* Manual creation lives in the book-of-business footer when the CRM
            list is present; this card is the fallback without one. */}
        {(candidates.length === 0 || !onCreateFromClient) && (
          <div className="card card-dashed" style={{ display: "flex", flexDirection: "column", gap: 8, justifyContent: "center" }}>
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
            <div style={{ fontSize: 10.5, color: T.inkMuted }}>
              Every client workspace starts identical: Home, plan & tasks, client dashboard, files with
              the four core documents, discussions, and access control. Consistency is the template.
            </div>
          </div>
        )}
      </div>

      {candidates.length > 0 && onCreateFromClient && (
        <BookOfBusiness candidates={candidates} live={candidatesLive} onCreate={onCreateFromClient} onCreateBlank={onCreate} />
      )}
    </div>
  );
}
