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
  "notes_next_activity_date",
  "num_contacted_notes",
  "hs_ideal_customer_profile",
  "hs_is_target_account",
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
  /** Full task tree (story_type=task) — feeds the review-gated task import. */
  kantataTasks: Record<string, unknown>[];
  /**
   * Per-workspace hours AGGREGATED SERVER-SIDE from time entries. Only
   * minutes and dates cross the wire — bill/cost rates are stripped here,
   * never sent to the browser (no-financials rule).
   */
  kantataHours: Record<string, unknown>[];
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

/** One request, hard 8s cap, one retry on HubSpot's 429 rate limit. */
async function timedFetch(url: string, headers: Record<string, string>): Promise<Response> {
  const attempt = () => fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  let res = await attempt();
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 1100));
    res = await attempt();
  }
  return res;
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
    const res = await timedFetch(`${baseUrl}${after ? `&after=${encodeURIComponent(after)}` : ""}`, headers);
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

/**
 * CLIENTS ONLY via the Search API — the portal holds thousands of
 * prospects, and this is a delivery tool (ADR 0008): the directory is
 * companies that are customers OR carry a Client Abbreviation (AGP fills
 * that field only for real clients). Server-side filter, so the cap can't
 * silently truncate the client list the way an unfiltered walk did.
 */
async function pullHubSpotClients(
  headers: Record<string, string>,
  cap: number,
): Promise<{ rows: NonNullable<HubSpotPage["results"]>; pages: number }> {
  const rows: NonNullable<HubSpotPage["results"]> = [];
  let after: string | undefined;
  let pages = 0;
  while (rows.length < cap && pages < Math.ceil(cap / 100)) {
    const body: Record<string, unknown> = {
      filterGroups: [
        { filters: [{ propertyName: "lifecyclestage", operator: "EQ", value: "customer" }] },
        { filters: [{ propertyName: "client_abbreviation__c", operator: "HAS_PROPERTY" }] },
      ],
      properties: COMPANY_PROPERTIES,
      sorts: [{ propertyName: "name", direction: "ASCENDING" }],
      limit: 100,
      ...(after ? { after } : {}),
    };
    const res = await fetch("https://api.hubapi.com/crm/v3/objects/companies/search", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 1100));
      continue; // retry the same page
    }
    if (!res.ok) {
      if (pages === 0) throw new Error(`clients search HTTP ${res.status}`);
      break;
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
  const dealsUrl =
    `https://api.hubapi.com/crm/v3/objects/deals?limit=100&properties=${DEAL_PROPERTIES.join(",")}&associations=companies`;

  // Clients (filtered search) and deals walk in parallel.
  const [companiesResult, dealsResult] = await Promise.allSettled([
    pullHubSpotClients(headers, 1000),
    pullHubSpotPaged(dealsUrl, headers, 300),
  ]);
  if (companiesResult.status === "rejected") {
    throw new Error(`companies ${companiesResult.reason instanceof Error ? companiesResult.reason.message : "failed"}`);
  }
  const companies = companiesResult.value.rows.map((r) => ({ id: r.id, ...r.properties }));

  let deals: Record<string, unknown>[] = [];
  let note = `${companies.length} clients (customer/abbreviation only, ${companiesResult.value.pages} pages)`;
  if (dealsResult.status === "fulfilled") {
    deals = dealsResult.value.rows.map((r) => ({
      id: r.id,
      ...r.properties,
      company_id: r.associations?.companies?.results?.[0]?.id ?? null,
    }));
    note += ` + ${deals.length} deals`;
  } else {
    note += `; deals failed: ${dealsResult.reason instanceof Error ? dealsResult.reason.message : "unknown"} (check crm.objects.deals.read scope)`;
  }
  return { companies, deals, note };
}

