import { useMemo, useState, type CSSProperties } from "react";
import { card, T } from "../theme.js";
import { SectionTitle } from "./bits.js";
import { timeAgoLabel } from "../workspace/format.js";
import { MentionTextarea, type MentionPerson } from "./MentionTextarea.js";
import type { ThreadMessage } from "../workspace/types.js";

export interface AgentRosterEntry {
  name: string;
  live: boolean;
  note: string;
}

const GENERAL = "General";

type Kind = "project" | "task" | "file" | "general";
const KIND_META: Record<Kind, { icon: string; label: string }> = {
  project: { icon: "🗂", label: "Projects" },
  task: { icon: "✅", label: "Tasks" },
  file: { icon: "📄", label: "Files" },
  general: { icon: "💬", label: "General" },
};

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
  taskTitles = [],
  fileNames = [],
  projectOptions = [],
  projectOf,
  mentionRoster = [],
  onQuickAdd,
  onOpenTopic,
  userName,
  onEdit,
  onDelete,
}: {
  messages: ThreadMessage[];
  onPost: (body: string, topic?: string) => void;
  /** Who's reading — edit/delete appear only on your own posts. */
  userName?: string;
  onEdit?: (messageId: string, body: string) => void;
  onDelete?: (messageId: string) => void;
  onAskAnalyst?: () => void;
  /**
   * The AI roster is injected by internal workspaces only. Client workspaces
   * pass nothing — keeping this component (and its import graph) free of
   * intelligence modules so the guest-surface allowlist test can verify it.
   */
  roster?: readonly AgentRosterEntry[];
  /** Project/topic options to scope a post to (client workspaces pass these). */
  topics?: readonly string[];
  /** Task titles — so a discussion tied to a task is classified/filtered as one. */
  taskTitles?: readonly string[];
  /** File/doc names — so a discussion about a document is classified as a file. */
  fileNames?: readonly string[];
  /**
   * The real projects (Kantata milestones) for the primary "by project" filter.
   * Kellie's decision: organize discussions at the PROJECT level only — no
   * finer slicing — so this is the one dimension conversation is grouped by.
   */
  projectOptions?: readonly string[];
  /**
   * Roll a post's topic up to its project: a post already on a project returns
   * that project; a post on a task returns the task's project; anything else
   * returns undefined. This is what makes "show me the November CYE I Appeal"
   * gather task-level replies too, instead of only posts filed on the project.
   */
  projectOf?: (topic: string | undefined) => string | undefined;
  /** Full AGP roster for @mention autocomplete (on- and off-account). */
  mentionRoster?: readonly MentionPerson[];
  /** Quick-add an off-account person to the account when they're mentioned. */
  onQuickAdd?: (name: string) => void;
  /** Jump to the source a message is tied to (task / file / project). */
  onOpenTopic?: (topic: string, kind: "project" | "task" | "file" | "general") => void;
}) {
  const showAgents = !!roster && roster.length > 0;
  const [draft, setDraft] = useState("");
  const [postTopic, setPostTopic] = useState<string>("");
  const [filter, setFilter] = useState<string>("");
  const [projectFilter, setProjectFilter] = useState<string>("");
  const [kindFilter, setKindFilter] = useState<"" | Kind>("");
  const [authorFilter, setAuthorFilter] = useState<string>("");
  const [timeFilter, setTimeFilter] = useState<"" | "7" | "30" | "90">("");
  const [search, setSearch] = useState("");
  const [pendingAdd, setPendingAdd] = useState<string | null>(null);

  // Classify a topic into the kind of collaboration it is, so history can be
  // sliced by project / task / file / general (Kellie: "here's around task
  // conversations, here's around file conversations…"). Pure name-matching —
  // no data migration needed.
  const taskSet = useMemo(() => new Set(taskTitles.map((t) => t.toLowerCase())), [taskTitles]);
  const fileSet = useMemo(() => new Set(fileNames.map((f) => f.toLowerCase())), [fileNames]);
  const projSet = useMemo(() => new Set(topics.map((t) => t.toLowerCase())), [topics]);
  const kindOf = (topic: string | undefined): Kind => {
    if (!topic) return "general";
    const t = topic.toLowerCase();
    if (fileSet.has(t)) return "file";
    if (taskSet.has(t)) return "task";
    if (projSet.has(t)) return "project";
    return "general";
  };

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

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const authors = useMemo(() => [...new Set(messages.map((m) => m.author))].sort((a, b) => a.localeCompare(b)), [messages]);
  const cutoff = timeFilter ? Date.now() - Number(timeFilter) * 86_400_000 : 0;
  const needle = search.trim().toLowerCase();
  const scoped = messages.filter((m) => {
    // Project is the lead scope (Kellie): selecting one gathers everything that
    // rolls up to it — posts filed on the project AND replies on its tasks.
    if (projectFilter && (projectOf?.(m.topic) ?? "") !== projectFilter) return false;
    if (filter && (m.topic ?? GENERAL) !== filter) return false;
    if (kindFilter && kindOf(m.topic) !== kindFilter) return false;
    if (authorFilter && m.author !== authorFilter) return false;
    if (cutoff && Date.parse(m.at) < cutoff) return false;
    if (needle && !m.body.toLowerCase().includes(needle) && !(m.topic ?? "").toLowerCase().includes(needle) && !m.author.toLowerCase().includes(needle)) return false;
    return true;
  });
  const canScope = topics.length > 0 || allTopics.length > 0;
  const anyFilter = !!(filter || projectFilter || kindFilter || authorFilter || timeFilter || needle);
  const selStyle: CSSProperties = { fontSize: 11, padding: "4px 7px" };

  const post = () => {
    const body = draft.trim();
    if (!body) return;
    // Auto-tag by context: if you're viewing one project and haven't picked a
    // topic, the post files under that project — so correspondence lands in the
    // right place without anyone having to remember to set it.
    onPost(body, postTopic || projectFilter || undefined);
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

      {/* By project — the primary way to see one project's correspondence
          (Kellie). Selecting a project gathers its task replies too. */}
      {projectOptions.length > 0 && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: T.inkMuted }}>Project</span>
          <select
            value={projectFilter}
            onChange={(e) => { setProjectFilter(e.target.value); setPostTopic(e.target.value); }}
            className="select"
            style={{ ...selStyle, minWidth: 200 }}
            title="See all correspondence for one project"
          >
            <option value="">All projects</option>
            {[...projectOptions].sort((a, b) => a.localeCompare(b)).map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          {projectFilter && (
            <span style={{ fontSize: 10.5, color: T.inkMuted }}>New posts here file under “{projectFilter}”.</span>
          )}
        </div>
      )}

      {/* View past discussions — author, timeframe, and free-text search. */}
      {messages.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search discussions…"
            className="input"
            style={{ fontSize: 11.5, padding: "5px 9px", flex: 1, minWidth: 150 }}
          />
          <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as "" | Kind)} className="select" style={selStyle} title="Filter by kind of conversation">
            <option value="">All kinds</option>
            <option value="project">🗂 Projects</option>
            <option value="task">✅ Tasks</option>
            <option value="file">📄 Files</option>
            <option value="general">💬 General</option>
          </select>
          <select value={authorFilter} onChange={(e) => setAuthorFilter(e.target.value)} className="select" style={selStyle} title="Filter by who posted">
            <option value="">Anyone</option>
            {authors.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select value={timeFilter} onChange={(e) => setTimeFilter(e.target.value as "" | "7" | "30" | "90")} className="select" style={selStyle} title="Filter by recency">
            <option value="">Any time</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
          {anyFilter && (
            <button type="button" className="btn-link" style={{ fontSize: 11 }} onClick={() => { setFilter(""); setProjectFilter(""); setKindFilter(""); setAuthorFilter(""); setTimeFilter(""); setSearch(""); }}>
              Clear filters
            </button>
          )}
          <span style={{ fontSize: 10.5, color: T.inkMuted, marginLeft: "auto" }}>{scoped.length} of {messages.length}</span>
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
                {m.topic && (() => {
                  const k = kindOf(m.topic);
                  const canOpen = !!onOpenTopic && k !== "general";
                  return (
                    <button
                      type="button"
                      onClick={() => { if (canOpen) onOpenTopic!(m.topic!, k); else { setFilter(m.topic ?? ""); setPostTopic(m.topic ?? ""); } }}
                      title={canOpen ? `Open the ${KIND_META[k].label.replace(/s$/, "").toLowerCase()} this is about` : `Show only “${m.topic}”`}
                      style={{ fontSize: 9, fontWeight: 800, color: T.roi.navy, background: "#eef2fb", border: "none", borderRadius: 4, padding: "1px 7px", cursor: "pointer", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    >
                      <span aria-hidden style={{ marginRight: 3 }}>{KIND_META[k].icon}</span>{m.topic}{canOpen && <span aria-hidden style={{ marginLeft: 3, opacity: 0.7 }}>↗</span>}
                    </button>
                  );
                })()}
                <span style={{ fontSize: 10, color: T.inkMuted }}>{timeAgoLabel(m.at)}</span>
                {m.editedAt && <span style={{ fontSize: 10, color: T.inkMuted }}>· edited</span>}
                {/* Your own posts only. Someone mis-posting into a discussion
                    had no way back — Cara hit exactly that on the pilot. */}
                {userName && m.author === userName && m.kind !== "agent" && (onEdit || onDelete) && editingId !== m.id && (
                  <span style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
                    {onEdit && (
                      <button
                        type="button"
                        className="btn-link"
                        style={{ fontSize: 10.5 }}
                        onClick={() => { setEditingId(m.id); setEditDraft(m.body); }}
                      >
                        Edit
                      </button>
                    )}
                    {onDelete && (
                      <button
                        type="button"
                        className="btn-link"
                        style={{ fontSize: 10.5, color: T.status.critical }}
                        onClick={() => { if (window.confirm("Delete this post? It disappears for everyone.")) onDelete(m.id); }}
                      >
                        Delete
                      </button>
                    )}
                  </span>
                )}
              </div>
              {editingId === m.id ? (
                <div style={{ marginTop: 5 }}>
                  <textarea
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    rows={3}
                    style={{ width: "100%", border: `1px solid ${T.grid}`, borderRadius: 8, padding: "7px 9px", fontSize: 12, fontFamily: "inherit", boxSizing: "border-box", resize: "vertical" }}
                  />
                  <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={!editDraft.trim()}
                      onClick={() => { onEdit?.(m.id, editDraft); setEditingId(null); }}
                    >
                      Save
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingId(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: T.inkSecondary, marginTop: 3, whiteSpace: "pre-wrap", lineHeight: 1.45 }}>
                  {m.body}
                </div>
              )}
            </div>
          </div>
        ))}
        {scoped.length === 0 && (
          <div style={{ fontSize: 12, color: T.inkMuted }}>
            {messages.length === 0
              ? "No messages yet — start the conversation."
              : anyFilter
                ? "No messages match these filters."
                : `No messages under “${filter}” yet.`}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          <MentionTextarea
            value={draft}
            onChange={setDraft}
            roster={mentionRoster}
            onPick={(p) => { if (!p.onAccount && onQuickAdd) setPendingAdd(p.name); }}
            onSubmit={post}
            rows={2}
            placeholder={showAgents ? "Write to the team and agents… (@ to mention, Ctrl+Enter to post)" : "Write to the team… (@ to mention, Ctrl+Enter to post)"}
          />
          {pendingAdd && onQuickAdd && (
            <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: "#faf3dc", border: "1px solid #e7c66f", borderRadius: 8, padding: "8px 12px" }}>
              <span style={{ fontSize: 11.5, color: "#7a5c12", flex: 1, minWidth: 160 }}>
                <b>{pendingAdd}</b> isn't on this account yet — add them so they get notified and can take part?
              </span>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => { onQuickAdd(pendingAdd); setPendingAdd(null); }}>Add &amp; invite</button>
              <button type="button" className="btn-link" style={{ fontSize: 11 }} onClick={() => setPendingAdd(null)}>Not now</button>
            </div>
          )}
        </div>
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
