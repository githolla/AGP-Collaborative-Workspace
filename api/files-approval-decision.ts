/**
 * POST /api/files-approval-decision — `POST /api/files/approval/:approvalId/decision`
 * (docs/api-spec-workspace-mutations.md; teams-provisioning-plan.md C2's
 * Approvals view). Body: `{ approvalId, decision: "approved" | "changes",
 * note? }`. Role: external (client) holding the grant — in practice, any
 * client linked to the account, since `file_approval` carries no
 * per-milestone scope yet (0008's own documented gap: "a client linked to
 * the account sees every approval on it for now").
 *
 * COLUMN-LEVEL DISCIPLINE, same caveat 0008 states for this table's own
 * `file_approval_decision` policy: the RLS policy gates WHO may run an
 * UPDATE at all (client, member, or admin), not WHICH columns. This handler
 * is what actually restricts the write to `decision`/`decided_at`/
 * `decided_by`/`note` — never `name`, `purpose`, `ms_item_id` or
 * `shared_by`/`shared_at`, regardless of what the body contains.
 *
 * `decidedBy` is server-stamped from the verified identity (the external's
 * own `external_link.name`, or the internal member's `display_name`), never
 * taken from the body — same rule api/message.ts's own header states for
 * authorship generally.
 */

import { requireUser } from "./_lib/requireUser.js";
import { withUserContext } from "./_lib/db.js";
import { toApiError } from "./_lib/apiError.js";
import { logActivity } from "./_lib/activity.js";

const DECISIONS = new Set(["approved", "changes"]);

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

  const b = req.body as { approvalId?: unknown; decision?: unknown; note?: unknown };
  const approvalId = typeof b.approvalId === "string" ? b.approvalId : "";
  const decision = typeof b.decision === "string" && DECISIONS.has(b.decision) ? b.decision : "";
  const note = typeof b.note === "string" && b.note.trim() ? b.note.trim() : null;
  if (!approvalId || !decision) {
    res.status(400).json({ error: { code: "validation_failed", message: "approvalId and decision ('approved'|'changes') are required" } });
    return;
  }

  const userId = auth.userId!;

  try {
    const result = await withUserContext(userId, async (tx) => {
      const [existing] = await tx<{ account_id: string }[]>`select account_id from collab.file_approval where id = ${approvalId}`;
      if (!existing) return { kind: "not_found" as const };

      const [me] = await tx<{ display_name: string }[]>`select display_name from collab.app_user where id = ${userId}`;
      const [external] = await tx<{ name: string }[]>`select name from collab.external_link where account_id = ${existing.account_id} and user_id = ${userId}`;
      const decidedBy = external?.name ?? me?.display_name ?? "Unknown";

      const [updated] = await tx<ApprovalRow[]>`
        update collab.file_approval
        set decision = ${decision}, decided_at = now(), decided_by = ${decidedBy}, note = ${note}
        where id = ${approvalId}
        returning id, account_id, ms_item_id, name, purpose, shared_at, shared_by, decision, decided_at, decided_by, note
      `;
      if (!updated) return { kind: "not_found" as const };
      await logActivity(
        tx,
        updated.account_id,
        decision === "approved" ? `Client approved — ${updated.name}` : `Client requested changes — ${updated.name}${note ? `: "${note}"` : ""}`,
        "workspace",
      );
      return { kind: "ok" as const, updated };
    });

    if (result.kind === "not_found") {
      res.status(404).json({ error: { code: "not_found", message: "approval not found" } });
      return;
    }
    res.status(200).json({ data: toApi(result.updated) });
  } catch (err) {
    const { status, body: errBody } = toApiError(err);
    res.status(status).json(errBody);
  }
}
