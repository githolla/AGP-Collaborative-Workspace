/**
 * Financial math (SPEC domain rules 2 & 3):
 * - All margin/ROI computes on FEE revenue net of pass-through. One generic
 *   burn model is a defect: expected-burn pacing is per commercial model.
 * - The expense-category → fee/pass-through mapping is admin-editable data
 *   (app.expense_category_map); this default seeds it and is superseded by the
 *   tenant grounding doc when it arrives (BLOCKERS #1, ADR 0003).
 */

export type CommercialModel = "retainer" | "fixed_fee" | "sprint_build" | "product_support";
export type ExpenseClass = "fee" | "pass_through";

export const DEFAULT_EXPENSE_CLASSIFICATION: Record<string, ExpenseClass> = {
  "Print Production": "pass_through",
  Postage: "pass_through",
  "Media Buys": "pass_through",
  "List Rental": "pass_through",
  "Mail Services": "pass_through",
};

export interface ExpenseLike {
  category: string;
  amountCents: number;
}

export function splitExpenses(
  expenses: ExpenseLike[],
  classification: Record<string, ExpenseClass> = DEFAULT_EXPENSE_CLASSIFICATION,
): { feeCents: number; passThroughCents: number } {
  let feeCents = 0;
  let passThroughCents = 0;
  for (const e of expenses) {
    // Unknown categories count as fee-side cost: safer to understate margin
    // than to silently launder cost into pass-through.
    if ((classification[e.category] ?? "fee") === "pass_through") passThroughCents += e.amountCents;
    else feeCents += e.amountCents;
  }
  return { feeCents, passThroughCents };
}

export interface TimeEntryLike {
  minutes: number;
  billRateCents: number; // per hour
  costRateCents: number; // per hour
}

export function burnFromTimeEntries(entries: TimeEntryLike[]): {
  billableValueCents: number;
  costCents: number;
  minutes: number;
} {
  let billableValueCents = 0;
  let costCents = 0;
  let minutes = 0;
  for (const e of entries) {
    billableValueCents += Math.round((e.minutes / 60) * e.billRateCents);
    costCents += Math.round((e.minutes / 60) * e.costRateCents);
    minutes += e.minutes;
  }
  return { billableValueCents, costCents, minutes };
}

/** Fee budget = contract value minus budgeted pass-through. */
export function feeBudgetCents(totalBudgetCents: number, passThroughCents: number): number {
  return Math.max(0, totalBudgetCents - passThroughCents);
}

const DAY_MS = 24 * 60 * 60 * 1000;

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/**
 * Expected burn fraction at `asOf`, per commercial model:
 * - fixed_fee / sprint_build / product_support: straight-line across the
 *   engagement window (M5 replaces this with learned per-project baselines —
 *   this is the cold-start prior, not the end state).
 * - retainer: burn is judged within the current month against the monthly
 *   envelope, so the fraction is position-in-month.
 */
export function expectedBurnFraction(
  model: CommercialModel,
  startDate: string,
  endDate: string,
  asOf: string,
): number {
  const asOfT = new Date(`${asOf}T00:00:00Z`).getTime();
  if (model === "retainer") {
    const d = new Date(`${asOf}T00:00:00Z`);
    const monthStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    const nextMonth = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    return clamp01((asOfT - monthStart) / (nextMonth - monthStart));
  }
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  if (end <= start) return 1;
  return clamp01((asOfT - start) / (end - start + DAY_MS));
}

export type BurnStatus = "on_track" | "watch" | "over" | "under";

/**
 * Compare actual vs expected burn fraction. Thresholds are the cold-start
 * prior; learned baselines (intel.baselines) replace them in M5.
 */
export function burnStatusOf(actualFraction: number, expectedFraction: number): BurnStatus {
  const delta = actualFraction - expectedFraction;
  if (delta > 0.2) return "over";
  if (delta > 0.1) return "watch";
  if (delta < -0.25) return "under";
  return "on_track";
}

/**
 * Projected margin on fee revenue: extrapolate cost-to-date across the
 * engagement (cost / actualFraction) and subtract from the fee budget.
 * With no meaningful burn yet, assume the fee budget's planned cost is unknown
 * and report margin at plan (fee budget minus cost-to-date).
 */
export function projectedMarginCents(
  feeBudget: number,
  costToDateCents: number,
  actualBurnFraction: number,
): number {
  if (actualBurnFraction < 0.05) return feeBudget - costToDateCents;
  return feeBudget - Math.round(costToDateCents / actualBurnFraction);
}

export function formatUsd(cents: number): string {
  const dollars = cents / 100;
  const abs = Math.abs(dollars);
  const formatted =
    abs >= 1_000_000
      ? `$${(abs / 1_000_000).toFixed(2)}M`
      : abs >= 10_000
        ? `$${Math.round(abs / 1000)}k`
        : `$${abs.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  return dollars < 0 ? `−${formatted}` : formatted;
}
