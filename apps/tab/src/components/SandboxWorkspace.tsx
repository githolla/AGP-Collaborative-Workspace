import { useState } from "react";
import { rollup } from "@agp/roi";
import { card, T } from "../theme.js";
import { SectionTitle, TagChip } from "./bits.js";
import { ExecCard } from "./RoiPanel.js";
import { Thread } from "./Thread.js";
import { DraftReview } from "./DraftReview.js";
import { BriefCard, PhaseTimeline, TeamParts } from "./PlanCards.js";
import { Crumbs } from "./ui.js";
import { AGENTS } from "../workspace/agents.js";
import { fmtUsd } from "../workspace/format.js";
import { factorsFromBasis } from "../workspace/basis.js";
import { TYPE_LABEL, type InitiativeType, type SandboxIdea } from "../workspace/types.js";
import type { AgpPerson } from "../workspace/agpKnowledge.js";

/**
 * Chat-first idea workspace: the manager talks, the AGP Copilot drafts.
 * The right rail is the living draft — everything on it was proposed with a
 * "because" and can be removed with one tap (approval-by-exception). The only
 * raw inputs left are two numbers on the build guess.
 */

const removeButton: React.CSSProperties = {
  border: "none",
  background: "none",
  color: T.inkMuted,
  cursor: "pointer",
  fontSize: 13,
  padding: "0 4px",
  lineHeight: 1,
};

const numberInput: React.CSSProperties = {
  fontSize: 12,
  padding: "3px 6px",
  border: `1px solid ${T.grid}`,
  borderRadius: 6,
  width: 62,
  color: T.ink,
  background: "#fff",
};

