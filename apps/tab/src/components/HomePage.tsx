import { useState } from "react";
import { T } from "../theme.js";
import { TagChip } from "./bits.js";
import { Card, EmptyState } from "./ui.js";
import { extractTitle } from "../workspace/planner.js";
import { buildNeedsYou, buildRecents, type NavTarget } from "../workspace/needsYou.js";
import type { ClientAccount, Initiative, SandboxIdea } from "../workspace/types.js";

/**
 * Home: the answer to "I just opened this — what do I do?"
 * One box to start something, the ranked Needs-You list (each item one tap
 * from its fix), and where you left off. Empty needs-you is a success state.
 */

const SEVERITY_COLOR = { critical: T.status.critical, warning: T.roi.amber, info: T.roi.navy } as const;

export function HomePage({
  userName,
  accounts,
  initiatives,
  ideas,
  onNavigate,
  onCreateIdea,
}: {
  userName: string;
  accounts: ClientAccount[];
  initiatives: Initiative[];
  ideas: SandboxIdea[];
  onNavigate: (target: NavTarget) => void;
  onCreateIdea: (title: string, pitch: string, aiMode: "copilot" | "observer") => void;
}) {
  const [text, setText] = useState("");
  const ready = text.trim().split(/\s+/).length >= 3;
  const needs = buildNeedsYou(accounts, initiatives, ideas);
  const recents = buildRecents(accounts, initiatives, ideas);

  const start = (aiMode: "copilot" | "observer") => {
    if (!ready) return;
    onCreateIdea(extractTitle(text.trim()), text.trim(), aiMode);
    setText("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Greeting + the one action that starts everything */}
      <div className="card" style={{ padding: "22px 24px" }}>
        <div style={{ fontSize: 21, fontWeight: 800, color: T.roi.navy }}>
          Hi {userName.split(" ")[0]} — what should exist that doesn't?
        </div>
        <div style={{ fontSize: 12.5, color: T.inkSecondary, marginTop: 4 }}>
          Describe it in a sentence. The Copilot names it, sizes it, plans it, and picks the team —
          or start blank with just your people.
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <input
            className="input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") start("copilot");
            }}
            placeholder="e.g. “What if we drafted grant compliance reports automatically?”"
            style={{ flex: 1, minWidth: 260, fontSize: 13.5, padding: "11px 14px" }}
          />
          <button type="button" className="btn btn-primary btn-lg" disabled={!ready} onClick={() => start("copilot")}>
            Build it for me →
          </button>
          <button type="button" className="btn btn-secondary btn-lg" disabled={!ready} onClick={() => start("observer")}>
            Start blank
          </button>
        </div>
      </div>

      <div className="two-col" style={{ gridTemplateColumns: "minmax(0, 3fr) minmax(0, 2fr)" }}>
        {/* Needs you */}
        <Card
          title="Needs you"
          right={<span style={{ fontSize: 11, color: T.inkMuted }}>ranked · max 5</span>}
        >
          {needs.length === 0 ? (
            <EmptyState
              icon="✓"
              title="Nothing needs you."
              hint="Every task is on time, every number has an owner, every invite is out. That's the goal — enjoy it."
            />
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {needs.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className="table-row-hover"
                  onClick={() => onNavigate(n.target)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    width: "100%",
                    textAlign: "left",
                    padding: "11px 8px",
                    background: "none",
                    border: "none",
                    borderBottom: `1px solid ${T.grid}`,
                    cursor: "pointer",
                  }}
                >
                  <span aria-hidden style={{ color: SEVERITY_COLOR[n.severity], fontSize: 14, width: 18, textAlign: "center", flexShrink: 0 }}>
                    {n.icon}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 12.5, color: T.ink, lineHeight: 1.4 }}>{n.text}</span>
                    <span style={{ fontSize: 11, color: T.inkMuted }}>{n.where}</span>
                  </span>
                  <span className="btn btn-ghost btn-sm" style={{ flexShrink: 0 }}>
                    {n.actionLabel} ›
                  </span>
                </button>
              ))}
            </div>
          )}
        </Card>

        {/* Jump back in */}
        <Card title="Jump back in">
          {recents.length === 0 ? (
            <EmptyState
              icon="✨"
              title="Nothing here yet"
              hint="Start something above, or create a client workspace from the Clients tab."
            />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {recents.map((r) => (
                <button
                  key={`${r.target.view}-${r.target.id}`}
                  type="button"
                  className="card card-hover"
                  onClick={() => onNavigate(r.target)}
                  style={{ display: "flex", flexDirection: "column", gap: 4, padding: "10px 12px" }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <TagChip>{r.kind}</TagChip>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.name}
                    </span>
                  </span>
                  <span style={{ fontSize: 11, color: T.inkSecondary }}>{r.line}</span>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
