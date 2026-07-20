/**
 * /api/mirror — the live Kantata + HubSpot pull, server-side on Vercel.
 *
 * Tokens (HUBSPOT_PRIVATE_APP_TOKEN, KANTATA_API_TOKEN) are read from env
 * and NEVER reach the browser; the tab app fetches this endpoint and maps
 * the raw payload into its mirror (apps/tab/src/workspace/liveMirror.ts).
 * Missing tokens or upstream failures degrade per-source — the app falls
 * back to bundled fixture data and says so in the header.
 *
 * Self-contained on purpose (no workspace imports): Vercel bundles this file
 * independently of the pnpm monorepo. The property list mirrors
 * services/sync/src/adapters/hubspotProperties.ts — change both together.
 * Least-privilege: no revenue fields, no contacts/PII (docs/hubspot-property-map.md).
 */

const COMPANY_PROPERTIES = [
  "name",
  "domain",
  "agp_industry",
  "industry",
  "lifecyclestage",
  "type",
  "ownername",
  "client_abbreviation__c",
  "client_health_index__c",
  "health_score_current_month",
  "renewal",
  "contract_start_date",
  "onboarding_date",
  "gdna_subscription_level",
  "gdna_client_type",
  "constituent_records_on_gdna",
  "hs_signals_summary",
  "hs_count_intent_signals_created_last_30_days",
  "hs_latest_intent_signal_occurred_at",
  "hs_last_sales_activity_type",
  "notes_last_contacted",
  "num_associated_deals",
  "hs_lastmodifieddate",
];

const DEAL_PROPERTIES = ["dealname", "dealstage", "pipeline", "closedate", "hs_lastmodifieddate"];

interface MirrorPayload {
  live: boolean;
  fetchedAt: string;
  sources: {
    hubspot: { ok: boolean; note: string; companies: number; deals: number };
    kantata: { ok: boolean; note: string; projects: number };
  };
  companies: Record<string, unknown>[];
  deals: Record<string, unknown>[];
  kantataProjects: Record<string, unknown>[];
  kantataMilestones: Record<string, unknown>[];
  kantataGroups: Record<string, unknown>[];
  kantataCustomFields: Record<string, unknown>[];
}

// Per-instance cache: previews are demo traffic; 5 minutes keeps upstream
// rate limits comfortable without staleness anyone would notice.
let cache: { at: number; payload: MirrorPayload } | null = null;
const TTL_MS = 5 * 60 * 1000;

interface HubSpotPage {
  results?: {
    id: string;
    properties: Record<string, unknown>;
    associations?: { companies?: { results?: { id: string }[] } };
  }[];
  paging?: { next?: { after?: string } };
}

/** Follow HubSpot's cursor pagination up to a cap — 100 rows per page is a
 * HubSpot API limit, NOT the size of AGP's book of business. */
async function pullHubSpotPaged(
  baseUrl: string,
  headers: Record<string, string>,
  cap: number,
): Promise<{ rows: NonNullable<HubSpotPage["results"]>; pages: number }> {
  const rows: NonNullable<HubSpotPage["results"]> = [];
  let after: string | undefined;
  let pages = 0;
  while (rows.length < cap && pages < Math.ceil(cap / 100)) {
    const res = await fetch(`${baseUrl}${after ? `&after=${encodeURIComponent(after)}` : ""}`, { headers });
    if (!res.ok) {
      if (pages === 0) throw new Error(`HTTP ${res.status}`);
      break; // partial result beats none
    }
    const json = (await res.json()) as HubSpotPage;
    rows.push(...(json.results ?? []));
    pages += 1;
    after = json.paging?.next?.after;
    if (!after) break;
  }
  return { rows: rows.slice(0, cap), pages };
}

