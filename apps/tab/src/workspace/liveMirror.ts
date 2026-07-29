import { setMirrorOverride, type AgpMirror, type MirrorClient } from "./agpKnowledge.js";
import { autoAbbreviation, initialism, stripCorpSuffix } from "./campaignImport.js";
import { isActiveClient, noteActivity, type ActivityEvidence } from "./clientActivity.js";
import { apiFetch } from "../auth/apiFetch.js";

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
  kantataPosts?: Record<string, unknown>[];
  kantataStaff?: Record<string, unknown>[];
}

const CACHE_KEY = "agp-live-mirror-v1";
/**
 * Bump whenever the payload shape or matching logic changes — a cached
 * pre-upgrade payload (no groups, one 100-row page) must be discarded, not
 * trusted. This is exactly what bit the first live deploys.
 */
const CACHE_SCHEMA = 11; // 11: 2-char dash prefixes, AGP/Test internal, space-insensitive keys

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Leading project code ("25-031 Syracuse Fall") — not client identity. */
const stripCode = (title: string): string => title.replace(/^\s*\d[\d.-]*\s+/, "").trim();

/**
 * Internal AGP work, not a client: the "Agency:" title prefix (AGP's stated
 * convention). Dropped from the client list AND the project list — it isn't
 * delivery for an outside client.
 */
export const isInternalTitle = (title: string): boolean => {
  const t = stripCode(str(title));
  // AGP labels its own work "AGP:" / "Allegiance Group …" — NOT the
  // "Agency:" this rule originally assumed, so internal projects were
  // being counted as two clients ("AGP", "Allegiance Group").
  // "Test:" projects are scratch work and are not a client either.
  return /^(agency|agp|allegiance\s+group|test)\b/i.test(t);
};

const normKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "");
const TITLE_SEP = /\s+[—–|]\s+|\s+-\s+/;

/**
 * Strip a TRAILING fiscal-year / campaign code from a client prefix, so
 * "Acme FY26" / "Acme FY27" / "Acme 2025-26" / "Acme Q3" all resolve to the
 * one client "Acme". Agencies routinely encode the cycle in the project
 * prefix; without this each cycle looks like a new client. Trailing only —
 * a leading year ("2025 Gala") is part of the name and left alone.
 */
const CAMPAIGN_CODE = /\s*[-–—|,]?\s*(fy\s?['’]?\d{2,4}(?:[-/]\d{2,4})?|q[1-4](?:\s?fy?\s?['’]?\d{2,4})?|(?:19|20)\d{2}(?:\s?[-/–]\s?(?:19|20)?\d{2})?|['’]\d{2}(?:[-/]\d{2})?|\d{2}\s?[-/–]\s?\d{2})\s*$/i;
export function stripCampaignCode(name: string): string {
  let n = name.trim();
  for (let i = 0; i < 3; i += 1) {
    const next = n.replace(CAMPAIGN_CODE, "").trim();
    if (next === n || next.length < 2) break;
    n = next;
  }
  return n || name.trim();
}

/**
 * Classify ONE workspace title into the client it belongs to and HOW that was
 * decided — the single source of truth for the derivation and its diagnostics.
 * - "internal": an "Agency:" project (not a client).
 * - "colon": the AGP convention — prefix before the first colon.
 * - "dash": client name before an em/en dash, spaced hyphen, or pipe.
 * - "verbatim": no convention matched — the whole title stands in as a client
 *   (reachable, but a sign the title doesn't follow the convention).
 */
export type TitleClass = { via: "internal" } | { via: "colon" | "dash" | "verbatim"; client: string };
export function classifyClientTitle(raw: string): TitleClass {
  if (isInternalTitle(raw)) return { via: "internal" };
  const title = stripCode(str(raw));
  const colon = title.indexOf(":");
  if (colon >= 2) {
    const prefix = title.slice(0, colon).trim();
    if (prefix.length >= 2 && prefix.length <= 40 && normKey(prefix) !== "agency") {
      return { via: "colon", client: prefix };
    }
  }
  const dash = title.split(TITLE_SEP);
  const head = dash[0]?.trim() ?? "";
  if (dash.length >= 2 && head.length >= 2 && head.length <= 40) return { via: "dash", client: head };
  if (title.length >= 4) return { via: "verbatim", client: title };
  return { via: "internal" };
}

/**
 * Kantata-only client derivation — AGP's stated convention (2026-07): take
 * the active (non-archived) workspaces, DROP the internal "Agency:" projects,
 * and group everything left by the title prefix before the colon
 * ("ARMS: Support 25-26" → ARMS). Titles with no colon fall back to a
 * separator split, then verbatim, so no active project is ever invisible.
 * Every derived client is active by construction — it exists because a live
 * project references it.
 */
function deriveClientsFromKantata(p: RawMirrorPayload, today: string): MirrorClient[] {
  const byKey = new Map<string, MirrorClient>();
  // Activity evidence per client key, gathered from the same titles and dates
  // the derivation already walks — no extra API call.
  const evidence = new Map<string, ActivityEvidence>();
  const add = (rawName: string, abbreviation: string | undefined, vertical: string): string | undefined => {
    // Canonical display name: drop the legal suffix so "Acme, Inc." and "Acme"
    // are ONE client (both by key and on screen) — a common inflation source.
    const name = stripCorpSuffix(rawName).trim() || rawName.trim();
    const key = normKey(name);
    if (!key || key.length < 2 || key === "agency") return undefined;
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.vertical && vertical) existing.vertical = vertical;
      if (!existing.abbreviation && abbreviation) existing.abbreviation = abbreviation;
      // Prefer the fuller display name (keeps "Acme Health" over "Acme").
      if (name.length > existing.name.length) existing.name = name;
      return key;
    }
    byKey.set(key, {
      id: `k-${key.replace(/\s+/g, "-")}`,
      name,
      vertical,
      lifecycleStage: "customer",
      ...(abbreviation ? { abbreviation } : {}),
    });
    return key;
  };
  const verticalFor = (workspaceId: string) => {
    const fieldsFor = (p.kantataCustomFields ?? []).filter((f) => String(f.subject_id) === workspaceId);
    return str(fieldsFor.find((f) => /vertical|industry/i.test(str(f.name)))?.value);
  };

  for (const w of p.kantataProjects) {
    const raw = classifyClientTitle(str(w.title));
    // A client is a named prefix — colon (the AGP convention) or a dash
    // separator. VERBATIM titles (no convention) are NOT clients: they're
    // project titles, and counting them inflates the directory. They stay in
    // the project list (findable via the Project Finder), just uncounted.
    if (raw.via !== "colon" && raw.via !== "dash") continue;
    // Strip a trailing fiscal-year / campaign code so "Acme FY26" and
    // "Acme FY27" are ONE client — the biggest source of prefix inflation.
    const cls = { via: raw.via, client: stripCampaignCode(raw.client) };
    const vertical = verticalFor(String(w.id));
    // A short single-token colon prefix IS the abbreviation ("ARMS"); a longer
    // one gets a derived acronym. Dash clients carry no abbreviation.
    const abbr =
      cls.via === "colon"
        ? cls.client.length <= 6 && !/\s/.test(cls.client)
          ? cls.client.toUpperCase()
          : autoAbbreviation(cls.client)
        : undefined;
    const key = add(cls.client, abbr, vertical);
    if (key) {
      evidence.set(
        key,
        noteActivity(evidence.get(key) ?? {}, str(w.title), [str(w.due_date), str(w.start_date)]),
      );
    }
  }
  for (const [key, client] of byKey) {
    client.active = isActiveClient(evidence.get(key) ?? {}, today);
  }
  return mergeAcronymDuplicates([...byKey.values()]);
}

