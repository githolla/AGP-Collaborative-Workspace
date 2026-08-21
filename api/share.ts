/**
 * POST /api/share, DELETE /api/share — `POST /api/account/:id/share` /
 * `DELETE /api/share/:shareId` (docs/api-spec-workspace-mutations.md),
 * replacing `shareWithPerson` / `revokeShare`. Flat, method-dispatched, ids
 * in the body — same convention as api/task.ts.
 *
 * DELETE is a REVOKE, not a real delete: collab.share's own comment (0007)
 * is explicit — "a RECORD, not a permission... nothing ever deletes one".
 * It stamps revoked_at/revoked_by and keeps the row, matching store.ts's
 * `revokeShare` exactly. `revokedBy` is always the caller's own resolved
 * name, never taken from the body (same anti-spoofing rule as every other
 * server-stamped identity field in this API).
 *
 * `share_update`'s RLS policy (0008) is intentionally broader than this
 * route's role — it also allows `recipient_user_id = auth.uid()`, for the
 * not-yet-built `POST /api/files/opened` (any signed-in caller can mark
 * their OWN share opened). Revoking is workspace_admin only per the spec, so
 * this handler checks that explicitly rather than leaning on the wider RLS
 * policy — application code narrowing what RLS would otherwise allow is
 * always safe, the reverse never is.
 *
 * Re-revoking an already-revoked share is treated as an idempotent success
 * (api-spec rule 5), not an error — returns the existing revoked row as-is.
 *
 * RETURNING is safe on the insert: share_insert's policy is
 * is_workspace_admin(account_id), and share_read's policy also accepts
 * is_workspace_admin(account_id) — no bootstrap gap.
 *
 * PER-EFFECT OUTCOMES (api-spec rule 6: "a multi-recipient share... returns
 * per-effect outcomes"): a malformed item in `items[]` is reported back as
 * `rejected`, never silently filtered out — a caller sending 5 items where
 * one has a typo'd `kind` should learn that 4 sent and 1 didn't, not get a
 * response that looks identical to "all 5 sent" with one item quietly gone.
 */

import { requireUser } from "./_lib/requireUser.js";
import { withUserContext } from "./_lib/db.js";
import { toApiError } from "./_lib/apiError.js";
import { logActivity } from "./_lib/activity.js";

const ITEM_KINDS = new Set(["file", "doc", "task", "folder"]);

interface ShareRow {
  id: string;
  account_id: string;
  person_name: string;
  item_kind: string;
  item_id: string;
  item_name: string;
  sent_at: string;
  sent_by: string;
  opened_at: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
}

function toApi(s: ShareRow) {
  return {
    id: s.id,
    accountId: s.account_id,
    personName: s.person_name,
    itemKind: s.item_kind,
    itemId: s.item_id,
    itemName: s.item_name,
    sentAt: s.sent_at,
    sentBy: s.sent_by,
    ...(s.opened_at ? { openedAt: s.opened_at } : {}),
    ...(s.revoked_at ? { revokedAt: s.revoked_at, revokedBy: s.revoked_by } : {}),
  };
}

