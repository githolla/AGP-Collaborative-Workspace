/**
 * /api/mirror — the live KANTATA pull, server-side on Vercel.
 *
 * Kantata-only (ADR 0008 + 2026-07-20 decision): AGP's other systems run
 * on Kantata data alone, and so does this one. HubSpot is pre-acquisition
 * CRM and is no longer pulled; the client directory is DERIVED from
 * Kantata itself in the browser mapping (title prefixes like "ARMS:",
 * full-name title conventions, group companies). The payload keeps the
 * `companies`/`deals` fields (always empty) so older cached payload shapes
 * stay parseable.
 *
 * KANTATA_API_TOKEN is read from env and NEVER reaches the browser.
 * No workspace imports (apps/tab, packages/*) — Vercel bundles this file
 * independently of the pnpm monorepo. The actual Kantata fetch/pagination
 * logic now lives in api/_lib/kantataMirror.ts, shared with the Kantata
 * import endpoints (api/account-import.ts, api/account-deepen.ts), which
 * call the same functions in-process rather than duplicating them — this
 * file keeps only the HTTP-layer concerns (caching, query params, response
 * shape) that were always specific to being a browser-facing route.
 */
import { requireAuth } from "./_lib/authGate.js";
import { pullKantata, pullWorkspaceStories } from "./_lib/kantataMirror.js";

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
  /** Full task tree (story_type=task) — feeds the review-gated task import.
   * Each task now carries `assignees` (owner names) + `percent`. */
  kantataTasks: Record<string, unknown>[];
  /** Recent project conversation — Kantata posts (workspace/story comments). */
  kantataPosts: Record<string, unknown>[];
  /**
   * Per-workspace hours AGGREGATED SERVER-SIDE from time entries. Only
   * minutes and dates cross the wire — bill/cost rates are stripped here,
   * never sent to the browser (no-financials rule).
   */
  kantataHours: Record<string, unknown>[];
  /** The AGP team — every member of the AGP Kantata account (id, name, title,
   * email). This is the live roster the collaboration UI adds teammates from. */
  kantataStaff: Record<string, unknown>[];
  /**
   * Resource allocations — Kantata's Resource Center grid: reserved hours per
   * person, per week (the numbers Kellie's team maintains by hand every
   * Thursday). This is where scheduled hours actually live (NOT the story's
   * estimated_minutes, which the tenant leaves empty). Read-only mirror of the
   * same `workspace_allocations` object the write-back pushes to.
   */
  kantataAllocations: Record<string, unknown>[];
  /**
   * A tiny raw sample of allocation rows (financial keys stripped) — the
   * diagnostic that answers the one open question: does an allocation link to
   * a specific task (story_id) or only to the workspace+person? That decides
   * whether hours can be re-spread per task on a timeline shift, or only
   * mirrored as the weekly grid.
   */
  kantataAllocationsSample: Record<string, unknown>[];
  /**
   * AGP's Kantata PROJECT TEMPLATES — the role-and-task blueprints Kellie's
   * team applies to spin up a timeline ("direct mail" → the standard phases,
   * roles, and tasks). This is the backbone of the resourcing model: roles map
   * to people, and the default hour split rides on the template's structure.
   */
  kantataTemplates: Record<string, unknown>[];
  /** Raw template sample + the endpoint it came from — the diagnostic that
   * pins down where Kantata exposes templates and in what shape. */
  kantataTemplatesSample: Record<string, unknown>[];
}

// Per-instance cache: previews are demo traffic; 5 minutes keeps upstream
// rate limits comfortable without staleness anyone would notice.
let cache: { at: number; payload: MirrorPayload } | null = null;
const TTL_MS = 5 * 60 * 1000;

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

  // ?workspaces=id1,id2 — focus pull for specific workspaces (complete
  // task tree, not the tenant-wide recency slice). Never cached: it's an
  // on-demand deepen triggered by populate/link actions.
  const wsMatch = /[?&]workspaces=([\d,]+)/.exec(req.url ?? "");
  if (wsMatch) {
    res.setHeader("Cache-Control", "no-store");
    const focusToken = process.env.KANTATA_API_TOKEN;
    const ids = [...new Set(wsMatch[1]!.split(",").filter((s) => /^\d+$/.test(s)))].slice(0, 12);
    if (!focusToken || ids.length === 0) {
      res.status(200).json({ live: false, note: focusToken ? "no valid workspace ids" : "KANTATA_API_TOKEN not set", kantataMilestones: [], kantataTasks: [] });
      return;
    }
    try {
      const focus = await pullWorkspaceStories(focusToken, ids);
      res.status(200).json({ live: true, note: focus.note, workspaces: ids, kantataMilestones: focus.milestones, kantataTasks: focus.tasks });
    } catch (e) {
      res.status(200).json({ live: false, note: e instanceof Error ? e.message : "focus pull failed", kantataMilestones: [], kantataTasks: [] });
    }
    return;
  }

  // ?fresh=1 (the Live pill's refresh) bypasses every cache layer.
  const fresh = /[?&]fresh=1/.test(req.url ?? "");
  res.setHeader("Cache-Control", fresh ? "no-store" : "s-maxage=300, stale-while-revalidate=600");
  if (!fresh && cache && Date.now() - cache.at < TTL_MS) {
    res.status(200).json(cache.payload);
    return;
  }

  const kantataToken = process.env.KANTATA_API_TOKEN;

  const payload: MirrorPayload = {
    live: false,
    fetchedAt: new Date().toISOString(),
    sources: {
      // Kantata-only: HubSpot is no longer pulled (ADR 0008). The entry
      // stays so older clients parsing the payload shape don't break.
      hubspot: { ok: false, note: "off — Kantata-only (ADR 0008)", companies: 0, deals: 0 },
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
    kantataPosts: [],
    kantataStaff: [],
    kantataAllocations: [],
    kantataAllocationsSample: [],
    kantataTemplates: [],
    kantataTemplatesSample: [],
  };

  const [kantataResult] = await Promise.allSettled([
    kantataToken ? pullKantata(kantataToken) : Promise.reject(new Error("token not set")),
  ]);

  if (kantataToken) {
    if (kantataResult.status === "fulfilled") {
      const k = kantataResult.value;
      payload.kantataProjects = k.projects;
      payload.kantataMilestones = k.milestones;
      payload.kantataGroups = k.groups;
      payload.kantataCustomFields = k.customFields;
      payload.kantataTasks = k.tasks;
      payload.kantataHours = k.hours;
      payload.kantataPosts = k.posts;
      payload.kantataStaff = k.staff;
      payload.kantataAllocations = k.allocations;
      payload.kantataAllocationsSample = k.allocationsSample;
      payload.kantataTemplates = k.templates;
      payload.kantataTemplatesSample = k.templatesSample;
      payload.sources.kantata = { ok: true, note: k.note, projects: k.projects.length };
    } else {
      payload.sources.kantata.note = `pull failed: ${kantataResult.reason instanceof Error ? kantataResult.reason.message : "unknown"}`;
    }
  }

  payload.live = payload.sources.kantata.ok;
  cache = { at: Date.now(), payload };
  res.status(200).json(payload);
}
