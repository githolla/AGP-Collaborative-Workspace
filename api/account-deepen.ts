/**
 * POST /api/account-deepen — `POST /api/account/:id/deepen`
 * (docs/api-spec-workspace-mutations.md), replacing `ensureDeepened`.
 *
 * No DB writes — matches the client's own `ensureDeepened`, which only
 * refreshes the mirror's hierarchy data (an exhaustive per-project pull),
 * never calls `populateFromKantata`. Here that distinction is even more
 * literal: this never touches `withUserContext`'s transaction for a write,
 * only to read the account's own `kantata_project_ids`.
 *
 * Role: member (or admin) — same as every other Kantata-import route in
 * this group; the spec's own table doesn't carry a Role column for this
 * section, and "any member may trigger a refresh" matches the client's
 * auto-deepen-on-open behavior (`ensureAutoPopulated`), not an admin-gated
 * one.
 */

import { requireUser } from "./_lib/requireUser.js";
import { withUserContext } from "./_lib/db.js";
import { pullWorkspaceStories, claimKantataPullSlot } from "./_lib/kantataImport.js";
import { toApiError } from "./_lib/apiError.js";

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

  const accountId = typeof (req.body as { accountId?: unknown })?.accountId === "string" ? (req.body as { accountId: string }).accountId : "";
  if (!accountId) {
    res.status(400).json({ error: { code: "validation_failed", message: "accountId is required" } });
    return;
  }

  try {
    const [account] = await withUserContext(auth.userId!, async (tx) => {
      return tx<{ kantata_project_ids: string[]; is_member: boolean }[]>`
        select kantata_project_ids, collab.is_account_member_or_admin(id) as is_member
        from collab.client_account where id = ${accountId}
      `;
    });
    // client_account_read's policy (can_read_account) also passes for a
    // linked EXTERNAL, broader than this route's real role (member/admin) —
    // an external must not trigger a live Kantata pull, checked explicitly.
    if (!account || !account.is_member) {
      res.status(404).json({ error: { code: "not_found", message: "account not found" } });
      return;
    }

    const ids = [...new Set(account.kantata_project_ids)].slice(0, 12);
    if (ids.length === 0) {
      res.status(200).json({ data: { storiesFetched: 0, note: "no linked Kantata projects yet" } });
      return;
    }

    const token = process.env.KANTATA_API_TOKEN;
    if (!token) throw new Error("KANTATA_API_TOKEN not set");

    // Rate limit — shares one per-account cooldown with account-import.ts
    // (same migration 0014 function): both trigger a comparable burst of
    // real Kantata API calls, so a caller can't dodge the limit by simply
    // alternating between the two endpoints.
    const claimed = await withUserContext(auth.userId!, async (tx) => claimKantataPullSlot(tx, accountId));
    if (!claimed) {
      res.status(409).json({ error: { code: "conflict", message: "a deepen for this account ran too recently — please wait a few seconds and try again" } });
      return;
    }

    const focus = await pullWorkspaceStories(token, ids);
    res.status(200).json({ data: { storiesFetched: focus.milestones.length + focus.tasks.length } });
  } catch (err) {
    const { status, body } = toApiError(err);
    res.status(status).json(body);
  }
}
