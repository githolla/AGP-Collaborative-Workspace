/**
 * /api/kantata-write — the WRITE half of the Kantata integration.
 *
 * Everything else in this app reads Kantata (api/mirror.ts). This endpoint is
 * the only place that writes back, and it exists so a change made in the
 * collaboration workspace — an owner, a due date, a status, a weekly
 * reservation — lands in Kantata, which is AGP's system of record for
 * capacity. See docs/kantata-writeback-resource-planner.md.
 *
 * Three rules this file enforces, in this order:
 *
 *  1. SIGNED IN. The same Supabase gate every other endpoint uses.
 *  2. EXPLICITLY ENABLED. Without KANTATA_WRITE_ENABLED=true every request is
 *     answered as a DRY RUN: intents are validated and the exact upstream
 *     calls are described back, but nothing is sent to Kantata. Writing to a
 *     customer's system of record is not something to switch on by deploying.
 *  3. NARROW. Only the fields in the table below are writable. An intent that
 *     names anything else is rejected — a bug in the browser must not be able
 *     to rewrite arbitrary Kantata records.
 *
 *   intent            upstream call                       writes
 *   story.update      PUT  /stories/{id}                  title, due_date,
 *                                                         state, percent,
 *                                                         assignee_ids
 *   story.create      POST /stories                       a new task in a
 *                                                         workspace
 *   allocation.set    POST /workspace_allocations         reserved hours for
 *                                                         one person, one week
 *
 * Intents are executed one at a time and reported one at a time: a batch of
 * five where the third fails still applies the other four, and the response
 * says exactly which. The browser marks only what actually landed.
 *
 * KANTATA_API_TOKEN never reaches the browser. Self-contained on purpose (no
 * workspace imports beyond ./_lib): Vercel bundles this file independently of
 * the pnpm monorepo.
 */
import { requireAuth } from "./_lib/authGate.js";

const API = "https://api.mavenlink.com/api/v1";

/**
 * Kantata story states we accept. Mirrors the app's three task columns plus
 * the two extra states Kantata projects use in practice, so a task that came
 * in as "accepted" can be written back without being flattened to "completed".
 */