/**
 * Fold an acronym client into its full-name sibling: "AWW" ⇄ "American Water
 * Works" are one client, not two. Keeps the multi-word name, carries the
 * acronym as its abbreviation so acronym-titled projects still match.
 */
function mergeAcronymDuplicates(clients: MirrorClient[]): MirrorClient[] {
  const fullByAcronym = new Map<string, MirrorClient>();
  for (const c of clients) {
    if (!/\s/.test(c.name)) continue; // only multi-word names produce acronyms
    const init = initialism(c.name).toLowerCase();
    if (init.length >= 2 && !fullByAcronym.has(init)) fullByAcronym.set(init, c);
  }
  const dropped = new Set<MirrorClient>();
  for (const c of clients) {
    if (/\s/.test(c.name)) continue; // candidate must be a single token (the acronym)
    const key = c.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (key.length < 2 || key.length > 6) continue;
    const full = fullByAcronym.get(key);
    if (full && full !== c) {
      if (!full.abbreviation) full.abbreviation = c.name;
      dropped.add(c);
    }
  }
  return clients.filter((c) => !dropped.has(c));
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
  const clients = mappedCompanies.length > 0 ? mappedCompanies : deriveClientsFromKantata(p, (p.fetchedAt || new Date().toISOString()).slice(0, 10));

  const nameOf = (id: unknown): string => clients.find((c) => c.id === String(id))?.name ?? "";

  return {
    clients,
    projects: p.kantataProjects
      // Drop internal "Agency:" work — it's not delivery for a client, so it
      // shouldn't appear in matching, the Project Finder, or the book count.
      .filter((w) => str(w.title).trim().length > 0 && !isInternalTitle(str(w.title)))
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
      .map((t) => {
        const assignees = Array.isArray(t.assignees) ? (t.assignees as unknown[]).map(String).filter((n) => n.length > 0) : [];
        return {
          id: String(t.id),
          projectId: String(t.workspace_id),
          title: str(t.title),
          state: str(t.state),
          ...(str(t.due_date) ? { dueDate: str(t.due_date).slice(0, 10) } : {}),
          ...(assignees.length > 0 ? { assignees } : {}),
          ...(typeof t.percent === "number" ? { percent: num(t.percent) } : {}),
        };
      }),
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
    posts: (p.kantataPosts ?? [])
      .filter((post) => str(post.message).trim().length > 0)
      .map((post) => ({
        id: String(post.id),
        projectId: String(post.workspace_id),
        message: str(post.message),
        author: str(post.author),
        createdAt: str(post.created_at),
      })),
    staff: (p.kantataStaff ?? [])
      .filter((u) => str(u.name).trim().length > 0)
      .map((u) => ({
        id: String(u.id),
        name: str(u.name),
        title: str(u.title),
        email: str(u.email),
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
    const res = await apiFetch(`/api/mirror?workspaces=${ids.join(",")}`);
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
    const res = await apiFetch(opts?.fresh ? "/api/mirror?fresh=1" : "/api/mirror");
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
