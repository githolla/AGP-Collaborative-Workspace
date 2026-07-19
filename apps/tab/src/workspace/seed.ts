import { applyModel, computeProjectROI, standardFactorTemplate, type RoiModel, type WorkspaceFactor } from "@agp/roi";
import type { Initiative, Snapshot } from "./types.js";
import { roiAnalystMessage } from "./agents.js";

/**
 * Demo initiatives. All figures are illustrative fixtures — the point is that
 * each starts from the standard 12-factor template and tightens as evidence
 * lands. One is deliberately untouched to demonstrate the acceptance
 * invariant: $0, grade C, three numbers still to gather.
 */

function snapshotOf(factors: WorkspaceFactor[], at: string): Snapshot {
  const roi = computeProjectROI(factors);
  return {
    at,
    netOneTime: roi.netOneTime,
    netRecurringAnnual: roi.netRecurringAnnual,
    adjustmentMultiplier: roi.adjustmentMultiplier,
    grade: roi.grade,
    hasUnknowns: roi.hasUnknowns,
  };
}

const PROPOSAL_BASIS: RoiModel = {
  summary: "Drafts and assembles RFP / proposal responses from the win-history corpus.",
  comparables: [
    { name: "Loopio", url: "https://www.loopio.com/", annual: 30_000, basis: "RFP software, representative" },
    { name: "Responsive", url: "https://www.responsive.io/", annual: 35_000, basis: "RFP platform, representative" },
  ],
  manual: [{ task: "Team hand-writing proposal responses", hoursPerWeek: 8, people: 2, rate: 90 }],
  buildHours: 200,
  buildRate: 100,
};

const GDNA_BASIS: RoiModel = {
  summary: "AI narrative reporting inside GivingDNA — donor analytics summaries drafted automatically.",
  comparables: [
    { name: "Power BI (report authoring seats)", url: "https://www.microsoft.com/power-platform/products/power-bi/pricing", annual: 6_000, basis: "$10/user/mo × 50 users" },
  ],
  manual: [{ task: "Analysts assembling client donor reports", hoursPerWeek: 6, people: 2, rate: 90 }],
  buildHours: 0, // build not yet scoped — cost stays unknown on purpose
  buildRate: 100,
};

function proposalAssistant(): Initiative {
  let factors = applyModel(standardFactorTemplate(), PROPOSAL_BASIS);
  factors = factors.map((f) => {
    if (f.key === "time_saved_cashable")
      return { ...f, status: "confirmed" as const, confidence: "B" as const, gatherOwner: "S. Whitfield" };
    if (f.key === "license_avoidance" || f.key === "fully_loaded_build_cost" || f.key === "human_in_loop_residual")
      return { ...f, confidence: "B" as const };
    if (f.key === "traditional_build_baseline")
      return { ...f, value: 45_000, status: "estimated" as const, confidence: "B" as const, evidence: "Agency quote, spring 2026" };
    if (f.key === "realism") return { ...f, selectedOption: "Realistic", status: "estimated" as const };
    return f;
  });

  const base: Initiative = {
    id: "proposal-draft-assistant",
    name: "Proposal Draft Assistant",
    type: "new_build",
    summary: PROPOSAL_BASIS.summary,
    factors,
    thread: [
      {
        id: "m1",
        author: "Barry M.",
        kind: "human",
        at: "2026-07-14T15:02:00Z",
        body: "Kicking this off — proposal team spends most of Thursday assembling responses by hand. Can we get the ROI basis cited before Friday's leadership sync?",
      },
      {
        id: "m2",
        author: "S. Whitfield",
        kind: "human",
        at: "2026-07-15T09:40:00Z",
        body: "Confirmed the time-saved line against last quarter's timesheets: 8h/wk × 2 people is real, marked it confirmed at B.",
      },
    ],
    snapshots: [snapshotOf(factors, "2026-07-15T09:41:00Z")],
    createdAt: "2026-07-14T15:00:00Z",
  };
  base.thread.push({
    id: "m3",
    author: "ROI Analyst",
    kind: "agent",
    at: "2026-07-15T09:42:00Z",
    body: roiAnalystMessage(base),
  });
  return base;
}

function gdnaReporting(): Initiative {
  let factors = applyModel(standardFactorTemplate(), GDNA_BASIS);
  factors = factors.map((f) => {
    // Build not scoped yet: cost + human-in-loop stay unknown (grade capped at C).
    if (f.key === "fully_loaded_build_cost")
      return { ...f, value: null, status: "unknown" as const, confidence: null, evidence: "Needs scoping session with GivingDNA eng", gatherOwner: "M. Okafor" };
    if (f.key === "human_in_loop_residual")
      return { ...f, value: null, status: "unknown" as const, confidence: null, evidence: "Depends on review workflow design", gatherOwner: "P. Raman" };
    return f;
  });

  const base: Initiative = {
    id: "gdna-ai-reporting",
    name: "AI Reporting inside GivingDNA",
    type: "ai_iteration",
    summary: GDNA_BASIS.summary,
    factors,
    thread: [
      {
        id: "m1",
        author: "Barry M.",
        kind: "human",
        at: "2026-07-16T14:10:00Z",
        body: "Iteration on the existing GivingDNA product — add AI-drafted donor narrative reports. Savings basis looks solid; we still owe a build estimate.",
      },
    ],
    snapshots: [snapshotOf(factors, "2026-07-16T14:11:00Z")],
    createdAt: "2026-07-16T14:00:00Z",
  };
  base.thread.push({
    id: "m2",
    author: "ROI Analyst",
    kind: "agent",
    at: "2026-07-16T14:12:00Z",
    body: roiAnalystMessage(base),
  });
  return base;
}

function dedupeService(): Initiative {
  const factors = standardFactorTemplate();
  return {
    id: "donor-data-dedupe",
    name: "Donor Data Dedupe Service",
    type: "new_build",
    summary: "Candidate: automated donor-record dedupe across client CRMs. Nothing entered yet — numbers to gather.",
    factors,
    thread: [
      {
        id: "m1",
        author: "Barry M.",
        kind: "human",
        at: "2026-07-18T10:30:00Z",
        body: "Parking this idea here so we can size it. Fresh template — note it correctly shows $0 until someone brings evidence.",
      },
    ],
    snapshots: [snapshotOf(factors, "2026-07-18T10:31:00Z")],
    createdAt: "2026-07-18T10:30:00Z",
  };
}

export function seedInitiatives(): Initiative[] {
  return [proposalAssistant(), gdnaReporting(), dedupeService()];
}
