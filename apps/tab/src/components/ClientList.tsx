import { useState } from "react";
import { T } from "../theme.js";
import { SectionTitle, TagChip } from "./bits.js";
import { AS_OF_TODAY } from "../workspace/format.js";
import type { ClientAccount } from "../workspace/types.js";

/** A CRM client that doesn't have a workspace yet — passed in as plain data. */
export interface ClientCandidate {
  name: string;
  vertical: string;
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
  const shown = candidates.slice(0, 8);

  return (
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

      {shown.length > 0 && onCreateFromClient && (
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <SectionTitle
            right={
              <span style={{ fontSize: 10.5, color: candidatesLive ? "#116a43" : T.inkMuted, fontWeight: 700 }}>
                {candidatesLive ? "● live from HubSpot" : "demo data"}
              </span>
            }
          >
            From your book of business
          </SectionTitle>
          {shown.map((c) => (
            <div key={c.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: `1px solid ${T.grid}` }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {c.name}
                </span>
                {c.vertical && <TagChip>{c.vertical}</TagChip>}
              </span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => onCreateFromClient(c.name)}>
                Create workspace →
              </button>
            </div>
          ))}
          <div style={{ fontSize: 10.5, color: T.inkMuted, marginTop: 6 }}>
            One click builds the standard workspace with this client's campaigns imported from
            Kantata &amp; HubSpot.
            {candidates.length > shown.length && ` ${candidates.length - shown.length} more clients available — or type a name below.`}
          </div>
        </div>
      )}

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
  );
}
