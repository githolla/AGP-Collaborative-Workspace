import {
  computeDecisionMetrics,
  computeProjectROI,
  explainProjectROI,
  type WorkspaceFactor,
} from "@agp/roi";
import { card, T } from "../theme.js";
import { SectionTitle, StatTile } from "./bits.js";
import { GradeBadge } from "./GradeBadge.js";
import { fmtMultiple, fmtPayback, fmtUsd } from "../workspace/format.js";

/** Exec decision card (spec §5): the four numbers a decision-maker needs. */
export function ExecCard({ factors }: { factors: WorkspaceFactor[] }) {
  const roi = computeProjectROI(factors);
  const m = computeDecisionMetrics(factors);
  return (
    <div style={card}>
      <SectionTitle right={<GradeBadge grade={roi.grade} />}>Decision view — {m.years}-year horizon</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <StatTile label="Annual net" value={fmtUsd(m.annualNet)} detail="recurring, after haircut" />
        <StatTile label="Payback" value={fmtPayback(m.paybackYears)} detail={m.upfront > 0 ? `on ${fmtUsd(m.upfront)} upfront` : "no upfront cost"} />
        <StatTile label={`${m.years}-yr cumulative net`} value={fmtUsd(m.cumulativeNet)} />
        <StatTile label="ROI multiple" value={fmtMultiple(m.roiMultiple)} detail="benefit ÷ cost" />
      </div>
      {roi.hasUnknowns && (
        <div style={{ marginTop: 10, fontSize: 11.5, color: T.roi.amber, fontWeight: 600 }}>
          ▲ Grade capped at {roi.grade} — {roi.unknownRequiredKeys.length} required number
          {roi.unknownRequiredKeys.length > 1 ? "s" : ""} still to gather. Treat as directional.
        </div>
      )}
    </div>
  );
}

/** Breakdown that can never disagree with the headline (spec §4). */
export function Waterfall({ factors }: { factors: WorkspaceFactor[] }) {
  const ex = explainProjectROI(factors);
  const rows = [
    { label: "Recurring savings (gross)", value: ex.grossRecurringSavings, per: "/yr", positive: true },
    { label: "Recurring costs", value: -ex.recurringCosts, per: "/yr", positive: false },
    { label: "One-time savings (gross)", value: ex.grossOneTimeSavings, per: "", positive: true },
    { label: "One-time costs", value: -ex.oneTimeCosts, per: "", positive: false },
  ];
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));

  return (
    <div style={card}>
      <SectionTitle>How the number is built</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((r) => (
          <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 170, fontSize: 11.5, color: T.inkSecondary }}>{r.label}</span>
            <div style={{ flex: 1, height: 12, background: "#f0efec", borderRadius: 4, overflow: "hidden" }}>
              <div
                style={{
                  width: `${(Math.abs(r.value) / max) * 100}%`,
                  height: "100%",
                  background: r.positive ? T.series1 : T.roi.navy,
                  borderRadius: 4,
                }}
              />
            </div>
            <span style={{ width: 95, textAlign: "right", fontSize: 11.5, color: T.ink, fontVariantNumeric: "tabular-nums" }}>
              {fmtUsd(r.value)}
              {r.per}
            </span>
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2, fontSize: 11.5, color: T.inkSecondary }}>
          <span>Haircut applied to savings:</span>
          {ex.dials.map((d) => (
            <span key={d.key} style={{ border: `1px solid ${T.grid}`, borderRadius: 999, padding: "1px 8px", color: T.ink }}>
              {d.label} ×{d.value}
            </span>
          ))}
          {ex.dials.length === 0 && <span>none</span>}
        </div>
        <div style={{ borderTop: `1px solid ${T.grid}`, paddingTop: 8, display: "flex", justifyContent: "space-between", fontSize: 12.5, fontWeight: 700 }}>
          <span style={{ color: T.ink }}>Net</span>
          <span style={{ color: T.ink }}>
            {fmtUsd(ex.netRecurringAnnual)}/yr · {fmtUsd(ex.netOneTime)} one-time
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Scenario strip: the realism dial as three side-by-side what-ifs, computed by
 * the same engine. Clicking applies the scenario to the live project.
 */
