import { kantataSeed, hubspotSeed, SEED_PEOPLE, SEED_WEEKS } from "@agp/sync/fixtures";
import {
  burnFromTimeEntries,
  burnStatusOf,
  expectedBurnFraction,
  feeBudgetCents,
  projectedMarginCents,
  splitExpenses,
  type BurnStatus,
  type CommercialModel,
} from "@agp/shared";

/**
 * Read-model assembly over the fixture mirror (M2 runs credential-free).
 * In M3+ this module reads the Supabase mirror through the same shapes.
 */

export const AS_OF = "2026-07-19"; // demo "today" — aligns with the fixture window

export interface Person {
  id: string;
  name: string;
  title: string;
}

export interface Milestone {
  id: string;
  title: string;
  storyType: string;
  state: string;
  due: string;
  hard: boolean;
}

export interface TimeEntryView {
  userId: string;
  date: string;
  minutes: number;
  billRateCents: number;
  costRateCents: number;
  notes: string;
}

export interface AllocationView {
  userId: string;
  week: string;
  minutes: number;
  hard: boolean;
}

export interface EngagementView {
  type: string;
  occurredAt: string;
  subject: string;
  body: string;
}

export interface ProjectFinance {
  passThroughCents: number;
  feeBudget: number;
  feesBurnedCents: number;
  costCents: number;
  actualFraction: number;
  expectedFraction: number;
  status: BurnStatus;
  projectedMarginCents: number;
  weeklyBurn: { week: string; valueCents: number }[];
  /** Provenance summary for the chip, e.g. "98 time entries · 3 expenses". */
  provenance: string;
}

export interface ProjectView {
  id: string;
  title: string;
  client: { id: string; name: string; vertical: string };
  serviceLine: string;
  model: CommercialModel;
  budgetCents: number;
  start: string;
  due: string;
  milestones: Milestone[];
  timeEntries: TimeEntryView[];
  allocations: AllocationView[];
  engagements: EngagementView[];
  finance: ProjectFinance;
}

const MODEL_LABEL: Record<CommercialModel, string> = {
  retainer: "Retainer",
  fixed_fee: "Fixed fee",
  sprint_build: "Sprint build",
  product_support: "Product / support",
};

const VERTICAL_LABEL: Record<string, string> = {
  food_banks: "Food banks",
  public_media: "Public media",
  hospitals: "Hospitals",
};

const SERVICE_LABEL: Record<string, string> = {
  direct_mail: "Direct mail",
  digital_fundraising: "Digital fundraising",
  mid_major_gifts: "Mid/major gifts",
  givingdna: "GivingDNA",
};

export const labelOf = {
  model: (m: CommercialModel) => MODEL_LABEL[m],
  vertical: (v: string) => VERTICAL_LABEL[v] ?? v,
  service: (s: string) => SERVICE_LABEL[s] ?? s,
};

export const people: Person[] = SEED_PEOPLE.map((p) => ({ id: p.id, name: p.full_name, title: p.title }));
export const weeks: readonly string[] = SEED_WEEKS;

export function personName(id: string): string {
  return people.find((p) => p.id === id)?.name ?? id;
}

