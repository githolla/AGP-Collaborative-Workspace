/**
 * PATCH /api/message/visibility — `PATCH /api/message/:messageId/visibility`
 * (docs/api-spec-workspace-mutations.md), role "member" — distinct from
 * ../message.ts's PATCH (body edits, author only). A real static path
 * segment, so its own file, same reasoning as api/grant/revoke-all.ts.
 *
 * Goes through collab.set_message_visibility() (migration 0011) rather than
 * a plain UPDATE: see that migration's header for why a permissive "any
 * member" RLS policy can't safely coexist with the author-only body-edit
 * policy on the same table, and why a SECURITY DEFINER function is the
 * actual fix rather than a second policy or a column-level GRANT.
 */

import { requireUser } from "../_lib/requireUser.js";
import { withUserContext } from "../_lib/db.js";
import { toApiError } from "../_lib/apiError.js";

interface MessageRow {
  id: string;
  client_visible: boolean;
  contractor_visible: boolean;
  updated_at: string;
}

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

  const b = req.body as { messageId?: unknown; clientVisible?: unknown; contractorVisible?: unknown };
  const messageId = typeof b?.messageId === "string" ? b.messageId : "";
  const clientVisible = typeof b?.clientVisible === "boolean" ? b.clientVisible : null;
  const contractorVisible = typeof b?.contractorVisible === "boolean" ? b.contractorVisible : null;
  if (!messageId) {
    res.status(400).json({ error: { code: "validation_failed", message: "messageId is required" } });
    return;
  }
  if (clientVisible === null && contractorVisible === null) {
    res.status(400).json({ error: { code: "validation_failed", message: "clientVisible or contractorVisible is required" } });
    return;
  }

  try {
    const [updated] = await withUserContext(auth.userId!, async (tx) => {
      return tx<MessageRow[]>`
        select * from collab.set_message_visibility(${messageId}, ${clientVisible}, ${contractorVisible})
      `;
    });
    if (!updated) throw new Error("set_message_visibility returned no row");
    res.status(200).json({
      data: { id: updated.id, clientVisible: updated.client_visible, contractorVisible: updated.contractor_visible, updatedAt: updated.updated_at },
    });
  } catch (err) {
    const { status, body } = toApiError(err);
    res.status(status).json(body);
  }
}
