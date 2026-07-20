import type { RoiModel } from "@agp/roi";
import { computeProjectROI } from "@agp/roi";
import { personById, type AgpFunction } from "./agpKnowledge.js";
import { factorsFromBasis } from "./basis.js";
import { fmtUsd } from "./format.js";
import type { CastMember, IdeaClassification, PlanPhase, ProjectPlan, WorkPackage } from "./types.js";

/**
 * Deterministic project planning: phases dated from the start date and a
 * concrete work package per cast member — what their part is, which phase,
 * how many hours, and the one input only they can bring. The copilot drafts
 * it behind the scenes; people are then added to contribute their part.
 */

interface PartTemplate {
  part: string;
  bring?: string;
  phaseKey: string;
  /** Share of build hours this function typically carries. */
  share: number;
  minHours: number;
}

const PART_TEMPLATES: Record<AgpFunction, PartTemplate> = {
  project_management: {
    part: "Own delivery — timeline, standups, unblocking, and the pilot rollout.",
    bring: "A run & maintenance estimate once the shape is clear.",
    phaseKey: "all",
    share: 0.12,
    minHours: 20,
  },
  web_development: {
    part: "Build the core — data plumbing, the working tool, and integration hooks.",
    bring: "A firm fully-loaded build estimate to replace the napkin guess.",
    phaseKey: "build",
    share: 0.5,
    minHours: 40,
  },
  analytics: {
    part: "Define the data mapping and success metrics; validate outputs against real numbers.",
    bring: "Timesheet-backed validation of the time-saved line.",
    phaseKey: "discovery",
    share: 0.15,
    minHours: 16,
  },
  data_solutions: {
    part: "Wire it into the campaign-deployment stack and QA the integration.",
    bring: "Per-campaign deployment effort, confirmed from the queue.",
    phaseKey: "build",
    share: 0.15,
    minHours: 16,
  },
  digital_fundraising: {
    part: "Shape the workflow around real campaign practice; pilot it on a live program.",
    bring: "A pilot client/program candidate.",
    phaseKey: "pilot",
    share: 0.1,
    minHours: 12,
  },
  creative: {
    part: "Voice and brand pass on everything client-visible the tool produces.",
    bring: "The review scope — what needs a creative eye vs. ships as-is.",
    phaseKey: "pilot",
    share: 0.08,
    minHours: 8,
  },
  production: {
    part: "Fold it into the production schedule and capacity calendar.",
    bring: "Capacity windows and hard-date constraints.",
    phaseKey: "pilot",
    share: 0.08,
    minHours: 8,
  },
  business_development: {
    part: "Pressure-test the money story; package it for clients or leadership.",
    bring: "The avoided-cost lines confirmed (agency quotes, tool invoices).",
    phaseKey: "discovery",
    share: 0.06,
    minHours: 8,
  },
  product_givingdna: {
    part: "Open the product surface — data access, embedding, and roadmap fit.",
    bring: "Confirmation of data access and where this lives in the product.",
    phaseKey: "build",
    share: 0.15,
    minHours: 16,
  },
};

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function makePlan(
  team: CastMember[],
  basis: RoiModel,
  startDate: string,
  ideaTitle: string,
  classification: IdeaClassification,
): ProjectPlan {
  const buildHours = Math.max(basis.buildHours, 40);
  const buildWeeks = Math.min(10, Math.max(2, Math.ceil(buildHours / 60)));

  const d0 = startDate;
  const d1 = addDays(d0, 14); // discovery: 2 weeks
  const d2 = addDays(d1, buildWeeks * 7);
  const d3 = addDays(d2, 14); // pilot: 2 weeks
  const d4 = addDays(d3, 7); // rollout: 1 week

  const phases: PlanPhase[] = [
    { key: "discovery", label: "Discovery", goal: "Confirm the numbers, map the data, lock scope.", start: d0, end: d1 },
    { key: "build", label: "Build", goal: `Working tool (${basis.buildHours || buildHours}h estimate).`, start: d1, end: d2 },
    { key: "pilot", label: "Pilot", goal: "Real users on real work; measure the time-saved claim.", start: d2, end: d3 },
    { key: "rollout", label: "Rollout", goal: "Team-wide, with adoption tracked against the realism dial.", start: d3, end: d4 },
  ];

  const packages: WorkPackage[] = team.map((m) => {
    const fn = personById(m.personId)?.fn ?? "project_management";
    const t = PART_TEMPLATES[fn];
    return {
      personId: m.personId,
      name: m.name,
      title: m.title,
      part: t.part,
      ...(t.bring ? { bring: t.bring } : {}),
      phaseKey: t.phaseKey === "all" ? "discovery" : t.phaseKey,
      hours: Math.max(t.minHours, Math.round((buildHours * t.share) / 4) * 4),
      status: "proposed",
      why: m.why,
      ...(m.viaManager ? { viaManager: m.viaManager } : {}),
    };
  });

  return { phases, packages, brief: composeBrief(ideaTitle, classification, basis, phases, packages) };
}

