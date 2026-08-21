/**
 * PUT /api/account-scope — `PUT /api/account/:id/scope`
 * (docs/api-spec-workspace-mutations.md), replacing `setProjectScope`.
 * workspace_admin (spec's own role column) — `client_account_update`'s
 * policy (`is_workspace_admin(id)`) enforces this directly, same as every
 * other field on this row.
 *
 * REPLACES `kantata_project_ids`/`scoped_to_projects` wholesale (unlike
 * account-projects.ts's union-only link), then drops any existing
 * Kantata-sourced campaign that fell outside the new scope — store.ts's own
 * `setProjectScope` does exactly this ("Drop auto-populated work that fell
 * outside the new scope"). A manually-created campaign (`source != 'kantata'`)
 * is never touched regardless of scope. Re-imports ("all") within the
 * trimmed scope afterward, same as the client.
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

  if (req.method !== "PUT") {
    res.status(405).json({ error: { code: "validation_failed", message: "PUT only" } });
    return;
  }

  const authHeader = typeof req.headers?.authorization === "string" ? req.headers.authorization : undefined;
  const auth = await requireUser(authHeader);
  if (!auth.authorized) {
    res.status(auth.status).json(auth.body);
    return;
  }

  const b = req.body as { accountId?: unknown; kantataProjectIds?: unknown; scoped?: unknown };
  const accountId = typeof b?.accountId === "string" ? b.accountId : "";
  const ids = Array.isArray(b?.kantataProjectIds) ? b.kantataProjectIds.filter((x): x is string => typeof x === "string") : null;
  const scoped = typeof b?.scoped === "boolean" ? b.scoped : null;
  if (!accountId || !ids || scoped === null) {
    res.status(400).json({ error: { code: "validation_failed", message: "accountId, kantataProjectIds (string[]) and scoped (boolean) are required" } });
    return;
  }
  const uniqueIds = [...new Set(ids)];

  try {
    const [updated] = await withUserContext(auth.userId!, async (tx) => {
      const [row] = await tx<{ client_name: string }[]>`
        update collab.client_account
        set kantata_project_ids = ${uniqueIds}, scoped_to_projects = ${scoped}
        where id = ${accountId}
        returning client_name
      `;
      if (row) await logActivity(tx, accountId, scoped ? "Workspace scoped to selected projects" : "Workspace covers the whole client", "workspace");
      return row ? [row] : [];
    });
    // client_account_update's policy denies silently — missing here means
    // either the id is wrong or the caller isn't this account's admin.
    if (!updated) {
      res.status(404).json({ error: { code: "not_found", message: "account not found" } });
      return;
    }

    // The scope change + campaign drop above are cheap, local writes, no
    // Kantata call — they've already happened and always succeed on their
    // own. Only the RE-IMPORT that follows costs a real Kantata API burst,
    // so only that part is rate-limited (shares the same per-account
    // cooldown as account-import.ts/account-deepen.ts, migration 0014) — a
    // cooldown miss here is a note, not a failure of the scope change
    // itself, which already committed.
    const claimed = await withUserContext(auth.userId!, async (tx) => claimKantataPullSlot(tx, accountId));
    if (!claimed) {
      res.status(200).json({
        data: { campaignsAdded: 0, campaignsUpdated: 0, tasksAdded: 0, note: "scope updated; re-import skipped — a Kantata pull for this account ran too recently. Call POST /api/account-import shortly." },
      });
      return;
    }

    const token = process.env.KANTATA_API_TOKEN;
    if (!token) throw new Error("KANTATA_API_TOKEN not set");

    const result = await withUserContext(auth.userId!, async (tx) => {
      await tx`
        delete from collab.campaign
        where account_id = ${accountId} and source = 'kantata' and kantata_project_id is not null
          and not (kantata_project_id = any(${uniqueIds}))
      `;
      return runKantataImport(tx, token, accountId, updated.client_name, uniqueIds, "all");
    });
    res.status(200).json({ data: result });
  } catch (err) {
    const { status, body } = toApiError(err);
    res.status(status).json(body);
  }
}
