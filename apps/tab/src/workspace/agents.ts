import { computeDecisionMetrics, computeProjectROI } from "@agp/roi";
import type { Initiative } from "./types.js";
import { fmtMultiple, fmtPayback, fmtUsd } from "./format.js";

/**
 * The agent roster. ROI Analyst is live today — its messages are computed
 * deterministically from the shared engine, so it can never disagree with the
 * numbers on screen. The LLM-backed agents activate when the Anthropic API key
 * is configured server-side (BLOCKERS #8) — they are never faked client-side.
 */
export const AGENTS = [
  { name: "ROI Analyst", live: true, note: "engine-backed, live now" },
  { name: "Product Strategist", live: false, note: "activates with Anthropic API key" },
  { name: "Brief Drafter", live: false, note: "activates with Anthropic API key" },
] as const;

/** Deterministic ROI assessment posted into the collaboration thread. */
export function roiAnalystMessage(initiative: Initiative): string {
  const roi = computeProjectROI(initiative.factors);
  const metrics = computeDecisionMetrics(initiative.factors);
  const unknowns = initiative.factors.filter((f) => roi.unknownRequiredKeys.includes(f.key));

  const lines: string[] = [
    `Current position: ${fmtUsd(roi.netRecurringAnnual)}/yr net · ${fmtUsd(roi.netOneTime)} one-time · realism ×${roi.adjustmentMultiplier.toFixed(2)} · grade ${roi.grade}.`,
    `Decision view (${metrics.years}-yr): payback ${fmtPayback(metrics.paybackYears)} · cumulative net ${fmtUsd(metrics.cumulativeNet)} · ROI multiple ${fmtMultiple(metrics.roiMultiple)}.`,
  ];

  if (unknowns.length > 0) {
    lines.push(
      `Grade is capped at C until ${unknowns.length} required number${unknowns.length > 1 ? "s" : ""} land${unknowns.length > 1 ? "" : "s"}: ` +
        unknowns.map((f) => `${f.label}${f.gatherOwner ? ` (owner: ${f.gatherOwner})` : ""}`).join("; ") +
        ".",
    );
  } else {
    const weakest = initiative.factors
      .filter((f) => f.affects !== "none" && f.kind !== "placeholder" && f.confidence)
      .sort((a, b) => (b.confidence ?? "A").localeCompare(a.confidence ?? "A"))[0];
    if (weakest && weakest.confidence !== "A") {
      lines.push(`Biggest credibility lever: harden “${weakest.label}” (currently ${weakest.status}, confidence ${weakest.confidence}).`);
    }
  }

  const drain = initiative.factors.find((f) => f.key === "human_in_loop_residual");
  if (drain?.value != null && roi.netRecurringAnnual > 0 && drain.value > roi.netRecurringAnnual * 0.4) {
    lines.push(`Watch the human-in-the-loop residual (${fmtUsd(drain.value)}/yr) — it is the #1 way internal AI tools quietly lose money.`);
  }

  return lines.join("\n");
}