function composeBrief(
  title: string,
  classification: IdeaClassification,
  basis: RoiModel,
  phases: PlanPhase[],
  packages: WorkPackage[],
): string {
  const roi = computeProjectROI(factorsFromBasis(basis));
  const cls = [classification.serviceLine, classification.vertical, ...classification.clientNames]
    .filter(Boolean)
    .join(" · ");
  const start = phases[0]?.start ?? "";
  return [
    `≡ 60-SECOND BRIEF — ${title}`,
    cls ? `What: ${basis.summary || title} (${cls}).` : `What: ${basis.summary || title}.`,
    `Why now: removes ${basis.manual.map((m) => m.task.toLowerCase()).join("; ") || "manual work (to be defined)"}${basis.comparables.length > 0 ? `; avoids ${basis.comparables.map((c) => c.name).join(", ")}` : ""}.`,
    `Napkin: ${fmtUsd(roi.netRecurringAnnual)}/yr net at realism ×${roi.adjustmentMultiplier.toFixed(2)}, grade ${roi.grade} — directional until required numbers land.`,
    `Plan: ${phases.map((p) => `${p.label} ${p.start.slice(5)}→${p.end.slice(5)}`).join(" · ")} (${start.slice(0, 4)}).`,
    `Who does what: ${packages.map((p) => `${p.name} — ${p.part.split("—")[0]?.trim() ?? p.part} (~${p.hours}h)`).join(" · ")}.`,
    `What we need from each person is listed on their part — bring your number, the grade improves, the plan tightens.`,
  ].join("\n");
}

/**
 * The plan IS the task list (Collab Hub: "avoid AMs updating multiple
 * places") — each work package becomes that person's task, due at the end of
 * its phase. Manual tasks can be added alongside.
 */
export function tasksFromPlan(plan: ProjectPlan): import("./types.js").Task[] {
  return plan.packages.map((p) => {
    const phase = plan.phases.find((ph) => ph.key === p.phaseKey);
    return {
      id: `task-${p.personId}`,
      title: p.part,
      ownerName: p.name,
      ...(phase ? { due: phase.end } : {}),
      status: p.status === "part_added" ? ("done" as const) : ("todo" as const),
      phaseKey: p.phaseKey,
      source: "plan" as const,
      createdAt: plan.phases[0]?.start ?? "",
    };
  });
}

/** Words a title must never end on — a cut mid-phrase reads as a mistake. */
const TITLE_STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "to", "for", "from", "with", "in", "on", "at",
  "by", "into", "that", "our", "their", "its", "this", "as", "so", "but", "we", "last",
]);

/** Trim trailing stopwords so "…email series from last" becomes "…email series". */
function trimDangling(words: string[]): string[] {
  const out = [...words];
  while (out.length > 3 && TITLE_STOPWORDS.has((out[out.length - 1] ?? "").toLowerCase().replace(/[^a-z']/g, ""))) {
    out.pop();
  }
  return out;
}

/** Derive a short title from a one-box description. */
export function extractTitle(text: string): string {
  const firstSentence = text.split(/[.!?\n]/)[0] ?? text;
  const cleaned = firstSentence
    .replace(/^\s*(what if we|what if|let'?s|we should|i want(?: to)?|maybe we|could we|can we|build|make|create)\s+/i, "")
    .replace(/^\s*(an?|the)\s+/i, "")
    .trim();
  const words = trimDangling(cleaned.split(/\s+/).slice(0, 7)).join(" ");
  const title = words.length >= 8 ? words : trimDangling(firstSentence.trim().split(/\s+/).slice(0, 7)).join(" ");
  return title.charAt(0).toUpperCase() + title.slice(1);
}
