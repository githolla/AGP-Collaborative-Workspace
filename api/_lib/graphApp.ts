/**
 * APPLICATION-credential Microsoft Graph access — a deliberate, isolated
 * counterpart to graph.ts (which is delegated-only and holds no secret).
 *
 * Two-way Teams sync needs the app to act with NO user present: when someone
 * types in a Teams channel, no one is signed into the workspace to forward a
 * token, so reading that message and running the change-notification
 * subscription require an application identity (client-credentials flow) with
 * the `ChannelMessage.Read.All` application permission (admin-consented).
 *
 * This is a security-relevant addition (a stored client secret), kept entirely
 * in this one module and gated behind env: if GRAPH_APP_CLIENT_ID /
 * GRAPH_APP_CLIENT_SECRET / GRAPH_APP_TENANT_ID are unset, `graphAppConfigured()`
 * is false and every caller no-ops rather than failing. Nothing else in the app
 * gains an app credential.
 */

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export function graphAppConfigured(): boolean {
  return !!(process.env.GRAPH_APP_CLIENT_ID && process.env.GRAPH_APP_CLIENT_SECRET && process.env.GRAPH_APP_TENANT_ID);
}

let cachedToken: { value: string; expiresAt: number } | null = null;

/** Client-credentials token for Graph, cached until ~1 min before expiry. */
async function appToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - 60_000 > now) return cachedToken.value;
  const tenant = process.env.GRAPH_APP_TENANT_ID!;
  const params = new URLSearchParams({
    client_id: process.env.GRAPH_APP_CLIENT_ID!,
    client_secret: process.env.GRAPH_APP_CLIENT_SECRET!,
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default",
  });
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`app token request failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("app token response missing access_token");
  cachedToken = { value: json.access_token, expiresAt: now + (json.expires_in ?? 3600) * 1000 };
  return cachedToken.value;
}

export class GraphAppError extends Error {
  status: number;
  constructor(status: number, detail: string) {
    super(`graph app request failed: ${status} ${detail}`);
    this.status = status;
  }
}

/**
 * Fetch one Graph endpoint with the application token. Absolute URLs pass
 * through; bare paths are prefixed with the v1.0 base. Throws GraphAppError on
 * a non-2xx (callers decide whether to swallow).
 */
export async function graphAppFetch(path: string, init: { method?: string; body?: unknown } = {}): Promise<unknown> {
  const token = await appToken();
  const url = path.startsWith("http") ? path : `${GRAPH_BASE}${path}`;
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    signal: AbortSignal.timeout(12_000),
  });
  const text = await res.text();
  if (!res.ok) throw new GraphAppError(res.status, text.slice(0, 200));
  return text ? JSON.parse(text) : null;
}
