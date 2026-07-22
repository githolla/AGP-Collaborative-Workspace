/**
 * Microsoft (Entra / Azure AD) sign-in — the browser half of MS SSO.
 *
 * Dependency-free OAuth2 Authorization-Code + PKCE flow for a SPA public
 * client. The client id and tenant id are NOT secrets (they're public in a
 * PKCE SPA flow), so they ride in as VITE_-exposed env — no secret is ever
 * shipped to the browser. The server half (api/_lib/entraAuth.ts) validates
 * the token when AUTH_REQUIRED=true.
 *
 * Goes live the moment an Azure app registration exists and these are set:
 *   VITE_ENTRA_TENANT_ID   — the directory (tenant) id
 *   VITE_ENTRA_CLIENT_ID   — the app registration (client) id, SPA platform,
 *                            redirect URI = this app's origin
 * Until then `configured` is false and the app stays in local-profile mode.
 */

const STORE_KEY = "agp-entra-identity-v1";
const PKCE_KEY = "agp-entra-pkce";
const SCOPES = "openid profile email User.Read";

export interface Identity {
  name: string;
  email: string;
  /** Raw id_token — sent as the Bearer to /api/* once AUTH_REQUIRED is on. */
  idToken: string;
}

function env(key: string): string {
  // import.meta.env is Vite-injected; guard so tests/node don't throw.
  const meta = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  return (meta[key] ?? "").trim();
}

export function entraConfig(): { tenantId: string; clientId: string; redirectUri: string } | null {
  const tenantId = env("VITE_ENTRA_TENANT_ID");
  const clientId = env("VITE_ENTRA_CLIENT_ID");
  if (!tenantId || !clientId) return null;
  return { tenantId, clientId, redirectUri: window.location.origin + window.location.pathname };
}

export const ssoConfigured = (): boolean => entraConfig() !== null;

const authorityBase = (tenantId: string) => `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0`;

// ---- PKCE helpers ---------------------------------------------------------
function randomString(bytes = 32): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return base64url(a.buffer);
}
function base64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function sha256(text: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
}
function decodeJwtClaims(token: string): Record<string, unknown> {
  try {
    const part = token.split(".")[1] ?? "";
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// ---- Public API -----------------------------------------------------------
export function currentIdentity(): Identity | null {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Identity;
    return parsed.name && parsed.idToken ? parsed : null;
  } catch {
    return null;
  }
}

/** Kick off the redirect to Microsoft. Returns false if SSO isn't configured. */
export async function signInWithMicrosoft(): Promise<boolean> {
  const cfg = entraConfig();
  if (!cfg) return false;
  const verifier = randomString();
  const challenge = base64url(await sha256(verifier));
  const state = randomString(16);
  sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state }));
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: "code",
    redirect_uri: cfg.redirectUri,
    response_mode: "query",
    scope: SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  window.location.assign(`${authorityBase(cfg.tenantId)}/authorize?${params.toString()}`);
  return true;
}

/**
 * Call once on app load. If we're back from Microsoft with a ?code, exchange
 * it for tokens, store the identity, and clean the URL. Returns the identity
 * when a sign-in just completed, else the existing one (or null).
 */
export async function handleRedirect(): Promise<Identity | null> {
  const cfg = entraConfig();
  if (!cfg) return currentIdentity();
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code) return currentIdentity();

  const stored = (() => {
    try {
      return JSON.parse(sessionStorage.getItem(PKCE_KEY) ?? "{}") as { verifier?: string; state?: string };
    } catch {
      return {};
    }
  })();
  sessionStorage.removeItem(PKCE_KEY);
  // Clean the auth params off the URL regardless of outcome.
  const clean = () => window.history.replaceState({}, document.title, cfg.redirectUri);
  if (!stored.verifier || stored.state !== state) {
    clean();
    return currentIdentity();
  }

  try {
    const body = new URLSearchParams({
      client_id: cfg.clientId,
      grant_type: "authorization_code",
      code,
      redirect_uri: cfg.redirectUri,
      code_verifier: stored.verifier,
    });
    const res = await fetch(`${authorityBase(cfg.tenantId)}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) {
      clean();
      return currentIdentity();
    }
    const tokens = (await res.json()) as { id_token?: string };
    const claims = decodeJwtClaims(tokens.id_token ?? "");
    const identity: Identity = {
      name: String(claims.name ?? claims.preferred_username ?? "Signed in"),
      email: String(claims.preferred_username ?? claims.email ?? ""),
      idToken: tokens.id_token ?? "",
    };
    window.localStorage.setItem(STORE_KEY, JSON.stringify(identity));
    clean();
    return identity;
  } catch {
    clean();
    return currentIdentity();
  }
}

/** Clear the local identity and (if configured) redirect to the Entra logout. */
export function signOutOfMicrosoft(): void {
  window.localStorage.removeItem(STORE_KEY);
  const cfg = entraConfig();
  if (!cfg) return;
  const params = new URLSearchParams({ post_logout_redirect_uri: cfg.redirectUri });
  window.location.assign(`${authorityBase(cfg.tenantId)}/logout?${params.toString()}`);
}
