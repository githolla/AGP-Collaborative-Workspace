import { card, T } from "../theme.js";
import { SectionTitle } from "./bits.js";
import type { ActivityEvent, ThreadMessage } from "../workspace/types.js";

/**
 * "What's new" (Collab Hub Must): the 60-second landing view — one merged
 * feed of discussion, ROI changes, task and team events, newest first.
 */

const KIND_ICON: Record<ActivityEvent["kind"], string> = {
  task: "☑",
  roi: "Σ",
  team: "◎",
  workspace: "▣",
};

interface FeedItem {
  id: string;
  at: string;
  icon: string;
  text: string;
  muted?: boolean;
}

export function buildFeed(activity: ActivityEvent[], thread: ThreadMessage[], limit = 6): FeedItem[] {
  const items: FeedItem[] = [
    ...activity.map((a) => ({ id: a.id, at: a.at, icon: KIND_ICON[a.kind], text: a.text, muted: true })),
    ...thread.map((m) => ({
      id: m.id,
      at: m.at,
      icon: m.kind === "agent" ? "AI" : "💬",
      text: `${m.author}: ${m.body.length > 110 ? `${m.body.slice(0, 110)}…` : m.body}`,
    })),
  ];
  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

export function WhatsNew({ activity, thread }: { activity: ActivityEvent[]; thread: ThreadMessage[] }) {
  const items = buildFeed(activity, thread);
  return (
    <div style={card}>
      <SectionTitle>What's new</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {items.map((i) => (
          <div key={i.id} style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
            <span style={{ fontSize: 10, color: T.inkMuted, width: 18, textAlign: "center", flexShrink: 0 }}>{i.icon}</span>
            <span style={{ flex: 1, fontSize: 12, color: i.muted ? T.inkSecondary : T.ink, lineHeight: 1.45, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {i.text}
            </span>
            <span style={{ fontSize: 10, color: T.inkMuted, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{i.at.slice(5, 10)}</span>
          </div>
        ))}
        {items.length === 0 && <div style={{ fontSize: 12, color: T.inkMuted }}>Nothing yet.</div>}
      </div>
    </div>
  );
}
