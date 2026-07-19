// Impact OS — shared ROI engine.
// Pure, deterministic, no I/O. Shared between client (live UI math) and
// server (persisted snapshot math) so both compute identical numbers.
//
// Design guarantees:
//  1. Never errors on missing data — a null value falls back to defaultValue.
//  2. Unknowns are visible (each factor carries a status).
//  3. Confidence reflects unknowns — a required+unknown factor caps the grade.

export type FactorKind =
  | 'one_time_saving' | 'recurring_saving'
  | 'one_time_cost'   | 'recurring_cost'
  | 'adjustment'      | 'classification' | 'placeholder';

export type Affects =
  | 'add_one_time' | 'sub_one_time'
  | 'add_recurring' | 'sub_recurring'
  | 'multiply' | 'none';

export type Unit = 'usd' | 'usd_per_year' | 'percent' | 'enum' | 'date';

export type FactorStatus = 'confirmed' | 'estimated' | 'unknown';

export type Grade = 'A' | 'B' | 'C' | 'D';

export interface FactorOption { label: string; value: number; isDefault?: boolean; }

export interface Factor {
  key: string;
  label: string;
  kind: FactorKind;
  affects: Affects;
  unit: Unit;
  value: number | null;
  defaultValue: number | null;
  status: FactorStatus;
  confidence: Grade | null;
  options?: FactorOption[];
  selectedOption?: string | null;
  required?: boolean;
}

export interface ProjectROI {
  netOneTime: number;
  netRecurringAnnual: number;
  adjustmentMultiplier: number;
  grade: Grade;
  hasUnknowns: boolean;
  unknownRequiredKeys: string[];
}

const GRADE_ORDER: Grade[] = ['A', 'B', 'C', 'D'];

// Resolve a factor to its numeric contribution, falling back to defaults for unknowns.
function num(f: Factor): number {
  if (f.unit === 'enum') {
    const opts = f.options ?? [];
    const chosen = opts.find(o => o.label === f.selectedOption)
      ?? opts.find(o => o.isDefault)
      ?? null;
    return chosen ? chosen.value : (f.defaultValue ?? (f.affects === 'multiply' ? 1 : 0));
  }
  if (f.value !== null && f.value !== undefined && !Number.isNaN(f.value)) return f.value;
  return f.defaultValue ?? (f.affects === 'multiply' ? 1 : 0);
}

const sumBy = (fs: Factor[], a: Affects) =>
  fs.filter(f => f.affects === a).reduce((s, f) => s + num(f), 0);

function worstGrade(grades: (Grade | null)[]): Grade {
  const present = grades.filter((g): g is Grade => !!g);
  if (present.length === 0) return 'C';
  return present.reduce<Grade>((w, g) =>
    GRADE_ORDER.indexOf(g) > GRADE_ORDER.indexOf(w) ? g : w, 'A');
}

const capAt = (g: Grade, floor: Grade): Grade =>
  GRADE_ORDER.indexOf(g) > GRADE_ORDER.indexOf(floor) ? g : floor;

export function computeProjectROI(factors: Factor[]): ProjectROI {
  const active = factors.filter(f => f.kind !== 'placeholder' && f.affects !== 'none');

  // Adjustment factors are multipliers in [0, 1+] (scope match, realization, adoption...).
  const adjustmentMultiplier = active
    .filter(f => f.affects === 'multiply')
    .reduce((m, f) => m * num(f), 1);

  const oneTime   = sumBy(active, 'add_one_time') * adjustmentMultiplier - sumBy(active, 'sub_one_time');
  const recurring = (sumBy(active, 'add_recurring') - sumBy(active, 'sub_recurring')) * adjustmentMultiplier;

  const unknownRequired = factors.filter(f =>
    f.required && f.status === 'unknown' &&
    (f.value === null || f.value === undefined) && !f.selectedOption);
  const hasUnknowns = unknownRequired.length > 0;

  let grade = worstGrade(active.map(f => f.confidence));
  if (hasUnknowns) grade = capAt(grade, 'C'); // never claim A/B while a required input is missing

  return {
    netOneTime: Math.round(oneTime),
    netRecurringAnnual: Math.round(recurring),
    adjustmentMultiplier,
    grade,
    hasUnknowns,
    unknownRequiredKeys: unknownRequired.map(f => f.key),
  };
}

