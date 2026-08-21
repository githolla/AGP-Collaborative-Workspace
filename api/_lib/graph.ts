/**
 * Server-side Microsoft Graph fetch helper (teams-provisioning-plan.md
 * B3/B4/B7; docs/api-spec-workspace-mutations.md rule 2). Every call here
 * carries the CALLER'S OWN delegated token, forwarded from the client's
 * `X-Graph-Token` header (acquired client-side via apps/tab's
 * auth/graphAuth.ts MSAL flow) — this module holds no application
 * credential of its own and stores nothing. A handler that cannot get a
 * token returns `graph_token_required` rather than falling back to
 * anything, per the spec's own rule.
 */

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const MAX_RETRIES = 3;

export function graphTokenFrom(headers: Record<string, string | string[] | undefined> | undefined): string | null {
  const v = headers?.["x-graph-token"];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export class GraphError extends Error {
  status: number;
  detail: string;
  constructor(status: number, detail: string) {
    super(`graph request failed: ${status} ${detail}`);
    this.status = status;
    this.detail = detail;
  }
}

/** Graph's own error body is `{ error: { code, message, innerError: {...} } }`
 * — the `innerError` block (request id, timestamp) is only useful to
 * Microsoft support, not to whoever is reading this in the app, so this
 * keeps just `code: message` when the body parses as that shape and falls
 * back to the raw text otherwise (a non-JSON body, or one that doesn't
 * match — still shown in full rather than swallowed). */
function readableGraphError(text: string): string {
  if (!text) return "";
  try {
    const parsed = JSON.parse(text) as { error?: { code?: string; message?: string } };
    const parts = [parsed.error?.code, parsed.error?.message].filter((p): p is string => !!p);
    if (parts.length > 0) return parts.join(": ");
  } catch {
    // Not JSON (or not the expected shape) — the raw text is all there is.
  }
  return text;
}

/**
 * Fetches one Graph endpoint with the forwarded delegated token, honouring
 * `Retry-After` on 429/503 (B3's own note: "honour Retry-After"). Returns
 * `null` on a 404 when `tolerate404` is set (B3: "404-tolerance for
 * filesFolder" and get-by-path folder lookups) — callers use that to decide
 * "does not exist yet" vs. a real failure. Any other non-2xx throws
 * `GraphError`, which callers map to the spec's `graph_failed` code.
 */
export async function graphFetch(
  token: string,
  path: string,
  init: { method?: string; body?: unknown; tolerate404?: boolean } = {},
): Promise<unknown> {
  const url = path.startsWith("http") ? path : `${GRAPH_BASE}${path}`;
  const method = init.method ?? "GET";

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });

    if (res.status === 429 || res.status === 503) {
      if (attempt === MAX_RETRIES) {
        const text = await res.text().catch(() => "");
        throw new GraphError(res.status, readableGraphError(text) || "throttled — retries exhausted");
      }
      const retryAfter = Number(res.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * (attempt + 1);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }

    if (res.status === 404 && init.tolerate404) return null;

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      // No server-side record of a Graph failure existed anywhere in this
      // codebase before this line — every prior "half-grant"/upload mystery
      // in this app's history had to be reconstructed after the fact from
      // the DB and a live retry, because the actual failing request was
      // never written down. The path (no token in it) and body are enough
      // to reproduce what was actually asked for.
      console.error(`[graph] ${method} ${path} -> ${res.status}`, init.body ? JSON.stringify(init.body) : "", text);
      throw new GraphError(res.status, readableGraphError(text) || res.statusText);
    }

    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
  // Unreachable — the loop always returns or throws.
  throw new GraphError(500, "graphFetch: retry loop exited without a result");
}

/** Maps a caught error to the spec's envelope. `GraphError` -> `graph_failed`
 * with the real Graph status folded into the detail (the spec has no per-
 * status Graph code, just one bucket); anything else rethrows for the
 * caller's own catch to handle as internal_error. */
export function graphApiError(err: unknown): { status: number; body: { error: { code: string; message: string; detail?: string } } } {
  if (err instanceof GraphError) {
    return { status: 502, body: { error: { code: "graph_failed", message: "Microsoft Graph request failed", detail: `${err.status}: ${err.detail}` } } };
  }
  throw err;
}
