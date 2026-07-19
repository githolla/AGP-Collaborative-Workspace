/**
 * The standard 12-factor template (spec §7): the proven starter set applied to
 * every initiative. Deliberately captures the benefit-ERODING factors (build
 * cost, human-in-the-loop tax, run cost, realism haircut) so naive math can't
 * flatter a project. All defaults conservative: a brand-new project starts at
 * $0 ROI, grade C, and improves only as evidence lands.
 *
 * Convention: a dollar is never counted twice — a replaced tool's avoidance is
 * a factor inside the project that replaces it, never a separate project.
 */

import type { Factor } from "./roiEngine.js";

/**
 * Metadata stored alongside a factor (spec §2: DB columns, not used by the
 * math). The engine's Factor type stays verbatim from the reference repo;
 * workspace code uses this extended shape.
 */
export interface FactorMeta {
  description?: string;
  evidence: string | null;
  gatherOwner?: string | null;
  sort?: number;
}

export type WorkspaceFactor = Factor & FactorMeta;

export function standardFactorTemplate(): WorkspaceFactor[] {
  const f = (
    partial: Omit<WorkspaceFactor, "value" | "status" | "confidence" | "evidence"> & Partial<WorkspaceFactor>,
  ): WorkspaceFactor => ({
    value: null,
    status: "unknown",
    confidence: null,
    evidence: null,
    ...partial,
  });

  return [
    f({
      key: "traditional_build_baseline",
      label: "Traditional-build cost avoided",
      kind: "one_time_saving",
      affects: "add_one_time",
      unit: "usd",
      defaultValue: 0,
      description: "Agency/contractor quote avoided",
      sort: 1,
    }),
    f({
      key: "license_avoidance",
      label: "License / SaaS avoided",
      kind: "recurring_saving",
      affects: "add_recurring",
      unit: "usd_per_year",
      defaultValue: 0,
      description: "Strongest line for finance; cite the replaced tool's invoice",
      sort: 2,
    }),
    f({
      key: "time_saved_cashable",
      label: "Time saved — cashable",
      kind: "recurring_saving",
      affects: "add_recurring",
      unit: "usd_per_year",
      defaultValue: 0,
      required: true,
      description: "Only bankable savings (headcount/contractor avoidance, billable hours). hrs/wk × users × loaded rate",
      sort: 3,
    }),
    f({
      key: "error_revenue_value",
      label: "Error-cost avoidance / revenue impact",
      kind: "recurring_saving",
      affects: "add_recurring",
      unit: "usd_per_year",
      defaultValue: 0,
      description: "Needs a clear counterfactual",
      sort: 4,
    }),
    f({
      key: "fully_loaded_build_cost",
      label: "Fully-loaded build cost",
      kind: "one_time_cost",
      affects: "sub_one_time",
      unit: "usd",
      defaultValue: 0,
      required: true,
      description: "Builder hrs × loaded rate + AI tooling + infra",
      sort: 5,
    }),
    f({
      key: "human_in_loop_residual",
      label: "Human-in-the-loop residual (“almost works” tax)",
      kind: "recurring_cost",
      affects: "sub_recurring",
      unit: "usd_per_year",
      defaultValue: 0,
      required: true,
      description: "Verification/correction hours — the #1 way internal AI tools quietly lose money",
      sort: 6,
    }),
    f({
      key: "run_maintenance_cost",
      label: "Run & maintenance cost",
      kind: "recurring_cost",
      affects: "sub_recurring",
      unit: "usd_per_year",
      defaultValue: 0,
      description: "Infra + licenses + babysitting hours",
      sort: 7,
    }),
    f({
      key: "realism",
      label: "Realism",
      kind: "adjustment",
      affects: "multiply",
      unit: "enum",
      defaultValue: null,
      options: [
        { label: "Conservative", value: 0.5 },
        { label: "Realistic", value: 0.7, isDefault: true },
        { label: "Optimistic", value: 0.9 },
      ],
      selectedOption: null,
      description: "One honest haircut covering adoption, ramp, partial realization, integration friction",
      sort: 8,
    }),
    f({
      key: "adoption",
      label: "Adoption / active usage",
      kind: "placeholder",
      affects: "none",
      unit: "percent",
      defaultValue: null,
      description: "Context metric — informs the realism call, moves no money",
      sort: 9,
    }),
    f({
      key: "integration_depth",
      label: "Integration depth",
      kind: "classification",
      affects: "none",
      unit: "enum",
      defaultValue: null,
      options: [
        { label: "Connected", value: 2 },
        { label: "Partial", value: 1 },
        { label: "Isolated island", value: 0, isDefault: true },
      ],
      selectedOption: null,
      description: "Context only",
      sort: 10,
    }),
    f({
      key: "time_to_working_tool",
      label: "Time-to-working-tool vs baseline",
      kind: "placeholder",
      affects: "none",
      unit: "percent",
      defaultValue: null,
      description: "The headline vibe-coding advantage, captured deliberately",
      sort: 11,
    }),
    f({
      key: "reusability",
      label: "Reusability / leverage",
      kind: "classification",
      affects: "none",
      unit: "enum",
      defaultValue: null,
      options: [
        { label: "One-off", value: 0, isDefault: true },
        { label: "Reusable component", value: 1 },
        { label: "Template-platform", value: 2 },
      ],
      selectedOption: null,
      sort: 12,
    }),
  ];
}
