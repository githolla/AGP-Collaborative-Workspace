/**
 * Interim email + password sign-in — a stop-gap until Microsoft SSO (Entra)
 * is wired. Team members are created with a password; they sign in with it.
 *
 * Passwords are NEVER stored in the clear. Each account carries a random salt
 * and a PBKDF2-SHA256 hash; only the salt + hash are persisted (in the shared
 * state), and sign-in re-derives the hash to compare.
 *
 * HONEST LIMITATION: the shared state is readable by any signed-in client, so
 * this is not a hardened auth system — it's a lightweight gate for the
 * prototype. It gets replaced wholesale by Microsoft SSO (see auth/ssoAuth.ts); do
 * not carry this into production as-is.
 */

const ITERATIONS = 100_000;
const IDENTITY_KEY = "agp-local-identity-v1";

export interface TeamAccount {
  id: string;
  name: string;
  email: string;
  title: string;
  /** base64 random salt */
  salt: string;
  /** base64 PBKDF2-SHA256(password, salt) */
  hash: string;
  createdAt: string;
}

export interface LocalIdentity {
  id: string;
  name: string;
  email: string;
  title: string;
}

function toB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function randomSalt(): string {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return toB64(a.buffer);
}

/** PBKDF2-SHA256 → base64 hash. */
export async function hashPassword(password: string, saltB64: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: fromB64(saltB64) as BufferSource, iterations: ITERATIONS, hash: "SHA-256" },
    key,
    256,
  );
  return toB64(bits);
}

/** Build a new team account with a hashed password. */
export async function makeTeamAccount(
  id: string,
  name: string,
  email: string,
  title: string,
  password: string,
  createdAt: string,
): Promise<TeamAccount> {
  const salt = randomSalt();
  const hash = await hashPassword(password, salt);
  return { id, name: name.trim(), email: email.trim().toLowerCase(), title: title.trim(), salt, hash, createdAt };
}

/** Verify a login against the team list. Returns the identity or null. */
export async function authenticate(
  email: string,
  password: string,
  team: TeamAccount[],
): Promise<LocalIdentity | null> {
  const acct = team.find((a) => a.email === email.trim().toLowerCase());
  if (!acct) return null;
  const hash = await hashPassword(password, acct.salt);
  if (hash !== acct.hash) return null;
  return { id: acct.id, name: acct.name, email: acct.email, title: acct.title };
}

// ---- current signed-in identity (this browser) ----------------------------
export function loadIdentity(): LocalIdentity | null {
  try {
    const raw = window.localStorage.getItem(IDENTITY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalIdentity;
    return parsed.email && parsed.name ? parsed : null;
  } catch {
    return null;
  }
}
export function saveIdentity(id: LocalIdentity): void {
  try {
    window.localStorage.setItem(IDENTITY_KEY, JSON.stringify(id));
  } catch {
    // storage unavailable — session-only
  }
}
export function clearIdentity(): void {
  try {
    window.localStorage.removeItem(IDENTITY_KEY);
  } catch {
    /* noop */
  }
}
