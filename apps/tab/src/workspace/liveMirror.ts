import { setMirrorOverride, type AgpMirror, type MirrorClient } from "./agpKnowledge.js";
import { autoAbbreviation } from "./campaignImport.js";

/**
 * Live mirror: the browser-side half of /api/mirror. On boot the app asks
 * the serverless endpoint for the live Kantata + HubSpot pull; when it
 * answers, the knowledge-base mirror is overridden with real data (and
 * cached in localStorage so reloads start warm). When the endpoint or the
 * tokens are absent — local dev, keys not configured — the app keeps its
 * bundled fixture mirror and says so honestly in the header.
 */

export interface LiveStatus {
  live: boolean;
  /** Short human line for the header, e.g. "Live · 42 clients · 12 projects". */
  label: string;
  /** Longer detail for tooltips/logs. */
  detail: string;
  fetchedAt?: string;
}

export interface RawMirrorPayload {
  live: boolean;
  fetchedAt: string;
  sources: {
    hubspot: { ok: boolean; note: string; companies: number; deals: number };
    kantata: { ok: boolean; note: string; projects: number };
  };
  companies: Record<string, unknown>[];
  deals: Record<string, unknown>[];
  kantataProjects: Record<string, unknown>[];
  kantataMilestones?: Record<string, unknown>[];
  kantataGroups?: Record<string, unknown>[];
  kantataCustomFields?: Record<string, unknown>[];
  kantataTasks?: Record<string, unknown>[];
  kantataHours?: Record<string, unknown>[];
}

const CACHE_KEY = "agp-live-mirror-v1";
/**
 * Bump whenever the payload shape or matching logic changes — a cached
 * pre-upgrade payload (no groups, one 100-row page) must be discarded, not
 * trusted. This is exactly what bit the first live deploys.
 */
