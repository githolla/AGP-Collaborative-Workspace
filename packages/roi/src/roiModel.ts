// Per-product "ROI basis" — the intelligent, editable assumptions that build a
// project's ROI from what it actually replaces: named traditional SaaS products
// (cited, with pricing-page links) and the manual process it automates. Pure,
// no I/O. Rolls up into the engine's money factors.

export interface Comparable {
  name: string;    // traditional product replaced, e.g. "Tableau"
  url: string;     // pricing page (citation)
  annual: number;  // annual $ avoided
  basis: string;   // how it's derived, e.g. "$75/user/mo × 5 users"
}

export interface ManualTask {
  task: string;          // the manual way it's done today
  hoursPerWeek: number;
  people: number;
  rate: number;          // loaded $/hour
}

export interface RoiModel {
  summary: string;            // inferred "what it does"
  comparables: Comparable[];  // → license_avoidance (recurring saving)
  manual: ManualTask[];       // → time_saved_cashable (recurring saving)
  buildHours: number;         // → fully_loaded_build_cost (one-time)
  buildRate: number;
}

// 46 working weeks/yr — matches FactorRow's estimate helper.
export const WORK_WEEKS = 46;
export const manualAnnual = (t: ManualTask) => Math.round(t.hoursPerWeek * t.people * t.rate * WORK_WEEKS);

export interface RoiRollup {
  licenseAvoidance: number;
  timeSavedCashable: number;
  buildCost: number;
  humanInLoop: number;
}

export function rollup(m: RoiModel): RoiRollup {
  const licenseAvoidance = m.comparables.reduce((s, c) => s + c.annual, 0);
  const timeSavedCashable = m.manual.reduce((s, t) => s + manualAnnual(t), 0);
  return {
    licenseAvoidance,
    timeSavedCashable,
    buildCost: Math.round(m.buildHours * m.buildRate),
    // Conservative "almost works" residual: ~15% of the time it claims to save.
    humanInLoop: Math.round(timeSavedCashable * 0.15),
  };
}

// Minimal factor shape applyModel needs — compatible with both SeedFactor and FactorRow.
interface FactorLike {
  key: string;
  value: number | null;
  status: 'confirmed' | 'estimated' | 'unknown';
  confidence: 'A' | 'B' | 'C' | 'D' | null;
  evidence: string | null;
}

// Pre-fill the basis-derived factors as editable estimates.
export function applyModel<T extends FactorLike>(factors: T[], m: RoiModel): T[] {
  const r = rollup(m);
  const set = (f: T, value: number, evidence: string): T =>
    ({ ...f, value, status: 'estimated', confidence: 'C', evidence });
  return factors.map(f => {
    switch (f.key) {
      case 'license_avoidance':
        return set(f, r.licenseAvoidance, m.comparables.map(c => c.name).join(', ') || (f.evidence ?? ''));
      case 'time_saved_cashable':
        return set(f, r.timeSavedCashable, m.manual.map(t => t.task).join('; ') || (f.evidence ?? ''));
      case 'fully_loaded_build_cost':
        return set(f, r.buildCost, `${m.buildHours} hrs × $${m.buildRate}/hr`);
      case 'human_in_loop_residual':
        return set(f, r.humanInLoop, 'Verification/correction overhead (~15% of time saved)');
      default:
        return f;
    }
  });
}

