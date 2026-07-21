import { computeProjectROI } from "@agp/roi";
import { card, T } from "../theme.js";
import { TagChip } from "./bits.js";
import { IntakePanel } from "./IntakePanel.js";
import { fmtUsd, timeAgoLabel } from "../workspace/format.js";
import { factorsFromBasis } from "../workspace/basis.js";
import type { DraftOverrides } from "../workspace/copilot.js";
import type { SandboxIdea } from "../workspace/types.js";

/**
 * The Sandbox — INSIDE a client workspace: every idea is tied to the client
 * it's for, explored beside that client's live work. No separate surface.
 * Promote when it earns a real number. Internal-only: this component is
 * composed from App, never imported by the guest-visible workspace shell
 * (clientSafety.test.ts enforces the graph).
 */
export function Sandbox({
  ideas,
  clientName,
  unclaimed = [],
  onClaim,
  onOpen,
  onCreate,
}: {
  ideas: SandboxIdea[];
  /** The client this sandbox belongs to — copy speaks to them. */
  clientName?: string;
  /** Legacy ideas not yet tied to any client — claimable into this one. */
  unclaimed?: SandboxIdea[];
  onClaim?: (id: string) => void;
  onOpen: (id: string) => void;
  onCreate: (title: string, pitch: string, aiMode: "copilot" | "observer", overrides: DraftOverrides) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10, padding: "20px 22px" }}>
        <div>
          <div style={{ fontSize: 15.5, fontWeight: 800, color: T.roi.navy }}>
            {clientName ? `Start an idea for ${clientName}` : "Start a new project"}
          </div>
          <div style={{ fontSize: 12.5, color: T.inkSecondary, marginTop: 3 }}>
            Describe it in a sentence. The Copilot drafts the plan, the team, and the numbers for
            your review — or start without AI and invite it in later.
            {clientName ? " It stays tied to this client." : ""}
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
          <div style={{ ...card, color: T.inkMuted, fontSize: 12.5 }}>
            No ideas yet{clientName ? ` for ${clientName}` : ""} — the sandbox is empty.
          </div>
        )}
      </div>

      {unclaimed.length > 0 && onClaim && (
        <div className="card" style={{ padding: "14px 18px" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.ink, marginBottom: 6 }}>
            {unclaimed.length} idea{unclaimed.length === 1 ? "" : "s"} not yet tied to a client
          </div>
          {unclaimed.map((idea) => (
            <div key={idea.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderTop: `1px solid ${T.grid}` }}>
              <span style={{ fontSize: 12.5, color: T.inkSecondary, flex: 1 }}>{idea.title}</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => onClaim(idea.id)}>
                Bring into this workspace
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
