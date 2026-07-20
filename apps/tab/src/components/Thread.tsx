import { useState } from "react";
import { card, T } from "../theme.js";
import { SectionTitle } from "./bits.js";
import { timeAgoLabel } from "../workspace/format.js";
import type { ThreadMessage } from "../workspace/types.js";

export interface AgentRosterEntry {
  name: string;
  live: boolean;
  note: string;
}

/**
 * The collaboration thread: people and AI agents working the initiative
 * together. ROI Analyst is live (engine-backed); LLM agents activate with the
 * server-side Anthropic key and are shown — honestly — as not yet active.
 */
export function Thread({
  messages,
  onPost,
  onAskAnalyst,
  roster,
}: {
  messages: ThreadMessage[];
  onPost: (body: string) => void;
  onAskAnalyst?: () => void;
  /**
   * The AI roster is injected by internal workspaces only. Client workspaces
   * pass nothing — keeping this component (and its import graph) free of
   * intelligence modules so the guest-surface allowlist test can verify it.
   */
  roster?: readonly AgentRosterEntry[];
}) {
  const showAgents = !!roster && roster.length > 0;
  const [draft, setDraft] = useState("");

  const post = () => {
    const body = draft.trim();
    if (!body) return;
    onPost(body);
    setDraft("");
  };

  return (
    <div style={card}>
      <SectionTitle>Collaboration</SectionTitle>

      {showAgents && (
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {(roster ?? []).map((a) => (
          <span
            key={a.name}
            title={a.note}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 10.5,
              padding: "3px 9px",
              borderRadius: 999,
              border: `1px solid ${a.live ? T.roi.cyan : T.grid}`,
              color: a.live ? "#16708f" : T.inkMuted,
              background: a.live ? "#eef8fc" : "transparent",
            }}
          >
            <span style={{ fontWeight: 800, fontSize: 9 }}>AI</span>
            {a.name}
            {a.live ? " · live" : " · needs API key"}
          </span>
        ))}
      </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 420, overflowY: "auto" }}>
        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              display: "flex",
              gap: 10,
              padding: "8px 10px",
              borderRadius: 8,
              background: m.kind === "agent" ? "#f4fafd" : "#f7f6f3",
              borderLeft: `3px solid ${m.kind === "agent" ? T.roi.cyan : T.grid}`,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: T.ink }}>
                  {m.author}
                  {m.kind === "agent" && (
                    <span style={{ fontSize: 9, fontWeight: 800, color: "#16708f", marginLeft: 5, border: `1px solid ${T.roi.cyan}`, borderRadius: 3, padding: "0 3px" }}>
                      AI
                    </span>
                  )}
                </span>
                <span style={{ fontSize: 10, color: T.inkMuted }}>{timeAgoLabel(m.at)}</span>
              </div>
              <div style={{ fontSize: 12, color: T.inkSecondary, marginTop: 3, whiteSpace: "pre-wrap", lineHeight: 1.45 }}>
                {m.body}
              </div>
            </div>
          </div>
        ))}
        {messages.length === 0 && (
          <div style={{ fontSize: 12, color: T.inkMuted }}>No messages yet — start the conversation.</div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) post();
          }}
          placeholder={showAgents ? "Write to the team and agents… (Ctrl+Enter to post)" : "Write to the team… (Ctrl+Enter to post)"}
          rows={2}
          style={{
            flex: 1,
            fontSize: 12.5,
            padding: "8px 10px",
            border: `1px solid ${T.grid}`,
            borderRadius: 8,
            resize: "vertical",
            fontFamily: "inherit",
            color: T.ink,
          }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <button
            type="button"
            onClick={post}
            style={{ fontSize: 12, fontWeight: 600, padding: "7px 14px", borderRadius: 8, border: "none", background: T.roi.navy, color: "#fff", cursor: "pointer" }}
          >
            Post
          </button>
          {showAgents && onAskAnalyst && (
            <button
              type="button"
              onClick={onAskAnalyst}
              title="Posts a computed assessment from the shared ROI engine"
              style={{ fontSize: 11, fontWeight: 600, padding: "6px 10px", borderRadius: 8, border: `1px solid ${T.roi.cyan}`, background: "#eef8fc", color: "#16708f", cursor: "pointer" }}
            >
              Ask ROI Analyst
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