const STATES = new Set(["not started", "started", "completed", "accepted", "blocked"]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^\d+$/;

export interface StoryUpdateIntent {
  kind: "story.update";
  /** Client-side correlation id — echoed back so the browser can match results. */
  ref: string;
  storyId: string;
  title?: string;
  dueDate?: string | null;
  state?: string;
  percent?: number;
  assigneeIds?: string[];
}

export interface StoryCreateIntent {
  kind: "story.create";
  ref: string;
  projectId: string;
  title: string;
  dueDate?: string;
  state?: string;
  assigneeIds?: string[];
}

export interface AllocationSetIntent {
  kind: "allocation.set";
  ref: string;
  projectId: string;
  userId: string;
  /** Monday of the reserved week. */
  startDate: string;
  /** Sunday of the reserved week. */
  endDate: string;
  hours: number;
}

export type WriteIntent = StoryUpdateIntent | StoryCreateIntent | AllocationSetIntent;

interface PlannedCall {
  method: "POST" | "PUT";
  url: string;
  body: Record<string, unknown>;
}

interface IntentResult {
  ref: string;
  kind: string;
  ok: boolean;
  /** True when nothing was sent upstream (dry run). */
  planned: boolean;
  /** The call that was (or would be) made — the audit line. */
  call?: { method: string; path: string; body: Record<string, unknown> };
  /** Kantata story id, on a successful create — the browser stores it. */
  createdId?: string;
  error?: string;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function ids(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.map((x) => str(x)).filter((x) => ID.test(x));
  return out.length > 0 ? out : undefined;
}

/**
 * Validate one intent and build the upstream call. Returns an error string
 * instead of throwing — one bad intent must not fail its whole batch.
 *
 * Exported for the unit tests: this is the security boundary, so it is tested
 * directly rather than through the handler.
 */
export function planCall(raw: unknown): { call: PlannedCall } | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "intent must be an object" };
  const i = raw as Record<string, unknown>;
  const kind = str(i.kind);

  if (kind === "story.update") {
    const storyId = str(i.storyId);
    if (!ID.test(storyId)) return { error: "storyId must be a Kantata story id" };
    const story: Record<string, unknown> = {};
    if (i.title !== undefined) {
      const title = str(i.title);
      if (!title) return { error: "title cannot be blank" };
      story.title = title;
    }
    if (i.dueDate !== undefined) {
      // null clears the date in Kantata — a real edit, so it is allowed.
      if (i.dueDate === null) story.due_date = null;
      else {
        const due = str(i.dueDate);
        if (!ISO_DATE.test(due)) return { error: "dueDate must be YYYY-MM-DD or null" };
        story.due_date = due;
      }
    }
    if (i.state !== undefined) {
      const state = str(i.state).toLowerCase();
      if (!STATES.has(state)) return { error: `state must be one of: ${[...STATES].join(", ")}` };
      story.state = state;
    }
    if (i.percent !== undefined) {
      const pct = typeof i.percent === "number" ? Math.round(i.percent) : NaN;
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) return { error: "percent must be 0-100" };
      story.percentage_complete = pct;
    }
    if (i.assigneeIds !== undefined) {
      const a = ids(i.assigneeIds);
      // An empty array is how you UNASSIGN in Kantata, so it is meaningful —
      // but only when the caller actually sent an array.
      if (!Array.isArray(i.assigneeIds)) return { error: "assigneeIds must be an array" };
      story.assignee_ids = a ?? [];
    }
    if (Object.keys(story).length === 0) return { error: "nothing to update" };
    return { call: { method: "PUT", url: `${API}/stories/${storyId}`, body: { story } } };
  }

  if (kind === "story.create") {
    const projectId = str(i.projectId);
    if (!ID.test(projectId)) return { error: "projectId must be a Kantata workspace id" };
    const title = str(i.title);
    if (!title) return { error: "title required" };
    const story: Record<string, unknown> = { workspace_id: projectId, title, story_type: "task" };
    if (i.dueDate !== undefined) {
      const due = str(i.dueDate);
      if (!ISO_DATE.test(due)) return { error: "dueDate must be YYYY-MM-DD" };
      story.due_date = due;
    }
    if (i.state !== undefined) {
      const state = str(i.state).toLowerCase();
      if (!STATES.has(state)) return { error: `state must be one of: ${[...STATES].join(", ")}` };
      story.state = state;
    }
    const a = ids(i.assigneeIds);
    if (a) story.assignee_ids = a;
    return { call: { method: "POST", url: `${API}/stories`, body: { story } } };
  }

  if (kind === "allocation.set") {
    const projectId = str(i.projectId);
    const userId = str(i.userId);
    if (!ID.test(projectId)) return { error: "projectId must be a Kantata workspace id" };
    if (!ID.test(userId)) return { error: "userId must be a Kantata user id" };
    const start = str(i.startDate);
    const end = str(i.endDate);
    if (!ISO_DATE.test(start) || !ISO_DATE.test(end)) return { error: "startDate/endDate must be YYYY-MM-DD" };
    if (end < start) return { error: "endDate is before startDate" };
    const hours = typeof i.hours === "number" ? i.hours : NaN;
    // 168 is a week. Anything above it is a units mix-up (minutes for hours),
    // not a booking — reject rather than reserve someone for eight weeks.
    if (!Number.isFinite(hours) || hours < 0 || hours > 168) return { error: "hours must be 0-168" };
    return {
      call: {
        method: "POST",
        url: `${API}/workspace_allocations`,
        body: {
          workspace_allocation: {
            workspace_id: projectId,
            user_id: userId,
            start_date: start,
            end_date: end,
            allocated_hours: Math.round(hours * 100) / 100,
          },
        },
      },
    };
  }

  return { error: `unknown intent kind: ${kind || "(missing)"}` };
}

