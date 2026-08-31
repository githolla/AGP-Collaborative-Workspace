/**
 * Shared Kantata "does this workspace have resourcing hours?" check, used by
 * both the app-admin diagnostic (arbitrary workspace ids) and the in-context
 * Resourcing-tab check (an account's own linked workspaces).
 *
 * Per workspace: Resource Center allocations (reserved hours the "By hours"
 * view reads) and story-level estimated hours (the other place hours can live),
 * with a verdict. Financial fields never leave this module — stripped from the
 * one sample row, matching the mirror.
 */

const BASE = (process.env.KANTATA_API_BASE || "https://api.mavenlink.com/api/v1").replace(/\/+$/, "");
const MONEY = /(cost|rate|bill|price|amount|budget|revenue|margin|charge|expense)/i;
const strip = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => !MONEY.test(k)));
const num = (...vals: unknown[]): number => { for (const v of vals) { const n = Number(v); if (Number.isFinite(n) && n !== 0) return n; } return 0; };

type Row = Record<string, unknown>;

async function pull(token: string, url: string, collection: string, cap: number): Promise<Row[]> {
  const rows: Row[] = [];
  for (let page = 1; rows.length < cap && page <= Math.ceil(cap / 200); page += 1) {
    const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}page=${page}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      if (page === 1) throw new Error(`${collection} HTTP ${res.status}`);
      break;
    }
    const json = (await res.json()) as Record<string, Record<string, Row> | unknown>;
    const batch = Object.values((json[collection] as Record<string, Row>) ?? {});
    rows.push(...batch);
    if (batch.length < 200) break;
  }
  return rows.slice(0, cap);
}

const allocHours = (a: Row): number => {
  const mins = num(a.total_minutes, a.minutes, a.scheduled_minutes);
  if (mins) return Math.round((mins / 60) * 10) / 10;
  return num(a.total_hours, a.hours, a.scheduled_hours);
};

export interface WorkspaceHoursReport {
  workspaceId: string;
  allocations: number;
  allocationsTaskLinked: number;
  allocationsHours: number;
  allocationWindow: { from: string; to: string } | null;
  stories: number;
  storiesWithHours: number;
  storyHours: number;
  verdict: "has_allocations" | "has_story_hours" | "no_hours";
  sample: Record<string, unknown> | null;
}

export interface KantataHoursCheck {
  configured: boolean;
  message?: string;
  totalAllocationsVisible?: number;
  allocationsError?: string;
  workspaces?: WorkspaceHoursReport[];
}

/** Run the check for a set of Kantata workspace ids. Returns configured:false
 * when the server token isn't set. Never throws for a per-workspace error.
 * Allocations are queried PER workspace (workspace_id filter) so an older
 * workspace can't fall outside a global recency window — the verdict is
 * complete for each workspace, not "within the last N updated". */
export async function checkKantataWorkspaces(workspaceIds: string[]): Promise<KantataHoursCheck> {
  const token = process.env.KANTATA_API_TOKEN;
  if (!token) {
    return { configured: false, message: "KANTATA_API_TOKEN is not set on the server, so Kantata can't be queried." };
  }
  const ids = workspaceIds.map((s) => String(s).trim()).filter(Boolean).slice(0, 10);
  if (ids.length === 0) {
    return { configured: true, totalAllocationsVisible: 0, workspaces: [] };
  }

  let allocError: string | null = null;
  let totalSeen = 0;
  const workspaces: WorkspaceHoursReport[] = [];
  for (const wsId of ids) {
    // Filter server-side by workspace; also filter client-side in case the API
    // ignores the param, so the count is always exactly this workspace's.
    let mine: Row[] = [];
    try {
      const pulled = await pull(token, `${BASE}/workspace_allocations?workspace_id=${encodeURIComponent(wsId)}&per_page=200&order=updated_at:desc&include=user`, "workspace_allocations", 2000);
      mine = pulled.filter((a) => String(a.workspace_id) === String(wsId));
      totalSeen += mine.length;
    } catch (e) {
      if (!allocError) allocError = e instanceof Error ? e.message : "allocations pull failed";
    }
    const taskLinked = mine.filter((a) => a.story_id).length;
    const hours = Math.round(mine.reduce((s, a) => s + allocHours(a), 0));
    const dates = mine.flatMap((a) => [a.start_date, a.end_date].filter((d): d is string => typeof d === "string")).sort();

    let stories: Row[] = [];
    try {
      stories = await pull(token, `${BASE}/stories?workspace_id=${encodeURIComponent(wsId)}&per_page=200&order=updated_at:desc`, "stories", 1000);
    } catch { /* leave stories empty; verdict handles it */ }
    const withHours = stories.filter((s) => num(s.estimated_minutes) > 0);
    const storyHours = Math.round(withHours.reduce((s, x) => s + num(x.estimated_minutes) / 60, 0));

    workspaces.push({
      workspaceId: wsId,
      allocations: mine.length,
      allocationsTaskLinked: taskLinked,
      allocationsHours: hours,
      allocationWindow: dates.length ? { from: dates[0]!, to: dates[dates.length - 1]! } : null,
      stories: stories.length,
      storiesWithHours: withHours.length,
      storyHours,
      verdict: mine.length > 0 ? "has_allocations" : withHours.length > 0 ? "has_story_hours" : "no_hours",
      sample: mine[0] ? strip(mine[0]) : null,
    });
  }

  return {
    configured: true,
    totalAllocationsVisible: totalSeen,
    ...(allocError ? { allocationsError: allocError } : {}),
    workspaces,
  };
}
