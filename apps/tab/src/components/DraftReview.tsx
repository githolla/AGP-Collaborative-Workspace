import { computeProjectROI } from "@agp/roi";
import { T } from "../theme.js";
import { TagChip } from "./bits.js";
import { factorsFromBasis } from "../workspace/basis.js";
import { fmtUsd } from "../workspace/format.js";
import type { SandboxIdea } from "../workspace/types.js";

/**
 * The draft-review panel: when the Copilot builds a project from an idea, the
 * human reviews what it built — every section with its "because", every line
 * removable — and signs off once. Approval-by-exception, but with an explicit
 * moment of review instead of silently trusting the machine.
 */

const sectionLabel: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  color: T.inkMuted,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  marginBottom: 6,
};

const removeButton: React.CSSProperties = {
  border: "none",
  background: "none",
  color: T.inkMuted,
  cursor: "pointer",
  fontSize: 13,
  padding: "0 4px",
  lineHeight: 1,
  flexShrink: 0,
};

function ReviewLine({ text, sub, onRemove }: { text: string; sub?: string; onRemove?: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 12, padding: "3px 0" }}>
      <span style={{ flex: 1, minWidth: 0, color: T.ink, lineHeight: 1.4 }}>
        {text}
        {sub && <span style={{ display: "block", fontSize: 10.5, color: T.inkMuted }}>{sub}</span>}
      </span>
      {onRemove && (
        <button type="button" title="Not right — remove it" style={removeButton} onClick={onRemove}>
          ×
        </button>
      )}
    </div>
  );
}

export function DraftReview({
  idea,
  onUpdate,
  onAccept,
}: {
  idea: SandboxIdea;
  onUpdate: (patch: Partial<Pick<SandboxIdea, "basis" | "team">>) => void;
  onAccept: () => void;
}) {
  const basis = idea.basis;
  const cls = idea.classification;
  const roi = computeProjectROI(factorsFromBasis(basis));
  const plan = idea.plan;

  return (
    <div className="card" data-tour="draft-review" style={{ borderColor: T.roi.navy, borderWidth: 1.5, padding: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 14.5, fontWeight: 800, color: T.roi.navy }}>Review what the Copilot built</div>
          <div style={{ fontSize: 12, color: T.inkSecondary, marginTop: 2 }}>
            It drafted all of this from your idea{cls.department ? ` for ${cls.department}` : ""} — remove anything
            that's wrong (×), or tell it in the chat. Accept when it reads right.
          </div>
        </div>
        <div style={{ fontSize: 13, fontWeight: 800, color: T.ink, fontVariantNumeric: "tabular-nums" }}>
          napkin {fmtUsd(roi.netRecurringAnnual)}/yr · grade {roi.grade}
        </div>
      </div>

      <div className="review-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 16, marginTop: 14 }}>
        {/* 1. How it read the idea */}
        <div>
          <div style={sectionLabel}>How it read the idea</div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 6 }}>
            {cls.department && <TagChip>{cls.department}</TagChip>}
            {cls.serviceLine && <TagChip>{cls.serviceLine}</TagChip>}
            {cls.vertical && <TagChip>{cls.vertical}</TagChip>}
            {cls.clientNames.map((c) => (
              <TagChip key={c}>{c}</TagChip>
            ))}
          </div>
          {!cls.serviceLine && !cls.vertical && (
            <div style={{ fontSize: 11, color: T.inkMuted }}>No service line or vertical recognized yet — mention one in the chat and it reclassifies.</div>
          )}
          {idea.relatedProjects.slice(0, 2).map((p) => (
            <ReviewLine key={p.title} text={`Kantata · ${p.title}`} sub={p.why} />
          ))}
          {idea.relatedCampaigns.slice(0, 1).map((c) => (
            <ReviewLine key={c.title} text={`HubSpot · ${c.title}`} sub={c.why} />
          ))}
        </div>

        {/* 2. The value it claims */}
        <div>
          <div style={sectionLabel}>The value it claims</div>
          {basis.comparables.map((c, i) => (
            <ReviewLine
              key={`${c.name}-${i}`}
              text={`Replaces ${c.name} — ${fmtUsd(c.annual)}/yr`}
              sub={c.basis}
              onRemove={() => onUpdate({ basis: { ...basis, comparables: basis.comparables.filter((_, j) => j !== i) } })}
            />
          ))}
          {basis.manual.map((t, i) => (
            <ReviewLine
              key={`${t.task}-${i}`}
              text={`Removes: ${t.task}`}
              sub={`${t.hoursPerWeek}h/wk × ${t.people} people × $${t.rate}/h`}
              onRemove={() => onUpdate({ basis: { ...basis, manual: basis.manual.filter((_, j) => j !== i) } })}
            />
          ))}
          {basis.comparables.length === 0 && basis.manual.length === 0 && (
            <div style={{ fontSize: 11, color: T.inkMuted }}>No value lines drafted — the honest number stays $0 until someone brings one.</div>
          )}
          <ReviewLine
            text={`Build guess: ${basis.buildHours}h × $${basis.buildRate}/h = ${fmtUsd(basis.buildHours * basis.buildRate)}`}
            sub="everything estimated at confidence C until evidence lands"
          />
        </div>

        {/* 3. The team it cast */}
        <div>
          <div style={sectionLabel}>The team it cast</div>
          {idea.team.map((m) => (
            <ReviewLine
              key={m.personId}
              text={`${m.name} — ${m.role}${m.viaManager ? ` (via ${m.viaManager})` : ""}`}
              sub={m.why}
              onRemove={() => onUpdate({ team: idea.team.filter((x) => x.personId !== m.personId) })}
            />
          ))}
          {idea.team.length === 0 && <div style={{ fontSize: 11, color: T.inkMuted }}>Nobody cast yet.</div>}
        </div>

        {/* 4. The plan it laid out */}
        <div>
          <div style={sectionLabel}>The plan it laid out</div>
          {plan?.phases.map((p) => (
            <ReviewLine key={p.key} text={`${p.label} · ${p.start.slice(5)} → ${p.end.slice(5)}`} sub={p.goal} />
          ))}
          {plan && plan.packages.length > 0 && (
            <div style={{ fontSize: 11, color: T.inkSecondary, marginTop: 4 }}>
              {plan.packages.length} part{plan.packages.length === 1 ? "" : "s"} drafted — one per person, each
              listing the one input only they can bring. Nobody is invited until you say so.
            </div>
          )}
          {!plan && <div style={{ fontSize: 11, color: T.inkMuted }}>No plan drafted yet.</div>}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14, paddingTop: 12, borderTop: `1px solid ${T.grid}`, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-primary btn-lg" onClick={onAccept}>
          Looks right — accept the draft ✓
        </button>
        <span style={{ fontSize: 11, color: T.inkMuted }}>
          Accepting locks nothing — you can still change everything. It just records that a human reviewed
          what the machine built.
        </span>
      </div>
    </div>
  );
}