const CACHE_SCHEMA = 7; // 7: milestone pull windowed around today + focus deepen — pre-7 caches carry the wrong milestone slice

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Kantata-only client derivation (ADR 0008 addendum): AGP's other systems
 * run on Kantata data alone, and the client is encoded in conventions —
 * a title prefix ("ARMS: Support 25-26"), a full-name title ("Harvest Hope
 * Food Bank — Fall Mail"), or a group carrying a company name. Every
 * derived client is active by construction: it exists because live
 * projects reference it.
 */
function deriveClientsFromKantata(p: RawMirrorPayload): MirrorClient[] {
  const byKey = new Map<string, MirrorClient>();
  const normKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const add = (name: string, abbreviation: string | undefined, vertical: string) => {
    const key = normKey(name);
    if (!key || key.length < 2) return;
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.vertical && vertical) existing.vertical = vertical;
      if (!existing.abbreviation && abbreviation) existing.abbreviation = abbreviation;
      return;
    }
    byKey.set(key, {
      id: `k-${key.replace(/\s+/g, "-")}`,
      name,
      vertical,
      lifecycleStage: "customer",
      ...(abbreviation ? { abbreviation } : {}),
    });
  };
  const verticalFor = (workspaceId: string) => {
    const fieldsFor = (p.kantataCustomFields ?? []).filter((f) => String(f.subject_id) === workspaceId);
    return str(fieldsFor.find((f) => /vertical|industry/i.test(str(f.name)))?.value);
  };

  // PRIMARY: workspace groups that are client records. The tenant census
  // proved groups carry company/contact_name/email — those ARE clients
  // (the bare-named ones are service categories and are skipped).
  for (const g of p.kantataGroups ?? []) {
    const isClientRecord = str(g.company) || str(g.contact_name) || str(g.email);
    if (!isClientRecord) continue;
    const name = str(g.company) || str(g.name);
    const firstWs = Array.isArray(g.workspace_ids) ? String((g.workspace_ids as unknown[])[0] ?? "") : "";
    // A legal-name client ("American Water Works Company, Inc.") gets a clean
    // acronym ("AWW") so projects titled "AWW: …" auto-match — otherwise it
    // can only be linked by hand.
    add(name, autoAbbreviation(name), firstWs ? verticalFor(firstWs) : "");
  }

  // SECONDARY: title conventions for projects no client group covers.
  const covered = new Set<string>();
  for (const g of p.kantataGroups ?? []) {
    if (!(str(g.company) || str(g.contact_name) || str(g.email))) continue;
    for (const id of Array.isArray(g.workspace_ids) ? (g.workspace_ids as unknown[]).map(String) : []) covered.add(id);
  }
  for (const w of p.kantataProjects) {
    const id = String(w.id);
    if (covered.has(id)) continue;
    // Leading project codes ("25-031 Syracuse Fall") aren't client identity —
    // strip them before parsing conventions.
    const title = str(w.title).replace(/^\s*\d[\d.-]*\s+/, "");
    const vertical = verticalFor(id);
    // Abbreviation prefix — "ARMS: Support 25-26".
    const prefix = /^\s*([A-Z][A-Za-z0-9&'.]{1,14}):\s+/.exec(title);
    if (prefix?.[1]) {
      add(prefix[1], prefix[1], vertical);
      continue;
    }
    // Client name before a separator: em/en dash, spaced hyphen, or pipe.
    const dash = title.split(/\s+[—–|]\s+|\s+-\s+/);
    if (dash.length >= 2 && (dash[0]?.trim().length ?? 0) >= 4) {
      add(dash[0]!.trim(), undefined, vertical);
      continue;
    }
    // ALL active clients, no project left behind: a title that follows no
    // convention becomes its own entry, verbatim. Ugly beats invisible —
    // every live project is reachable from the picker, and hand-linking
    // (Project Finder) consolidates these under real clients over time.
    if (title.trim().length >= 4) add(title.trim(), undefined, vertical);
  }
  return [...byKey.values()];
}

/** Pure mapping: raw /api/mirror payload → the AgpMirror the Copilot grounds on. */
export function mapLivePayload(p: RawMirrorPayload): AgpMirror {
  const mappedCompanies: MirrorClient[] = p.companies
    .filter((c) => str(c.name).trim().length > 0)
    .map((c) => ({
      id: String(c.id ?? str(c.domain) ?? str(c.name)),
      name: str(c.name),
      // Portal reality (docs/hubspot-property-map.md): AGP's vertical lives
      // in the custom agp_industry select; standard industry is the fallback.
      vertical: str(c.agp_industry) || str(c.industry),
      ...(str(c.client_abbreviation__c) ? { abbreviation: str(c.client_abbreviation__c) } : {}),
      lifecycleStage: str(c.lifecyclestage),
      healthIndex: str(c.client_health_index__c) || str(c.health_score_current_month),
      renewal: str(c.renewal),
      gdnaLevel: str(c.gdna_subscription_level),
      intentSummary: str(c.hs_signals_summary),
      intentCount30d: num(c.hs_count_intent_signals_created_last_30_days),
      owner: str(c.ownername),
      ...(str(c.notes_last_contacted) ? { lastTouch: str(c.notes_last_contacted).slice(0, 10) } : {}),
      ...(str(c.notes_next_activity_date) ? { nextActivity: str(c.notes_next_activity_date).slice(0, 10) } : {}),
      ...(c.num_contacted_notes != null && str(c.num_contacted_notes) !== "" ? { touches: num(c.num_contacted_notes) } : {}),
      ...(str(c.hs_ideal_customer_profile) ? { icpTier: str(c.hs_ideal_customer_profile) } : {}),
      ...(str(c.hs_is_target_account) === "true" ? { targetAccount: true } : {}),
    }));

  // Kantata-only: new payloads carry no companies — derive the client
  // directory from Kantata itself. Legacy cached payloads still map.
  const clients = mappedCompanies.length > 0 ? mappedCompanies : deriveClientsFromKantata(p);

  const nameOf = (id: unknown): string => clients.find((c) => c.id === String(id))?.name ?? "";

  return {
    clients,
    projects: p.kantataProjects
      .filter((w) => str(w.title).trim().length > 0)
      .map((w) => {
        const id = String(w.id);
        // Workspace-group join: a project can sit in BOTH a client group and
        // a category group ("Direct Mail") — prefer the group that is a
        // client record (company/contact info), never the category.
        const groupsFor = (p.kantataGroups ?? []).filter((g) =>
          Array.isArray(g.workspace_ids) ? (g.workspace_ids as unknown[]).map(String).includes(id) : false,
        );
        const group =
          groupsFor.find((g) => str(g.company) || str(g.contact_name) || str(g.email)) ?? groupsFor[0];
        const clientGroup = group ? str(group.company) || str(group.name) : "";
        // Custom fields: "Service Line Detail" etc. per the tenant taxonomy.
        const fieldsFor = (p.kantataCustomFields ?? []).filter((f) => String(f.subject_id) === id);
        const serviceLine = str(fieldsFor.find((f) => /service\s*line/i.test(str(f.name)))?.value);
        const vertical = str(fieldsFor.find((f) => /vertical|industry/i.test(str(f.name)))?.value);
        const team = Array.isArray(w.participant_names)
          ? (w.participant_names as unknown[]).map(String).filter((n) => n.length > 0)
          : [];
        const hoursRow = (p.kantataHours ?? []).find((h) => String(h.workspace_id) === id);
        return {
          id,
          title: str(w.title),
          serviceLine,
          vertical,
          model: str(w.status),
          ...(str(w.start_date) ? { startDate: str(w.start_date) } : {}),
          ...(str(w.due_date) ? { dueDate: str(w.due_date) } : {}),
          ...(str(w.status) ? { status: str(w.status) } : {}),
          ...(clientGroup ? { clientGroup } : {}),
          ...(team.length > 0 ? { team } : {}),
          ...(hoursRow
            ? {
                minutes30d: num(hoursRow.minutes_30d),
                minutesRecent: num(hoursRow.minutes_recent),
                people30d: num(hoursRow.people_30d),
                ...(str(hoursRow.last_entry_date) ? { lastEntryDate: str(hoursRow.last_entry_date) } : {}),
              }
            : {}),
        };
      }),
    tasks: (p.kantataTasks ?? [])
      .filter((t) => str(t.title).trim().length > 0)
      .map((t) => ({
        id: String(t.id),
        projectId: String(t.workspace_id),
        title: str(t.title),
        state: str(t.state),
        ...(str(t.due_date) ? { dueDate: str(t.due_date).slice(0, 10) } : {}),
      })),
    campaigns: p.deals
      .filter((d) => str(d.dealname).trim().length > 0)
      .map((d) => ({
        id: String(d.id),
        title: str(d.dealname),
        clientName: nameOf(d.company_id),
        stage: str(d.dealstage),
        kind: "deal" as const,
        ...(str(d.closedate) ? { closeDate: str(d.closedate) } : {}),
      })),
    milestones: (p.kantataMilestones ?? [])
      .filter((m) => str(m.title).trim().length > 0 && str(m.due_date).length > 0)
      .map((m) => ({
        id: String(m.id),
        projectId: String(m.workspace_id),
        title: str(m.title),
        dueDate: str(m.due_date).slice(0, 10),
        state: str(m.state),
      })),
  };
}

/** The most recent live payload applied (cache or fetch) — the base a
 * focus deepen merges into. Null until the app has gone live once. */
let lastPayload: RawMirrorPayload | null = null;

/**
 * Pure merge for a focus pull: the detail response carries the COMPLETE
 * story set for `ids`, so existing rows for those workspaces are REPLACED
 * (stale slices out), and every other workspace's rows are kept.
 */
export function mergeFocusPayload(
  base: RawMirrorPayload,
  ids: string[],
  detail: { kantataMilestones?: Record<string, unknown>[]; kantataTasks?: Record<string, unknown>[] },
): RawMirrorPayload {
  const idSet = new Set(ids.map(String));
  const others = (rows?: Record<string, unknown>[]) => (rows ?? []).filter((r) => !idSet.has(String(r.workspace_id)));
  return {
    ...base,
    kantataMilestones: [...others(base.kantataMilestones), ...(detail.kantataMilestones ?? [])],
    kantataTasks: [...others(base.kantataTasks), ...(detail.kantataTasks ?? [])],
  };
}

/**
 * Deepen: pull the complete task tree for specific workspaces and merge it
 * into the live mirror. The tenant-wide boot pull is a recency slice
 * (2,000 tasks of ~160k stories) — a workspace being populated deserves
 * EVERYTHING its projects carry. Returns the number of stories fetched;
 * 0 on any failure (never throws — populate flows proceed on the slice).
 */
export async function deepenWorkspaces(workspaceIds: string[]): Promise<number> {
  const ids = [...new Set(workspaceIds.filter((i) => /^\d+$/.test(i)))].slice(0, 12);
  if (ids.length === 0 || !lastPayload?.live) return 0;
  try {
    const res = await fetch(`/api/mirror?workspaces=${ids.join(",")}`);
    if (!res.ok) return 0;
    const detail = (await res.json()) as {
      live: boolean;
      kantataMilestones?: Record<string, unknown>[];
      kantataTasks?: Record<string, unknown>[];
    };
    if (!detail.live) return 0;
    const merged = mergeFocusPayload(lastPayload, ids, detail);
    lastPayload = merged;
    setMirrorOverride(mapLivePayload(merged));
    try {
      window.localStorage.setItem(CACHE_KEY, JSON.stringify({ schema: CACHE_SCHEMA, payload: merged }));
    } catch {
      // storage full — merged mirror still applied in memory
    }
    return (detail.kantataMilestones?.length ?? 0) + (detail.kantataTasks?.length ?? 0);
  } catch {
    return 0;
  }
}

function statusFrom(p: RawMirrorPayload, cached: boolean): LiveStatus {
  if (!p.live) {
    return {
      live: false,
      label: "Demo data",
      detail: `Kantata: ${p.sources.kantata.note || "off"}`,
    };
  }
  // Kantata-only: HubSpot appears in the label only for legacy cached
  // payloads that still carry companies.
  const bits = [p.sources.kantata.ok ? `${p.sources.kantata.projects} projects` : "Kantata off"];
  if (p.sources.hubspot.ok) bits.unshift(`${p.sources.hubspot.companies} clients`);
  return {
    live: true,
    label: `Live · Kantata · ${bits.join(" · ")}${cached ? " (cached)" : ""}`,
    detail: `Kantata: ${p.sources.kantata.note} · fetched ${p.fetchedAt}`,
    fetchedAt: p.fetchedAt,
  };
}

/**
 * Boot sequence: apply the cached live mirror instantly (if any), then fetch
 * fresh. onStatus fires for each state so the header stays truthful.
 */
export async function initLiveMirror(
  onStatus: (s: LiveStatus) => void,
  opts?: { fresh?: boolean },
): Promise<void> {
  let cachedStatus: LiveStatus | null = null;
  if (!opts?.fresh) {
    try {
      const raw = window.localStorage.getItem(CACHE_KEY);
      if (raw) {
        const wrapped = JSON.parse(raw) as { schema?: number; payload?: RawMirrorPayload };
        if (wrapped.schema === CACHE_SCHEMA && wrapped.payload?.live) {
          lastPayload = wrapped.payload;
          setMirrorOverride(mapLivePayload(wrapped.payload));
          cachedStatus = statusFrom(wrapped.payload, true);
          onStatus(cachedStatus);
        } else {
          window.localStorage.removeItem(CACHE_KEY); // stale schema — refetch
        }
      }
    } catch {
      // corrupt cache — ignore, the fetch below decides
    }
  }

  try {
    const res = await fetch(opts?.fresh ? "/api/mirror?fresh=1" : "/api/mirror");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = (await res.json()) as RawMirrorPayload;
    if (payload.live) {
      lastPayload = payload;
      setMirrorOverride(mapLivePayload(payload));
      try {
        window.localStorage.setItem(CACHE_KEY, JSON.stringify({ schema: CACHE_SCHEMA, payload }));
      } catch {
        // storage full — live data still applied in memory
      }
      onStatus(statusFrom(payload, false));
    } else if (cachedStatus) {
      // Endpoint reachable but tokens now absent — the cached live mirror is
      // still applied and still the best truth. Keep saying so.
      onStatus({ ...cachedStatus, detail: `${cachedStatus.detail} · refresh returned no live data` });
    } else {
      onStatus(statusFrom(payload, false));
    }
  } catch {
    // No endpoint (local dev) or network failure. A cached live mirror, if
    // applied above, stays applied — never mislabel it as demo data.
    if (cachedStatus) {
      onStatus({ ...cachedStatus, detail: `${cachedStatus.detail} · /api/mirror unreachable, showing cache` });
    } else {
      onStatus({
        live: false,
        label: "Demo data",
        detail: "/api/mirror unreachable — bundled fixture mirror in use",
      });
    }
  }
}

/** User-invoked hard refresh: drop every cache layer and re-pull. */
export async function refreshLiveMirror(onStatus: (s: LiveStatus) => void): Promise<void> {
  try {
    window.localStorage.removeItem(CACHE_KEY);
  } catch {
    // storage unavailable — the fresh fetch still applies in memory
  }
  onStatus({ live: false, label: "Refreshing…", detail: "re-pulling Kantata" });
  await initLiveMirror(onStatus, { fresh: true });
}
