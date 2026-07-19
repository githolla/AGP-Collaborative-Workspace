# AGP ROI Calculator — Complete Specification

**Purpose of this document:** everything needed to reuse the Impact OS ROI calculator in another AGP product — as a build brief for a new workspace/collaboration site where the calculator is embedded in every product evaluation (new product builds and AI-added-to-existing-product initiatives).

**Reference implementation:** `shared/roiEngine.ts` and `shared/roiModel.ts` in `AllegianceGroup/agp-ai-roi-calculator` (also `githolla/AIROI`, branch `main`). The engine is pure TypeScript with **zero dependencies and no I/O** — the fastest way to reuse it is to copy those two files verbatim into the new project.

---

## 1. Design principles (the three guarantees)

The calculator is a **factor-based ROI engine**: each product/project is a list of typed *factors*, and one pure function computes ROI from whatever factors exist.

1. **The engine never errors on missing data.** A `null` factor value falls back to its `defaultValue`. The number is always computable, even with zero data entered.
2. **Unknowns are visible, not hidden.** Every factor carries a `status` (`confirmed | estimated | unknown`). Unknown numeric factors render as empty "NEED" fields; unknown categorical factors render as dropdowns showing the assumed default.
3. **Confidence reflects the unknowns.** If any *required* factor is unknown, the project's confidence grade is capped at C — the headline number can never claim A/B credibility while a required input is missing.

The same engine module is shared between client (live UI math) and server (persisted snapshots), so the number on screen and the number in the database are always identical.

---

## 2. The Factor data model

```ts
type FactorKind =
  | 'one_time_saving' | 'recurring_saving'
  | 'one_time_cost'   | 'recurring_cost'
  | 'adjustment'      | 'classification' | 'placeholder';

type Affects =
  | 'add_one_time' | 'sub_one_time'      // one-time money in / out
  | 'add_recurring' | 'sub_recurring'    // annual money in / out
  | 'multiply'                           // adjustment dial (haircut)
  | 'none';                              // tracked context, moves no money

type Unit = 'usd' | 'usd_per_year' | 'percent' | 'enum' | 'date';
type FactorStatus = 'confirmed' | 'estimated' | 'unknown';
type Grade = 'A' | 'B' | 'C' | 'D';

interface FactorOption { label: string; value: number; isDefault?: boolean; }

interface Factor {
  key: string;                  // stable identifier, e.g. 'license_avoidance'
  label: string;                // display name
  kind: FactorKind;
  affects: Affects;             // how it enters the math
  unit: Unit;
  value: number | null;         // entered value (null = not entered)
  defaultValue: number | null;  // conservative fallback
  status: FactorStatus;
  confidence: Grade | null;     // per-factor evidence quality
  options?: FactorOption[];     // for unit === 'enum'
  selectedOption?: string | null;
  required?: boolean;           // required+unknown caps the project grade
}
```

Extra per-factor metadata stored alongside (DB columns, not used by the math): `description`, `evidence` (what proof backs the number), `gather_owner` (who is responsible for getting the real value), `sort` (display order).

### Value resolution (the fallback rules)

How a factor becomes a number, in order:

- **Enum factors:** the option whose `label === selectedOption` → else the option with `isDefault: true` → else `defaultValue` → else `1` if the factor multiplies, `0` otherwise.
- **Numeric factors:** `value` if entered (non-null, non-NaN) → else `defaultValue` → else `1` if it multiplies, `0` otherwise.

This is what makes the engine total: every factor always resolves, unknowns just resolve conservatively.

---

## 3. The core math (`computeProjectROI`)

```
active            = factors excluding kind 'placeholder' and affects 'none'
adjustment        = product of all 'multiply' factor values          (dials, each in [0, 1+])
netOneTime        = round( Σ add_one_time × adjustment − Σ sub_one_time )
netRecurring/yr   = round( (Σ add_recurring − Σ sub_recurring) × adjustment )
```

Notes on the shape of the formula:

- The adjustment haircut applies to the **savings**, not the costs — one-time costs are subtracted at full value (you pay the whole build cost even if only 70% of savings land), and recurring is netted then multiplied.
- Multiple dials compound multiplicatively (0.9 × 0.75 = 0.675).
- Output is rounded to whole dollars.

### Confidence grade

```
grade = worst confidence grade among active factors (A best → D worst; no grades at all → C)
if any factor is required AND status==='unknown' AND no value AND no selectedOption:
    grade = capped at C (i.e. never A or B)
hasUnknowns = that condition, exposed as a boolean + the list of offending factor keys
```

Result object:

