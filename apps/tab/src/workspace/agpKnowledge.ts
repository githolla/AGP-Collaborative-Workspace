import { hubspotSeed, kantataSeed } from "@agp/sync/fixtures";

/**
 * The AGP knowledge base the sandbox copilot reasons over:
 * - org structure (people, functions, teams, routing) shaped by AGP's known
 *   structure — PM team as daily operators, Data Solutions & Campaign
 *   Deployment as the dispatch-managed hub, in-house print/mail production,
 *   Beaconfire web/app heritage, GivingDNA product team;
 * - a tool catalog and manual-process patterns per domain;
 * - service-line / vertical taxonomy with detection keywords;
 * - clients, projects, and campaigns read from the Kantata/HubSpot mirror
 *   (fixtures today; the live sync replaces the data source, not the shape).
 *
 * Curated data, deterministic matching — every suggestion carries a "because".
 * The real org chart seed (BLOCKERS #2) replaces the people list on arrival.
 */

export type AgpFunction =
  | "project_management"
  | "creative"
  | "data_solutions"
  | "analytics"
  | "digital_fundraising"
  | "web_development"
  | "production"
  | "business_development"
  | "product_givingdna";

export interface AgpPerson {
  id: string;
  name: string;
  title: string;
  fn: AgpFunction;
  team: string;
  entity: "PG Agency" | "PG Software" | "PG Ops" | "Staff";
  /** Dispatch-managed teams route through the manager, never direct invites. */
  routing: "direct" | "via_manager";
  managerId?: string;
}

export const AGP_PEOPLE: AgpPerson[] = [
  { id: "u-501", name: "Dana Whitfield", title: "Creative Director", fn: "creative", team: "Brand & Creative", entity: "PG Agency", routing: "direct" },
  { id: "u-502", name: "Marcus Okafor", title: "Digital Strategist", fn: "digital_fundraising", team: "Digital Fundraising", entity: "PG Agency", routing: "direct" },
  { id: "u-503", name: "Priya Raman", title: "Senior Project Manager", fn: "project_management", team: "PM Team", entity: "PG Agency", routing: "direct" },
  { id: "u-504", name: "Tom Alvarez", title: "Data Analyst", fn: "analytics", team: "Analytics", entity: "PG Agency", routing: "direct" },
  { id: "u-505", name: "Grace Liu", title: "Production Manager", fn: "production", team: "Print & Mail Production", entity: "PG Ops", routing: "via_manager" },
  { id: "u-506", name: "Elena Vasquez", title: "AVP, Project Management", fn: "project_management", team: "PM Team", entity: "PG Agency", routing: "direct" },
  { id: "u-507", name: "Sam Whitfield", title: "Director, Business Development", fn: "business_development", team: "Growth", entity: "Staff", routing: "direct" },
  { id: "u-508", name: "Jordan Lee", title: "Manager, Campaign Deployment", fn: "data_solutions", team: "Data Solutions & Campaign Deployment", entity: "PG Agency", routing: "direct" },
  { id: "u-509", name: "Aisha Bello", title: "Campaign Deployment Specialist", fn: "data_solutions", team: "Data Solutions & Campaign Deployment", entity: "PG Agency", routing: "via_manager", managerId: "u-508" },
  { id: "u-510", name: "Chris Novak", title: "Lead Engineer (Beaconfire)", fn: "web_development", team: "Web & AI Development", entity: "PG Software", routing: "direct" },
  { id: "u-511", name: "Maya Patel", title: "Product Manager, GivingDNA", fn: "product_givingdna", team: "GivingDNA", entity: "PG Software", routing: "direct" },
  { id: "u-512", name: "Rob Chen", title: "Analytics Director", fn: "analytics", team: "Analytics", entity: "PG Agency", routing: "direct" },
];

export function personById(id: string): AgpPerson | undefined {
  return AGP_PEOPLE.find((p) => p.id === id);
}

/** Which functions a build needs, per domain — builder, operator, reviewer. */
export const FUNCTION_NOTES: Record<AgpFunction, string> = {
  project_management: "the PM team runs daily delivery — pilot persona for every internal tool",
  creative: "owns concepting and brand voice",
  data_solutions: "the campaign-deployment hub — nearly every campaign routes through this team (dispatch-managed)",
  analytics: "owns measurement, reporting, and donor analysis",
  digital_fundraising: "owns email/automation and digital campaign strategy",
  web_development: "Beaconfire heritage — builds web/app/AI product",
  production: "in-house print/mail facility — scheduled as capacity, routed via the production manager",
  business_development: "owns proposals, pricing, and growth",
  product_givingdna: "owns the GivingDNA product surface",
};

