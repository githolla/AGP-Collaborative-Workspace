import { card, T } from "../theme.js";
import { TagChip } from "./bits.js";
import { FactorEditor } from "./FactorEditor.js";
import { ExecCard, GatherList, ScenarioStrip, Waterfall } from "./RoiPanel.js";
import { Thread } from "./Thread.js";
import { BriefCard, PhaseTimeline, TeamParts } from "./PlanCards.js";
import { fmtUsd, timeAgoLabel } from "../workspace/format.js";
import { TYPE_LABEL, type Initiative } from "../workspace/types.js";
import type { WorkspaceFactor } from "@agp/roi";

export function InitiativeWorkspace({
  initiative,
  onBack,
  onFactorChange,
  onPost,
  onAskAnalyst,
  onSummaryChange,
  onInvite,
  onPartAdded,
}: {
  initiative: Initiative;
  onBack: () => void;
  onFactorChange: (key: string, patch: Partial<WorkspaceFactor>) => void;
  onPost: (body: string) => void;
  onAskAnalyst: () => void;
  onSummaryChange: (summary: string) => void;
  onInvite: (personId: string) => void;
  onPartAdded: (personId: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <button
          type="button"
          onClick={onBack}
          style={{ fontSize: 12, color: T.inkSecondary, background: "none", border: "none", cursor: "pointer", padding: 0 }}
        >
          ← All initiatives
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: T.ink }}>{initiative.name}</h1>
          <TagChip>{TYPE_LABEL[initiative.type]}</TagChip>
        </div>
        <textarea
          value={initiative.summary}
          onChange={(e) => onSummaryChange(e.target.value)}
          placeholder="What is this initiative? One or two sentences."
          rows={2}
          style={{
            marginTop: 8,
            width: "100%",
            fontSize: 12.5,
            color: T.inkSecondary,
            padding: "8px 10px",
            border: `1px solid ${T.grid}`,
            borderRadius: 8,
            resize: "vertical",
            fontFamily: "inherit",
            background: T.surface,
          }}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 5fr) minmax(0, 4fr)", gap: 14, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={card}>
            <FactorEditor factors={initiative.factors} onChange={onFactorChange} />
          </div>
          <Thread messages={initiative.thread} onPost={onPost} onAskAnalyst={onAskAnalyst} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <ExecCard factors={initiative.factors} />
          {initiative.plan && <PhaseTimeline plan={initiative.plan} />}
          {initiative.plan && (
            <TeamParts plan={initiative.plan} onInvite={onInvite} onPartAdded={onPartAdded} />
          )}
          {initiative.plan && <BriefCard brief={initiative.plan.brief} />}
          <ScenarioStrip
            factors={initiative.factors}
            onApply={(option) => onFactorChange("realism", { selectedOption: option, status: "estimated" })}
          />
          <Waterfall factors={initiative.factors} />
          <GatherList factors={initiative.factors} onChange={onFactorChange} />

          <div style={card}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: T.inkMuted, marginBottom: 8 }}>
              Snapshot history (audit trail)
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 140, overflowY: "auto" }}>
              {[...initiative.snapshots].reverse().map((s, idx) => (
                <div key={`${s.at}-${idx}`} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: T.inkSecondary }}>
                  <span>{timeAgoLabel(s.at)}</span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>
                    {fmtUsd(s.netRecurringAnnual)}/yr · {fmtUsd(s.netOneTime)} once · {s.grade}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 10.5, color: T.inkMuted, marginTop: 6 }}>
              A snapshot is written on every factor change — the provenance trail when these numbers
              go in front of finance.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