async function handleCreate(
  body: unknown,
  userId: string,
  res: { status: (code: number) => { json: (body: unknown) => void } },
): Promise<void> {
  const b = body as { accountId?: unknown; personName?: unknown; items?: unknown };
  const accountId = typeof b.accountId === "string" ? b.accountId : "";
  const personName = typeof b.personName === "string" ? b.personName.trim() : "";
  const rawItems = Array.isArray(b.items) ? b.items : [];
  if (!accountId || !personName || rawItems.length === 0) {
    res.status(400).json({ error: { code: "validation_failed", message: "accountId, personName and a non-empty items[] (kind, itemId, itemName) are required" } });
    return;
  }

  // Classified up front, not silently filtered — each malformed item is
  // reported back as `rejected` (with its original position) rather than
  // quietly disappearing, per the spec's own per-effect-outcome rule.
  const valid: { index: number; kind: string; itemId: string; itemName: string }[] = [];
  const rejected: { index: number; reason: string }[] = [];
  rawItems.forEach((i, index) => {
    if (!i || typeof i !== "object") {
      rejected.push({ index, reason: "not an object" });
      return;
    }
    const kind = (i as { kind?: unknown }).kind;
    const itemId = (i as { itemId?: unknown }).itemId;
    const itemName = (i as { itemName?: unknown }).itemName;
    if (typeof kind !== "string" || !ITEM_KINDS.has(kind)) {
      rejected.push({ index, reason: "kind must be 'file', 'doc', 'task' or 'folder'" });
    } else if (typeof itemId !== "string" || typeof itemName !== "string") {
      rejected.push({ index, reason: "itemId and itemName must be strings" });
    } else {
      valid.push({ index, kind, itemId, itemName });
    }
  });
  if (valid.length === 0) {
    res.status(400).json({ error: { code: "validation_failed", message: "no valid items in items[]" }, data: { rejected } });
    return;
  }

  try {
    const created = await withUserContext(userId, async (tx) => {
      const [me] = await tx<{ display_name: string }[]>`select display_name from collab.app_user where id = ${userId}`;
      const sentBy = me?.display_name ?? "Unknown";
      const rows: ShareRow[] = [];
      // Individual inserts, not a bulk multi-row statement: item counts here
      // are small (a person-at-a-time handover), and each row's RETURNING
      // needs to come back in the same shape as every other endpoint — no
      // real cost to keeping this the same pattern as the rest of the API.
      for (const item of valid) {
        const [row] = await tx<ShareRow[]>`
          insert into collab.share (account_id, person_name, item_kind, item_id, item_name, sent_by)
          values (${accountId}, ${personName}, ${item.kind}, ${item.itemId}, ${item.itemName}, ${sentBy})
          returning id, account_id, person_name, item_kind, item_id, item_name, sent_at, sent_by, opened_at, revoked_at, revoked_by
        `;
        if (row) rows.push(row);
      }
      if (rows.length > 0) {
        await logActivity(tx, accountId, `Shared with ${personName} — ${rows.map((r) => r.item_name).join(", ")}`, "team");
      }
      return rows;
    });
    if (created.length === 0) throw new Error("no share rows were created");
    res.status(200).json({ data: { shares: created.map(toApi), ...(rejected.length > 0 ? { rejected } : {}) } });
  } catch (err) {
    const { status, body: errBody } = toApiError(err);
    res.status(status).json(errBody);
  }
}

async function handleRevoke(
  body: unknown,
  userId: string,
  res: { status: (code: number) => { json: (body: unknown) => void } },
): Promise<void> {
  const shareId = typeof (body as { shareId?: unknown })?.shareId === "string" ? (body as { shareId: string }).shareId : "";
  if (!shareId) {
    res.status(400).json({ error: { code: "validation_failed", message: "shareId is required" } });
    return;
  }

  try {
    const result = await withUserContext(userId, async (tx) => {
      const [current] = await tx<ShareRow[]>`
        select id, account_id, person_name, item_kind, item_id, item_name, sent_at, sent_by, opened_at, revoked_at, revoked_by
        from collab.share where id = ${shareId}
      `;
      // share_read's policy denies silently — missing here means either the
      // id is wrong or the caller cannot see it at all.
      if (!current) return { kind: "not_found" as const };

      const [access] = await tx<{ ok: boolean }[]>`select collab.is_workspace_admin(${current.account_id}) as ok`;
      if (!access?.ok) return { kind: "not_found" as const };

      if (current.revoked_at) return { kind: "ok" as const, row: current };

      const [me] = await tx<{ display_name: string }[]>`select display_name from collab.app_user where id = ${userId}`;
      const [updated] = await tx<ShareRow[]>`
        update collab.share
        set revoked_at = now(), revoked_by = ${me?.display_name ?? "Unknown"}
        where id = ${shareId}
        returning id, account_id, person_name, item_kind, item_id, item_name, sent_at, sent_by, opened_at, revoked_at, revoked_by
      `;
      if (!updated) return { kind: "not_found" as const };
      await logActivity(tx, updated.account_id, `Access revoked — ${updated.item_name} (${updated.person_name})`, "team");
      return { kind: "ok" as const, row: updated };
    });

    if (result.kind === "not_found") {
      res.status(404).json({ error: { code: "not_found", message: "share not found" } });
      return;
    }
    res.status(200).json({ data: toApi(result.row) });
  } catch (err) {
    const { status, body } = toApiError(err);
    res.status(status).json(body);
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
  else await handleRevoke(req.body, auth.userId!, res);
}
