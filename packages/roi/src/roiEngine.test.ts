import { describe, expect, it } from "vitest";
import {
  computeDecisionMetrics,
  computePortfolio,
  computeProjectROI,
  explainProjectROI,
  type Factor,
} from "./roiEngine.js";
import { standardFactorTemplate } from "./factorTemplate.js";
import { applyModel, WORK_WEEKS, type RoiModel } from "./roiModel.js";

function factor(partial: Partial<Factor> & Pick<Factor, "key" | "affects">): Factor {
  return {
    label: partial.key,
    kind: "recurring_saving",
    unit: "usd_per_year",
    value: null,
    defaultValue: null,
    status: "unknown",
    confidence: null,
    ...partial,
  } as Factor;
}

describe("acceptance invariant (spec §11.5)", () => {
  it("zero data entered → $0, grade ≤ C, correct still-to-gather count", () => {
    const roi = computeProjectROI(standardFactorTemplate());
    expect(roi.netOneTime).toBe(0);
    expect(roi.netRecurringAnnual).toBe(0);
    expect(["C", "D"]).toContain(roi.grade);
    expect(roi.hasUnknowns).toBe(true);
    expect(roi.unknownRequiredKeys.sort()).toEqual([
      "fully_loaded_build_cost",
      "human_in_loop_residual",
      "time_saved_cashable",
    ]);
    // Realism dial defaults to Realistic 0.7 even with nothing selected.
    expect(roi.adjustmentMultiplier).toBeCloseTo(0.7);
  });

  it("numbers tighten as real values are entered", () => {
    const factors = standardFactorTemplate().map((f) => {
      if (f.key === "time_saved_cashable") return { ...f, value: 100_000, status: "estimated" as const, confidence: "B" as const };
      if (f.key === "fully_loaded_build_cost") return { ...f, value: 40_000, status: "confirmed" as const, confidence: "A" as const };
      if (f.key === "human_in_loop_residual") return { ...f, value: 15_000, status: "estimated" as const, confidence: "B" as const };
      return f;
    });
    const roi = computeProjectROI(factors);
    expect(roi.netRecurringAnnual).toBe(Math.round((100_000 - 15_000) * 0.7)); // 59,500
    expect(roi.netOneTime).toBe(-40_000);
    expect(roi.hasUnknowns).toBe(false);
    expect(roi.grade).toBe("B"); // worst of A, B, B
  });
});

describe("value resolution fallbacks (spec §2), observed through the engine", () => {
  it("numeric: value → defaultValue → 0 (or 1 for multiply)", () => {
    const single = (f: Factor) => computeProjectROI([f]).netRecurringAnnual;
    expect(single(factor({ key: "a", affects: "add_recurring", value: 5, defaultValue: 9 }))).toBe(5);
    expect(single(factor({ key: "a", affects: "add_recurring", value: null, defaultValue: 9 }))).toBe(9);
    expect(single(factor({ key: "a", affects: "add_recurring" }))).toBe(0);
    // A lone dial with no value resolves to 1 (multiplicative identity).
    expect(
      computeProjectROI([factor({ key: "d", affects: "multiply", kind: "adjustment" })]).adjustmentMultiplier,
    ).toBe(1);
  });

  it("enum: selectedOption → isDefault option → defaultValue", () => {
    const base = factor({
      key: "dial",
      affects: "multiply",
      kind: "adjustment",
      unit: "enum",
      options: [
        { label: "Low", value: 0.5 },
        { label: "Mid", value: 0.75, isDefault: true },
      ],
    });
    const mult = (f: Factor) => computeProjectROI([f]).adjustmentMultiplier;
    expect(mult({ ...base, selectedOption: "Low" })).toBe(0.5);
    expect(mult({ ...base, selectedOption: null })).toBe(0.75);
    expect(mult({ ...base, selectedOption: "Nonexistent" })).toBe(0.75);
    expect(mult({ ...base, options: [{ label: "X", value: 0.9 }], defaultValue: 0.6 })).toBe(0.6);
  });
});

describe("core math shape (spec §3)", () => {
  const factors: Factor[] = [
    factor({ key: "save_once", affects: "add_one_time", kind: "one_time_saving", unit: "usd", value: 100_000 }),
    factor({ key: "cost_once", affects: "sub_one_time", kind: "one_time_cost", unit: "usd", value: 40_000 }),
    factor({ key: "save_yr", affects: "add_recurring", value: 60_000 }),
    factor({ key: "cost_yr", affects: "sub_recurring", kind: "recurring_cost", value: 10_000 }),
    factor({ key: "dial1", affects: "multiply", kind: "adjustment", unit: "percent", value: 0.9 }),
    factor({ key: "dial2", affects: "multiply", kind: "adjustment", unit: "percent", value: 0.75 }),
  ];

  it("haircut hits savings but never costs; dials compound; recurring nets then multiplies", () => {
    const roi = computeProjectROI(factors);
    expect(roi.adjustmentMultiplier).toBeCloseTo(0.675); // 0.9 × 0.75
    expect(roi.netOneTime).toBe(Math.round(100_000 * 0.675 - 40_000)); // costs at full value
    expect(roi.netRecurringAnnual).toBe(Math.round((60_000 - 10_000) * 0.675));
  });

  it("placeholder and affects:none factors are excluded from the math", () => {
    const withContext: Factor[] = [
      ...factors,
      factor({ key: "ctx", affects: "none", kind: "classification", value: 999_999 }),
      factor({ key: "ph", affects: "add_recurring", kind: "placeholder", value: 999_999 }),
    ];
    expect(computeProjectROI(withContext).netRecurringAnnual).toBe(computeProjectROI(factors).netRecurringAnnual);
  });

  it("explanation always agrees with the headline number", () => {
    const roi = computeProjectROI(factors);
    const ex = explainProjectROI(factors);
    expect(ex.netOneTime).toBe(roi.netOneTime);
    expect(ex.netRecurringAnnual).toBe(roi.netRecurringAnnual);
    expect(ex.grossOneTimeSavings).toBe(100_000); // pre-haircut
    expect(ex.dials.map((d) => d.value)).toEqual([0.9, 0.75]);
  });
});

