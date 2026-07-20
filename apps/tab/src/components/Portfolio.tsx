import { useState } from "react";
import { computeDecisionMetrics, computePortfolio, computeProjectROI } from "@agp/roi";
import { card, T } from "../theme.js";
import { SectionTitle, StatTile, TagChip } from "./bits.js";
import { GradeBadge } from "./GradeBadge.js";
import { fmtPayback, fmtUsd } from "../workspace/format.js";
import { TYPE_LABEL, type Initiative } from "../workspace/types.js";

export function Portfolio({
  initiatives,
  onOpen,
  onStartInSandbox,
}: {
  initiatives: Initiative[];
  onOpen: (id: string) => void;
  onStartInSandbox: () => void;
}) {
  const [showArchived, setShowArchived] = useState(false);
  const active = initiatives.filter((i) => !i.archived);
  const archivedCount = initiatives.length - active.length;
  const visible = showArchived ? initiatives : active;
  // Archived work stays out of the live portfolio number.
  const portfolio = computePortfolio(active);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "stretch" }}>
        <StatTile label="Portfolio annual net" value={`${fmtUsd(portfolio.netRecurringAnnual)}/yr`} detail="Σ across initiatives, after haircuts" />
        <StatTile label="Portfolio one-time net" value={fmtUsd(portfolio.netOneTime)} />
        <div style={{ ...card, display: "flex", alignItems: "center", gap: 12, minWidth: 170, flex: 1 }}>
          <GradeBadge grade={portfolio.grade} size={34} />
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase", color: T.inkMuted }}>Portfolio grade</div>
            <div style={{ fontSize: 11.5, color: T.inkSecondary }}>only as credible as the weakest number</div>
          </div>
        </div>
        <StatTile
          label="Numbers still to gather"
          value={`${portfolio.openUnknowns}`}
          detail="required factors without values"
          detailColor={portfolio.openUnknowns > 0 ? T.roi.amber : T.roi.confirmed}
        />
      </div>

      {archivedCount > 0 && (
        <button
          type="button"
          onClick={() => setShowArchived(!showArchived)}
          className="btn-link"
          style={{ alignSelf: "flex-start", fontSize: 11.5 }}
        >
          {showArchived ? "Hide archived" : `Show archived (${archivedCount})`}
        </button>
      )}

      <div className="cards-grid">
        {visible.map((i) => {
          const roi = computeProjectROI(i.factors);
          const m = computeDecisionMetrics(i.factors);
          return (
            <button
              key={i.id}
              type="button"
              onClick={() => onOpen(i.id)}
              className="card card-hover"
              style={{ display: "flex", flexDirection: "column", gap: 8 }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: T.ink, lineHeight: 1.3 }}>{i.name}</span>
                <GradeBadge grade={roi.grade} />
              </div>
              <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                <TagChip>{TYPE_LABEL[i.type]}</TagChip>
                {i.archived && <TagChip>Archived</TagChip>}
              </span>
              <div style={{ fontSize: 20, fontWeight: 800, color: T.ink }}>
                {fmtUsd(roi.netRecurringAnnual)}
                <span style={{ fontSize: 12, fontWeight: 500, color: T.inkMuted }}>/yr net</span>
              </div>
              <div style={{ fontSize: 11.5, color: T.inkSecondary }}>
                {fmtUsd(roi.netOneTime)} one-time · payback {fmtPayback(m.paybackYears).toLowerCase()}
              </div>
              {roi.hasUnknowns ? (
                <div style={{ fontSize: 11, fontWeight: 600, color: T.roi.amber }}>
                  ▲ {roi.unknownRequiredKeys.length} number{roi.unknownRequiredKeys.length > 1 ? "s" : ""} to gather
                </div>
              ) : (
                <div style={{ fontSize: 11, fontWeight: 600, color: T.roi.confirmed }}>✓ all required numbers in</div>
              )}
              <div style={{ fontSize: 11, color: T.inkMuted }}>
                {i.thread.length} message{i.thread.length === 1 ? "" : "s"} · {i.snapshots.length} snapshot{i.snapshots.length === 1 ? "" : "s"}
              </div>
            </button>
          );
        })}

        <button
          type="button"
          onClick={onStartInSandbox}
          className="card card-dashed card-hover"
          style={{ display: "flex", flexDirection: "column", gap: 8, justifyContent: "center" }}
        >
          <SectionTitle>Start something new</SectionTitle>
          <div style={{ fontSize: 12.5, color: T.inkSecondary, lineHeight: 1.5 }}>
            Everything starts in the <strong style={{ color: T.ink }}>Sandbox</strong> — describe an
            idea in a sentence and the Copilot builds the project behind the scenes, or start blank
            with just your team. Promote it here when the numbers earn it.
          </div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: T.roi.navy }}>Open the Sandbox →</div>
        </button>
      </div>
    </div>
  );
}
