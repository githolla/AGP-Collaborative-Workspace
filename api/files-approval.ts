/**
 * POST /api/files-approval, DELETE /api/files-approval — `POST /api/files/approval`,
 * `DELETE /api/files/approval/:approvalId` (docs/api-spec-workspace-mutations.md
 * "Files and approvals"; teams-provisioning-plan.md C2's Approvals view).
 * Flat, method-dispatched, ids in the body — same convention as every other
 * endpoint in this repo. Role: member (an internal person shares a file for
 * review; the decision itself is a separate route, files-approval-decision.ts,
 * with its own role).
 *
 * Keyed on the SharePoint item id (`msItemId`), never an app file row — B7's
 * own rule, now that there is no app-side file inventory. `name` is captured
 * at share time so the record survives a rename, same pattern as `Share`.
 */

import { requireUser } from "./_lib/requireUser.js";
import { withUserContext } from "./_lib/db.js";
import { toApiError } from "./_lib/apiError.js";
import { logActivity } from "./_lib/activity.js";

const PURPOSES = new Set(["fyi", "approval"]);

interface ApprovalRow {
  id: string;
  account_id: string;
  ms_item_id: string;
  name: string;
  purpose: string;
  shared_at: string;
  shared_by: string;
  decision: string | null;
  decided_at: string | null;
  decided_by: string | null;
  note: string | null;
}

function toApi(a: ApprovalRow) {
  return {
    id: a.id,
    accountId: a.account_id,
    msItemId: a.ms_item_id,
    name: a.name,
    purpose: a.purpose,
    sharedAt: a.shared_at,
    sharedBy: a.shared_by,
    decision: a.decision,
    decidedAt: a.decided_at,
    decidedBy: a.decided_by,
    note: a.note,
  };
}

async function handleCreate(
  body: unknown,
  userId: string,
  res: { status: (code: number) => { json: (body: unknown) => void } },
): Promise<void> {
  const b = body as { accountId?: unknown; msItemId?: unknown; name?: unknown; purpose?: unknown };
  const accountId = typeof b.accountId === "string" ? b.accountId : "";
  const msItemId = typeof b.msItemId === "string" ? b.msItemId : "";
  const name = typeof b.name === "string" ? b.name.trim() : "";
  const purpose = typeof b.purpose === "string" && PURPOSES.has(b.purpose) ? b.purpose : "";
  if (!accountId || !msItemId || !name || !purpose) {
    res.status(400).json({ error: { code: "validation_failed", message: "accountId, msItemId, name and purpose ('fyi'|'approval') are required" } });
    return;
  }

  try {
    const [created] = await withUserContext(userId, async (tx) => {
      const [me] = await tx<{ display_name: string }[]>`select display_name from collab.app_user where id = ${userId}`;
      // ON CONFLICT, not a plain INSERT: the unique constraint on
      // (account_id, ms_item_id) (0022) closes the race two concurrent
      // shares of the same item could otherwise hit, and the UPDATE branch
      // matches store.ts's own old rule for this exact action — "re-sharing
      // a previously decided doc starts a CLEAN request" — by resetting
      // decision/note/opened_at, not just refreshing purpose/name.
      const rows = await tx<ApprovalRow[]>`
        insert into collab.file_approval (account_id, ms_item_id, name, purpose, shared_by)
        values (${accountId}, ${msItemId}, ${name}, ${purpose}, ${me?.display_name ?? "Unknown"})
        on conflict (account_id, ms_item_id) do update set
          name = excluded.name,
          purpose = excluded.purpose,
          shared_at = now(),
          shared_by = excluded.shared_by,
          decision = null,
          decided_at = null,
          decided_by = null,
          note = null,
          opened_at = null
        returning id, account_id, ms_item_id, name, purpose, shared_at, shared_by, decision, decided_at, decided_by, note
      `;
      if (rows[0]) await logActivity(tx, accountId, `${purpose === "approval" ? "Sent to client for approval" : "Shared with client"} — ${name}`, "workspace");
      return rows;
    });
    if (!created) throw new Error("insert returned no row");
    res.status(200).json({ data: toApi(created) });
  } catch (err) {
    const { status, body: errBody } = toApiError(err);
    res.status(status).json(errBody);
  }
}

async function handleDelete(
  body: unknown,
  userId: string,
  res: { status: (code: number) => { json: (body: unknown) => void } },
): Promise<void> {
  const approvalId = typeof (body as { approvalId?: unknown })?.approvalId === "string" ? (body as { approvalId: string }).approvalId : "";
  if (!approvalId) {
    res.status(400).json({ error: { code: "validation_failed", message: "approvalId is required" } });
    return;
  }

  try {
    const [deleted] = await withUserContext(userId, async (tx) => {
      const [row] = await tx<{ id: string; account_id: string; name: string }[]>`
        delete from collab.file_approval where id = ${approvalId} returning id, account_id, name
      `;
      if (row) await logActivity(tx, row.account_id, `Stopped sharing with client — ${row.name}`, "workspace");
      return row ? [row] : [];
    });
    if (!deleted) {
      res.status(404).json({ error: { code: "not_found", message: "approval not found" } });
      return;
    }
    res.status(200).json({ data: { id: deleted.id } });
  } catch (err) {
    const { status, body: errBody } = toApiError(err);
    res.status(status).json(errBody);
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

  if (req.method !== "POST" && req.method !== "DELETE") {
    res.status(405).json({ error: { code: "validation_failed", message: "POST or DELETE" } });
    return;
  }

  const authHeader = typeof req.headers?.authorization === "string" ? req.headers.authorization : undefined;
  const auth = await requireUser(authHeader);
  if (!auth.authorized) {
    res.status(auth.status).json(auth.body);
    return;
  }

  if (req.method === "POST") await handleCreate(req.body, auth.userId!, res);
  else await handleDelete(req.body, auth.userId!, res);
}