describe("confidence grade (spec §3)", () => {
  it("takes the worst grade among active factors; no grades at all → C", () => {
    const graded = [
      factor({ key: "a", affects: "add_recurring", value: 1, confidence: "A", status: "confirmed" }),
      factor({ key: "b", affects: "sub_recurring", value: 1, confidence: "D", status: "estimated" }),
    ];
    expect(computeProjectROI(graded).grade).toBe("D");
    expect(computeProjectROI([factor({ key: "a", affects: "add_recurring", value: 1, status: "estimated" })]).grade).toBe("C");
  });

  it("required unknown caps an A/B grade at C but never improves a D", () => {
    const capped = [
      factor({ key: "good", affects: "add_recurring", value: 1, confidence: "A", status: "confirmed" }),
      factor({ key: "missing", affects: "sub_recurring", required: true, status: "unknown" }),
    ];
    const roi = computeProjectROI(capped);
    expect(roi.grade).toBe("C");
    expect(roi.unknownRequiredKeys).toEqual(["missing"]);

    const alreadyD = [
      factor({ key: "bad", affects: "add_recurring", value: 1, confidence: "D", status: "estimated" }),
      factor({ key: "missing", affects: "sub_recurring", required: true, status: "unknown" }),
    ];
    expect(computeProjectROI(alreadyD).grade).toBe("D");
  });
});

describe("decision metrics (spec §5)", () => {
  it("computes payback, cumulative net, and ROI multiple over 3 years", () => {
    const m = computeDecisionMetrics([
      factor({ key: "save_yr", affects: "add_recurring", value: 60_000 }),
      factor({ key: "cost_yr", affects: "sub_recurring", kind: "recurring_cost", value: 10_000 }),
      factor({ key: "build", affects: "sub_one_time", kind: "one_time_cost", unit: "usd", value: 50_000 }),
    ]);
    expect(m.annualNet).toBe(50_000);
    expect(m.paybackYears).toBeCloseTo(1);
    expect(m.cumulativeNet).toBe(-50_000 + 3 * 50_000);
    expect(m.roiMultiple).toBeCloseTo((3 * 60_000) / (50_000 + 3 * 10_000));
  });

  it("payback is 0 with no upfront, null when it never pays back", () => {
    expect(computeDecisionMetrics([factor({ key: "s", affects: "add_recurring", value: 10 })]).paybackYears).toBe(0);
    expect(
      computeDecisionMetrics([
        factor({ key: "build", affects: "sub_one_time", kind: "one_time_cost", unit: "usd", value: 100 }),
        factor({ key: "drain", affects: "sub_recurring", kind: "recurring_cost", value: 10 }),
      ]).paybackYears,
    ).toBeNull();
  });

  it("roiMultiple is null when cost is zero", () => {
    expect(computeDecisionMetrics([factor({ key: "s", affects: "add_recurring", value: 10 })]).roiMultiple).toBeNull();
  });
});

describe("portfolio rollup (spec §6)", () => {
  it("sums money, takes the worst grade, counts open unknowns", () => {
    const strong = [factor({ key: "a", affects: "add_recurring", value: 100, confidence: "A", status: "confirmed" })];
    const portfolio = computePortfolio([{ factors: strong }, { factors: standardFactorTemplate() }]);
    expect(portfolio.netRecurringAnnual).toBe(100);
    expect(portfolio.grade).toBe("C"); // weakest project drags the portfolio
    expect(portfolio.openUnknowns).toBe(3);
  });
});

describe("basis layer (spec §8)", () => {
  const model: RoiModel = {
    summary: "Replaces manual reporting",
    comparables: [{ name: "Tableau", url: "https://example.com", annual: 4_500, basis: "$75/user/mo × 5 users" }],
    manual: [{ task: "Weekly report assembly", hoursPerWeek: 6, people: 2, rate: 85 }],
    buildHours: 120,
    buildRate: 100,
  };

  it("derives the four money factors as estimated/C with citations as evidence", () => {
    const factors = applyModel(standardFactorTemplate(), model);
    const get = (key: string) => factors.find((f) => f.key === key)!;

    const expectedTimeSaved = 6 * 2 * 85 * WORK_WEEKS; // 46,920
    expect(get("license_avoidance").value).toBe(4_500);
    expect(get("time_saved_cashable").value).toBe(expectedTimeSaved);
    expect(get("fully_loaded_build_cost").value).toBe(12_000);
    expect(get("human_in_loop_residual").value).toBe(Math.round(expectedTimeSaved * 0.15));
    for (const key of ["license_avoidance", "time_saved_cashable", "fully_loaded_build_cost", "human_in_loop_residual"]) {
      expect(get(key).status).toBe("estimated");
      expect(get(key).confidence).toBe("C");
      expect(get(key).evidence).toBeTruthy();
    }
    // Pre-fill clears the required-unknown cap path but grade stays C (worst = C).
    const roi = computeProjectROI(factors);
    expect(roi.hasUnknowns).toBe(false);
    expect(roi.grade).toBe("C");
  });
});
