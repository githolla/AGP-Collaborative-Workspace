import { msApiCallPlain } from "./msApiFetch.js";

/**
 * Client-side writes for `collab.share` (docs/api-spec-workspace-mutations.md
 * "Handover") — the migration off `/api/state`'s `Share`/`shareWithPerson`/
 * `revokeShare`/`revokeAllForPerson`. Plain Postgres writes, no Graph token
 * (msApiCallPlain), same as msPeople.ts/msFileApproval.ts.
 *
 * There was never a live UI for the old model's handover record (confirmed
 * by a repo-wide search: nothing outside store.ts/handover.ts/its test ever
 * called shareWithPerson et al.) — the pure per-person rollup logic in
 * handover.ts (personHandover/offboardChecklist/shareState) is reused as-is
 * against these Postgres-shaped rows, since `MsAccountShare` carries every
 * field the old `Share` type does.
 */

export interface ShareResult {
  id: string;
  accountId: string;
  personName: string;
  itemKind: "file" | "doc" | "task" | "folder";
  itemId: string;
  itemName: string;
  sentAt: string;
  sentBy: string;
  openedAt?: string;
  revokedAt?: string;
  revokedBy?: string;
}

export interface ShareItemInput {
  kind: "file" | "doc" | "task" | "folder";
  itemId: string;
  itemName: string;
}

export interface ShareBatchResult {
  shares: ShareResult[];
  rejected?: { index: number; reason: string }[];
}

/** `POST /api/share` — one or more items handed to one person in a single
 * batch (api/share.ts's own per-effect-outcome rule: a malformed item is
 * reported back in `rejected`, never silently dropped). */
export async function shareItems(accountId: string, personName: string, items: ShareItemInput[]): Promise<ShareBatchResult> {
  return msApiCallPlain<ShareBatchResult>("/api/share", { body: { accountId, personName, items } });
}

/** `DELETE /api/share` — a REVOKE, not a delete: stamps `revokedAt`/
 * `revokedBy` and keeps the row (collab.share is a record, never thrown
 * away). Re-revoking an already-revoked share is an idempotent success. */
export async function revokeShare(shareId: string): Promise<ShareResult> {
  return msApiCallPlain<ShareResult>("/api/share", { method: "DELETE", body: { shareId } });
}