/** The story id Kantata returns from a create, wherever it put it. */
function createdStoryId(json: unknown): string | undefined {
  const j = json as { results?: { key?: string; id?: number | string }[]; stories?: Record<string, unknown> } | null;
  const fromResults = j?.results?.find((r) => r.key === "stories")?.id;
  if (fromResults != null) return String(fromResults);
  const keys = j?.stories ? Object.keys(j.stories) : [];
  return keys[0];
}

async function execute(call: PlannedCall, token: string): Promise<{ ok: true; createdId?: string } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetch(call.url, {
      method: call.method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(call.body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "request failed" };
  }
  if (!res.ok) {
    // Kantata puts the useful part in the body; truncated so one bad intent
    // can't return a page of HTML.
    const text = (await res.text().catch(() => "")).slice(0, 400);
    return { ok: false, error: `Kantata ${res.status}${text ? `: ${text}` : ""}` };
  }
  const json = await res.json().catch(() => null);
  const createdId = call.method === "POST" && call.url.endsWith("/stories") ? createdStoryId(json) : undefined;
  return { ok: true, ...(createdId ? { createdId } : {}) };
}

/** Path only — the full URL carries no secrets, but the log reads better. */
const pathOf = (url: string): string => url.slice(API.length);

export default async function handler(
  req: { method?: string; body?: unknown; headers?: Record<string, string | string[] | undefined> },
  res: {
    status: (code: number) => { json: (body: unknown) => void };
    setHeader: (k: string, v: string) => void;
  },
): Promise<void> {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }

  const auth = await requireAuth(typeof req.headers?.authorization === "string" ? req.headers.authorization : undefined);
  if (!auth.authorized) {
    res.status(auth.status).json(auth.body);
    return;
  }

  const token = process.env.KANTATA_API_TOKEN;
  const enabled = process.env.KANTATA_WRITE_ENABLED === "true";

  const body = (req.body ?? {}) as { intents?: unknown; dryRun?: unknown };
  const intents = Array.isArray(body.intents) ? body.intents : null;
  if (!intents) {
    res.status(400).json({ error: "intents array required" });
    return;
  }
  // A batch is one user's edits being flushed, not a migration. The cap keeps
  // a runaway client from walking the whole tenant in one request.
  if (intents.length > 50) {
    res.status(400).json({ error: "at most 50 intents per request" });
    return;
  }

  // Dry run unless writes are switched on AND the caller didn't ask for one.
  // Missing token is treated as not-enabled rather than an error, so the
  // endpoint stays useful (it validates and explains) on any environment.
  const dryRun = body.dryRun === true || !enabled || !token;
  const reason = !token ? "KANTATA_API_TOKEN not set" : !enabled ? "KANTATA_WRITE_ENABLED is not true" : body.dryRun === true ? "caller asked for a dry run" : "";

  const results: IntentResult[] = [];
  for (const raw of intents) {
    const ref = str((raw as Record<string, unknown> | null)?.ref) || "(no ref)";
    const kind = str((raw as Record<string, unknown> | null)?.kind);
    const planned = planCall(raw);
    if ("error" in planned) {
      results.push({ ref, kind, ok: false, planned: true, error: planned.error });
      continue;
    }
    const call = { method: planned.call.method, path: pathOf(planned.call.url), body: planned.call.body };
    if (dryRun) {
      results.push({ ref, kind, ok: true, planned: true, call });
      continue;
    }
    const done = await execute(planned.call, token);
    results.push(
      done.ok
        ? { ref, kind, ok: true, planned: false, call, ...(done.createdId ? { createdId: done.createdId } : {}) }
        : { ref, kind, ok: false, planned: false, call, error: done.error },
    );
  }

  res.status(200).json({
    dryRun,
    ...(dryRun && reason ? { reason } : {}),
    applied: results.filter((r) => r.ok && !r.planned).length,
    failed: results.filter((r) => !r.ok).length,
    by: auth.user?.email ?? auth.user?.name ?? "unknown",
    at: new Date().toISOString(),
    results,
  });
}
