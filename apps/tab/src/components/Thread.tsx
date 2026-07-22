import { useMemo, useState } from "react";
import { card, T } from "../theme.js";
import { SectionTitle } from "./bits.js";
import { timeAgoLabel } from "../workspace/format.js";
import type { ThreadMessage } from "../workspace/types.js";

export interface AgentRosterEntry {
  name: string;
  live: boolean;
  note: string;
}

const GENERAL = "General";

/**
 * The collaboration thread: people and AI agents working the initiative
 * together. ROI Analyst is live (engine-backed); LLM agents activate with the
 * server-side Anthropic key and are shown — honestly — as not yet active.
 *
 * Discussions are scoped by topic — a project, a task, or "General" — so a
 * client with many projects keeps conversation organized and searchable
 * (per the client call: scope by project, pilot at the task level). Topics
 * come from `topics` (the account's live projects) plus whatever already
 * appears in the thread (e.g. a task raised from its detail drawer).
 */
export function Thread({
  messages,
  onPost,
  onAskAnalyst,
  roster,
  topics = [],
}: {
  messages: ThreadMessage[];
  onPost: (body: string, topic?: string) => void;
  onAskAnalyst?: () => void;
  /**
   * The AI roster is injected by internal workspaces only. Client workspaces
   * pass nothing — keeping this component (and its import graph) free of
   * intelligence modules so the guest-surface allowlist test can verify it.
   */
  roster?: readonly AgentRosterEntry[];
  /** Project/topic options to scope a post to (client workspaces pass these). */
  topics?: readonly string[];
}) {
  const showAgents = !!roster && roster.length > 0;
  const [draft, setDraft] = useState("");
  const [postTopic, setPostTopic] = useState<string>("");
  const [filter, setFilter] = useState<string>("");

  // How many messages sit under each topic — drives the filter chips.
  const topicCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of messages) {
      const t = m.topic ?? GENERAL;
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return counts;
  }, [messages]);

  // Every topic that exists — the provided project list plus any already in
  // the thread — minus "General" (rendered separately, first).
  const allTopics = useMemo(() => {
    const set = new Set<string>([...topics]);
    for (const t of topicCounts.keys()) set.add(t);
    set.delete(GENERAL);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [topics, topicCounts]);

  const scoped = filter ? messages.filter((m) => (m.topic ?? GENERAL) === filter) : messages;
  const canScope = topics.length > 0 || allTopics.length > 0;

  const post = () => {
    const body = draft.trim();
    if (!body) return;
    onPost(body, postTopic || undefined);
    setDraft("");
  };

  const chip = (labelText: string, value: string, count?: number) => {
    const on = filter === value;
    return (
      <button
        key={value || "all"}
        type="button"
        onClick={() => { setFilter(value); setPostTopic(value); }}
        style={{
          fontSize: 10.5, fontWeight: 700, padding: "3px 10px", borderRadius: 999, cursor: "pointer",
          border: `1px solid ${on ? T.roi.navy : T.border}`,
          background: on ? T.roi.navy : "transparent",
          color: on ? "#fff" : T.inkSecondary, whiteSpace: "nowrap", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis",
        }}
      >
        {labelText}{count != null ? ` · ${count}` : ""}
      </button>
    );
  };

  return (
    <div style={card}>
      <SectionTitle right={canScope ? <span style={{ fontSize: 10.5, color: T.inkMuted }}>scoped by project · pilot at task level</span> : undefined}>
        Discussions
      </SectionTitle>

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

      {/* Topic filter — one thread per project keeps many projects legible. */}
      {canScope && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {chip("All", "", messages.length)}
          {topicCounts.has(GENERAL) && chip(GENERAL, GENERAL, topicCounts.get(GENERAL))}
          {allTopics.map((t) => chip(t, t, topicCounts.get(t)))}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 420, overflowY: "auto" }}>
        {scoped.map((m) => (
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
              <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: T.ink }}>
                  {m.author}
                  {m.kind === "agent" && (
                    <span style={{ fontSize: 9, fontWeight: 800, color: "#16708f", marginLeft: 5, border: `1px solid ${T.roi.cyan}`, borderRadius: 3, padding: "0 3px" }}>
                      AI
                    </span>
                  )}
                </span>
                {m.topic && (
                  <button
                    type="button"
                    onClick={() => { setFilter(m.topic ?? ""); setPostTopic(m.topic ?? ""); }}
                    title={`Show only “${m.topic}”`}
                    style={{ fontSize: 9, fontWeight: 800, color: T.roi.navy, background: "#eef2fb", border: "none", borderRadius: 4, padding: "1px 7px", cursor: "pointer", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {m.topic}
                  </button>
                )}
                <span style={{ fontSize: 10, color: T.inkMuted }}>{timeAgoLabel(m.at)}</span>
              </div>
              <div style={{ fontSize: 12, color: T.inkSecondary, marginTop: 3, whiteSpace: "pre-wrap", lineHeight: 1.45 }}>
                {m.body}
              </div>
            </div>
          </div>
        ))}
        {scoped.length === 0 && (
          <div style={{ fontSize: 12, color: T.inkMuted }}>
            {filter ? `No messages under “${filter}” yet.` : "No messages yet — start the conversation."}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "flex-start" }}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) post();
          }}
          placeholder={showAgents ? "Write to the team and agents… (Ctrl+Enter to post)" : "Write to the team… (Ctrl+Enter to post)"}
          rows={2}
          className="textarea"
          style={{ flex: 1 }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 140 }}>
          {canScope && (
            <select
              className="select"
              value={postTopic}
              onChange={(e) => setPostTopic(e.target.value)}
              title="File this message under a project (or a task / phase)"
              style={{ fontSize: 11.5, padding: "5px 8px" }}
            >
              <option value="">{GENERAL}</option>
              {allTopics.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
              {/* Keep a task/phase topic postable even if it's not in the
                  project list, so replies stay on that thread. */}
              {filter && filter !== GENERAL && !allTopics.includes(filter) && <option value={filter}>{filter}</option>}
            </select>
          )}
          <button type="button" className="btn btn-primary" onClick={post}>
            Post
          </button>
          {showAgents && onAskAnalyst && (
            <button
              type="button"
              className="btn btn-ai btn-sm"
              onClick={onAskAnalyst}
              title="Posts a computed assessment from the shared ROI engine"
            >
              Ask ROI Analyst
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
