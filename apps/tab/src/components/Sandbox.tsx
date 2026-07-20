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
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10, padding: "20px 22px" }}>
        <div>
          <div style={{ fontSize: 15.5, fontWeight: 800, color: T.roi.navy }}>Start a new project</div>
          <div style={{ fontSize: 12.5, color: T.inkSecondary, marginTop: 3 }}>
            Describe it in a sentence. The Copilot drafts the plan, the team, and the numbers for
            your review — or start without AI and invite it in later.
          </div>
        </div>
        <IntakePanel
          onCreate={onCreate}
          rows={3}
          placeholder="e.g. “Draft grant compliance reports automatically from campaign outcomes for our food-bank clients.”"
        />
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
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                borderTop: `3px solid ${idea.status === "promoted" ? T.roi.confirmed : T.roi.navy}`,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                <span style={{ fontSize: 14.5, fontWeight: 800, color: T.roi.navy, lineHeight: 1.3 }}>{idea.title}</span>
                <TagChip>{idea.status === "promoted" ? "Promoted ✓" : "In review"}</TagChip>
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
