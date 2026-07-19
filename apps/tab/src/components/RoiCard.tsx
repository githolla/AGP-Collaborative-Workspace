import { formatUsd } from "@agp/shared";
import { T } from "../theme.js";
import { ProvenanceChip, SectionTitle } from "./bits.js";
import type { ProjectView } from "../data/model.js";

/**
 * Engagement ROI (SPEC 1b): value, cost to date, projected margin — all on fee
 * revenue net of pass-through (domain rule 3). Delta text uses success/critical
 * text tokens with an arrow + label, never color alone.
 */
export function RoiCard({ project }: { project: ProjectView }) {
  const f = project.finance;
  const marginPct = f.feeBudget > 0 ? Math.round((f.projectedMarginCents / f.feeBudget) * 100) : 0;
  const healthy = marginPct >= 30;

  const rows: { label: string; value: string; note?: string }[] = [
    { label: "Contract value", value: formatUsd(project.budgetCents) },
    { label: "Pass-through (print, postage, media)", value: `− ${formatUsd(f.passThroughCents)}` },
    { label: "Fee revenue", value: formatUsd(f.feeBudget) },
    { label: "Delivery cost to date", value: `− ${formatUsd(f.costCents)}` },
  ];

  return (
    <div>
      <SectionTitle right={<ProvenanceChip source={f.provenance} />}>Engagement ROI</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.map((r) => (
          <div key={r.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
            <span style={{ color: T.inkSecondary }}>{r.label}</span>
            <span style={{ color: T.ink, fontVariantNumeric: "tabular-nums" }}>{r.value}</span>
          </div>
        ))}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            borderTop: `1px solid ${T.grid}`,
            paddingTop: 8,
            marginTop: 2,
            fontSize: 13.5,
            fontWeight: 700,
          }}
        >
          <span style={{ color: T.ink }}>Projected margin</span>
          <span style={{ color: healthy ? T.successText : T.status.critical }}>
            {healthy ? "↑" : "↓"} {formatUsd(f.projectedMarginCents)} ({marginPct}%)
          </span>
        </div>
        <div style={{ fontSize: 11, color: T.inkMuted }}>
          Margin computed on fee revenue net of pass-through; figures are fixture data pending the
          tenant grounding doc.
        </div>
      </div>
    </div>
  );
}