// Curated comparables per product (Project Tracking keeps its bespoke factors).
// Pricing is representative public pricing — every figure is editable in-app.
const RATE = 100; // default loaded $/hr for build estimates
export const ROI_MODELS: Record<string, RoiModel> = {
  'client-health': {
    summary: 'Early-warning signals on client health and churn risk.',
    comparables: [
      { name: 'Gainsight', url: 'https://www.gainsight.com/customer-success/', annual: 60000, basis: 'CS platform, representative enterprise tier' },
      { name: 'ChurnZero', url: 'https://www.churnzero.com/', annual: 24000, basis: 'mid-market plan' },
    ],
    manual: [{ task: 'CSMs manually reviewing account signals', hoursPerWeek: 5, people: 2, rate: 90 }],
    buildHours: 220, buildRate: RATE,
  },
  'utilization-dashboard': {
    summary: 'Team utilization and capacity visibility.',
    comparables: [
      { name: 'Float', url: 'https://www.float.com/pricing', annual: 4500, basis: '$7.50/user/mo × 50 users' },
      { name: 'Runn', url: 'https://www.runn.io/pricing', annual: 6000, basis: 'resource-planning plan' },
    ],
    manual: [{ task: 'Ops compiling utilization spreadsheets', hoursPerWeek: 4, people: 1, rate: 90 }],
    buildHours: 160, buildRate: RATE,
  },
  'lead-response-personalization-engine': {
    summary: 'Personalizes lead responses to lift conversion.',
    comparables: [
      { name: 'Drift', url: 'https://www.drift.com/pricing/', annual: 30000, basis: 'conversational-marketing plan' },
      { name: '6sense', url: 'https://6sense.com/pricing/', annual: 60000, basis: 'ABM/intent, representative' },
    ],
    manual: [{ task: 'SDRs hand-personalizing outreach', hoursPerWeek: 6, people: 3, rate: 60 }],
    buildHours: 240, buildRate: RATE,
  },
  'sales-dashboard': {
    summary: 'Pipeline and sales performance dashboard.',
    comparables: [
      { name: 'Tableau', url: 'https://www.tableau.com/pricing', annual: 4500, basis: '$75/user/mo × 5 users' },
      { name: 'Salesforce CRM Analytics', url: 'https://www.salesforce.com/products/crm-analytics/pricing/', annual: 3000, basis: '$50/user/mo × 5 users' },
    ],
    manual: [{ task: 'Analyst compiling the weekly sales report', hoursPerWeek: 5, people: 1, rate: 90 }],
    buildHours: 150, buildRate: RATE,
  },
  'ai-task-resource-allocation-platform': {
    summary: 'Allocates tasks and resources across delivery teams.',
    comparables: [
      { name: 'Asana', url: 'https://asana.com/pricing', annual: 9000, basis: '$24.99/user/mo × 30 users' },
      { name: 'Kantata', url: 'https://www.kantata.com/', annual: 40000, basis: 'PSA suite, representative' },
    ],
    manual: [{ task: 'PMs manually scheduling and rebalancing work', hoursPerWeek: 6, people: 2, rate: 100 }],
    buildHours: 320, buildRate: RATE,
  },
  'smart-data': {
    summary: 'Taking SmartData work in-house from Abra.',
    comparables: [
      { name: 'Abra (agency data work)', url: 'https://www.alteryx.com/pricing', annual: 80000, basis: 'outsourced scope, representative' },
    ],
    manual: [{ task: 'Analysts manually preparing and reconciling data', hoursPerWeek: 10, people: 2, rate: 85 }],
    buildHours: 280, buildRate: RATE,
  },
  'mpr-input-engine': {
    summary: 'Monthly performance reporting input engine.',
    comparables: [
      { name: 'Power BI', url: 'https://www.microsoft.com/power-platform/products/power-bi/pricing', annual: 6000, basis: '$10/user/mo × 50 users' },
    ],
    manual: [{ task: 'Analysts assembling monthly performance inputs', hoursPerWeek: 8, people: 2, rate: 90 }],
    buildHours: 180, buildRate: RATE,
  },
  'ai-analytics-roi-framework': {
    summary: 'Analytics and ROI framework for AI initiatives.',
    comparables: [
      { name: 'Looker', url: 'https://cloud.google.com/looker/pricing', annual: 60000, basis: 'BI platform, representative' },
    ],
    manual: [{ task: 'Analysts building ROI analyses by hand', hoursPerWeek: 6, people: 2, rate: 95 }],
    buildHours: 200, buildRate: RATE,
  },
  'rtm-dashboard': {
    summary: 'Real-time metrics dashboard.',
    comparables: [
      { name: 'Power BI', url: 'https://www.microsoft.com/power-platform/products/power-bi/pricing', annual: 6000, basis: '$10/user/mo × 50 users' },
      { name: 'Tableau', url: 'https://www.tableau.com/pricing', annual: 4500, basis: '$75/user/mo × 5 users' },
    ],
    manual: [{ task: 'Ops refreshing metrics manually', hoursPerWeek: 5, people: 1, rate: 85 }],
    buildHours: 150, buildRate: RATE,
  },
  'ai-os-hub': {
    summary: 'The AI Operating Layer hub — entry point to the production apps.',
    comparables: [
      { name: 'Notion', url: 'https://www.notion.so/pricing', annual: 6000, basis: '$10/user/mo × 50 users' },
    ],
    manual: [{ task: 'Staff hunting across fragmented internal tools', hoursPerWeek: 2, people: 20, rate: 80 }],
    buildHours: 200, buildRate: RATE,
  },
  'ai-os-impact-agp': {
    summary: 'Tracks the ROI of every app in the portfolio.',
    comparables: [
      { name: 'Anaplan', url: 'https://www.anaplan.com/', annual: 50000, basis: 'planning/CPM, representative' },
    ],
    manual: [{ task: 'Finance building ROI decks by hand', hoursPerWeek: 6, people: 1, rate: 110 }],
    buildHours: 220, buildRate: RATE,
  },
  'audience-intelligence': {
    summary: 'Audience modeling and segmentation across campaigns.',
    comparables: [
      { name: 'Segment', url: 'https://segment.com/pricing/', annual: 15000, basis: 'CDP team plan, representative' },
      { name: '6sense', url: 'https://6sense.com/pricing/', annual: 60000, basis: 'audience/intent, representative' },
    ],
    manual: [{ task: 'Analysts building audience segments manually', hoursPerWeek: 6, people: 2, rate: 90 }],
    buildHours: 240, buildRate: RATE,
  },
  'cpm-dashboard': {
    summary: 'Corporate performance management dashboard for leadership.',
    comparables: [
      { name: 'Planful', url: 'https://www.planful.com/', annual: 45000, basis: 'CPM platform, representative' },
      { name: 'Power BI', url: 'https://www.microsoft.com/power-platform/products/power-bi/pricing', annual: 6000, basis: '$10/user/mo × 50 users' },
    ],
    manual: [{ task: 'FP&A consolidating performance data', hoursPerWeek: 8, people: 2, rate: 110 }],
    buildHours: 260, buildRate: RATE,
  },
  'pricing-engine': {
    summary: 'Recommends pricing to protect margin and speed quoting.',
    comparables: [
      { name: 'PROS', url: 'https://pros.com/', annual: 70000, basis: 'pricing optimization, representative' },
    ],
    manual: [{ task: 'Deal desk pricing quotes by hand', hoursPerWeek: 5, people: 2, rate: 100 }],
    buildHours: 220, buildRate: RATE,
  },
  'rfp-generator': {
    summary: 'Drafts and assembles RFP / proposal responses.',
    comparables: [
      { name: 'Loopio', url: 'https://www.loopio.com/', annual: 30000, basis: 'RFP software, representative' },
      { name: 'Responsive', url: 'https://www.responsive.io/', annual: 35000, basis: 'RFP platform, representative' },
    ],
    manual: [{ task: 'Team hand-writing proposal responses', hoursPerWeek: 8, people: 2, rate: 90 }],
    buildHours: 200, buildRate: RATE,
  },
  'ttm-dashboard': {
    summary: 'Time-to-market dashboard for delivery leadership.',
    comparables: [
      { name: 'Productboard', url: 'https://www.productboard.com/pricing/', annual: 9000, basis: '$25/user/mo × 30 users' },
    ],
    manual: [{ task: 'PMs tracking delivery timelines manually', hoursPerWeek: 4, people: 1, rate: 100 }],
    buildHours: 150, buildRate: RATE,
  },
};
