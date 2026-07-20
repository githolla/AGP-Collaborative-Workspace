import { useState } from "react";
import { T } from "../theme.js";
import { SectionTitle, TagChip } from "./bits.js";
import { AS_OF_TODAY } from "../workspace/format.js";
import type { ClientAccount } from "../workspace/types.js";

/** Client-account list: one workspace per client, no cross-visibility. */
export function ClientList({
  accounts,
  onOpen,
  onCreate,
}: {
  accounts: ClientAccount[];
  onOpen: (id: string) => void;
  onCreate: (clientName: string) => void;
}) {
  const [name, setName] = useState("");
  const today = AS_OF_TODAY();

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
