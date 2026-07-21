import { useState } from "react";
import { card, T } from "../theme.js";
import { loadMirror } from "../workspace/agpKnowledge.js";

/**
 * Data Inspector — the tuning window into what Kantata actually sent.
 * When matching misses on a real tenant, guessing conventions is a losing
 * game; this panel shows the derived client directory, raw project titles,
 * and group names so one screenshot is enough to tune the derivation.
 * Internal-only surface: rendered by App (never reachable from the guest
 * component graph).
 */
export function DataInspector({ live, unlinkedCount = 0 }: { live: boolean; unlinkedCount?: number }) {
  // Live data + several unlinked workspaces = the exact moment this panel
  // matters. Open itself instead of hiding behind a link.
  const [open, setOpen] = useState(() => live && unlinkedCount >= 3);
  const [copied, setCopied] = useState(false);
  if (!open) {
    return (
      <button type="button" className="btn-link" style={{ fontSize: 11.5, alignSelf: "flex-start" }} onClick={() => setOpen(true)}>
        🔍 Inspect what Kantata sent (matching diagnostics)
      </button>
    );
  }

  const mirror = loadMirror();
  const groups = [...new Set(mirror.projects.map((p) => p.clientGroup).filter((g): g is string => !!g))];
  const mono: React.CSSProperties = { fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: 11, lineHeight: 1.6, color: T.inkSecondary, whiteSpace: "pre-wrap", wordBreak: "break-word" };

  const asText = [
    `=== derived clients (${mirror.clients.length}) ===`,
    ...mirror.clients.map((c) => `${c.name}${c.abbreviation && c.abbreviation !== c.name ? ` [${c.abbreviation}]` : ""}`),
    ``,
    `=== raw project titles (first 60 of ${mirror.projects.length}) ===`,
    ...mirror.projects.slice(0, 60).map((p) => p.title),
    ``,
    `=== group names on projects (${groups.length} distinct) ===`,
    ...groups.slice(0, 60),
  ].join("\n");

  return (
    <div style={{ ...card, borderColor: "#e7c66f" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: T.roi.navy }}>
          Matching diagnostics — what {live ? "the live pull" : "demo data"} contains
        </span>
        <span style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => {
              void navigator.clipboard?.writeText(asText).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2500);
              });
            }}
          >
            {copied ? "✓ Copied" : "Copy as text"}
          </button>
          <button type="button" className="btn-link" style={{ fontSize: 11.5 }} onClick={() => setOpen(false)}>
            Close
          </button>
        </span>
      </div>
      <div style={{ fontSize: 11.5, color: T.inkMuted, margin: "4px 0 10px" }}>
        {unlinkedCount >= 3 ? `${unlinkedCount} workspaces have no Kantata match — ` : ""}
        hit <strong>Copy as text</strong> (or screenshot this panel) and share it; it's exactly
        what's needed to tune client matching to the tenant's real naming conventions.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: T.inkMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
            Derived clients ({mirror.clients.length})
          </div>
          <div style={mono}>
            {mirror.clients.slice(0, 40).map((c) => `${c.name}${c.abbreviation && c.abbreviation !== c.name ? ` [${c.abbreviation}]` : ""}`).join("\n") || "— none —"}
            {mirror.clients.length > 40 ? `\n… +${mirror.clients.length - 40} more` : ""}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: T.inkMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
            Raw project titles (first 40 of {mirror.projects.length})
          </div>
          <div style={mono}>{mirror.projects.slice(0, 40).map((p) => p.title).join("\n") || "— none —"}</div>
        </div>
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: T.inkMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
            Group names on projects ({groups.length} distinct)
          </div>
          <div style={mono}>
            {groups.slice(0, 40).join("\n") || "— none —"}
            {groups.length > 40 ? `\n… +${groups.length - 40} more` : ""}
          </div>
        </div>
      </div>
    </div>
  );
}
