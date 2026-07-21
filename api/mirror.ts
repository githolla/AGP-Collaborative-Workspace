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
 * Self-contained on purpose (no workspace imports): Vercel bundles this
 * file independently of the pnpm monorepo.
 */

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

/** One request, hard 8s cap, one retry on a 429 rate limit. */
async function timedFetch(url: string, headers: Record<string, string>): Promise<Response> {
  const attempt = () => fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  let res = await attempt();
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 1100));
    res = await attempt();
  }
  return res;
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
  type KantataGroup = {
    id: string;
    name?: string;
    company?: string;
    contact_name?: string;
    email?: string;
    workspace_ids?: (string | number)[];
  };
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
    // Caps sized from the tenant census (~160k stories, ~617k time entries
    // lifetime): recency-ordered walks capture the live slice.
    pullKantataPaged<KantataStory>(
      "https://api.mavenlink.com/api/v1/stories?story_type=milestone&per_page=200&order=due_date:asc",
      "stories",
      1200,
    ),
    pullKantataPaged<KantataStory>(
      "https://api.mavenlink.com/api/v1/stories?story_type=task&per_page=200&order=updated_at:desc",
      "stories",
      2000,
    ),
    // ~688 groups in the tenant — and the client-record ones (company/
    // contact fields) ARE the client directory. Never truncate them again.
    pullKantataPaged<KantataGroup>(
      "https://api.mavenlink.com/api/v1/workspace_groups?per_page=200&include=workspaces",
      "workspace_groups",
      1000,
    ),
    pullKantataPaged<KantataCfv>(
      "https://api.mavenlink.com/api/v1/custom_field_values?subject_type=Workspace&per_page=200",
      "custom_field_values",
      1000,
    ),
    pullKantataPaged<KantataTimeEntry>(
      `https://api.mavenlink.com/api/v1/time_entries?per_page=200&order=date_performed:desc&date_performed_between=${new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10)}:${new Date().toISOString().slice(0, 10)}`,
      "time_entries",
      4000,
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
      contact_name: g.contact_name ?? "",
      email: g.email ?? "",
      workspace_ids: (g.workspace_ids ?? []).map(String),
    }));
    const clientRecords = groups.filter((g) => g.company || g.contact_name || g.email).length;
    notes.push(`${groups.length} groups (${clientRecords} client records)`);
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
      payload.sources.kantata = { ok: true, note: k.note, projects: k.projects.length };
    } else {
      payload.sources.kantata.note = `pull failed: ${kantataResult.reason instanceof Error ? kantataResult.reason.message : "unknown"}`;
    }
  }

  payload.live = payload.sources.kantata.ok;
  cache = { at: Date.now(), payload };
  res.status(200).json(payload);
}
