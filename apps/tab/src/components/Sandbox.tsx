import { useState } from "react";
import { computeProjectROI } from "@agp/roi";
import { card, T } from "../theme.js";
import { TagChip } from "./bits.js";
import { fmtUsd, timeAgoLabel } from "../workspace/format.js";
import { factorsFromBasis } from "../workspace/basis.js";
import { extractTitle } from "../workspace/planner.js";
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
  onCreate: (title: string, pitch: string, aiMode: "copilot" | "observer") => void;
}) {
  const [text, setText] = useState("");
  const ready = text.trim().split(/\s+/).length >= 3;

  const start = (aiMode: "copilot" | "observer") => {
    if (!ready) return;
    onCreate(extractTitle(text.trim()), text.trim(), aiMode);
    setText("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ ...card, borderStyle: "dashed", display: "flex", flexDirection: "column", gap: 8, padding: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: T.ink }}>What should exist that doesn't?</div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) start("copilot");
          }}
          placeholder="One sentence is enough — “What if we drafted grant compliance reports automatically from campaign outcomes?”"
          rows={3}
          style={{ fontSize: 13.5, padding: "12px 14px", border: `1px solid ${T.grid}`, borderRadius: 10, resize: "vertical", fontFamily: "inherit", color: T.ink, lineHeight: 1.5 }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            disabled={!ready}
            onClick={() => start("copilot")}
            title="The Copilot names it, sizes it, plans it, and picks the team behind the scenes"
            style={{
              fontSize: 13,
              fontWeight: 700,
              padding: "10px 20px",
              borderRadius: 8,
              border: "none",
              cursor: ready ? "pointer" : "default",
              background: ready ? T.roi.navy : T.grid,
              color: "#fff",
            }}
          >
            Build it for me →
          </button>
          <button
            type="button"
            disabled={!ready}
            onClick={() => start("observer")}
            title="No drafting — you and your team shape it; the Copilot observes quietly and joins only when invited"
            style={{
              fontSize: 13,
              fontWeight: 600,
              padding: "10px 20px",
              borderRadius: 8,
              cursor: ready ? "pointer" : "default",
              border: `1px solid ${ready ? T.roi.navy : T.grid}`,
              background: "transparent",
              color: ready ? T.roi.navy : T.inkMuted,
            }}
          >
            Start blank — just us
          </button>
          <span style={{ fontSize: 11, color: T.inkMuted }}>
            Either way the Copilot pays attention — in blank mode it stays silent until you invite
            it in, and it arrives already knowing the project.
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
              <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {idea.aiMode === "observer" && <TagChip>Blank — Copilot observing</TagChip>}
                {idea.classification.serviceLine && <TagChip>{idea.classification.serviceLine}</TagChip>}
                {idea.classification.vertical && <TagChip>{idea.classification.vertical}</TagChip>}
                {idea.team.length > 0 && <TagChip>{idea.team.length} on the team</TagChip>}
              </span>
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
