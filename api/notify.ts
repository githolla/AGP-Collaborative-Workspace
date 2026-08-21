/**
 * PATCH /api/notify — `PATCH /api/account/:id/notify/:personName`
 * (docs/api-spec-workspace-mutations.md), replacing `setNotifyPref`.
 *
 * Goes through collab.set_notify_pref() (migration 0012) rather than a plain
 * UPDATE on client_account — see that migration's header for why: the spec
 * gives this route role "member", but client_account_update's RLS policy is
 * workspace_admin-only for every other field on that table, and RLS can't
 * split "any member may touch notify_prefs" from "only admin may touch
 * client_name/archived/etc." on the same table without also opening every
 * other column to any member.
 */

import { requireUser } from "./_lib/requireUser.js";
import { withUserContext } from "./_lib/db.js";
import { toApiError } from "./_lib/apiError.js";

const PREFS = new Set(["teams", "email", "both"]);

export default async function handler(
  req: { method?: string; body?: unknown; headers?: Record<string, string | string[] | undefined> },
  res: {
    status: (code: number) => { json: (body: unknown) => void };
    setHeader: (k: string, v: string) => void;
  },
): Promise<void> {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "PATCH") {
    res.status(405).json({ error: { code: "validation_failed", message: "PATCH only" } });
    return;
  }

  const authHeader = typeof req.headers?.authorization === "string" ? req.headers.authorization : undefined;
  const auth = await requireUser(authHeader);
  if (!auth.authorized) {
    res.status(auth.status).json(auth.body);
    return;
  }

  const b = req.body as { accountId?: unknown; personName?: unknown; pref?: unknown };
  const accountId = typeof b?.accountId === "string" ? b.accountId : "";
  const personName = typeof b?.personName === "string" ? b.personName.trim() : "";
  const pref = typeof b?.pref === "string" && PREFS.has(b.pref) ? b.pref : "";
  if (!accountId || !personName || !pref) {
    res.status(400).json({ error: { code: "validation_failed", message: "accountId, personName and pref ('teams'|'email'|'both') are required" } });
    return;
  }

  try {
    const [updated] = await withUserContext(auth.userId!, async (tx) => {
      return tx<{ id: string; notify_prefs: Record<string, string> }[]>`
        select id, notify_prefs from collab.set_notify_pref(${accountId}, ${personName}, ${pref})
      `;
    });
    if (!updated) throw new Error("set_notify_pref returned no row");
    res.status(200).json({ data: { accountId: updated.id, notifyPrefs: updated.notify_prefs } });
  } catch (err) {
    const { status, body } = toApiError(err);
    res.status(status).json(body);
  }
}
