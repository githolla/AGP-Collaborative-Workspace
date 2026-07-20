import { computeProjectROI } from "@agp/roi";
import { card, T } from "../theme.js";
import { TagChip } from "./bits.js";
import { IntakePanel } from "./IntakePanel.js";
import { fmtUsd, timeAgoLabel } from "../workspace/format.js";
import { factorsFromBasis } from "../workspace/basis.js";
import type { DraftOverrides } from "../workspace/copilot.js";
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
  onCreate: (title: string, pitch: string, aiMode: "copilot" | "observer", overrides: DraftOverrides) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="card card-dashed" style={{ display: "flex", flexDirection: "column", gap: 8, padding: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: T.ink }}>What should exist that doesn't?</div>
        <IntakePanel
          onCreate={onCreate}
          rows={3}
          placeholder="One sentence is enough — “What if we drafted grant compliance reports automatically from campaign outcomes?”"
        />
        <span style={{ fontSize: 11, color: T.inkMuted }}>
          Either way the Copilot pays attention — in blank mode it stays silent until you invite it
          in, and it arrives already knowing the project.
        </span>
      </div>

      <div className="cards-grid">
        {ideas.map((idea) => {
          const roi = computeProjectROI(factorsFromBasis(idea.basis));
          const hasBasis = idea.basis.comparables.length > 0 || idea.basis.manual.length > 0;
          return (
            <button
              key={idea.id}
              type="button"
              onClick={() => onOpen(idea.id)}
              className="card card-hover"
              style={{ display: "flex", flexDirection: "column", gap: 8 }}
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
