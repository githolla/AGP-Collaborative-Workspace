/**
 * POST /api/account-view-config — set a workspace's role-based view tiers.
 *
 * Persists the per-account `view_config` blob (migration 0026) that decides
 * which tabs each internal person sees: an "account" tier (Client Experience —
 * strategists + PMs) sees everything; a "delivery" tier sees only Home, Project
 * Plan, Discussions and Files. Shape:
 *   { defaultTier?: "account"|"delivery",
 *     memberTiers?: { <lowercased-email>: "account"|"delivery" } }
 *
 * Goes through collab.set_view_config() rather than a plain UPDATE for the same
 * reason as notify.ts — RLS can't scope an UPDATE to one jsonb column. The
 * config UI is app-admin-only on the client; server-side "admin only" is B6.
 */

import { requireUser } from "./_lib/requireUser.js";
import { withUserContext } from "./_lib/db.js";
import { toApiError } from "./_lib/apiError.js";

const TIERS = new Set(["account_manager", "project_manager", "delivery"]);

/** Keep only well-formed tier data — a bad value must never persist. */
function sanitize(raw: unknown): { defaultTier?: string; memberTiers: Record<string, string> } {
  const obj = (raw && typeof raw === "object" ? raw : {}) as { defaultTier?: unknown; memberTiers?: unknown };
  const out: { defaultTier?: string; memberTiers: Record<string, string> } = { memberTiers: {} };
  if (typeof obj.defaultTier === "string" && TIERS.has(obj.defaultTier)) out.defaultTier = obj.defaultTier;
  if (obj.memberTiers && typeof obj.memberTiers === "object") {
    for (const [email, tier] of Object.entries(obj.memberTiers as Record<string, unknown>)) {
      const key = email.trim().toLowerCase();
      if (key && typeof tier === "string" && TIERS.has(tier)) out.memberTiers[key] = tier;
    }
  }
  return out;
}

export default async function handler(
  req: { method?: string; body?: unknown; headers?: Record<string, string | string[] | undefined> },
  res: { status: (code: number) => { json: (body: unknown) => void }; setHeader: (k: string, v: string) => void },
): Promise<void> {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.status(405).json({ error: { code: "validation_failed", message: "POST only" } });
    return;
  }

  const authHeader = typeof req.headers?.authorization === "string" ? req.headers.authorization : undefined;
  const auth = await requireUser(authHeader);
  if (!auth.authorized) {
    res.status(auth.status).json(auth.body);
    return;
  }

  const b = req.body as { accountId?: unknown; config?: unknown };
  const accountId = typeof b?.accountId === "string" ? b.accountId : "";
  if (!accountId) {
    res.status(400).json({ error: { code: "validation_failed", message: "accountId is required" } });
    return;
  }
  const config = sanitize(b?.config);

  try {
    const [updated] = await withUserContext(auth.userId!, async (tx) => {
      return await tx<{ id: string; view_config: Record<string, unknown> }[]>`
        select id, view_config from collab.set_view_config(${accountId}, ${tx.json(config)})
      `;
    });
    if (!updated) throw new Error("set_view_config returned no row");
    res.status(200).json({ data: { accountId: updated.id, viewConfig: updated.view_config } });
  } catch (err) {
    const { status, body } = toApiError(err);
    res.status(status).json(body);
  }
}