// ---------------------------------------------------------------------------
// Taxonomy + detection keywords
// ---------------------------------------------------------------------------

export interface KeywordEntry {
  key: string;
  label: string;
  keywords: string[];
}

export const SERVICE_LINES: KeywordEntry[] = [
  { key: "direct_mail", label: "Direct mail", keywords: ["mail", "print", "package", "postage", "in-home", "appeal letter"] },
  { key: "digital_fundraising", label: "Digital fundraising", keywords: ["email", "digital", "online giving", "sustainer", "automation", "sms"] },
  { key: "analytics", label: "Analytics", keywords: ["report", "reporting", "dashboard", "analytics", "analysis", "metrics", "kpi"] },
  { key: "brand_creative", label: "Brand & creative", keywords: ["creative", "brand", "design", "copy", "concept"] },
  { key: "web_ai_development", label: "Web & AI development", keywords: ["web", "app", "website", "portal", "ai ", "automation tool", "integration"] },
  { key: "mid_major_gifts", label: "Mid/major gifts", keywords: ["major gift", "mid-level", "wealth", "grateful patient", "portfolio"] },
  { key: "givingdna", label: "GivingDNA", keywords: ["givingdna", "donor analytics", "segmentation", "donor data"] },
  { key: "advertising_media", label: "Advertising & media", keywords: ["media buy", "advertising", "paid media", "ads"] },
];

export const VERTICALS: KeywordEntry[] = [
  { key: "food_banks", label: "Food banks", keywords: ["food bank", "hunger", "meals"] },
  { key: "public_media", label: "Public media", keywords: ["public media", "pledge", "station", "npr", "pbs"] },
  { key: "hospitals", label: "Hospitals", keywords: ["hospital", "health", "patient", "medical"] },
  { key: "faith_based", label: "Faith-based", keywords: ["faith", "church", "ministry", "parish"] },
  { key: "arts_culture", label: "Arts & culture", keywords: ["museum", "arts", "theater", "orchestra"] },
  { key: "environment", label: "Environment & animal welfare", keywords: ["environment", "climate", "animal", "wildlife"] },
  { key: "associations", label: "Associations", keywords: ["association", "member", "membership"] },
];

// ---------------------------------------------------------------------------
// Tool catalog + manual-process patterns (drive the ROI basis draft)
// ---------------------------------------------------------------------------

export interface ToolPattern {
  keywords: string[];
  name: string;
  url: string;
  annual: number;
  basis: string;
}

/** Representative public pricing — every figure stays editable (spec §8). */
export const TOOL_CATALOG: ToolPattern[] = [
  { keywords: ["proposal", "rfp", "pitch"], name: "Loopio", url: "https://www.loopio.com/", annual: 30_000, basis: "RFP software, representative" },
  { keywords: ["proposal", "rfp"], name: "Responsive", url: "https://www.responsive.io/", annual: 35_000, basis: "RFP platform, representative" },
  { keywords: ["report", "reporting", "dashboard", "metrics"], name: "Power BI (authoring seats)", url: "https://www.microsoft.com/power-platform/products/power-bi/pricing", annual: 6_000, basis: "$10/user/mo × 50 users" },
  { keywords: ["dashboard", "visualization"], name: "Tableau", url: "https://www.tableau.com/pricing", annual: 4_500, basis: "$75/user/mo × 5 users" },
  { keywords: ["dedupe", "data quality", "data prep", "reconcil"], name: "Alteryx-class data prep", url: "https://www.alteryx.com/pricing", annual: 30_000, basis: "designer seats, representative" },
  { keywords: ["client health", "churn", "retention risk"], name: "ChurnZero", url: "https://www.churnzero.com/", annual: 24_000, basis: "mid-market plan" },
  { keywords: ["schedule", "allocation", "resourc", "capacity"], name: "Runn", url: "https://www.runn.io/pricing", annual: 6_000, basis: "resource-planning plan" },
  { keywords: ["segment", "audience", "donor analytics"], name: "Segment-class CDP", url: "https://segment.com/pricing/", annual: 15_000, basis: "CDP team plan, representative" },
  { keywords: ["grant", "compliance report"], name: "Instrumentl-class grant tooling", url: "https://www.instrumentl.com/pricing", annual: 7_200, basis: "$600/mo team plan, representative" },
];

export interface ProcessPattern {
  keywords: string[];
  task: string;
  hoursPerWeek: number;
  people: number;
  rate: number;
  why: string;
  /** Functions this work touches — drives the cast suggestion. */
  functions: AgpFunction[];
  buildHours: number;
}

