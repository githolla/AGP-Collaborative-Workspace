import { formatUsd } from "@agp/shared";
import { T } from "../theme.js";
import { StatusBadge } from "./bits.js";
import type { ProjectFinance } from "../data/model.js";
import type { Severity } from "../theme.js";

const STATUS_TO_SEVERITY: Record<ProjectFinance["status"], { severity: Severity; label: string }> = {
  on_track: { severity: "good", label: "On track" },
  watch: { severity: "warning", label: "Ahead of plan — watch" },
  over: { severity: "serious", label: "Over plan" },
  under: { severity: "warning", label: "Under plan" },
};

/**
 * Budget-vs-burn meter: actual fee burn as a filled bar, expected pace as a
 * tick on the same single scale (one axis — never two).
 */
export function BurnMeter({ finance, envelopeLabel }: { finance: ProjectFinance; envelopeLabel: string }) {
  const actualPct = Math.min(1.15, finance.actualFraction) * 100;
  const expectedPct = Math.min(1, finance.expectedFraction) * 100;
  const status = STATUS_TO_SEVERITY[finance.status];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: T.inkSecondary }}>
          {formatUsd(finance.feesBurnedCents)} of {formatUsd(finance.feeBudget)} {envelopeLabel}
        </span>
        <StatusBadge severity={status.severity} label={status.label} />
      </div>
      <div
        style={{
          position: "relative",
          height: 14,
          background: "#f0efec",
          borderRadius: 4,
          overflow: "visible",
        }}
        role="img"
        aria-label={`Fees burned ${Math.round(finance.actualFraction * 100)} percent; expected ${Math.round(finance.expectedFraction * 100)} percent`}
      >
        <div
          style={{
            width: `${Math.min(100, actualPct)}%`,
            height: "100%",
            background: T.series1,
            borderRadius: 4,
          }}
        />
        {actualPct > 100 && (
          <div
            style={{
              position: "absolute",
              left: "100%",
              top: 0,
              width: `${actualPct - 100}%`,
              height: "100%",
              background: T.status.serious,
              borderRadius: "0 4px 4px 0",
            }}
          />
        )}
        <div
          title={`Expected pace: ${Math.round(expectedPct)}%`}
          style={{
            position: "absolute",
            left: `${expectedPct}%`,
            top: -3,
            width: 2,
            height: 20,
            background: T.ink,
          }}
        />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5, fontSize: 11, color: T.inkMuted }}>
        <span>
          Actual <strong style={{ color: T.ink }}>{Math.round(finance.actualFraction * 100)}%</strong>
        </span>
        <span>
          Expected pace <strong style={{ color: T.ink }}>{Math.round(finance.expectedFraction * 100)}%</strong>
        </span>
      </div>
    </div>
  );
}
