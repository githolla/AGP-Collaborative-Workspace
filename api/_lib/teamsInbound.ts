/**
 * Inbound half of two-way Teams sync: turning a Teams channel message into a
 * workspace Discussion post. Pure text helpers + one system write.
 */

import { withServiceContext } from "./db.js";
import { WORKSPACE_POST_MARKER } from "./teamsNotify.js";

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

/** Teams message bodies are HTML; the Discussion thread stores plain text.
 * Drop tags, collapse whitespace, decode the handful of entities we emit. */
export function stripHtml(html: string): string {
  return html
    .replace(/<\/(p|div|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&nbsp;/g, (m) => ENTITIES[m] ?? m)
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** True when a channel message is one WE posted (an @mention notification) —
 * so it never round-trips back into the Discussion as if a person typed it. */
export function isOwnEcho(content: string): boolean {
  return content.includes(WORKSPACE_POST_MARKER);
}

/**
 * Write a Teams reply into the account's Discussion thread. Runs in the SERVICE
 * context (no signed-in user — the message came from Teams), which bypasses RLS
 * intentionally: the webhook already authenticated the notification via its
 * per-subscription clientState. Returns the new message id, or null if the body
 * was empty after stripping. Idempotent on the Teams message id: a duplicate
 * delivery (Graph may retry) is ignored.
 */
export async function ingestTeamsMessage(input: {
  accountId: string;
  teamsMessageId: string;
  author: string;
  body: string;
  createdAt?: string;
}): Promise<string | null> {
  const body = input.body.trim();
  if (!body) return null;
  return withServiceContext(async (tx) => {
    // Dedupe on the Teams message id, stored in kantata_id's sibling — reuse a
    // dedicated source tag so a retried notification can't double-post.
    const [existing] = await tx<{ id: string }[]>`
      select id from collab.thread_message
      where account_id = ${input.accountId} and teams_message_id = ${input.teamsMessageId}
      limit 1
    `;
    if (existing) return existing.id;
    const [row] = await tx<{ id: string }[]>`
      insert into collab.thread_message (account_id, author, author_user_id, kind, body, teams_message_id)
      values (${input.accountId}, ${input.author}, null, 'human', ${body}, ${input.teamsMessageId})
      returning id
    `;
    return row?.id ?? null;
  });
}