export interface PortfolioROI {
  netOneTime: number;
  netRecurringAnnual: number;
  grade: Grade;
  openUnknowns: number;
}

export interface ROIDial { key: string; label: string; value: number; }

export interface ROIExplanation {
  grossOneTimeSavings: number;
  oneTimeCosts: number;
  grossRecurringSavings: number;
  recurringCosts: number;
  adjustmentMultiplier: number;
  dials: ROIDial[];
  netOneTime: number;
  netRecurringAnnual: number;
}

// Decompose the ROI into the pieces the UI shows (charts + plain-language
// breakdown). Uses the exact same resolution/rounding as computeProjectROI so
// the explanation never disagrees with the headline number.
export function explainProjectROI(factors: Factor[]): ROIExplanation {
  const active = factors.filter(f => f.kind !== 'placeholder' && f.affects !== 'none');

  const dials: ROIDial[] = active
    .filter(f => f.affects === 'multiply')
    .map(f => ({ key: f.key, label: f.label, value: num(f) }));
  const adjustmentMultiplier = dials.reduce((m, d) => m * d.value, 1);

  const grossOneTimeSavings = sumBy(active, 'add_one_time');
  const oneTimeCosts = sumBy(active, 'sub_one_time');
  const grossRecurringSavings = sumBy(active, 'add_recurring');
  const recurringCosts = sumBy(active, 'sub_recurring');

  return {
    grossOneTimeSavings,
    oneTimeCosts,
    grossRecurringSavings,
    recurringCosts,
    adjustmentMultiplier,
    dials,
    netOneTime: Math.round(grossOneTimeSavings * adjustmentMultiplier - oneTimeCosts),
    netRecurringAnnual: Math.round((grossRecurringSavings - recurringCosts) * adjustmentMultiplier),
  };
}

export interface DecisionMetrics {
  annualNet: number;
  upfront: number;
  paybackYears: number | null;   // null when there's no positive annual net to pay it back
  cumulativeNet: number;         // net over `years` (one-time + years × annual)
  roiMultiple: number | null;    // benefit ÷ cost over `years`; null when there is no cost
  years: number;
}

// Exec-grade decision numbers, derived from the same explanation the headline uses.
export function computeDecisionMetrics(factors: Factor[], years = 3): DecisionMetrics {
  const ex = explainProjectROI(factors);
  const annualNet = ex.netRecurringAnnual;
  const upfront = ex.oneTimeCosts;
  const benefit = ex.adjustmentMultiplier * (ex.grossOneTimeSavings + years * ex.grossRecurringSavings);
  const cost = ex.oneTimeCosts + years * ex.recurringCosts;
  return {
    annualNet,
    upfront,
    paybackYears: annualNet > 0 ? (upfront > 0 ? upfront / annualNet : 0) : null,
    cumulativeNet: ex.netOneTime + years * annualNet,
    roiMultiple: cost > 0 ? benefit / cost : null,
    years,
  };
}

export function computePortfolio(projects: { factors: Factor[] }[]): PortfolioROI {
  const rois = projects.map(p => computeProjectROI(p.factors));
  return {
    netOneTime: rois.reduce((s, r) => s + r.netOneTime, 0),
    netRecurringAnnual: rois.reduce((s, r) => s + r.netRecurringAnnual, 0),
    grade: worstGrade(rois.map(r => r.grade)),
    openUnknowns: rois.reduce((s, r) => s + r.unknownRequiredKeys.length, 0),
  };
}