```ts
interface ProjectROI {
  netOneTime: number;
  netRecurringAnnual: number;
  adjustmentMultiplier: number;
  grade: Grade;
  hasUnknowns: boolean;
  unknownRequiredKeys: string[];   // drives the "numbers still to gather" list
}
```

---

## 4. The explanation decomposition (`explainProjectROI`)

Same resolution and rounding as the core function — the breakdown can never disagree with the headline number. Returns the pieces the UI charts/plain-language views need:

```ts
interface ROIExplanation {
  grossOneTimeSavings: number;    // Σ add_one_time, pre-haircut
  oneTimeCosts: number;           // Σ sub_one_time
  grossRecurringSavings: number;  // Σ add_recurring, pre-haircut
  recurringCosts: number;         // Σ sub_recurring
  adjustmentMultiplier: number;
  dials: { key, label, value }[]; // each multiply-factor individually (for a waterfall)
  netOneTime: number;
  netRecurringAnnual: number;
}
```

---

## 5. Executive decision metrics (`computeDecisionMetrics`)

Derived from the explanation, over a horizon of `years` (default **3**):

```
annualNet     = netRecurringAnnual
upfront       = oneTimeCosts
paybackYears  = upfront / annualNet          (0 if no upfront; null if annualNet ≤ 0 — "never pays back")
cumulativeNet = netOneTime + years × annualNet
benefit       = adjustment × (grossOneTimeSavings + years × grossRecurringSavings)
cost          = oneTimeCosts + years × recurringCosts
roiMultiple   = benefit / cost               (null if cost is 0)
```

These are the four numbers an exec decision card shows: **payback period, N-year cumulative net, ROI multiple, annual net**.

---

## 6. Portfolio rollup (`computePortfolio`)

Across all products/projects:

```
netOneTime          = Σ project netOneTime
netRecurringAnnual  = Σ project netRecurringAnnual
grade               = worst grade of any project     (portfolio is only as credible as its weakest number)
openUnknowns        = Σ count of required-unknown factors   (the "numbers still to gather" counter)
```

---

## 7. The standard factor template (12 factors)

This is the proven starter set applied to every project. It deliberately captures the benefit-**eroding** factors (build cost, human-in-the-loop tax, run cost, realism haircut) so naive math can't flatter a project. All defaults are $0 / conservative — a brand-new project starts at $0 ROI, grade C, and improves only as evidence lands.

| # | Key | Label | Kind | Affects | Unit | Required | Notes |
|---|---|---|---|---|---|---|---|
| 1 | `traditional_build_baseline` | Traditional-build cost avoided | one_time_saving | add_one_time | usd | — | Agency/contractor quote avoided |
| 2 | `license_avoidance` | License / SaaS avoided | recurring_saving | add_recurring | usd_per_year | — | Strongest line for finance; cite the replaced tool's invoice |
| 3 | `time_saved_cashable` | Time saved — cashable | recurring_saving | add_recurring | usd_per_year | ✅ | Only bankable savings (headcount/contractor avoidance, billable hours). Formula: hrs/wk × users × loaded rate |
| 4 | `error_revenue_value` | Error-cost avoidance / revenue impact | recurring_saving | add_recurring | usd_per_year | — | Needs a clear counterfactual |
| 5 | `fully_loaded_build_cost` | Fully-loaded build cost | one_time_cost | sub_one_time | usd | ✅ | Builder hrs × loaded rate + AI tooling + infra |
| 6 | `human_in_loop_residual` | Human-in-the-loop residual ("almost works" tax) | recurring_cost | sub_recurring | usd_per_year | ✅ | Verification/correction hours. The #1 way internal AI tools quietly lose money — tracked explicitly |
| 7 | `run_maintenance_cost` | Run & maintenance cost | recurring_cost | sub_recurring | usd_per_year | — | Infra + licenses + babysitting hours |
| 8 | `realism` | Realism | adjustment | multiply | enum | — | One honest haircut: Conservative 0.5 / **Realistic 0.7 (default)** / Optimistic 0.9. Covers adoption, ramp, partial realization, integration friction in one dial instead of stacking several |
| 9 | `adoption` | Adoption / active usage | placeholder | none | percent | — | Context metric — informs the realism call, moves no money |
| 10 | `integration_depth` | Integration depth | classification | none | enum | — | Connected / Partial / Isolated island (default). Context only |
| 11 | `time_to_working_tool` | Time-to-working-tool vs baseline | placeholder | none | percent | — | The headline vibe-coding advantage, captured deliberately |
| 12 | `reusability` | Reusability / leverage | classification | none | enum | — | One-off (default) / Reusable component / Template-platform |