export function SandboxWorkspace({
  idea,
  onBack,
  onDelete,
  onUpdate,
  onPost,
  onAskAnalyst,
  onPromote,
  onOpenInitiative,
  onInvite,
  onPartAdded,
  onInviteCopilot,
  onAddMember,
  onAcceptReview,
  people,
  flags,
}: {
  idea: SandboxIdea;
  onBack: () => void;
  /** Delete this sandbox project for good (confirmed in the UI). */
  onDelete?: () => void;
  onUpdate: (patch: Partial<Pick<SandboxIdea, "title" | "pitch" | "basis" | "team">>) => void;
  onPost: (body: string) => void;
  onAskAnalyst: () => void;
  onPromote: (type: InitiativeType) => void;
  onOpenInitiative: (id: string) => void;
  onInvite: (personId: string) => void;
  onPartAdded: (personId: string) => void;
  onInviteCopilot: () => void;
  onAddMember: (personId: string) => void;
  onAcceptReview: () => void;
  people: readonly AgpPerson[];
  flags: string[];
}) {
  const [promoteType, setPromoteType] = useState<InitiativeType>("new_build");
  const [pickPerson, setPickPerson] = useState("");
  const basis = idea.basis;
  const r = rollup(basis);
  const promoted = idea.status === "promoted";
  const cls = idea.classification;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <Crumbs trail={[{ label: "Sandbox", onClick: onBack }, { label: idea.title }]} />
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
          <input
            value={idea.title}
            onChange={(e) => onUpdate({ title: e.target.value })}
            aria-label="Idea title"
            style={{ fontSize: 18, fontWeight: 700, color: T.ink, border: "none", background: "transparent", flex: "1 1 300px", minWidth: 0, padding: 0 }}
          />
          <TagChip>Sandbox — not tied to any product</TagChip>
          {cls.serviceLine && <TagChip>{cls.serviceLine}</TagChip>}
          {cls.vertical && <TagChip>{cls.vertical}</TagChip>}
          {cls.clientNames.map((c) => (
            <TagChip key={c}>{c}</TagChip>
          ))}
          {promoted && <TagChip>Promoted ✓</TagChip>}
          {onDelete && (
            <button
              type="button"
              className="btn btn-danger btn-sm"
              style={{ marginLeft: "auto" }}
              title={promoted ? "Delete this sandbox idea — the promoted build it created is kept" : "Delete this sandbox project permanently"}
              onClick={() => {
                if (
                  window.confirm(
                    promoted
                      ? `Delete “${idea.title}” from the Sandbox? The promoted build it created stays.`
                      : `Delete “${idea.title}” permanently? Sandbox projects have no archive — this can't be undone.`,
                  )
                )
                  onDelete();
              }}
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {idea.aiMode === "observer" && !promoted && (
        <div style={{ ...card, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, background: "#f4fafd", borderColor: T.roi.cyan, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, color: T.ink }}>
            <strong>AGP Copilot is observing quietly.</strong> It's been following the conversation
            and already knows this project{flags.length > 0 ? ` — it has ${flags.length} flag${flags.length > 1 ? "s" : ""} and suggestions ready` : ""}.
            Nothing gets drafted until you ask.
          </span>
          <button
            type="button"
            onClick={onInviteCopilot}
            className="btn btn-ai"
          >
            Invite the Copilot in →
          </button>
        </div>
      )}

      {/* One explicit moment of human review over everything the machine built. */}
      {idea.aiMode === "copilot" && !idea.reviewed && !promoted && (
        <DraftReview idea={idea} onUpdate={onUpdate} onAccept={onAcceptReview} />
      )}

      {promoted && idea.promotedInitiativeId && (
        <div style={{ ...card, display: "flex", alignItems: "center", justifyContent: "space-between", background: "#f2faf6", borderColor: T.roi.confirmed }}>
          <span style={{ fontSize: 12.5, color: T.ink, fontWeight: 600 }}>✓ This idea graduated into a build.</span>
          <button
            type="button"
            onClick={() => onOpenInitiative(idea.promotedInitiativeId!)}
            className="btn btn-success"
          >
            Open the build →
          </button>
        </div>
      )}

      <div className="two-col">
        {/* The conversation IS the interface. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Thread messages={idea.thread} onPost={onPost} onAskAnalyst={onAskAnalyst} roster={AGENTS} />
          <div style={{ fontSize: 11, color: T.inkMuted, padding: "0 4px" }}>
            {idea.aiMode === "copilot"
              ? "Talk to the Copilot in plain words — “assume 300 build hours” · “this is mainly for food banks” · “drop the Loopio line” · “add someone from analytics”. It re-drafts and the rail on the right updates live."
              : "This thread is just your team — the Copilot reads along but never speaks unless invited."}
          </div>
        </div>

        {/* The living draft. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div data-tour="decision-view">
            <ExecCard factors={factorsFromBasis(basis)} />
          </div>

          {idea.aiMode === "copilot" && flags.length > 0 && !promoted && (
            <div style={{ ...card, borderColor: "#e7c66f" }}>
              <SectionTitle>Copilot flags</SectionTitle>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {flags.map((f) => (
                  <div key={f} style={{ fontSize: 12, color: T.inkSecondary, lineHeight: 1.45 }}>
                    <span style={{ color: "#8a6d1a", fontWeight: 700 }}>⚑</span> {f}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={card}>
            <SectionTitle>{idea.aiMode === "copilot" ? "What the Copilot drafted" : "Project numbers — add what you know"}</SectionTitle>

            {basis.comparables.length > 0 && (
              <>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.inkMuted, textTransform: "uppercase", letterSpacing: 0.5, margin: "4px 0" }}>
                  Replaces
                </div>
                {basis.comparables.map((c, i) => (
                  <div key={`${c.name}-${i}`} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, padding: "3px 0" }}>
                    <span style={{ flex: 1, color: T.ink }}>
                      {c.name} <span style={{ color: T.inkMuted }}>({c.basis})</span>
                    </span>
                    <span style={{ color: T.ink, fontVariantNumeric: "tabular-nums" }}>{fmtUsd(c.annual)}/yr</span>
                    {!promoted && (
                      <button type="button" title="Remove" style={removeButton} onClick={() => onUpdate({ basis: { ...basis, comparables: basis.comparables.filter((_, j) => j !== i) } })}>
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </>
            )}

            {basis.manual.length > 0 && (
              <>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.inkMuted, textTransform: "uppercase", letterSpacing: 0.5, margin: "10px 0 4px" }}>
                  Manual work it removes
                </div>
                {basis.manual.map((t, i) => (
                  <div key={`${t.task}-${i}`} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, padding: "3px 0" }}>
                    <span style={{ flex: 1, color: T.ink }}>
                      {t.task} <span style={{ color: T.inkMuted }}>({t.hoursPerWeek}h/wk × {t.people} × ${t.rate}/h)</span>
                    </span>
                    {!promoted && (
                      <button type="button" title="Remove" style={removeButton} onClick={() => onUpdate({ basis: { ...basis, manual: basis.manual.filter((_, j) => j !== i) } })}>
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </>
            )}

            <div style={{ fontSize: 11, fontWeight: 700, color: T.inkMuted, textTransform: "uppercase", letterSpacing: 0.5, margin: "10px 0 4px" }}>
              Build guess
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: T.inkSecondary }}>
              <input type="number" value={basis.buildHours || ""} placeholder="0" onChange={(e) => onUpdate({ basis: { ...basis, buildHours: Number(e.target.value) || 0 } })} style={numberInput} disabled={promoted} />
              <span>hours × $</span>
              <input type="number" value={basis.buildRate || ""} placeholder="100" onChange={(e) => onUpdate({ basis: { ...basis, buildRate: Number(e.target.value) || 0 } })} style={{ ...numberInput, width: 52 }} disabled={promoted} />
              <span>/h = {fmtUsd(r.buildCost)}</span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginTop: 10, paddingTop: 8, borderTop: `1px solid ${T.grid}` }}>
              <span style={{ color: T.inkSecondary }}>Human-in-the-loop residual (auto, 15%)</span>
              <span style={{ color: T.ink, fontVariantNumeric: "tabular-nums" }}>−{fmtUsd(r.humanInLoop)}/yr</span>
            </div>
            <div style={{ fontSize: 10.5, color: T.inkMuted, marginTop: 8 }}>
              Drafted from AGP patterns at confidence C. Remove what's wrong — or just tell the
              Copilot. Lines left empty stay honestly unknown.
            </div>
          </div>

          {idea.plan && idea.plan.packages.length > 0 && <PhaseTimeline plan={idea.plan} />}
          {idea.plan && idea.plan.packages.length > 0 && (
            <TeamParts
              plan={idea.plan}
              readOnly={promoted}
              onInvite={onInvite}
              onPartAdded={onPartAdded}
              onRemove={(personId) => onUpdate({ team: idea.team.filter((x) => x.personId !== personId) })}
            />
          )}

          {!promoted && (
            <div style={card}>
              <SectionTitle>Add a teammate</SectionTitle>
              <div style={{ display: "flex", gap: 8 }}>
                <select
                  value={pickPerson}
                  onChange={(e) => setPickPerson(e.target.value)}
                  style={{ flex: 1, fontSize: 12, padding: "7px 10px", border: `1px solid ${T.grid}`, borderRadius: 6, color: T.ink }}
                >
                  <option value="">Pick from the AGP org…</option>
                  {people
                    .filter((p) => !idea.team.some((m) => m.personId === p.id))
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} — {p.title} ({p.team})
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  disabled={!pickPerson}
                  onClick={() => {
                    onAddMember(pickPerson);
                    setPickPerson("");
                  }}
                  className="btn btn-primary"
                >
                  Add
                </button>
              </div>
              <div style={{ fontSize: 10.5, color: T.inkMuted, marginTop: 6 }}>
                Their part gets drafted automatically; dispatch-managed people route via their
                manager.
              </div>
            </div>
          )}

          {idea.plan && idea.plan.packages.length > 0 && <BriefCard brief={idea.plan.brief} />}

          {(idea.relatedProjects.length > 0 || idea.relatedCampaigns.length > 0) && (
            <div style={card}>
              <SectionTitle>Related AGP context</SectionTitle>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {idea.relatedProjects.map((p) => (
                  <div key={p.title} style={{ fontSize: 12 }}>
                    <span style={{ color: T.ink, fontWeight: 600 }}>Kantata · {p.title}</span>
                    <div style={{ color: T.inkSecondary, fontSize: 11 }}>{p.why}</div>
                  </div>
                ))}
                {idea.relatedCampaigns.map((c) => (
                  <div key={c.title} style={{ fontSize: 12 }}>
                    <span style={{ color: T.ink, fontWeight: 600 }}>HubSpot · {c.title}</span>
                    <div style={{ color: T.inkSecondary, fontSize: 11 }}>{c.why}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!promoted && (
            <div style={{ ...card, borderColor: T.roi.navy }}>
              <SectionTitle>Start the build</SectionTitle>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <select value={promoteType} onChange={(e) => setPromoteType(e.target.value as InitiativeType)} style={{ fontSize: 12.5, padding: "7px 10px", border: `1px solid ${T.grid}`, borderRadius: 6, color: T.ink }}>
                  <option value="new_build">{TYPE_LABEL.new_build}</option>
                  <option value="ai_iteration">{TYPE_LABEL.ai_iteration}</option>
                </select>
                <button
                  type="button"
                  onClick={() => onPromote(promoteType)}
                  className="btn btn-primary btn-lg"
                >
                  Promote to a build →
                </button>
                <div style={{ fontSize: 11, color: T.inkMuted }}>
                  The basis, cast, conversation, and gather list carry into a full initiative. The
                  sandbox copy stays for history.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
