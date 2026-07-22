import { useState } from "react";
import { computeProjectROI } from "@agp/roi";
import { card, T } from "../theme.js";
import { TagChip } from "./bits.js";
import { IntakePanel, type IntakeSeed } from "./IntakePanel.js";
import { fmtUsd, timeAgoLabel } from "../workspace/format.js";
import { factorsFromBasis } from "../workspace/basis.js";
import type { DraftOverrides } from "../workspace/copilot.js";
import type { SandboxIdea } from "../workspace/types.js";

/** A past project for this client — the seed for a "what if we did it again,
 * differently" scenario. Tied to the client's real history. */
export interface PastProject {
  title: string;
  serviceLine?: string;
  vertical?: string;
}

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
  pastProjects = [],
  roster = [],
  onClaim,
  onOpen,
  onCreate,
}: {
  ideas: SandboxIdea[];
  /** The client this sandbox belongs to — copy speaks to them. */
  clientName?: string;
  /** Legacy ideas not yet tied to any client — claimable into this one. */
  unclaimed?: SandboxIdea[];
  /** This client's real past projects — the seeds for adjustable scenarios. */
  pastProjects?: readonly PastProject[];
  /** AGP roster to hand-pick a starting team from. */
  roster?: readonly { id: string; name: string; title: string }[];
  onClaim?: (id: string) => void;
  onOpen: (id: string) => void;
  onCreate: (title: string, pitch: string, aiMode: "copilot" | "observer", overrides: DraftOverrides) => void;
}) {
  const [seed, setSeed] = useState<IntakeSeed | undefined>(undefined);
  const [nonce, setNonce] = useState(0);

  const applyScenario = (p: PastProject) => {
    const n = nonce + 1;
    setNonce(n);
    setSeed({
      nonce: n,
      text: `A new project for ${clientName ?? "this client"} modeled on their “${p.title}”${p.serviceLine ? ` (${p.serviceLine})` : ""}. Explore how it could be built differently — adjust the scope, team, and timeline below.`,
      ...(p.serviceLine ? { serviceLine: p.serviceLine } : {}),
      ...(p.vertical ? { vertical: p.vertical } : {}),
    });
    if (typeof document !== "undefined") document.querySelector('[data-tour="intake-box"]')?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Scenarios seeded from this client's real history — the "see how a
          project could be built differently, tied to their history" ask. */}
      {pastProjects.length > 0 && (
        <div className="card" style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: 13.5, fontWeight: 800, color: T.roi.navy }}>
            Explore a scenario from {clientName ?? "this client"}'s history
          </div>
          <div style={{ fontSize: 12, color: T.inkSecondary, marginTop: 3, marginBottom: 12 }}>
            Start from a real past project and adjust it — different scope, team, or timeline — to see how it could go. Everything stays tied to this client's history.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
            {pastProjects.slice(0, 6).map((p, i) => (
              <button
                key={`${p.title}-${i}`}
                type="button"
                onClick={() => applyScenario(p)}
                className="card card-hover"
                style={{ textAlign: "left", display: "flex", flexDirection: "column", gap: 6, borderTop: `3px solid ${T.roi.cyan}`, padding: "12px 14px" }}
              >
                <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: "#16708f" }}>Past project</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.roi.navy, lineHeight: 1.3 }}>{p.title}</span>
                <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {p.serviceLine && <TagChip>{p.serviceLine}</TagChip>}
                </span>
                <span style={{ fontSize: 11, fontWeight: 700, color: T.roi.navy, marginTop: 2 }}>Model a scenario →</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10, padding: "20px 22px" }}>
        <div>
          <div style={{ fontSize: 15.5, fontWeight: 800, color: T.roi.navy }}>
            {clientName ? `Start an idea for ${clientName}` : "Start a new project"}
          </div>
          <div style={{ fontSize: 12.5, color: T.inkSecondary, marginTop: 3 }}>
            Describe it in a sentence, hand-pick the team, and the Copilot drafts the plan and the
            numbers for your review — or start without AI and invite it in later.
            {clientName ? " It stays tied to this client's history." : ""}
          </div>
        </div>
        <IntakePanel
          onCreate={onCreate}
          rows={3}
          roster={roster}
          {...(clientName ? { defaultClientName: clientName } : {})}
          {...(seed ? { seed } : {})}
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
