import { msApiCallPlain, msApiCallOptionalGraphToken } from "./msApiFetch.js";

/**
 * Client-side actions for `collab.thread_message` (docs/api-spec-workspace-
 * mutations.md "Discussions") — the migration off `/api/state`'s
 * `account.thread` JSON array, foundation phase. Plain Postgres writes, no
 * Graph token (msApiCallPlain), same as msPeople.ts.
 */

export interface MessageResult {
  id: string;
  accountId: string;
  author: string;
  authorUserId: string | null;
  kind: "human" | "agent";
  body: string;
  topic?: string;
  editedAt?: string;
  clientVisible: boolean;
  contractorVisible: boolean;
  kantataId?: string;
  kantataLevel?: "project" | "milestone" | "phase" | "task";
  createdAt: string;
  updatedAt: string;
  /** Non-fatal diagnostic: whether the @mention was delivered to the account's
   * Teams channel, and if not, why. The post itself always succeeds. */
  teamsNotify?: { sent: boolean; reason?: string; notified?: number };
}

/**
 * Posting forwards the caller's Graph token (when available) so the server can,
 * best-effort, mirror an @mention into the account's Teams channel and notify
 * that person in Teams (api/_lib/teamsNotify.ts). Degrades cleanly to a plain
 * DB write when there's no token/consent — the post always succeeds either way.
 */
export async function postMessage(accountId: string, body: string, topic?: string): Promise<MessageResult> {
  const result = await msApiCallOptionalGraphToken<MessageResult>("/api/message", { body: { accountId, body, ...(topic ? { topic } : {}) } });
  // Surface the Teams-delivery outcome during the pilot: if an @mention didn't
  // reach Teams, the reason is logged rather than lost. The post still succeeded.
  if (body.includes("@") && result.teamsNotify && !result.teamsNotify.sent) {
    console.info(`[Teams notify] not delivered — ${result.teamsNotify.reason ?? "unknown"}`);
  }
  return result;
}

/** `expectedUpdatedAt` is the message's own current `updatedAt` — api/message.ts's
 * optimistic-concurrency guard against two people editing the same post at once. */
export async function editMessage(messageId: string, body: string, expectedUpdatedAt: string): Promise<MessageResult> {
  return msApiCallPlain<MessageResult>("/api/message", { method: "PATCH", body: { messageId, body, expectedUpdatedAt } });
}

export async function deleteMessage(messageId: string): Promise<{ id: string }> {
  return msApiCallPlain<{ id: string }>("/api/message", { method: "DELETE", body: { messageId } });
}

export interface MessageVisibilityResult {
  id: string;
  clientVisible: boolean;
  contractorVisible: boolean;
  updatedAt: string;
}

/** Goes through `collab.set_message_visibility()` server-side (api/message/
 * visibility.ts) rather than the author-only PATCH above — flagging a
 * message shareable is a member action, not an authorship one. */
export async function setMessageVisibility(
  messageId: string,
  visibility: { clientVisible?: boolean; contractorVisible?: boolean },
): Promise<MessageVisibilityResult> {
  return msApiCallPlain<MessageVisibilityResult>("/api/message/visibility", { method: "PATCH", body: { messageId, ...visibility } });
}
