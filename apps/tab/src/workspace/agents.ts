import { computeDecisionMetrics, computeProjectROI, rollup } from "@agp/roi";
import type { Initiative, SandboxIdea } from "./types.js";
import { factorsFromBasis } from "./basis.js";
import { fmtMultiple, fmtPayback, fmtUsd } from "./format.js";

/**
 * The agent roster. ROI Analyst is live today — its messages are computed
 * deterministically from the shared engine, so it can never disagree with the
 * numbers on screen. The LLM-backed agents activate when the Anthropic API key
 * is configured server-side (BLOCKERS #8) — they are never faked client-side.
 */
export const AGENTS = [
  { name: "AGP Copilot", live: true, note: "AGP knowledge base — org, Kantata projects, HubSpot campaigns" },
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

/** Deterministic napkin assessment for a sandbox idea (engine-backed). */
export function sandboxAnalystMessage(idea: SandboxIdea): string {
  const factors = factorsFromBasis(idea.basis);
  const roi = computeProjectROI(factors);
  const m = computeDecisionMetrics(factors);
  const r = rollup(idea.basis);

  const lines: string[] = [];
  if (idea.basis.comparables.length === 0 && idea.basis.manual.length === 0) {
    lines.push(
      "No basis yet — name the tool this would replace or the manual process it removes, and I can put a first number on it. Until then the honest answer is $0.",
    );
  } else {
    lines.push(
      `Back-of-napkin: ${fmtUsd(roi.netRecurringAnnual)}/yr net at realism ×${roi.adjustmentMultiplier.toFixed(2)} — from ${fmtUsd(r.licenseAvoidance)} license avoidance + ${fmtUsd(r.timeSavedCashable)} cashable time saved, less ${fmtUsd(r.humanInLoop)} human-in-the-loop residual.`,
    );
    lines.push(
      idea.basis.buildHours > 0
        ? `Build guess: ${fmtUsd(r.buildCost)} (${idea.basis.buildHours}h × $${idea.basis.buildRate}/h) → payback ${fmtPayback(m.paybackYears)}, ${m.years}-yr net ${fmtUsd(m.cumulativeNet)}, ROI ${fmtMultiple(m.roiMultiple)}.`
        : "No build estimate yet — even a rough hour count would complete the napkin math.",
    );
    lines.push(`Everything here is estimated at confidence C. Promote to a build to start hardening the numbers.`);
  }
  return lines.join("\n");
}
