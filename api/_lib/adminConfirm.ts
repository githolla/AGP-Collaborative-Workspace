/**
 * Two-step confirmation for the API's genuinely destructive admin actions
 * (currently just api/admin/workspace/clear.ts, but written generically —
 * any future destructive admin endpoint needs the identical shape of
 * problem). A single `{ confirm: true }` boolean is trivially satisfied by
 * resending a copied curl command or a stale client retry; this requires
 * TWO separate requests:
 *
 *  1. Call with no token -> returns a signed, short-lived token describing
 *     exactly what's about to happen (via `snapshot`, e.g. the row count
 *     about to be deleted) and does nothing yet.
 *  2. Call again with that exact token, before it expires -> the handler
 *     verifies it and only then proceeds.
 *
 * The token is self-contained (HMAC-signed, not stored anywhere), so it
 * works identically whether the two calls land on the same long-lived
 * server.mts process or two different, unrelated Vercel invocations — no
 * shared memory or extra table required. It is bound to BOTH the specific
 * action name and the calling admin's own id, so a token issued for one
 * admin or one action can never be replayed for another; and to a
 * `snapshot` value the caller must recompute fresh at verify time — if
 * reality changed between issuing and redeeming (someone created another
 * account in the meantime, say), the snapshot no longer matches and the
 * token is rejected, forcing a fresh, current confirmation rather than
 * executing against stale intent.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_TTL_MS = 5 * 60_000;

function signingKey(): string {
  const raw = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!raw) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");
  // Derived, not the raw secret itself — a distinct key for this one
  // purpose, so this token's signature reveals nothing about (and can't be
  // confused with) any other use of the service role key.
  return createHmac("sha256", raw).update("admin-confirm-token-v1").digest("hex");
}

export interface ConfirmSubject {
  action: string;
  adminUserId: string;
  snapshot: string | number;
}

export function issueConfirmToken(subject: ConfirmSubject): { token: string; expiresAt: string } {
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const body = `${subject.action}.${subject.adminUserId}.${subject.snapshot}.${expiresAt}`;
  const sig = createHmac("sha256", signingKey()).update(body).digest("hex");
  return {
    token: Buffer.from(`${body}.${sig}`, "utf8").toString("base64url"),
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

export function verifyConfirmToken(token: string, subject: ConfirmSubject): { ok: true } | { ok: false; reason: string } {
  let decoded: string;
  try {
    decoded = Buffer.from(token, "base64url").toString("utf8");
  } catch {
    return { ok: false, reason: "malformed token" };
  }
  const parts = decoded.split(".");
  if (parts.length !== 5) return { ok: false, reason: "malformed token" };
  const [action, adminUserId, snapshot, expiresAtStr, sig] = parts as [string, string, string, string, string];

  const body = `${action}.${adminUserId}.${snapshot}.${expiresAtStr}`;
  const expectedSig = createHmac("sha256", signingKey()).update(body).digest("hex");
  const sigBuf = Buffer.from(sig, "hex");
  const expectedBuf = Buffer.from(expectedSig, "hex");
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return { ok: false, reason: "invalid token" };
  }

  if (action !== subject.action || adminUserId !== subject.adminUserId) {
    return { ok: false, reason: "token was not issued for this action or this admin" };
  }
  if (snapshot !== String(subject.snapshot)) {
    return { ok: false, reason: "what would be affected has changed since this token was issued — request a new one" };
  }
  if (Date.now() > Number(expiresAtStr)) {
    return { ok: false, reason: "token expired — request a new one" };
  }
  return { ok: true };
}
