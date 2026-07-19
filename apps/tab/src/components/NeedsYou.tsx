import { useState } from "react";
import { card, severityMeta, T } from "../theme.js";
import { ProvenanceChip, SectionTitle } from "./bits.js";
import type { FeedItem } from "../data/feed.js";

/**
 * Needs-You feed (SPEC Layer 2b): max 5 items, ranked, one-tap actions, every
 * item states its "because". Empty feed is a success state. Dismissals feed
 * user_prefs_learned in M5; here they demonstrate the interaction.
 */
export function NeedsYou({ items, onOpenProject }: { items: FeedItem[]; onOpenProject: (id: string) => void }) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const visible = items.filter((i) => !dismissed.has(i.id));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {visible.length === 0 && (
        <div style={{ ...card, textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: T.ink }}>Nothing needs you.</div>
          <div style={{ fontSize: 12, color: T.inkMuted, marginTop: 6 }}>
            Everything below the line is being handled or held. That’s the goal.
          </div>
        </div>
      )}
      {visible.map((item) => {
        const meta = severityMeta[item.severity];
        return (
          <div key={item.id} style={{ ...card, display: "flex", gap: 12, alignItems: "flex-start" }}>
            <span aria-label={meta.label} title={meta.label} style={{ color: meta.color, fontSize: 13, marginTop: 2 }}>
              {meta.icon}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: T.ink, lineHeight: 1.35 }}>{item.title}</div>
              <div style={{ fontSize: 12, color: T.inkSecondary, marginTop: 3, lineHeight: 1.4 }}>{item.because}</div>
              <div style={{ marginTop: 7, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {item.actions.map((action) => {
                  const isDismiss = action === "Dismiss";
                  return (
                    <button
                      key={action}
                      type="button"
                      onClick={() => {
                        if (isDismiss) {
                          setDismissed(new Set([...dismissed, item.id]));
                        } else if (item.projectId) {
                          onOpenProject(item.projectId);
                        }
                      }}
                      style={{
                        fontSize: 11.5,
                        fontWeight: 600,
                        padding: "5px 12px",
                        borderRadius: 6,
                        cursor: "pointer",
                        border: `1px solid ${isDismiss ? T.grid : T.series1}`,
                        background: isDismiss ? "transparent" : T.series1,
                        color: isDismiss ? T.inkSecondary : "#fff",
                      }}
                    >
                      {action}
                    </button>
                  );
                })}
                <ProvenanceChip source={item.source} />
              </div>
            </div>
          </div>
        );
      })}
      {visible.length > 0 && (
        <div style={{ fontSize: 11, color: T.inkMuted, padding: "0 4px" }}>
          Max 5 items, ranked by impact × deadline. Dismissing a signal teaches the feed to
          deprioritize it for you — learned, never configured.
        </div>
      )}
    </div>
  );
}

export function FeedBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 17,
        height: 17,
        borderRadius: 999,
        background: T.status.serious,
        color: "#fff",
        fontSize: 10.5,
        fontWeight: 700,
        padding: "0 4px",
      }}
    >
      {count}
    </span>
  );
}

export function SectionHint() {
  return <SectionTitle>Needs you</SectionTitle>;
}