An alternative richer dial (used in the original cost-out template) is `realization`: High 0.9 / **Medium 0.75 (default)** / Conservative 0.55.

**Important convention:** a dollar is never counted twice. If a paid tool (e.g. Kantata) is replaced by a project, its avoidance is a *factor inside that project*, never a separate project.

---

## 8. The ROI basis layer (`roiModel.ts`) — cited, editable assumptions

Sitting above the raw factors is an "ROI basis" per product that *derives* the money factors from real-world citations, so every number traces to something checkable:

```ts
interface Comparable { name: string; url: string; annual: number; basis: string; }
  // e.g. { name: 'Tableau', url: '<pricing page>', annual: 4500, basis: '$75/user/mo × 5 users' }

interface ManualTask { task: string; hoursPerWeek: number; people: number; rate: number; }
  // rate = loaded $/hour

interface RoiModel {
  summary: string;           // what the product does
  comparables: Comparable[]; // traditional SaaS it replaces
  manual: ManualTask[];      // the manual process it automates
  buildHours: number;
  buildRate: number;         // default $100/hr loaded
}
```

Rollup rules (constants matter — keep them):

```
WORK_WEEKS = 46                                    // working weeks per year
manualAnnual(t)     = hoursPerWeek × people × rate × 46
licenseAvoidance    = Σ comparable.annual
timeSavedCashable   = Σ manualAnnual(task)
buildCost           = buildHours × buildRate
humanInLoop         = 15% of timeSavedCashable     // conservative "almost works" residual
```

`applyModel()` writes these into the four matching factors (`license_avoidance`, `time_saved_cashable`, `fully_loaded_build_cost`, `human_in_loop_residual`) as **status `estimated`, confidence C**, with the citation text stored as `evidence`. Every figure remains editable in-app — the basis pre-fills, it doesn't lock.

---

## 9. UI behavior rules (how factors render and update)

- **`usd` / `usd_per_year`** → `$` number input. Empty → amber **NEED** pill + greyed "assuming $X" hint showing the default in use. On input: set `value`, flip `status` to `estimated`, recompute.
- **`enum`** → dropdown of `options`, default option preselected and labeled "(default)". On change: set `selectedOption`, recompute.
- **`percent`** → number input or slider.
- **`placeholder`** → disabled control with an "Once live" tag.
- Every factor shows a **status chip**: confirmed = green, estimated = blue, unknown = amber; plus a confidence letter where set.
- **Confirmed factors are visually locked** (green); only their `evidence` remains editable.
- Every change calls the shared engine **immediately** for instant UI feedback, then persists + writes a snapshot in the background.
- Each project card has an expandable **"what we need to gather"** list built from each unknown factor's `evidence` + `gather_owner`.
- A live portfolio counter shows total `required && unknown` factors ("numbers still to gather").
- Brand colors: navy `#0b3c6e`, cyan `#4fb8e0`, green `#1f9d6b` (confirmed), amber `#d8932f` (needs data).

---

## 10. Persistence (audit trail)

On any factor change: recompute → insert a **snapshot** row. The snapshot stores `net_one_time`, `net_recurring_annual`, `adjustment_multiplier`, `confidence_grade`, `has_unknowns`, and — critically — an `inputs` JSON blob of the exact factor values used. That's the provenance trail when numbers go in front of finance.

Minimal tables: `projects` (id, name, notes, sort, …) · `factors` (all Factor fields + project_id, evidence, gather_owner, sort) · `roi_snapshots` (fields above + computed_at). New products and new factors are **rows, not schema changes**.

---

## 11. How to embed it in the new workspace

1. **Copy `shared/roiEngine.ts` (and optionally `roiModel.ts`) unchanged.** Pure functions, no deps — they work in any TS/JS app, client or server.
2. Give every product in the workspace a factor list, seeded from the 12-factor template (§7).
3. For "add AI to an existing product" initiatives, the same template applies directly — `license_avoidance` becomes tooling consolidated/avoided, `time_saved_cashable` the workflow hours the AI removes, `human_in_loop_residual` the verification tax of the AI feature, `fully_loaded_build_cost` the AI integration build.
4. Wire the three calls: `computeProjectROI` per product (headline + grade), `explainProjectROI` (breakdown/waterfall), `computeDecisionMetrics` (exec card), `computePortfolio` (workspace rollup).
5. Keep the acceptance invariant: **with zero data entered, every product shows $0 / grade ≤ C and a correct "still to gather" count — and the numbers tighten automatically as real values are entered.**
