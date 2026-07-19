import { useState } from "react";
import { computeProjectROI } from "@agp/roi";
import { card, T } from "../theme.js";
import { SectionTitle, TagChip } from "./bits.js";
import { fmtUsd, timeAgoLabel } from "../workspace/format.js";
import { factorsFromBasis } from "../workspace/basis.js";
import type { SandboxIdea } from "../workspace/types.js";

/**
 * The Sandbox: ideas not tied to any product. Any manager can drop an idea
 * here and start exploring a build from it — no product, no initiative, no
 * commitment. Promote when it earns a real number.
 */
export function Sandbox({
  ideas,
  onOpen,
  onCreate,
}: {
  ideas: SandboxIdea[];
  onOpen: (id: string) => void;
  onCreate: (title: string, pitch: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [pitch, setPitch] = useState("");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ ...card, borderStyle: "dashed", display: "flex", flexDirection: "column", gap: 8 }}>
        <SectionTitle>Start a build from an idea</SectionTitle>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Give the idea a name"
          style={{ fontSize: 13, padding: "8px 10px", border: `1px solid ${T.grid}`, borderRadius: 8, color: T.ink }}
        />
        <textarea
          value={pitch}
          onChange={(e) => setPitch(e.target.value)}
          placeholder="Describe the idea in your own words — the problem, who it's for, what it might replace. That's all it takes to start."
          rows={3}
          style={{ fontSize: 12.5, padding: "8px 10px", border: `1px solid ${T.grid}`, borderRadius: 8, resize: "vertical", fontFamily: "inherit", color: T.ink }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            type="button"
            disabled={!title.trim()}
            onClick={() => {
              onCreate(title.trim(), pitch.trim());
              setTitle("");
              setPitch("");
            }}
            style={{
              fontSize: 12.5,
              fontWeight: 700,
              padding: "9px 16px",
              borderRadius: 8,
              border: "none",
              cursor: title.trim() ? "pointer" : "default",
              background: title.trim() ? T.roi.navy : T.grid,
              color: "#fff",
            }}
          >
            Drop it in the sandbox
          </button>
          <span style={{ fontSize: 11, color: T.inkMuted }}>
            Not tied to any product. No numbers required — the ROI Analyst helps you rough them out.
          </span>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))", gap: 12 }}>
        {ideas.map((idea) => {
          const roi = computeProjectROI(factorsFromBasis(idea.basis));
          const hasBasis = idea.basis.comparables.length > 0 || idea.basis.manual.length > 0;
          return (
            <button
              key={idea.id}
              type="button"
              onClick={() => onOpen(idea.id)}
              style={{ ...card, textAlign: "left", cursor: "pointer", display: "flex", flexDirection: "column", gap: 8 }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: T.ink, lineHeight: 1.3 }}>{idea.title}</span>
                <TagChip>{idea.status === "promoted" ? "Promoted ✓" : "Exploring"}</TagChip>
              </div>
              <span style={{ fontSize: 12, color: T.inkSecondary, lineHeight: 1.45, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                {idea.pitch || "No description yet."}
              </span>
              <div style={{ fontSize: 12, fontWeight: 700, color: hasBasis ? T.ink : T.inkMuted }}>
                {hasBasis ? `${fmtUsd(roi.netRecurringAnnual)}/yr napkin` : "No numbers yet — honestly $0"}
              </div>
              <div style={{ fontSize: 11, color: T.inkMuted }}>
                {idea.thread.length} message{idea.thread.length === 1 ? "" : "s"} · started {timeAgoLabel(idea.createdAt)}
              </div>
            </button>
          );
        })}
        {ideas.length === 0 && (
          <div style={{ ...card, color: T.inkMuted, fontSize: 12.5 }}>No ideas yet — the sandbox is empty.</div>
        )}
      </div>
    </div>
  );
}