function financeOf(
  model: CommercialModel,
  budgetCents: number,
  start: string,
  due: string,
  entries: TimeEntryView[],
  expenses: { category: string; amountCents: number }[],
): ProjectFinance {
  const { passThroughCents } = splitExpenses(expenses);
  const feeBudget = feeBudgetCents(budgetCents, passThroughCents);

  // Retainer burn is judged within the current month against the monthly envelope.
  const monthStart = `${AS_OF.slice(0, 7)}-01`;
  const scopedEntries = model === "retainer" ? entries.filter((e) => e.date >= monthStart) : entries;
  const envelope = model === "retainer" ? Math.round(feeBudget / 12) : feeBudget;

  const burn = burnFromTimeEntries(
    scopedEntries.map((e) => ({ minutes: e.minutes, billRateCents: e.billRateCents, costRateCents: e.costRateCents })),
  );
  const allBurn = burnFromTimeEntries(
    entries.map((e) => ({ minutes: e.minutes, billRateCents: e.billRateCents, costRateCents: e.costRateCents })),
  );
  const actualFraction = envelope > 0 ? burn.billableValueCents / envelope : 0;
  const expectedFraction = expectedBurnFraction(model, start, due, AS_OF);

  const weeklyBurn = SEED_WEEKS.map((week, i) => {
    const next: string | undefined = SEED_WEEKS[i + 1];
    const inWeek = entries.filter((e) => e.date >= week && (next === undefined || e.date < next));
    return { week, valueCents: burnFromTimeEntries(inWeek).billableValueCents };
  });

  return {
    passThroughCents,
    feeBudget,
    feesBurnedCents: burn.billableValueCents,
    costCents: allBurn.costCents,
    actualFraction,
    expectedFraction,
    status: burnStatusOf(actualFraction, expectedFraction),
    projectedMarginCents: projectedMarginCents(feeBudget, allBurn.costCents, Math.min(1, actualFraction)),
    weeklyBurn,
    provenance: `${entries.length} time entries · ${expenses.length} expenses · Kantata (fixture)`,
  };
}

export function loadProjects(): ProjectView[] {
  const k = kantataSeed().entities;
  const h = hubspotSeed().entities;

  return (k.workspace ?? []).map((ws) => {
    const id = String(ws.id);
    const companyId = String(ws.workspace_group_company_id);
    const company = (h.company ?? []).find((c) => c.id === companyId);
    const model = String(ws.commercial_model) as CommercialModel;

    const timeEntries: TimeEntryView[] = (k.time_entry ?? [])
      .filter((t) => t.workspace_id === id)
      .map((t) => ({
        userId: String(t.user_id),
        date: String(t.date_performed),
        minutes: Number(t.time_in_minutes),
        billRateCents: Number(t.bill_rate_cents),
        costRateCents: Number(t.cost_rate_cents),
        notes: String(t.notes ?? ""),
      }));

    const expenses = (k.expense ?? [])
      .filter((e) => e.workspace_id === id)
      .map((e) => ({ category: String(e.category), amountCents: Number(e.amount_cents) }));

    return {
      id,
      title: String(ws.title),
      client: {
        id: companyId,
        name: String(company?.name ?? companyId),
        vertical: String(ws.vertical),
      },
      serviceLine: String(ws.service_line),
      model,
      budgetCents: Number(ws.budget_cents),
      start: String(ws.start_date),
      due: String(ws.due_date),
      milestones: (k.story ?? [])
        .filter((s) => s.workspace_id === id)
        .map((s) => ({
          id: String(s.id),
          title: String(s.title),
          storyType: String(s.story_type),
          state: String(s.state),
          due: String(s.due_date),
          hard: Boolean(s.hard_date),
        }))
        .sort((a, b) => a.due.localeCompare(b.due)),
      timeEntries,
      allocations: (k.allocation ?? [])
        .filter((a) => a.workspace_id === id)
        .map((a) => ({
          userId: String(a.user_id),
          week: String(a.week_start),
          minutes: Number(a.minutes),
          hard: Boolean(a.hard),
        })),
      engagements: (h.engagement ?? [])
        .filter((e) => e.company_id === companyId)
        .map((e) => ({
          type: String(e.engagement_type),
          occurredAt: String(e.occurred_at),
          subject: String(e.subject),
          body: String(e.body),
        }))
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)),
      finance: financeOf(model, Number(ws.budget_cents), String(ws.start_date), String(ws.due_date), timeEntries, expenses),
    };
  });
}

export function daysUntil(dateIso: string, from: string = AS_OF): number {
  return Math.round(
    (new Date(`${dateIso}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000,
  );
}
