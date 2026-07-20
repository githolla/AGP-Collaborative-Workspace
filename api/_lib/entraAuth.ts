/**
 * Microsoft Entra ID token validation for the /api functions — the server
 * half of MS SSO (ADR 0007). Dormant until AUTH_REQUIRED=true; once the
 * Entra app registration exists (BLOCKERS #5), flipping the env vars turns
 * every endpoint from open-demo mode to signed-in-only.
 *
 * Validates RS256-signed Entra ID tokens against the tenant's published
 * JWKS: signature (WebCrypto), issuer, audience, expiry. No dependencies.
 * Files under api/_lib are not routes.
 */

export interface EntraJwk {
  kty: string;
  kid?: string;
  n?: string;
  e?: string;
}

export interface VerifyOptions {
  tenantId: string;
  clientId: string;
  /** Test seam: inject a JWKS instead of fetching the tenant's. */
  jwks?: { keys: EntraJwk[] };
  nowSeconds?: number;
}

export interface VerifyResult {
  ok: boolean;
  reason?: string;
  name?: string;
  email?: string;
}

let jwksCache: { url: string; keys: EntraJwk[]; at: number } | null = null;
const JWKS_TTL_MS = 60 * 60 * 1000;

function b64urlToBytes(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "base64url"));
}

function decodeJson<T>(b64url: string): T | null {
  try {
    return JSON.parse(Buffer.from(b64url, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

async function loadJwks(tenantId: string, injected?: { keys: EntraJwk[] }): Promise<EntraJwk[]> {
  if (injected) return injected.keys;
  const url = `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`;
  if (jwksCache && jwksCache.url === url && Date.now() - jwksCache.at < JWKS_TTL_MS) return jwksCache.keys;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`JWKS HTTP ${res.status}`);
  const json = (await res.json()) as { keys?: EntraJwk[] };
  jwksCache = { url, keys: json.keys ?? [], at: Date.now() };
  return jwksCache.keys;
}

export async function verifyEntraToken(token: string, opts: VerifyOptions): Promise<VerifyResult> {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed token" };
  const [h, p, sig] = parts as [string, string, string];

  const header = decodeJson<{ alg?: string; kid?: string }>(h);
  const payload = decodeJson<{
    iss?: string;
    aud?: string;
    exp?: number;
    name?: string;
    preferred_username?: string;
  }>(p);
  if (!header || !payload) return { ok: false, reason: "undecodable token" };
  if (header.alg !== "RS256") return { ok: false, reason: `unsupported alg ${header.alg}` };

  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp <= now) return { ok: false, reason: "expired" };
  if (payload.aud !== opts.clientId) return { ok: false, reason: "wrong audience" };
  const issuer = `https://login.microsoftonline.com/${opts.tenantId}/v2.0`;
  if (payload.iss !== issuer) return { ok: false, reason: "wrong issuer" };

  let keys: EntraJwk[];
  try {
    keys = await loadJwks(opts.tenantId, opts.jwks);
  } catch (err) {
    return { ok: false, reason: `jwks unavailable: ${err instanceof Error ? err.message : "unknown"}` };
  }
  const jwk = keys.find((k) => k.kid === header.kid && k.kty === "RSA");
  if (!jwk || !jwk.n || !jwk.e) return { ok: false, reason: "signing key not found" };

  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: "RSA", n: jwk.n, e: jwk.e },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      b64urlToBytes(sig),
      new TextEncoder().encode(`${h}.${p}`),
    );
    if (!valid) return { ok: false, reason: "bad signature" };
  } catch {
    return { ok: false, reason: "signature verification failed" };
  }

  return {
    ok: true,
    ...(payload.name ? { name: payload.name } : {}),
    ...(payload.preferred_username ? { email: payload.preferred_username } : {}),
  };
}

export interface AuthGateResult {
  authorized: boolean;
  status: number;
  body?: unknown;
  user?: { name?: string; email?: string };
}

/**
 * Endpoint gate. Open mode (AUTH_REQUIRED unset) authorizes everything —
 * today's behavior. With AUTH_REQUIRED=true + ENTRA_TENANT_ID +
 * ENTRA_CLIENT_ID set, a valid Entra Bearer token is required.
 */
export async function requireAuth(authorizationHeader: string | undefined): Promise<AuthGateResult> {
  if (process.env.AUTH_REQUIRED !== "true") return { authorized: true, status: 200 };
  const tenantId = process.env.ENTRA_TENANT_ID;
  const clientId = process.env.ENTRA_CLIENT_ID;
  if (!tenantId || !clientId) {
    return { authorized: false, status: 500, body: { error: "AUTH_REQUIRED set but ENTRA_TENANT_ID/ENTRA_CLIENT_ID missing" } };
  }
  const token = authorizationHeader?.startsWith("Bearer ") ? authorizationHeader.slice(7) : undefined;
  if (!token) return { authorized: false, status: 401, body: { error: "sign-in required" } };
  const result = await verifyEntraToken(token, { tenantId, clientId });
  if (!result.ok) return { authorized: false, status: 401, body: { error: `invalid token: ${result.reason}` } };
  return {
    authorized: true,
    status: 200,
    user: { ...(result.name ? { name: result.name } : {}), ...(result.email ? { email: result.email } : {}) },
  };
}