async function pullHubSpot(token: string): Promise<{
  companies: Record<string, unknown>[];
  deals: Record<string, unknown>[];
  note: string;
}> {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const companiesUrl =
    `https://api.hubapi.com/crm/v3/objects/companies?limit=100&properties=${COMPANY_PROPERTIES.join(",")}`;
  const dealsUrl =
    `https://api.hubapi.com/crm/v3/objects/deals?limit=100&properties=${DEAL_PROPERTIES.join(",")}&associations=companies`;

  const companiesPull = await pullHubSpotPaged(companiesUrl, headers, 1000);
  const companies = companiesPull.rows.map((r) => ({ id: r.id, ...r.properties }));

  let deals: Record<string, unknown>[] = [];
  let note = `${companies.length} companies (${companiesPull.pages} pages)`;
  try {
    const dealsPull = await pullHubSpotPaged(dealsUrl, headers, 300);
    deals = dealsPull.rows.map((r) => ({
      id: r.id,
      ...r.properties,
      company_id: r.associations?.companies?.results?.[0]?.id ?? null,
    }));
    note += ` + ${deals.length} deals`;
  } catch (err) {
    note += `; deals failed: ${err instanceof Error ? err.message : "unknown"} (check crm.objects.deals.read scope)`;
  }
  return { companies, deals, note };
}

async function pullKantata(token: string): Promise<{
  projects: Record<string, unknown>[];
  milestones: Record<string, unknown>[];
  groups: Record<string, unknown>[];
  customFields: Record<string, unknown>[];
  note: string;
}> {
  const headers = { Authorization: `Bearer ${token}` };

  // Mavenlink pages are numbered, 200 rows max — walk until a short page or
  // the cap. First-page failure throws; later failures keep partial results.
  const pullKantataPaged = async <T>(baseUrl: string, collection: string, cap: number): Promise<T[]> => {
    const rows: T[] = [];
    for (let page = 1; rows.length < cap && page <= Math.ceil(cap / 200); page += 1) {
      const res = await fetch(`${baseUrl}&page=${page}`, { headers });
      if (!res.ok) {
        if (page === 1) throw new Error(`${collection} HTTP ${res.status}`);
        break;
      }
      const json = (await res.json()) as Record<string, Record<string, T> | unknown>;
      const batch = Object.values((json[collection] as Record<string, T>) ?? {});
      rows.push(...batch);
      if (batch.length < 200) break;
    }
    return rows.slice(0, cap);
  };

  type KantataWorkspace = {
    id: string;
    title?: string;
    status?: { message?: string };
    start_date?: string;
    due_date?: string;
    updated_at?: string;
    archived?: boolean;
  };
  const workspaces = await pullKantataPaged<KantataWorkspace>(
    "https://api.mavenlink.com/api/v1/workspaces?per_page=200&order=updated_at:desc",
    "workspaces",
    1000,
  );
  const projects = workspaces
    .filter((w) => !w.archived)
    .map((w) => ({
      id: String(w.id),
      title: w.title ?? "",
      status: w.status?.message ?? "",
      start_date: w.start_date ?? "",
      due_date: w.due_date ?? "",
      updated_at: w.updated_at ?? "",
      // service_line / vertical / commercial_model are AGP custom fields —
      // mapping them needs the tenant grounding doc (BLOCKERS #1).
    }));

  // Milestones, workspace groups (the REAL client↔project join per SPEC
  // constraint #7), and custom field values ("Service Line Detail" etc.).
  // Each degrades independently if the token lacks that endpoint.
  const notes: string[] = [`${projects.length} workspaces`];

  let milestones: Record<string, unknown>[] = [];
  try {
    type KantataStory = { id: string; title?: string; workspace_id?: string | number; due_date?: string; state?: string };
    const stories = await pullKantataPaged<KantataStory>(
      "https://api.mavenlink.com/api/v1/stories?story_type=milestone&per_page=200&order=due_date:asc",
      "stories",
      600,
    );
    milestones = stories.map((s) => ({
      id: String(s.id),
      title: s.title ?? "",
      workspace_id: String(s.workspace_id ?? ""),
      due_date: s.due_date ?? "",
      state: s.state ?? "",
    }));
    notes.push(`${milestones.length} milestones`);
  } catch (err) {
    notes.push(err instanceof Error ? err.message : "milestones failed");
  }

  let groups: Record<string, unknown>[] = [];
  try {
    type KantataGroup = { id: string; name?: string; company?: string; workspace_ids?: (string | number)[] };
    const rawGroups = await pullKantataPaged<KantataGroup>(
      "https://api.mavenlink.com/api/v1/workspace_groups?per_page=200&include=workspaces",
      "workspace_groups",
      400,
    );
    groups = rawGroups.map((g) => ({
      id: String(g.id),
      name: g.name ?? "",
      company: g.company ?? "",
      workspace_ids: (g.workspace_ids ?? []).map(String),
    }));
    notes.push(`${groups.length} groups`);
  } catch (err) {
    notes.push(err instanceof Error ? err.message : "groups failed");
  }

  let customFields: Record<string, unknown>[] = [];
  try {
    type KantataCfv = { id: string; subject_id?: string | number; custom_field_name?: string; display_value?: string; value?: unknown };
    const cfvs = await pullKantataPaged<KantataCfv>(
      "https://api.mavenlink.com/api/v1/custom_field_values?subject_type=Workspace&per_page=200",
      "custom_field_values",
      1000,
    );
    customFields = cfvs.map((v) => ({
      subject_id: String(v.subject_id ?? ""),
      name: v.custom_field_name ?? "",
      value: v.display_value ?? (typeof v.value === "string" ? v.value : ""),
    }));
    notes.push(`${customFields.length} custom-field values`);
  } catch (err) {
    notes.push(err instanceof Error ? err.message : "custom fields failed");
  }

  return { projects, milestones, groups, customFields, note: notes.join(" · ") };
}

