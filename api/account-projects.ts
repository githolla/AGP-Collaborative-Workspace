/**
 * POST /api/account-projects — `POST /api/account/:id/projects`
 * (docs/api-spec-workspace-mutations.md), replacing `linkProjects`.
 * workspace_admin (spec's own role column) — same `client_account_update`
 * enforcement as account-scope.ts.
 *
 * UNIONS the given ids into the account's EXISTING `kantata_project_ids`
 * (never replaces, never touches `scoped_to_projects`) — the Project
 * Finder's permanent hand-link action, distinct from account-scope.ts's
 * wholesale replace. No campaign-dropping here either: linking only ever
 * adds scope, so nothing that was previously in-scope can fall out of it.
 */

import { requireUser } from "./_lib/requireUser.js";
import { withUserContext } from "./_lib/db.js";
import { runKantataImport, claimKantataPullSlot } from "./_lib/kantataImport.js";
import { toApiError } from "./_lib/apiError.js";
import { logActivity } from "./_lib/activity.js";

export default async function handler(
  req: { method?: string; body?: unknown; headers?: Record<string, string | string[] | undefined> },
  res: {
    status: (code: number) => { json: (body: unknown) => void };
    setHeader: (k: string, v: string) => void;
  },
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

  const b = req.body as { accountId?: unknown; kantataProjectIds?: unknown };
  const accountId = typeof b?.accountId === "string" ? b.accountId : "";
  const newIds = Array.isArray(b?.kantataProjectIds) ? b.kantataProjectIds.filter((x): x is string => typeof x === "string") : null;
  if (!accountId || !newIds || newIds.length === 0) {
    res.status(400).json({ error: { code: "validation_failed", message: "accountId and a non-empty kantataProjectIds (string[]) are required" } });
    return;
  }

  try {
    const [updated] = await withUserContext(auth.userId!, async (tx) => {
      const [row] = await tx<{ client_name: string; kantata_project_ids: string[] }[]>`
        update collab.client_account
        set kantata_project_ids = (
          select array_agg(distinct id) from unnest(kantata_project_ids || ${newIds}) as id
        )
        where id = ${accountId}
        returning client_name, kantata_project_ids
      `;
      if (row) await logActivity(tx, accountId, `Linked ${newIds.length} Kantata project${newIds.length === 1 ? "" : "s"}`, "workspace");
      return row ? [row] : [];
    });
    // client_account_update's policy denies silently — missing here means
    // either the id is wrong or the caller isn't this account's admin.
    if (!updated) {
      res.status(404).json({ error: { code: "not_found", message: "account not found" } });
      return;
    }

    // The link itself (above) is a cheap, local write, no Kantata call — it
    // already committed and always succeeds on its own. Only the re-import
    // that follows costs a real Kantata API burst, so only that part shares
    // the per-account cooldown with account-import.ts/account-deepen.ts/
    // account-scope.ts (migration 0014) — a cooldown miss here is a note,
    // not a failure of the link itself.
    const claimed = await withUserContext(auth.userId!, async (tx) => claimKantataPullSlot(tx, accountId));
    if (!claimed) {
      res.status(200).json({
        data: { campaignsAdded: 0, campaignsUpdated: 0, tasksAdded: 0, note: "projects linked; re-import skipped — a Kantata pull for this account ran too recently. Call POST /api/account-import shortly." },
      });
      return;
    }

    const token = process.env.KANTATA_API_TOKEN;
    if (!token) throw new Error("KANTATA_API_TOKEN not set");

    const result = await withUserContext(auth.userId!, async (tx) => {
      return runKantataImport(tx, token, accountId, updated.client_name, updated.kantata_project_ids, "all");
    });
    res.status(200).json({ data: result });
  } catch (err) {
    const { status, body } = toApiError(err);
    res.status(status).json(body);
  }
}
