import { describe, expect, it } from "vitest";
import {
  burnFromTimeEntries,
  burnStatusOf,
  expectedBurnFraction,
  feeBudgetCents,
  formatUsd,
  projectedMarginCents,
  splitExpenses,
} from "./finance.js";

describe("splitExpenses", () => {
  it("separates pass-through from fee-side cost", () => {
    const { feeCents, passThroughCents } = splitExpenses([
      { category: "Print Production", amountCents: 4_200_000 },
      { category: "Postage", amountCents: 2_800_000 },
      { category: "Travel", amountCents: 50_000 },
    ]);
    expect(passThroughCents).toBe(7_000_000);
    expect(feeCents).toBe(50_000);
  });

  it("treats unknown categories as fee-side (understate margin, never launder cost)", () => {
    const { feeCents, passThroughCents } = splitExpenses([
      { category: "Mystery Category", amountCents: 100 },
    ]);
    expect(feeCents).toBe(100);
    expect(passThroughCents).toBe(0);
  });
});

describe("burn math", () => {
  it("computes billable value and cost from minutes and hourly rates", () => {
    const burn = burnFromTimeEntries([
      { minutes: 90, billRateCents: 20_000, costRateCents: 10_000 },
      { minutes: 30, billRateCents: 20_000, costRateCents: 10_000 },
    ]);
    expect(burn.billableValueCents).toBe(40_000); // 2h @ $200
    expect(burn.costCents).toBe(20_000);
    expect(burn.minutes).toBe(120);
  });

  it("fee budget nets pass-through off the contract value", () => {
    expect(feeBudgetCents(18_500_000, 7_000_000)).toBe(11_500_000);
    expect(feeBudgetCents(100, 200)).toBe(0);
  });
});

describe("expectedBurnFraction (per commercial model — one generic model is a defect)", () => {
  it("fixed_fee paces straight-line across the engagement", () => {
    const f = expectedBurnFraction("fixed_fee", "2026-06-01", "2026-11-20", "2026-07-19");
    expect(f).toBeGreaterThan(0.26);
    expect(f).toBeLessThan(0.30);
  });

  it("retainer paces within the current month, ignoring the annual window", () => {
    const f = expectedBurnFraction("retainer", "2026-01-01", "2026-12-31", "2026-07-16");
    expect(f).toBeCloseTo(15 / 31, 2); // July 16 = 15 days into a 31-day month
  });

  it("clamps outside the window", () => {
    expect(expectedBurnFraction("fixed_fee", "2026-06-01", "2026-11-20", "2027-01-01")).toBe(1);
    expect(expectedBurnFraction("fixed_fee", "2026-06-01", "2026-11-20", "2025-01-01")).toBe(0);
  });
});

describe("burnStatusOf", () => {
  it("classifies against expectation", () => {
    expect(burnStatusOf(0.5, 0.48)).toBe("on_track");
    expect(burnStatusOf(0.62, 0.48)).toBe("watch");
    expect(burnStatusOf(0.75, 0.48)).toBe("over");
    expect(burnStatusOf(0.1, 0.5)).toBe("under");
  });
});

describe("projectedMarginCents", () => {
  it("extrapolates cost-to-date across the engagement", () => {
    // Half done, $30k cost so far → $60k projected cost against $115k fee budget.
    expect(projectedMarginCents(11_500_000, 3_000_000, 0.5)).toBe(5_500_000);
  });

  it("reports plan margin before meaningful burn", () => {
    expect(projectedMarginCents(11_500_000, 10_000, 0.01)).toBe(11_490_000);
  });
});

describe("formatUsd", () => {
  it("formats compact dollars", () => {
    expect(formatUsd(18_500_000)).toBe("$185k");
    expect(formatUsd(123_456_789_00)).toBe("$123.46M");
    expect(formatUsd(-5_500_000)).toBe("−$55k");
    expect(formatUsd(999_00)).toBe("$999");
  });
});
