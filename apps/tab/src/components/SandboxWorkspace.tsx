import { useState } from "react";
import { rollup } from "@agp/roi";
import { card, T } from "../theme.js";
import { SectionTitle, TagChip } from "./bits.js";
import { ExecCard } from "./RoiPanel.js";
import { Thread } from "./Thread.js";
import { fmtUsd } from "../workspace/format.js";
import { factorsFromBasis } from "../workspace/basis.js";
import { TYPE_LABEL, type InitiativeType, type SandboxIdea } from "../workspace/types.js";

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
  onUpdate,
  onPost,
  onAskAnalyst,
  onPromote,
  onOpenInitiative,
}: {
  idea: SandboxIdea;
  onBack: () => void;
  onUpdate: (patch: Partial<Pick<SandboxIdea, "title" | "pitch" | "basis" | "team">>) => void;
  onPost: (body: string) => void;
  onAskAnalyst: () => void;
  onPromote: (type: InitiativeType) => void;
  onOpenInitiative: (id: string) => void;
}) {
  const [promoteType, setPromoteType] = useState<InitiativeType>("new_build");
  const basis = idea.basis;
  const r = rollup(basis);
  const promoted = idea.status === "promoted";
  const cls = idea.classification;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <button type="button" onClick={onBack} style={{ fontSize: 12, color: T.inkSecondary, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
          ← Sandbox
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
          <input
            value={idea.title}
            onChange={(e) => onUpdate({ title: e.target.value })}
            style={{ fontSize: 18, fontWeight: 700, color: T.ink, border: "none", background: "transparent", minWidth: 300, padding: 0 }}
          />
          <TagChip>Sandbox — not tied to any product</TagChip>
          {cls.serviceLine && <TagChip>{cls.serviceLine}</TagChip>}
          {cls.vertical && <TagChip>{cls.vertical}</TagChip>}
          {cls.clientNames.map((c) => (
            <TagChip key={c}>{c}</TagChip>
          ))}
          {promoted && <TagChip>Promoted ✓</TagChip>}
        </div>
      </div>

      {promoted && idea.promotedInitiativeId && (
        <div style={{ ...card, display: "flex", alignItems: "center", justifyContent: "space-between", background: "#f2faf6", borderColor: T.roi.confirmed }}>
          <span style={{ fontSize: 12.5, color: T.ink, fontWeight: 600 }}>✓ This idea graduated into a build.</span>
          <button
            type="button"
            onClick={() => onOpenInitiative(idea.promotedInitiativeId!)}
            style={{ fontSize: 12, fontWeight: 700, padding: "7px 14px", borderRadius: 8, border: "none", background: T.roi.confirmed, color: "#fff", cursor: "pointer" }}
          >
            Open the build →
          </button>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 5fr) minmax(0, 4fr)", gap: 14, alignItems: "start" }}>
        {/* The conversation IS the interface. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Thread messages={idea.thread} onPost={onPost} onAskAnalyst={onAskAnalyst} />
          <div style={{ fontSize: 11, color: T.inkMuted, padding: "0 4px" }}>
            Talk to the Copilot in plain words — “assume 300 build hours” · “this is mainly for food
            banks” · “drop the Loopio line” · “add someone from analytics”. It re-drafts and the
            rail on the right updates live.
          </div>
        </div>

        {/* The living draft. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <ExecCard factors={factorsFromBasis(basis)} />

          <div style={card}>
            <SectionTitle>What the Copilot drafted</SectionTitle>

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

          <div style={card}>
            <SectionTitle>Suggested cast</SectionTitle>
            {idea.team.length === 0 && (
              <div style={{ fontSize: 12, color: T.inkMuted }}>
                No cast yet — tell the Copilot what kind of work this is and it will pull the right
                people from the org.
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {idea.team.map((m) => (
                <div key={m.personId} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <span
                    aria-hidden
                    style={{ width: 26, height: 26, borderRadius: "50%", background: "#e6e4ee", color: T.roi.navy, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10.5, fontWeight: 700, flexShrink: 0 }}
                  >
                    {m.name.split(" ").map((w) => w[0]).join("")}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, color: T.ink, fontWeight: 600 }}>
                      {m.name} <span style={{ color: T.inkMuted, fontWeight: 400 }}>· {m.title}</span>
                      {m.viaManager && <TagChip>via {m.viaManager}</TagChip>}
                    </div>
                    <div style={{ fontSize: 11, color: T.inkSecondary }}>{m.why}</div>
                  </div>
                  {!promoted && (
                    <button type="button" title="Remove from cast" style={removeButton} onClick={() => onUpdate({ team: idea.team.filter((x) => x.personId !== m.personId) })}>
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

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
                  style={{ fontSize: 12.5, fontWeight: 700, padding: "10px 14px", borderRadius: 8, border: "none", background: T.roi.navy, color: "#fff", cursor: "pointer" }}
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
