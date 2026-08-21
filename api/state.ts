/**
 * /api/state — shared workspace persistence, backed by Supabase Storage.
 *
 * The whole workspace (accounts, ideas, builds) is one versioned JSON
 * document in a private bucket, read/written ONLY through this endpoint with
 * the service-role key (never exposed to the browser). Zero manual setup:
 * the bucket is created on first use.
 *
 * Concurrency: optimistic versioning — writes carry baseVersion; a stale
 * write gets 409 + the current envelope and the client adopts it
 * (last-write-wins per save, good enough until per-user auth and row-level
 * data land with Teams SSO — see docs/adr + BLOCKERS #5).
 *
 * SECURITY NOTE (accepted 2026-07-20, NARROWED 2026-08-17): with no bearer
 * token at all and AUTH_REQUIRED unset, this endpoint is still open by
 * design — that pre-SSO posture is unchanged. But Microsoft SSO is now LIVE
 * for real external guests too (teams-provisioning-plan.md C1/C2), and this
 * document (every ROI initiative, idea, and financial figure) is exactly
 * what C2 exists to keep an external from ever reaching — C2's own
 * client-side IdentityGate cannot be the only thing standing between an
 * external's valid token and this endpoint, since a token holder can always
 * call the API directly, bypassing any amount of client-side routing.
 * Whenever a bearer token IS present, this handler now independently
 * verifies it and refuses a caller `collab.app_user.kind` classifies as
 * "external" — regardless of AUTH_REQUIRED, since an external's token being
 * usable at all is the exact condition that must never reach this document.
 * Classification failure (no collab schema in this environment, a DB error)
 * fails OPEN here, matching every other place in this codebase that
 * classifies internal-vs-external (App.tsx's IdentityGate, api/me.ts) — the
 * alternative would let a transient Postgres hiccup lock out every
 * legitimate internal user of the one document the whole app still runs on.
 */

const BUCKET = "agp-workspace";
const OBJECT = "state.json";

interface Envelope {
  version: number;
  savedAt: string;
  state: unknown;
}

function supabaseHeaders(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key}`, apikey: key };
}

async function readEnvelope(url: string, key: string): Promise<Envelope | null> {
  // Network failures (DNS, timeout, connection reset) reject fetch() itself,
  // not just a bad response — caught here so a transient Supabase outage
  // degrades to "no envelope" instead of throwing out of the request handler
  // (which would crash the whole process on a long-lived host; Vercel only
  // loses the one invocation).
  try {
    const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${OBJECT}`, { headers: supabaseHeaders(key) });
    if (!res.ok) return null; // 400/404 = no state yet (or no bucket yet)
    const json = (await res.json()) as Partial<Envelope>;
    if (typeof json.version === "number" && json.state !== undefined) {
      return { version: json.version, savedAt: String(json.savedAt ?? ""), state: json.state };
    }
    return null;
  } catch {
    return null;
  }
}

async function writeEnvelope(url: string, key: string, envelope: Envelope): Promise<boolean> {
  // Same reasoning as readEnvelope: a rejected fetch() must resolve to a
  // handled `false`, not propagate — the caller already treats `false` as
  // "storage write failed" (502), which is exactly right for a network error.
  try {
    const upload = () =>
      fetch(`${url}/storage/v1/object/${BUCKET}/${OBJECT}`, {
        method: "POST",
        headers: { ...supabaseHeaders(key), "Content-Type": "application/json", "x-upsert": "true" },
        body: JSON.stringify(envelope),
      });
    let res = await upload();
    if (!res.ok) {
      // First ever save: create the private bucket, then retry once.
      await fetch(`${url}/storage/v1/bucket`, {
        method: "POST",
        headers: { ...supabaseHeaders(key), "Content-Type": "application/json" },
        body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }),
      });
      res = await upload();
    }
    return res.ok;
  } catch {
    return false;
  }
}

import { requireAuth } from "./_lib/authGate.js";
import { requireUser } from "./_lib/requireUser.js";
import { withUserContext } from "./_lib/db.js";

/**
 * Refuses a caller `collab.app_user.kind` classifies as "external" — see
 * this file's own SECURITY NOTE above for why this check exists here in
 * addition to (not instead of) the client-side IdentityGate. Only runs when
 * a bearer token is actually present; an anonymous request under the
 * pre-SSO AUTH_REQUIRED-unset posture is unaffected (a separate, already-
 * accepted gap this fix does not attempt to close). Never throws: any
 * failure to classify (no collab schema applied, a DB error) resolves to
 * `false` (not external) rather than blocking the request.
 */
async function callerIsExternal(authorizationHeader: string | undefined): Promise<boolean> {
  if (!authorizationHeader) return false;
  const verified = await requireUser(authorizationHeader);
  if (!verified.authorized || !verified.userId) return false;
  const userId = verified.userId;
  try {
    const [row] = await withUserContext(userId, async (tx) => tx<{ kind: string }[]>`select kind from collab.app_user where id = ${userId}`);
    return row?.kind === "external";
  } catch {
    return false;
  }
}

export default async function handler(
  req: { method?: string; body?: unknown; headers?: Record<string, string | string[] | undefined> },
  res: {
    status: (code: number) => { json: (body: unknown) => void };
    setHeader: (k: string, v: string) => void;
  },
): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  const authHeader = typeof req.headers?.authorization === "string" ? req.headers.authorization : undefined;

  const auth = await requireAuth(authHeader);
  if (!auth.authorized) {
    res.status(auth.status).json(auth.body);
    return;
  }
  if (await callerIsExternal(authHeader)) {
    res.status(403).json({ error: "not available to external accounts" });
    return;
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    res.status(200).json({ configured: false, reason: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set" });
    return;
  }

  if (req.method === "GET") {
    const envelope = await readEnvelope(url, key);
    res.status(200).json(envelope ? { configured: true, exists: true, envelope } : { configured: true, exists: false });
    return;
  }

  if (req.method === "POST") {
    const body = (req.body ?? {}) as { baseVersion?: number; state?: unknown };
    if (body.state === undefined) {
      res.status(400).json({ error: "state required" });
      return;
    }
    const current = await readEnvelope(url, key);
    const currentVersion = current?.version ?? 0;
    if ((body.baseVersion ?? 0) !== currentVersion) {
      res.status(409).json({ conflict: true, envelope: current });
      return;
    }
    const next: Envelope = { version: currentVersion + 1, savedAt: new Date().toISOString(), state: body.state };
    const ok = await writeEnvelope(url, key, next);
    if (!ok) {
      res.status(502).json({ error: "storage write failed" });
      return;
    }
    res.status(200).json({ ok: true, version: next.version, savedAt: next.savedAt });
    return;
  }

  res.status(405).json({ error: "GET or POST" });
}
