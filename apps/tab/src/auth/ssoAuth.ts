import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase Auth (Azure provider) wrapper. The public Supabase URL + anon key
 * are browser-safe by design and expected in VITE_ env vars.
 */

const STORE_KEY = "agp-supabase-identity-v1";

export interface Identity {
  name: string;
  email: string;
  /** Supabase access token — attached to /api requests as Bearer. */
  idToken: string;
}

function env(key: string): string {
  const meta = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  return (meta[key] ?? "").trim();
}

export function ssoConfig(): { redirectUri: string } | null {
  const url = env("VITE_SUPABASE_URL");
  const key = env("VITE_SUPABASE_ANON_KEY");
  const redirectUri = env("VITE_SUPABASE_REDIRECT_URI") || window.location.origin;
  if (!url || !key) return null;
  return { redirectUri };
}

export const ssoConfigured = (): boolean => {
  const enabled = (env("VITE_ENABLE_MICROSOFT_LOGIN") || "true").toLowerCase() === "true";
  return enabled && ssoConfig() !== null;
};

let supabase: SupabaseClient | null = null;

function client(): SupabaseClient | null {
  if (supabase) return supabase;
  const url = env("VITE_SUPABASE_URL");
  const key = env("VITE_SUPABASE_ANON_KEY");
  if (!url || !key) return null;
  supabase = createClient(url, key);
  return supabase;
}

function identityFromSession(session: Session | null): Identity | null {
  if (!session?.access_token || !session.user) return null;
  const meta = (session.user.user_metadata ?? {}) as Record<string, unknown>;
  const displayName =
    (typeof meta.full_name === "string" && meta.full_name.trim()) ||
    (typeof meta.name === "string" && meta.name.trim()) ||
    session.user.email ||
    "Signed in";
  return {
    name: displayName,
    email: session.user.email ?? "",
    idToken: session.access_token,
  };
}

function saveIdentity(identity: Identity | null): void {
  try {
    if (!identity) {
      window.localStorage.removeItem(STORE_KEY);
      return;
    }
    window.localStorage.setItem(STORE_KEY, JSON.stringify(identity));
  } catch {
    // storage unavailable — session still works in memory
  }
}

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

/** Kick off Supabase Azure OAuth. Returns false when not configured. */
export async function signInWithMicrosoft(): Promise<boolean> {
  const c = client();
  const cfg = ssoConfig();
  if (!c || !cfg || !ssoConfigured()) return false;
  const { error } = await c.auth.signInWithOAuth({
    provider: "azure",
    options: { scopes: "openid profile email", redirectTo: cfg.redirectUri },
  });
  return !error;
}

/** Resolve active Supabase session and mirror identity into local storage. */
export async function handleRedirect(): Promise<Identity | null> {
  const c = client();
  if (!c) return currentIdentity();
  try {
    const { data } = await c.auth.getSession();
    const identity = identityFromSession(data.session);
    saveIdentity(identity);
    return identity;
  } catch {
    return currentIdentity();
  }
}

/** Resolve freshest access token for API calls. */
export async function currentAccessToken(): Promise<string | null> {
  const c = client();
  if (!c) return currentIdentity()?.idToken ?? null;
  try {
    const { data } = await c.auth.getSession();
    const identity = identityFromSession(data.session);
    saveIdentity(identity);
    return identity?.idToken ?? null;
  } catch {
    return currentIdentity()?.idToken ?? null;
  }
}

/** Clear local identity and Supabase session. */
export async function signOutOfMicrosoft(): Promise<void> {
  const c = client();
  saveIdentity(null);
  if (!c) return;
  await c.auth.signOut();
}
