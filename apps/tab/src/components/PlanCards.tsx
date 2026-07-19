import { useState } from "react";
import { card, T } from "../theme.js";
import { SectionTitle, TagChip } from "./bits.js";
import type { ProjectPlan, WorkPackage } from "../workspace/types.js";

/** Phase timeline: four dated bands with goals — recessive, glanceable. */
export function PhaseTimeline({ plan }: { plan: ProjectPlan }) {
  return (
    <div style={card}>
      <SectionTitle>Plan</SectionTitle>
      <div style={{ display: "flex", gap: 4 }}>
        {plan.phases.map((p, i) => (
          <div key={p.key} style={{ flex: i === 1 ? 2 : 1, minWidth: 0 }}>
            <div
              title={p.goal}
              style={{
                height: 8,
                borderRadius: 4,
                background: i === 1 ? T.series1 : T.seq[Math.min(2 + i * 2, 9)],
                marginBottom: 6,
              }}
            />
            <div style={{ fontSize: 11.5, fontWeight: 700, color: T.ink }}>{p.label}</div>
            <div style={{ fontSize: 10, color: T.inkMuted, fontVariantNumeric: "tabular-nums" }}>
              {p.start.slice(5)} → {p.end.slice(5)}
            </div>
            <div style={{ fontSize: 10.5, color: T.inkSecondary, marginTop: 2, lineHeight: 1.35 }}>{p.goal}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

const STATUS_META: Record<WorkPackage["status"], { label: string; color: string; bg: string }> = {
  proposed: { label: "Proposed", color: "#8a6d1a", bg: "#faf3dd" },
  invited: { label: "Invited", color: "#16708f", bg: "#e8f4fa" },
  part_added: { label: "Part added ✓", color: "#116a43", bg: "#e3f4ec" },
};

/**
 * Team & their parts: the copilot drafted who does what; people are invited
 * to add their part. Every part shows its hours, phase, the one input only
 * that person can bring, and the routing rule when dispatch-managed.
 */
export function TeamParts({
  plan,
  readOnly,
  onInvite,
  onPartAdded,
  onRemove,
}: {
  plan: ProjectPlan;
  readOnly?: boolean;
  onInvite?: (personId: string) => void;
  onPartAdded?: (personId: string) => void;
  onRemove?: (personId: string) => void;
}) {
  const added = plan.packages.filter((p) => p.status === "part_added").length;
  return (
    <div style={card}>
      <SectionTitle
        right={
          <span style={{ fontSize: 11, color: T.inkMuted }}>
            {added}/{plan.packages.length} parts in
          </span>
        }
      >
        Team & their parts
      </SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {plan.packages.map((p) => {
          const meta = STATUS_META[p.status];
          return (
            <div key={p.personId} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span
                aria-hidden
                style={{ width: 28, height: 28, borderRadius: "50%", background: "#e6e4ee", color: T.roi.navy, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0, marginTop: 2 }}
              >
                {p.name.split(" ").map((w) => w[0]).join("")}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: T.ink }}>{p.name}</span>
                  <span style={{ fontSize: 11, color: T.inkMuted }}>{p.title}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: meta.color, background: meta.bg, borderRadius: 4, padding: "1px 7px" }}>
                    {meta.label}
                  </span>
                  {p.viaManager && <TagChip>via {p.viaManager}</TagChip>}
                </div>
                <div style={{ fontSize: 12, color: T.ink, marginTop: 3 }}>{p.part}</div>
                <div style={{ fontSize: 10.5, color: T.inkMuted, marginTop: 2 }}>
                  ~{p.hours}h · {p.phaseKey} phase · {p.why}
                </div>
                {p.bring && (
                  <div style={{ fontSize: 11, color: "#8a6d1a", marginTop: 3 }}>
                    ⤷ Brings: {p.bring}
                  </div>
                )}
                {!readOnly && (
                  <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                    {p.status === "proposed" && onInvite && (
                      <button
                        type="button"
                        onClick={() => onInvite(p.personId)}
                        style={{ fontSize: 11, fontWeight: 600, padding: "4px 12px", borderRadius: 6, border: "none", background: T.roi.navy, color: "#fff", cursor: "pointer" }}
                      >
                        Invite{p.viaManager ? ` via ${p.viaManager.split(" ")[0]}` : ""}
                      </button>
                    )}
                    {p.status === "invited" && onPartAdded && (
                      <button
                        type="button"
                        onClick={() => onPartAdded(p.personId)}
                        style={{ fontSize: 11, fontWeight: 600, padding: "4px 12px", borderRadius: 6, border: `1px solid ${T.roi.confirmed}`, background: "transparent", color: T.roi.confirmed, cursor: "pointer" }}
                      >
                        Mark part added
                      </button>
                    )}
                    {onRemove && p.status === "proposed" && (
                      <button
                        type="button"
                        onClick={() => onRemove(p.personId)}
                        style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, border: `1px solid ${T.grid}`, background: "transparent", color: T.inkMuted, cursor: "pointer" }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {plan.packages.length === 0 && (
          <div style={{ fontSize: 12, color: T.inkMuted }}>No parts yet — tell the Copilot what kind of work this is.</div>
        )}
      </div>
    </div>
  );
}

/** The auto-generated 60-second brief, collapsible. */
export function BriefCard({ brief }: { brief: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={card}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{ display: "flex", justifyContent: "space-between", width: "100%", background: "none", border: "none", cursor: "pointer", padding: 0 }}
      >
        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.3, color: T.ink, textTransform: "uppercase" }}>
          60-second brief
        </span>
        <span style={{ fontSize: 12, color: T.inkMuted }}>{open ? "▴ hide" : "▾ show"}</span>
      </button>
      {open && (
        <div style={{ marginTop: 10, fontSize: 12, color: T.inkSecondary, whiteSpace: "pre-wrap", lineHeight: 1.55 }}>
          {brief}
        </div>
      )}
      {!open && (
        <div style={{ marginTop: 6, fontSize: 11, color: T.inkMuted }}>
          Auto-generated for anyone joining — what it is, the numbers, who does what.
        </div>
      )}
    </div>
  );
}
