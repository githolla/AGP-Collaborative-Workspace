import { setMirrorOverride, type AgpMirror, type MirrorClient } from "./agpKnowledge.js";

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
}

const CACHE_KEY = "agp-live-mirror-v1";

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Pure mapping: raw /api/mirror payload → the AgpMirror the Copilot grounds on. */
export function mapLivePayload(p: RawMirrorPayload): AgpMirror {
  const clients: MirrorClient[] = p.companies
    .filter((c) => str(c.name).trim().length > 0)
    .map((c) => ({
      id: String(c.id ?? str(c.domain) ?? str(c.name)),
      name: str(c.name),
      // Portal reality (docs/hubspot-property-map.md): AGP's vertical lives
      // in the custom agp_industry select; standard industry is the fallback.
      vertical: str(c.agp_industry) || str(c.industry),
      lifecycleStage: str(c.lifecyclestage),
      healthIndex: str(c.client_health_index__c) || str(c.health_score_current_month),
      renewal: str(c.renewal),
      gdnaLevel: str(c.gdna_subscription_level),
      intentSummary: str(c.hs_signals_summary),
      intentCount30d: num(c.hs_count_intent_signals_created_last_30_days),
      owner: str(c.ownername),
    }));

  const nameOf = (id: unknown): string => clients.find((c) => c.id === String(id))?.name ?? "";

  return {
    clients,
    projects: p.kantataProjects
      .filter((w) => str(w.title).trim().length > 0)
      .map((w) => ({
        id: String(w.id),
        title: str(w.title),
        // AGP custom fields (service line / vertical / model) need the
        // Kantata tenant grounding doc (BLOCKERS #1) — empty until then.
        serviceLine: "",
        vertical: "",
        model: str(w.status),
        ...(str(w.start_date) ? { startDate: str(w.start_date) } : {}),
        ...(str(w.due_date) ? { dueDate: str(w.due_date) } : {}),
        ...(str(w.status) ? { status: str(w.status) } : {}),
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

function statusFrom(p: RawMirrorPayload, cached: boolean): LiveStatus {
  if (!p.live) {
    return {
      live: false,
      label: "Demo data",
      detail: `HubSpot: ${p.sources.hubspot.note || "off"} · Kantata: ${p.sources.kantata.note || "off"}`,
    };
  }
  const bits = [
    p.sources.hubspot.ok ? `${p.sources.hubspot.companies} clients` : "HubSpot off",
    p.sources.kantata.ok ? `${p.sources.kantata.projects} projects` : "Kantata off",
  ];
  return {
    live: true,
    label: `Live · ${bits.join(" · ")}${cached ? " (cached)" : ""}`,
    detail: `HubSpot: ${p.sources.hubspot.note} · Kantata: ${p.sources.kantata.note} · fetched ${p.fetchedAt}`,
    fetchedAt: p.fetchedAt,
  };
}

/**
 * Boot sequence: apply the cached live mirror instantly (if any), then fetch
 * fresh. onStatus fires for each state so the header stays truthful.
 */
export async function initLiveMirror(onStatus: (s: LiveStatus) => void): Promise<void> {
  let cachedStatus: LiveStatus | null = null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (raw) {
      const cached = JSON.parse(raw) as RawMirrorPayload;
      if (cached.live) {
        setMirrorOverride(mapLivePayload(cached));
        cachedStatus = statusFrom(cached, true);
        onStatus(cachedStatus);
      }
    }
  } catch {
    // corrupt cache — ignore, the fetch below decides
  }

  try {
    const res = await fetch("/api/mirror");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = (await res.json()) as RawMirrorPayload;
    if (payload.live) {
      setMirrorOverride(mapLivePayload(payload));
      try {
        window.localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
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
