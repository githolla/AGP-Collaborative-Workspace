import { formatUsd } from "@agp/shared";
import { card, T } from "../theme.js";
import { ProvenanceChip, SectionTitle, StatTile, TagChip } from "./bits.js";
import { BurnMeter } from "./BurnMeter.js";
import { WeeklyBurnChart } from "./WeeklyBurnChart.js";
import { Milestones } from "./Milestones.js";
import { RoiCard } from "./RoiCard.js";
import { labelOf, type ProjectView } from "../data/model.js";

export function Dashboard({ project }: { project: ProjectView }) {
  const f = project.finance;
  const marginPct = f.feeBudget > 0 ? Math.round((f.projectedMarginCents / f.feeBudget) * 100) : 0;
  const envelopeLabel = project.model === "retainer" ? "monthly envelope" : "fee budget";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: T.ink }}>{project.title}</h1>
          <TagChip>{labelOf.vertical(project.client.vertical)}</TagChip>
          <TagChip>{labelOf.service(project.serviceLine)}</TagChip>
          <TagChip>{labelOf.model(project.model)}</TagChip>
        </div>
        <div style={{ fontSize: 12, color: T.inkMuted, marginTop: 4 }}>
          {project.start} → {project.due} · {project.client.name}
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <StatTile label="Contract value" value={formatUsd(project.budgetCents)} detail="per signed deal" source="HubSpot deal (fixture)" />
        <StatTile
          label="Fee revenue"
          value={formatUsd(f.feeBudget)}
          detail={`net of ${formatUsd(f.passThroughCents)} pass-through`}
          source={f.provenance}
        />
        <StatTile
          label={project.model === "retainer" ? "Fees this month" : "Fees burned"}
          value={formatUsd(f.feesBurnedCents)}
          detail={`${Math.round(f.actualFraction * 100)}% of ${envelopeLabel}`}
          source={f.provenance}
        />
        <StatTile
          label="Projected margin"
          value={formatUsd(f.projectedMarginCents)}
          detail={`${marginPct >= 30 ? "↑" : "↓"} ${marginPct}% of fee revenue`}
          detailColor={marginPct >= 30 ? T.successText : T.status.critical}
          source={f.provenance}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 3fr) minmax(0, 2fr)", gap: 14 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={card}>
            <SectionTitle right={<ProvenanceChip source={f.provenance} />}>
              Budget vs. burn — {envelopeLabel}
            </SectionTitle>
            <BurnMeter finance={f} envelopeLabel={envelopeLabel} />
          </div>
          <div style={card}>
            <SectionTitle>Weekly fee burn</SectionTitle>
            <WeeklyBurnChart data={f.weeklyBurn} />
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={card}>
            <RoiCard project={project} />
          </div>
          <div style={card}>
            <SectionTitle right={<ProvenanceChip source={`${project.milestones.length} stories · Kantata (fixture)`} />}>
              Timeline & milestones
            </SectionTitle>
            <Milestones milestones={project.milestones} />
          </div>
        </div>
      </div>
    </div>
  );
}
