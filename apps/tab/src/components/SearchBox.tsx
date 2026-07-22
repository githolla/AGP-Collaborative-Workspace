import { useMemo, useState } from "react";
import { T } from "../theme.js";
import type { ClientAccount, Initiative, SandboxIdea } from "../workspace/types.js";

/**
 * Search across the workspace (Collab Hub Must): client accounts, builds,
 * ideas — their discussions, tasks, files, and team parts. Jump straight to
 * the result. Client accounts are the primary surface, so they lead.
 */

type Target = { view: "initiative" | "idea" | "account"; id: string };

interface Hit {
  key: string;
  kind: "Client" | "Build" | "Idea" | "Message" | "Task" | "File";
  label: string;
  context: string;
  target: Target;
}

function collectHits(query: string, accounts: ClientAccount[], initiatives: Initiative[], ideas: SandboxIdea[]): Hit[] {
  const q = query.toLowerCase();
  const hits: Hit[] = [];
  const match = (s?: string | null) => !!s && s.toLowerCase().includes(q);

  // Client accounts first — the primary collaboration surface. Search the
  // account itself, its shared tasks, its discussion thread, and its files.
  for (const a of accounts) {
    if (a.archived) continue;
    const target = { view: "account" as const, id: a.id };
    if (match(a.clientName)) hits.push({ key: `a-${a.id}`, kind: "Client", label: a.clientName, context: `${a.campaigns.length} campaigns · ${a.tasks.length} tasks`, target });
    for (const t of a.tasks)
      if (match(t.title) || match(t.ownerName)) hits.push({ key: `at-${a.id}-${t.id}`, kind: "Task", label: t.title.slice(0, 60), context: `${a.clientName}${t.ownerName ? ` · ${t.ownerName}` : ""}`, target });
    for (const m of a.thread)
      if (match(m.body)) hits.push({ key: `am-${a.id}-${m.id}`, kind: "Message", label: `${m.author} in ${a.clientName}`, context: m.body.slice(0, 90), target });
    for (const f of [...a.files, ...a.docs])
      if (match(f.name)) hits.push({ key: `af-${a.id}-${f.id}`, kind: "File", label: f.name.slice(0, 60), context: a.clientName, target });
  }

  for (const i of initiatives) {
    const target = { view: "initiative" as const, id: i.id };
    if (match(i.name) || match(i.summary)) hits.push({ key: `i-${i.id}`, kind: "Build", label: i.name, context: i.summary.slice(0, 80), target });
    for (const m of i.thread)
      if (match(m.body)) hits.push({ key: `im-${i.id}-${m.id}`, kind: "Message", label: `${m.author} in ${i.name}`, context: m.body.slice(0, 90), target });
    for (const t of i.tasks)
      if (match(t.title) || match(t.ownerName)) hits.push({ key: `it-${t.id}`, kind: "Task", label: t.title.slice(0, 60), context: `${i.name}${t.ownerName ? ` · ${t.ownerName}` : ""}`, target });
  }
  for (const idea of ideas) {
    const target = { view: "idea" as const, id: idea.id };
    if (match(idea.title) || match(idea.pitch)) hits.push({ key: `s-${idea.id}`, kind: "Idea", label: idea.title, context: idea.pitch.slice(0, 80), target });
    for (const m of idea.thread)
      if (match(m.body)) hits.push({ key: `sm-${idea.id}-${m.id}`, kind: "Message", label: `${m.author} in ${idea.title}`, context: m.body.slice(0, 90), target });
  }
  return hits.slice(0, 10);
}

const KIND_COLOR: Record<Hit["kind"], string> = {
  Client: T.roi.navy,
  Build: "#3a4a86",
  Idea: "#8a6d1a",
  Message: "#16708f",
  Task: "#116a43",
  File: T.inkSecondary,
};

export function SearchBox({
  accounts,
  initiatives,
  ideas,
  onNavigate,
}: {
  accounts: ClientAccount[];
  initiatives: Initiative[];
  ideas: SandboxIdea[];
  onNavigate: (target: Target) => void;
}) {
  const [query, setQuery] = useState("");
  const hits = useMemo(
    () => (query.trim().length >= 2 ? collectHits(query.trim(), accounts, initiatives, ideas) : []),
    [query, accounts, initiatives, ideas],
  );

  return (
    <div style={{ position: "relative", marginLeft: "auto", width: 280 }}>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search workspaces, tasks, messages…"
        aria-label="Search across the workspace"
        className="input"
        style={{ width: "100%", fontSize: 12, padding: "7px 12px", borderRadius: 999 }}
      />
      {hits.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "110%",
            right: 0,
            width: 380,
            maxWidth: "80vw",
            background: T.surface,
            border: `1px solid ${T.border}`,
            borderRadius: 10,
            boxShadow: "0 8px 24px rgba(11,11,11,0.12)",
            zIndex: 40,
            overflow: "hidden",
          }}
        >
          {hits.map((h) => (
            <button
              key={h.key}
              type="button"
              onClick={() => {
                onNavigate(h.target);
                setQuery("");
              }}
              className="table-row-hover" style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 12px", background: "none", border: "none", borderBottom: `1px solid ${T.grid}`, cursor: "pointer" }}
            >
              <span style={{ fontSize: 9.5, fontWeight: 800, color: "#fff", background: KIND_COLOR[h.kind], borderRadius: 3, padding: "1px 5px", marginRight: 7, letterSpacing: 0.5 }}>
                {h.kind.toUpperCase()}
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, color: T.ink }}>{h.label}</span>
              <div style={{ fontSize: 11, color: T.inkSecondary, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.context}</div>
            </button>
          ))}
        </div>
      )}
      {query.trim().length >= 2 && hits.length === 0 && (
        <div style={{ position: "absolute", top: "110%", right: 0, width: 280, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: 12, fontSize: 12, color: T.inkMuted, zIndex: 40 }}>
          No matches.
        </div>
      )}
    </div>
  );
}