async function pullKantata(token: string): Promise<{
  projects: Record<string, unknown>[];
  milestones: Record<string, unknown>[];
  tasks: Record<string, unknown>[];
  groups: Record<string, unknown>[];
  customFields: Record<string, unknown>[];
  hours: Record<string, unknown>[];
  note: string;
}> {
  const headers = { Authorization: `Bearer ${token}` };

  // Mavenlink pages are numbered, 200 rows max — walk until a short page or
  // the cap. First-page failure throws; later failures keep partial results.
  // `harvest` sees each raw page — used to collect side buckets (users) that
  // ride along with `include=` associations.
  const pullKantataPaged = async <T>(
    baseUrl: string,
    collection: string,
    cap: number,
    harvest?: (json: Record<string, unknown>) => void,
  ): Promise<T[]> => {
    const rows: T[] = [];
    for (let page = 1; rows.length < cap && page <= Math.ceil(cap / 200); page += 1) {
      const res = await timedFetch(`${baseUrl}&page=${page}`, headers);
      if (!res.ok) {
        if (page === 1) throw new Error(`${collection} HTTP ${res.status}`);
        break;
      }
      const json = (await res.json()) as Record<string, Record<string, T> | unknown>;
      harvest?.(json as Record<string, unknown>);
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
    participant_ids?: (string | number)[];
  };
  type KantataStory = { id: string; title?: string; workspace_id?: string | number; due_date?: string; state?: string };
  type KantataGroup = { id: string; name?: string; company?: string; workspace_ids?: (string | number)[] };
  type KantataCfv = { id: string; subject_id?: string | number; custom_field_name?: string; display_value?: string; value?: unknown };
  type KantataTimeEntry = { id: string; workspace_id?: string | number; user_id?: string | number; date_performed?: string; time_in_minutes?: number };

  // Users side-bucket harvested from `include=participants` — id → full name.
  const userNames = new Map<string, string>();
  const harvestUsers = (json: Record<string, unknown>): void => {
    const users = (json.users ?? {}) as Record<string, { full_name?: string }>;
    for (const [id, u] of Object.entries(users)) {
      if (u?.full_name) userNames.set(String(id), u.full_name);
    }
  };

  // All six endpoints walk in parallel — workspaces (+participants),
  // milestones, the full task tree, workspace groups (the client↔project
  // join, SPEC §7), custom-field taxonomy, and recent time entries. Each
  // degrades independently; only a workspaces failure is fatal.
  const [wsResult, storiesResult, tasksResult, groupsResult, cfvResult, hoursResult] = await Promise.allSettled([
    pullKantataPaged<KantataWorkspace>(
      "https://api.mavenlink.com/api/v1/workspaces?per_page=200&order=updated_at:desc&include=participants",
      "workspaces",
      1000,
      harvestUsers,
    ),
    pullKantataPaged<KantataStory>(
      "https://api.mavenlink.com/api/v1/stories?story_type=milestone&per_page=200&order=due_date:asc",
      "stories",
      600,
    ),
    pullKantataPaged<KantataStory>(
      "https://api.mavenlink.com/api/v1/stories?story_type=task&per_page=200&order=updated_at:desc",
      "stories",
      1000,
    ),
    pullKantataPaged<KantataGroup>(
      "https://api.mavenlink.com/api/v1/workspace_groups?per_page=200&include=workspaces",
      "workspace_groups",
      400,
    ),
    pullKantataPaged<KantataCfv>(
      "https://api.mavenlink.com/api/v1/custom_field_values?subject_type=Workspace&per_page=200",
      "custom_field_values",
      1000,
    ),
    pullKantataPaged<KantataTimeEntry>(
      "https://api.mavenlink.com/api/v1/time_entries?per_page=200&order=date_performed:desc",
      "time_entries",
      2000,
    ),
  ]);

  if (wsResult.status === "rejected") {
    throw new Error(wsResult.reason instanceof Error ? wsResult.reason.message : "workspaces failed");
  }
  const projects = wsResult.value
    .filter((w) => !w.archived)
    .map((w) => ({
      id: String(w.id),
      title: w.title ?? "",
      status: w.status?.message ?? "",
      start_date: w.start_date ?? "",
      due_date: w.due_date ?? "",
      updated_at: w.updated_at ?? "",
      // Real delivery team, resolved server-side from the participants join.
      participant_names: (w.participant_ids ?? [])
        .map((id) => userNames.get(String(id)))
        .filter((n): n is string => !!n),
      // service_line / vertical / commercial_model are AGP custom fields —
      // mapping them needs the tenant grounding doc (BLOCKERS #1).
    }));
  const notes: string[] = [`${projects.length} workspaces`, `${userNames.size} staff`];

  let milestones: Record<string, unknown>[] = [];
  if (storiesResult.status === "fulfilled") {
    milestones = storiesResult.value.map((s) => ({
      id: String(s.id),
      title: s.title ?? "",
      workspace_id: String(s.workspace_id ?? ""),
      due_date: s.due_date ?? "",
      state: s.state ?? "",
    }));
    notes.push(`${milestones.length} milestones`);
  } else {
    notes.push(storiesResult.reason instanceof Error ? storiesResult.reason.message : "milestones failed");
  }

  let tasks: Record<string, unknown>[] = [];
  if (tasksResult.status === "fulfilled") {
    tasks = tasksResult.value.map((s) => ({
      id: String(s.id),
      title: s.title ?? "",
      workspace_id: String(s.workspace_id ?? ""),
      due_date: s.due_date ?? "",
      state: s.state ?? "",
    }));
    notes.push(`${tasks.length} tasks`);
  } else {
    notes.push(tasksResult.reason instanceof Error ? tasksResult.reason.message : "tasks failed");
  }

  // Time entries aggregate per workspace HERE — minutes and dates only.
  // Rates/amounts on the raw entries never leave this function.
  let hours: Record<string, unknown>[] = [];
  if (hoursResult.status === "fulfilled") {
    const cutoff30 = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const byWs = new Map<string, { m30: number; m90: number; last: string; users30: Set<string> }>();
    for (const te of hoursResult.value) {
      const ws = String(te.workspace_id ?? "");
      if (!ws) continue;
      const date = (te.date_performed ?? "").slice(0, 10);
      const mins = Number(te.time_in_minutes) || 0;
      const agg = byWs.get(ws) ?? { m30: 0, m90: 0, last: "", users30: new Set<string>() };
      agg.m90 += mins;
      if (date >= cutoff30) {
        agg.m30 += mins;
        if (te.user_id) agg.users30.add(String(te.user_id));
      }
      if (date > agg.last) agg.last = date;
      byWs.set(ws, agg);
    }
    hours = [...byWs.entries()].map(([ws, a]) => ({
      workspace_id: ws,
      minutes_30d: a.m30,
      minutes_recent: a.m90,
      last_entry_date: a.last,
      people_30d: a.users30.size,
    }));
    notes.push(`${hoursResult.value.length} time entries`);
  } else {
    notes.push(hoursResult.reason instanceof Error ? hoursResult.reason.message : "time entries failed");
  }

  let groups: Record<string, unknown>[] = [];
  if (groupsResult.status === "fulfilled") {
    groups = groupsResult.value.map((g) => ({
      id: String(g.id),
      name: g.name ?? "",
      company: g.company ?? "",
      workspace_ids: (g.workspace_ids ?? []).map(String),
    }));
    notes.push(`${groups.length} groups`);
  } else {
    notes.push(groupsResult.reason instanceof Error ? groupsResult.reason.message : "groups failed");
  }

  let customFields: Record<string, unknown>[] = [];
  if (cfvResult.status === "fulfilled") {
    customFields = cfvResult.value.map((v) => ({
      subject_id: String(v.subject_id ?? ""),
      name: v.custom_field_name ?? "",
      value: v.display_value ?? (typeof v.value === "string" ? v.value : ""),
    }));
    notes.push(`${customFields.length} custom-field values`);
  } else {
    notes.push(cfvResult.reason instanceof Error ? cfvResult.reason.message : "custom fields failed");
  }

  return { projects, milestones, tasks, groups, customFields, hours, note: notes.join(" · ") };
}

import { requireAuth } from "./_lib/entraAuth.js";

export default async function handler(
  req: { method?: string; url?: string; headers?: Record<string, string | string[] | undefined> },
  res: {
    status: (code: number) => { json: (body: unknown) => void };
    setHeader: (k: string, v: string) => void;
  },
): Promise<void> {
  const auth = await requireAuth(typeof req.headers?.authorization === "string" ? req.headers.authorization : undefined);
  if (!auth.authorized) {
    res.status(auth.status).json(auth.body);
    return;
  }

  // ?fresh=1 (the Live pill's refresh) bypasses every cache layer.
  const fresh = /[?&]fresh=1/.test(req.url ?? "");
  res.setHeader("Cache-Control", fresh ? "no-store" : "s-maxage=300, stale-while-revalidate=600");
  if (!fresh && cache && Date.now() - cache.at < TTL_MS) {
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
    kantataTasks: [],
    kantataHours: [],
  };

  // Both sources pull in parallel — wall time is the slower source, not the sum.
  const [hubspotResult, kantataResult] = await Promise.allSettled([
    hubspotToken ? pullHubSpot(hubspotToken) : Promise.reject(new Error("token not set")),
    kantataToken ? pullKantata(kantataToken) : Promise.reject(new Error("token not set")),
  ]);

  if (hubspotToken) {
    if (hubspotResult.status === "fulfilled") {
      const h = hubspotResult.value;
      payload.companies = h.companies;
      payload.deals = h.deals;
      payload.sources.hubspot = { ok: true, note: h.note, companies: h.companies.length, deals: h.deals.length };
    } else {
      payload.sources.hubspot.note = `pull failed: ${hubspotResult.reason instanceof Error ? hubspotResult.reason.message : "unknown"}`;
    }
  }

  if (kantataToken) {
    if (kantataResult.status === "fulfilled") {
      const k = kantataResult.value;
      payload.kantataProjects = k.projects;
      payload.kantataMilestones = k.milestones;
      payload.kantataGroups = k.groups;
      payload.kantataCustomFields = k.customFields;
      payload.kantataTasks = k.tasks;
      payload.kantataHours = k.hours;
      payload.sources.kantata = { ok: true, note: k.note, projects: k.projects.length };
    } else {
      payload.sources.kantata.note = `pull failed: ${kantataResult.reason instanceof Error ? kantataResult.reason.message : "unknown"}`;
    }
  }

  payload.live = payload.sources.hubspot.ok || payload.sources.kantata.ok;
  cache = { at: Date.now(), payload };
  res.status(200).json(payload);
}