import { requireAuth } from "./_lib/entraAuth.js";

export default async function handler(
  req: { method?: string; headers?: Record<string, string | string[] | undefined> },
  res: {
    status: (code: number) => { json: (body: unknown) => void };
    setHeader: (k: string, v: string) => void;
  },
): Promise<void> {
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
  const auth = await requireAuth(typeof req.headers?.authorization === "string" ? req.headers.authorization : undefined);
  if (!auth.authorized) {
    res.status(auth.status).json(auth.body);
    return;
  }

  if (cache && Date.now() - cache.at < TTL_MS) {
    res.status(200).json(cache.payload);
    return;
  }

  const hubspotToken = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  const kantataToken = process.env.KANTATA_API_TOKEN;

  const payload: MirrorPayload = {
    live: false,
    fetchedAt: new Date().toISOString(),
    sources: {
      hubspot: { ok: false, note: hubspotToken ? "" : "HUBSPOT_PRIVATE_APP_TOKEN not set", companies: 0, deals: 0 },
      kantata: { ok: false, note: kantataToken ? "" : "KANTATA_API_TOKEN not set", projects: 0 },
    },
    companies: [],
    deals: [],
    kantataProjects: [],
    kantataMilestones: [],
    kantataGroups: [],
    kantataCustomFields: [],
  };

  if (hubspotToken) {
    try {
      const h = await pullHubSpot(hubspotToken);
      payload.companies = h.companies;
      payload.deals = h.deals;
      payload.sources.hubspot = { ok: true, note: h.note, companies: h.companies.length, deals: h.deals.length };
    } catch (err) {
      payload.sources.hubspot.note = `pull failed: ${err instanceof Error ? err.message : "unknown"}`;
    }
  }

  if (kantataToken) {
    try {
      const k = await pullKantata(kantataToken);
      payload.kantataProjects = k.projects;
      payload.kantataMilestones = k.milestones;
      payload.kantataGroups = k.groups;
      payload.kantataCustomFields = k.customFields;
      payload.sources.kantata = { ok: true, note: k.note, projects: k.projects.length };
    } catch (err) {
      payload.sources.kantata.note = `pull failed: ${err instanceof Error ? err.message : "unknown"}`;
    }
  }

  payload.live = payload.sources.hubspot.ok || payload.sources.kantata.ok;
  cache = { at: Date.now(), payload };
  res.status(200).json(payload);
}
