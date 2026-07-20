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
}

// Per-instance cache: previews are demo traffic; 5 minutes keeps upstream
// rate limits comfortable without staleness anyone would notice.
let cache: { at: number; payload: MirrorPayload } | null = null;
const TTL_MS = 5 * 60 * 1000;

async function pullHubSpot(token: string): Promise<{
  companies: Record<string, unknown>[];
  deals: Record<string, unknown>[];
  note: string;
}> {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const companiesUrl =
    `https://api.hubapi.com/crm/v3/objects/companies?limit=100&properties=${COMPANY_PROPERTIES.join(",")}`;
  const dealsUrl =
    `https://api.hubapi.com/crm/v3/objects/deals?limit=50&properties=${DEAL_PROPERTIES.join(",")}&associations=companies`;

  const [companiesRes, dealsRes] = await Promise.all([fetch(companiesUrl, { headers }), fetch(dealsUrl, { headers })]);
  if (!companiesRes.ok) throw new Error(`companies HTTP ${companiesRes.status}`);
  const companiesJson = (await companiesRes.json()) as { results?: { id: string; properties: Record<string, unknown> }[] };
  const companies = (companiesJson.results ?? []).map((r) => ({ id: r.id, ...r.properties }));

  let deals: Record<string, unknown>[] = [];
  let note = "companies ok";
  if (dealsRes.ok) {
    const dealsJson = (await dealsRes.json()) as {
      results?: {
        id: string;
        properties: Record<string, unknown>;
        associations?: { companies?: { results?: { id: string }[] } };
      }[];
    };
    deals = (dealsJson.results ?? []).map((r) => ({
      id: r.id,
      ...r.properties,
      company_id: r.associations?.companies?.results?.[0]?.id ?? null,
    }));
    note = "companies + deals ok";
  } else {
    note = `companies ok; deals HTTP ${dealsRes.status} (check crm.objects.deals.read scope)`;
  }
  return { companies, deals, note };
}

async function pullKantata(token: string): Promise<{ projects: Record<string, unknown>[]; note: string }> {
  const res = await fetch("https://api.mavenlink.com/api/v1/workspaces?per_page=50&order=updated_at:desc", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`workspaces HTTP ${res.status}`);
  const json = (await res.json()) as { workspaces?: Record<string, { id: string; title?: string; status?: { message?: string }; updated_at?: string; archived?: boolean }> };
  const projects = Object.values(json.workspaces ?? {}).map((w) => ({
    id: String(w.id),
    title: w.title ?? "",
    status: w.status?.message ?? "",
    archived: Boolean(w.archived),
    updated_at: w.updated_at ?? "",
    // service_line / vertical / commercial_model are AGP custom fields —
    // mapping them needs the tenant grounding doc (BLOCKERS #1).
  }));
  return { projects, note: "workspaces ok (custom fields await tenant grounding doc)" };
}

export default async function handler(
  _req: { method?: string },
  res: {
    status: (code: number) => { json: (body: unknown) => void };
    setHeader: (k: string, v: string) => void;
  },
): Promise<void> {
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");

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
      payload.sources.kantata = { ok: true, note: k.note, projects: k.projects.length };
    } catch (err) {
      payload.sources.kantata.note = `pull failed: ${err instanceof Error ? err.message : "unknown"}`;
    }
  }

  payload.live = payload.sources.hubspot.ok || payload.sources.kantata.ok;
  cache = { at: Date.now(), payload };
  res.status(200).json(payload);
}
