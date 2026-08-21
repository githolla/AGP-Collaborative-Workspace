import { apiFetch } from "../auth/apiFetch.js";
import { currentGraphTokenDetailed } from "../auth/graphAuth.js";

/**
 * Shared transport for the B3-B7 (teams-provisioning-plan.md) endpoints —
 * every one of them is a Graph-backed mutation whose server side forwards
 * the caller's OWN delegated token (docs/api-spec-workspace-mutations.md
 * rule 2: "Graph calls carry the caller's own delegated token, forwarded as
 * X-Graph-Token"). This is why msProvision.ts/msShare.ts/msFiles.ts are thin
 * wrappers here rather than modules that call Microsoft Graph directly: the
 * actual Graph orchestration (retry/backoff, 404-tolerance, the invite/
 * revoke calls) lives server-side in api/_lib/graph.ts and is exercised by
 * api/account-team.ts, api/account-folders*.ts, api/grant.ts and friends —
 * this module's only job is getting a Graph token and attaching it.
 *
 * `graphConfigured()` being false, or `currentGraphToken` returning null
 * (consent not landed, sign-in didn't complete), surfaces as the same
 * `graph_token_required` the server would return for a missing header —
 * callers get one consistent shape either way, not a special client-side
 * case.
 */

export interface ApiError {
  code: string;
  message: string;
  detail?: string;
}

export class MsApiError extends Error {
  code: string;
  detail?: string | undefined;
  constructor(err: ApiError) {
    super(err.message);
    this.code = err.code;
    this.detail = err.detail;
  }
}

async function withGraphToken(loginHintEmail: string | undefined, headers: Headers): Promise<void> {
  const { token, reason } = await currentGraphTokenDetailed(loginHintEmail);
  if (!token) {
    throw new MsApiError({ code: "graph_token_required", message: reason ?? "no Microsoft Graph token available", ...(reason ? { detail: reason } : {}) });
  }
  headers.set("X-Graph-Token", token);
}

/** POST/PATCH/DELETE with a JSON body, Graph token attached. */
export async function msApiCall<T>(path: string, opts: { method?: string; body?: unknown; loginHintEmail?: string | undefined } = {}): Promise<T> {
  const headers = new Headers({ "Content-Type": "application/json" });
  await withGraphToken(opts.loginHintEmail, headers);
  const res = await apiFetch(path, {
    method: opts.method ?? "POST",
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  const json = (await res.json().catch(() => null)) as { data?: T; error?: ApiError } | null;
  if (!res.ok || !json || json.error) {
    throw new MsApiError(json?.error ?? { code: "internal_error", message: `request failed (${res.status})` });
  }
  return json.data as T;
}

/** POST/PATCH/DELETE with a Graph token attached WHEN ONE IS AVAILABLE, but
 * never blocking the request otherwise — for the few endpoints (api/grant.ts's
 * revoke, api/grant/revoke-all.ts) whose server side already tolerates a
 * missing X-Graph-Token by degrading to a DB-only effect (the access_grant
 * row is deleted either way; only the real SharePoint permission removal
 * needs the token). Using the hard-required `msApiCall` here would
 * incorrectly make even a no-SharePoint-connection revoke depend on the
 * caller having a live Graph session — access_grant is the source of truth
 * for what this app believes someone can reach, and revoking THAT must never
 * be blocked by an unrelated Graph/consent problem. */
export async function msApiCallOptionalGraphToken<T>(path: string, opts: { method?: string; body?: unknown; loginHintEmail?: string | undefined } = {}): Promise<T> {
  const headers = new Headers({ "Content-Type": "application/json" });
  try {
    await withGraphToken(opts.loginHintEmail, headers);
  } catch {
    // Proceed without X-Graph-Token — the server-side handlers this backs
    // treat that the same as "SharePoint isn't connected for this grant,"
    // not as a reason to refuse the request.
  }
  const res = await apiFetch(path, {
    method: opts.method ?? "POST",
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  const json = (await res.json().catch(() => null)) as { data?: T; error?: ApiError } | null;
  if (!res.ok || !json || json.error) {
    throw new MsApiError(json?.error ?? { code: "internal_error", message: `request failed (${res.status})` });
  }
  return json.data as T;
}

/** GET with a Graph token attached (api/files.ts's listing). */
export async function msApiGet<T>(path: string, opts: { loginHintEmail?: string | undefined } = {}): Promise<T> {
  const headers = new Headers();
  await withGraphToken(opts.loginHintEmail, headers);
  const res = await apiFetch(path, { headers });
  const json = (await res.json().catch(() => null)) as { data?: T; error?: ApiError } | null;
  if (!res.ok || !json || json.error) {
    throw new MsApiError(json?.error ?? { code: "internal_error", message: `request failed (${res.status})` });
  }
  return json.data as T;
}

/** POST/PATCH/DELETE with no Graph token — plain Postgres writes
 * (api/member.ts, api/external.ts, api/account*.ts's non-Graph routes) never
 * need one; only the Graph-backed endpoints do. */
export async function msApiCallPlain<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await apiFetch(path, {
    method: opts.method ?? "POST",
    headers: { "Content-Type": "application/json" },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  const json = (await res.json().catch(() => null)) as { data?: T; error?: ApiError } | null;
  if (!res.ok || !json || json.error) {
    throw new MsApiError(json?.error ?? { code: "internal_error", message: `request failed (${res.status})` });
  }
  return json.data as T;
}

/** GET with no Graph token — plain Postgres reads (api/workspace.ts) never
 * need one, and requiring it here would block a page that only needs
 * already-stored msTeam/ms_folder/member/grant data from ever loading just
 * because Graph consent hasn't landed yet. */
export async function msApiGetPlain<T>(path: string): Promise<T> {
  const res = await apiFetch(path);
  const json = (await res.json().catch(() => null)) as { data?: T; error?: ApiError } | null;
  if (!res.ok || !json || json.error) {
    throw new MsApiError(json?.error ?? { code: "internal_error", message: `request failed (${res.status})` });
  }
  return json.data as T;
}