export const PROCESS_PATTERNS: ProcessPattern[] = [
  {
    keywords: ["proposal", "rfp", "pitch"],
    task: "Team hand-writing proposal responses from scratch",
    hoursPerWeek: 8, people: 2, rate: 90,
    why: "typical AGP proposal cycle: BD + creative assembling responses weekly",
    functions: ["business_development", "creative", "project_management"],
    buildHours: 200,
  },
  {
    keywords: ["report", "reporting", "dashboard", "metrics", "kpi"],
    task: "Analysts assembling recurring reports by hand",
    hoursPerWeek: 6, people: 2, rate: 90,
    why: "typical AGP analytics reporting load per recurring deliverable",
    functions: ["analytics", "data_solutions", "project_management"],
    buildHours: 180,
  },
  {
    keywords: ["grant", "compliance"],
    task: "Client program teams assembling grant/compliance reports manually",
    hoursPerWeek: 4, people: 3, rate: 75,
    why: "program-officer reporting cycles observed across nonprofit clients",
    functions: ["analytics", "product_givingdna", "project_management"],
    buildHours: 220,
  },
  {
    keywords: ["dedupe", "data quality", "clean", "reconcil", "donor data"],
    task: "Analysts manually preparing, deduping, and reconciling donor data",
    hoursPerWeek: 10, people: 2, rate: 85,
    why: "manual data-prep load typical of multi-CRM nonprofit clients",
    functions: ["data_solutions", "analytics", "web_development"],
    buildHours: 280,
  },
  {
    keywords: ["email", "campaign deploy", "automation", "journey"],
    task: "Deployment team hand-building campaign sends and QA",
    hoursPerWeek: 6, people: 2, rate: 80,
    why: "campaign deployment is AGP's widest-collaboration hub — per-campaign hand-work adds up",
    functions: ["data_solutions", "digital_fundraising", "project_management"],
    buildHours: 200,
  },
  {
    keywords: ["schedule", "allocation", "resourc", "capacity", "staffing"],
    task: "PMs manually scheduling and rebalancing work across teams",
    hoursPerWeek: 6, people: 2, rate: 100,
    why: "PM team's weekly rebalancing ritual",
    functions: ["project_management", "production"],
    buildHours: 240,
  },
  {
    keywords: ["mail", "print", "production", "in-home"],
    task: "Production coordinating print/mail schedules by spreadsheet and email",
    hoursPerWeek: 5, people: 2, rate: 75,
    why: "in-house print/mail facility runs on hard dates — coordination is manual today",
    functions: ["production", "project_management", "data_solutions"],
    buildHours: 220,
  },
  {
    keywords: ["segment", "audience", "wealth", "major gift", "portfolio"],
    task: "Analysts building donor segments and portfolios manually",
    hoursPerWeek: 6, people: 2, rate: 90,
    why: "segmentation requests route through analytics for nearly every campaign",
    functions: ["analytics", "product_givingdna", "digital_fundraising"],
    buildHours: 240,
  },
];

// ---------------------------------------------------------------------------
// Mirror context (fixtures today; live sync later)
// ---------------------------------------------------------------------------

export interface MirrorProject {
  id: string;
  title: string;
  serviceLine: string;
  vertical: string;
  model: string;
}

export interface MirrorCampaign {
  id: string;
  title: string;
  clientName: string;
  stage: string;
  kind: "deal" | "engagement";
}

export interface MirrorClient {
  id: string;
  name: string;
  vertical: string;
}

export interface AgpMirror {
  clients: MirrorClient[];
  projects: MirrorProject[];
  campaigns: MirrorCampaign[];
}

export function loadMirror(): AgpMirror {
  const k = kantataSeed().entities;
  const h = hubspotSeed().entities;
  const clients: MirrorClient[] = (h.company ?? []).map((c) => ({
    id: String(c.id),
    name: String(c.name),
    vertical: String(c.vertical),
  }));
  const nameOf = (id: unknown) => clients.find((c) => c.id === String(id))?.name ?? "";
  return {
    clients,
    projects: (k.workspace ?? []).map((w) => ({
      id: String(w.id),
      title: String(w.title),
      serviceLine: String(w.service_line),
      vertical: String(w.vertical),
      model: String(w.commercial_model),
    })),
    campaigns: [
      ...(h.deal ?? []).map((d) => ({
        id: String(d.id),
        title: String(d.dealname),
        clientName: nameOf(d.company_id),
        stage: String(d.dealstage),
        kind: "deal" as const,
      })),
      ...(h.engagement ?? []).map((e) => ({
        id: String(e.id),
        title: String(e.subject),
        clientName: nameOf(e.company_id),
        stage: String(e.engagement_type),
        kind: "engagement" as const,
      })),
    ],
  };
}
