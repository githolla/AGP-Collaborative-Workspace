/**
 * GET /api/admin/kantata-diagnostic?workspaceIds=45402856,45442936 — app-admin
 * only. Answers "does this Kantata workspace have resourcing data we can pull?"
 * from the server's own KANTATA_API_TOKEN, so an admin can see it in the app
 * instead of running a CLI script.
 *
 * Per workspace it reports Resource Center allocations (reserved hours per
 * person — what the resourcing "By hours" view reads) and story-level estimated
 * hours (the other place hours can live), with a verdict. Financial fields are
 * never returned — stripped from the one sample row, matching the mirror.
 *
 * Bounded on purpose (capped pulls, per-workspace story filter) so it stays
 * inside the origin's request window rather than walking the whole account.
 */

import { requireUser } from "../_lib/requireUser.js";
import { isAppAdmin } from "../_lib/requireAppAdmin.js";
import { toApiError } from "../_lib/apiError.js";

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

interface WorkspaceReport {
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

export default async function handler(
  req: { method?: string; headers?: Record<string, string | string[] | undefined>; query?: Record<string, unknown> },
  res: { status: (code: number) => { json: (body: unknown) => void }; setHeader: (k: string, v: string) => void },
): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  if (req.method && req.method !== "GET") {
    res.status(405).json({ error: { code: "validation_failed", message: "GET only" } });
    return;
  }

  const auth = await requireUser(typeof req.headers?.authorization === "string" ? req.headers.authorization : undefined);
  if (!auth.authorized) {
    res.status(auth.status).json(auth.body);
    return;
  }
  if (!(await isAppAdmin(auth.userId!))) {
    res.status(403).json({ error: { code: "forbidden", message: "app admins only" } });
    return;
  }

  const raw = typeof req.query?.workspaceIds === "string" ? req.query.workspaceIds : "";
  const workspaceIds = raw.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 10);
  if (workspaceIds.length === 0) {
    res.status(400).json({ error: { code: "validation_failed", message: "workspaceIds is required (comma-separated Kantata workspace ids)" } });
    return;
  }

  const token = process.env.KANTATA_API_TOKEN;
  if (!token) {
    res.status(200).json({ data: { configured: false, message: "KANTATA_API_TOKEN is not set on the server, so Kantata can't be queried." } });
    return;
  }

  try {
    // One bounded allocations pull, then filter per workspace (the endpoint
    // doesn't reliably filter server-side). 1500 rows ≈ recent Resource Center.
    let allAllocations: Row[] = [];
    let allocError: string | null = null;
    try {
      allAllocations = await pull(token, `${BASE}/workspace_allocations?per_page=200&order=updated_at:desc&include=user`, "workspace_allocations", 1500);
    } catch (e) {
      allocError = e instanceof Error ? e.message : "allocations pull failed";
    }

    const workspaces: WorkspaceReport[] = [];
    for (const wsId of workspaceIds) {
      const mine = allAllocations.filter((a) => String(a.workspace_id) === String(wsId));
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

    res.status(200).json({
      data: {
        configured: true,
        totalAllocationsVisible: allAllocations.length,
        allocationsTruncated: allAllocations.length >= 1500,
        ...(allocError ? { allocationsError: allocError } : {}),
        workspaces,
      },
    });
  } catch (err) {
    const { status, body } = toApiError(err);
    res.status(status).json(body);
  }
}