export function ScenarioStrip({
  factors,
  onApply,
}: {
  factors: WorkspaceFactor[];
  onApply: (option: string) => void;
}) {
  const realism = factors.find((f) => f.key === "realism");
  if (!realism?.options) return null;
  const current = realism.selectedOption ?? realism.options.find((o) => o.isDefault)?.label;

  return (
    <div style={card}>
      <SectionTitle>Scenarios — realism dial</SectionTitle>
      <div style={{ display: "flex", gap: 8 }}>
        {realism.options.map((o) => {
          const scenarioFactors = factors.map((f) =>
            f.key === "realism" ? { ...f, selectedOption: o.label } : f,
          );
          const roi = computeProjectROI(scenarioFactors);
          const m = computeDecisionMetrics(scenarioFactors);
          const active = o.label === current;
          return (
            <button
              key={o.label}
              type="button"
              onClick={() => onApply(o.label)}
              style={{
                flex: 1,
                textAlign: "left",
                padding: "10px 12px",
                borderRadius: 8,
                cursor: "pointer",
                border: `2px solid ${active ? T.series1 : T.grid}`,
                background: active ? "#eef5fd" : "#fff",
              }}
            >
              <div style={{ fontSize: 11.5, fontWeight: 700, color: T.ink }}>
                {o.label} <span style={{ color: T.inkMuted, fontWeight: 500 }}>×{o.value}</span>
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, marginTop: 4 }}>{fmtUsd(roi.netRecurringAnnual)}/yr</div>
              <div style={{ fontSize: 10.5, color: T.inkSecondary }}>{m.years}-yr net {fmtUsd(m.cumulativeNet)}</div>
            </button>
          );
        })}
      </div>
      <div style={{ marginTop: 8, fontSize: 11, color: T.inkMuted }}>
        One honest haircut — adoption, ramp, partial realization, integration friction in a single
        dial. Click a scenario to apply it.
      </div>
    </div>
  );
}

/** The "what we need to gather" list (spec §9), from unknown factors. */
export function GatherList({
  factors,
  onChange,
}: {
  factors: WorkspaceFactor[];
  onChange: (key: string, patch: Partial<WorkspaceFactor>) => void;
}) {
  const unknowns = factors.filter((f) => f.status === "unknown" && f.affects !== "none" && f.kind !== "placeholder");
  if (unknowns.length === 0) {
    return (
      <div style={card}>
        <SectionTitle>Numbers still to gather</SectionTitle>
        <div style={{ fontSize: 12, color: T.roi.confirmed, fontWeight: 600 }}>✓ Nothing outstanding — every money factor has a value.</div>
      </div>
    );
  }
  return (
    <div style={card}>
      <SectionTitle
        right={
          <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: T.roi.amber, borderRadius: 999, padding: "2px 9px" }}>
            {unknowns.filter((f) => f.required).length} required
          </span>
        }
      >
        Numbers still to gather
      </SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {unknowns.map((f) => (
          <div key={f.key} style={{ fontSize: 12 }}>
            <div style={{ color: T.ink, fontWeight: 600 }}>
              {f.label}
              {f.required && <span style={{ color: T.roi.amber }}> *</span>}
            </div>
            {f.evidence && <div style={{ color: T.inkSecondary, marginTop: 2 }}>{f.evidence}</div>}
            <input
              value={f.gatherOwner ?? ""}
              placeholder="Who owns getting this number?"
              onChange={(e) => onChange(f.key, { gatherOwner: e.target.value || null })}
              style={{
                marginTop: 4,
                fontSize: 11,
                padding: "4px 8px",
                border: `1px solid ${T.grid}`,
                borderRadius: 6,
                width: "100%",
                color: T.inkSecondary,
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
