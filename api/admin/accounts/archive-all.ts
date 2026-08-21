/**
 * POST /api/admin/accounts/archive-all — `POST /api/admin/accounts/archive-all`
 * (docs/api-spec-workspace-mutations.md), replacing `archiveAllAccounts`.
 *
 * Reversible, not deleted (store.ts's own comment: "each restorable from
 * Archived") — this only flips `archived`, the same field `PATCH /api/account`
 * already exposes per-account. `client_account_update`'s policy is
 * `is_workspace_admin(id)`, which `is_app_admin()` satisfies for every
 * account, so the caller's own JWT already reaches every row — no
 * service-role crossing needed.
 */

import { requireUser } from "../../_lib/requireUser.js";
import { withUserContext } from "../../_lib/db.js";
import { isAppAdmin } from "../../_lib/requireAppAdmin.js";
import { toApiError } from "../../_lib/apiError.js";

export default async function handler(
  req: { method?: string; headers?: Record<string, string | string[] | undefined> },
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
  const callerId = auth.userId!;

  if (!(await isAppAdmin(callerId))) {
    res.status(403).json({ error: { code: "forbidden", message: "app admins only" } });
    return;
  }

  try {
    const archived = await withUserContext(callerId, async (tx) => {
      return tx<{ id: string }[]>`
        update collab.client_account set archived = true where archived = false returning id
      `;
    });
    res.status(200).json({ data: { archived: archived.length } });
  } catch (err) {
    const { status, body } = toApiError(err);
    res.status(status).json(body);
  }
}
