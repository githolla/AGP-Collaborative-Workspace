import { formatUsd } from "@agp/shared";
import { T } from "../theme.js";
import { useTooltip } from "./bits.js";

/**
 * Weekly fee burn — single blue series, thin bars with 4px rounded data-ends
 * anchored to the baseline, per-mark hover tooltip, recessive baseline.
 * Single series → the title names it; no legend box.
 */
export function WeeklyBurnChart({ data }: { data: { week: string; valueCents: number }[] }) {
  const tooltip = useTooltip();
  const max = Math.max(1, ...data.map((d) => d.valueCents));
  const H = 96;

  return (
    <div>
      <div
        style={{ display: "flex", alignItems: "flex-end", gap: 6, height: H, borderBottom: `1px solid ${T.baseline}` }}
      >
        {data.map((d) => {
          const h = Math.max(2, Math.round((d.valueCents / max) * (H - 8)));
          const isMax = d.valueCents === max;
          return (
            <div
              key={d.week}
              style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}
              onMouseMove={(e) =>
                tooltip.show(e, (
                  <span>
                    Week of {d.week.slice(5)} — <strong>{formatUsd(d.valueCents)}</strong> fees
                  </span>
                ))
              }
              onMouseLeave={tooltip.hide}
            >
              {isMax && (
                <span style={{ fontSize: 10, color: T.inkSecondary, marginBottom: 2 }}>{formatUsd(d.valueCents)}</span>
              )}
              <div
                style={{
                  width: "70%",
                  maxWidth: 34,
                  height: h,
                  background: T.series1,
                  borderRadius: "4px 4px 0 0",
                }}
              />
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
        {data.map((d) => (
          <span key={d.week} style={{ flex: 1, textAlign: "center", fontSize: 10, color: T.inkMuted }}>
            {d.week.slice(5)}
          </span>
        ))}
      </div>
      {tooltip.node}
    </div>
  );
}
