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
}

/** "health_services" → "health services" — raw select values, readable. */
const pretty = (v: string) => v.replace(/_/g, " ");

/**
 * Full-width, searchable picker over the live book of business. With 100
 * clients from HubSpot, truncated names in a narrow column are useless —
 * full names, a search box, and client-vs-prospect chips are the point.
 */
function BookOfBusiness({
  candidates,
  live,
  onCreate,
}: {
  candidates: ClientCandidate[];
  live: boolean;
  onCreate: (name: string) => void;
}) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? candidates.filter((c) => c.name.toLowerCase().includes(needle) || c.vertical.toLowerCase().includes(needle))
    : candidates;
  const shown = filtered.slice(0, 18);
  const clients = candidates.filter((c) => c.lifecycleStage === "customer").length;

  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 14.5, fontWeight: 800, color: T.roi.navy }}>Add clients from your book of business</div>
          <div style={{ fontSize: 12, color: T.inkSecondary, marginTop: 2 }}>
            One click builds the standard workspace and imports that client's campaigns from
            Kantata &amp; HubSpot — nothing retyped.
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
          {live ? "● live from HubSpot" : "demo data"} · {candidates.length} without a workspace
          {clients > 0 ? ` · ${clients} active clients` : ""}
        </span>
      </div>

      <input
        className="input"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`Search ${candidates.length} companies by name or vertical…`}
        style={{ width: "100%", marginTop: 12, fontSize: 13, padding: "10px 14px" }}
      />

      {shown.length === 0 ? (
        <div style={{ fontSize: 12.5, color: T.inkMuted, padding: "16px 4px" }}>
          No companies match “{q}”.
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
            gap: "0 24px",
            marginTop: 6,
          }}
        >
          {shown.map((c) => (
            <div
              key={c.name}
              className="table-row-hover"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "9px 6px",
                borderBottom: `1px solid ${T.grid}`,
                borderRadius: 6,
              }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: T.ink, lineHeight: 1.35 }}>
                  {c.name}
                </span>
                <span style={{ display: "flex", gap: 4, marginTop: 3, flexWrap: "wrap", alignItems: "center" }}>
                  {c.lifecycleStage === "customer" ? (
                    <span style={{ fontSize: 10, fontWeight: 800, color: "#116a43", background: "#e3f4ec", borderRadius: 999, padding: "1.5px 8px", textTransform: "uppercase", letterSpacing: 0.4 }}>
                      Client
                    </span>
                  ) : (
                    <span style={{ fontSize: 10, fontWeight: 700, color: T.inkMuted, background: "#f0efec", borderRadius: 999, padding: "1.5px 8px", textTransform: "uppercase", letterSpacing: 0.4 }}>
                      {c.lifecycleStage ? pretty(c.lifecycleStage) : "prospect"}
                    </span>
                  )}
                  {c.vertical && <TagChip>{pretty(c.vertical)}</TagChip>}
                </span>
              </span>
              <button type="button" className="btn btn-secondary btn-sm" style={{ flexShrink: 0 }} onClick={() => onCreate(c.name)}>
                Create →
              </button>
            </div>
          ))}
        </div>
      )}

      {filtered.length > shown.length && (
        <div style={{ fontSize: 11, color: T.inkMuted, marginTop: 10 }}>
          Showing {shown.length} of {filtered.length} — keep typing to narrow it down.
        </div>
      )}
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
      </div>

      {candidates.length > 0 && onCreateFromClient && (
        <BookOfBusiness candidates={candidates} live={candidatesLive} onCreate={onCreateFromClient} />
      )}
    </div>
  );
}
