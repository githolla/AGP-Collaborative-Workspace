/**
 * POST /api/message, PATCH /api/message, DELETE /api/message — discussions
 * (docs/api-spec-workspace-mutations.md's `POST /api/account/:id/messages`,
 * `PATCH`/`DELETE /api/message/:messageId`). Flat, method-dispatched, ids in
 * the body — same convention as api/task.ts. The visibility toggle
 * (`PATCH .../visibility`, role "member" instead of "author only") is a
 * separate static route, api/message/visibility.ts — see that file for why
 * it can't just be a third branch here.
 *
 * SERVER-STAMPED IDENTITY, for every caller, not only externals: `author` and
 * `authorUserId` always come from the verified token, never the body — the
 * same "nothing trusts a field to establish authority" rule the spec states
 * specifically for externals (below) applies to authorship generally, since
 * `PATCH`/`DELETE`'s "author only" check is keyed on this exact column.
 *
 * EXTERNAL POSTS (spec: "external may post into a milestone they hold" +
 * "server-stamped: author from the token, kantataId inherited from the
 * thread, audience set to their own role only — none of those three taken
 * from the body"): this pass reads `kantataId` from the body still (there is
 * no other transport for "which milestone thread" in the documented shape)
 * but treats it as a claim to verify, not an authority — thread_message_insert's
 * RLS policy (0008) independently re-checks holds_grant() as the real
 * backstop. What IS fully server-stamped, ignoring the body outright, is
 * `clientVisible`/`contractorVisible`: forced to the caller's own
 * external_role, so a contractor's reply can never carry clientVisible=true
 * regardless of what they send. An external's kantataLevel must be exactly
 * "milestone" — the only unit externals hold grants at in this schema.
 *
 * kantata_ancestor_ids is set to [kantataId] when given, never a resolved
 * hierarchy — same honest limit as api/task.ts's manual tasks: walking a
 * task/phase id up to its governing milestone needs Kantata's live mirror,
 * which isn't part of this schema (0007's own comment on task.kantata_ancestor_ids).
 * This means a grant held at a broader level (project) won't yet cover a
 * milestone-level message — real, documented, not silently pretended away.
 *
 * RETURNING is safe on create: an insert that passed thread_message_insert's
 * WITH CHECK (member, or external holding a matching grant with the correct
 * lone audience flag) always also satisfies thread_message_read for the same
 * caller — same row, same conditions, no bootstrap gap.
 */

import { requireUser } from "./_lib/requireUser.js";
import { withUserContext } from "./_lib/db.js";
import { toApiError } from "./_lib/apiError.js";
import { graphTokenFrom } from "./_lib/graph.js";
import { matchedMentions, notifyTeamsMentions } from "./_lib/teamsNotify.js";

const KANTATA_LEVELS = new Set(["project", "milestone", "phase", "task"]);

interface MessageRow {
  id: string;
  account_id: string;
  author: string;
  author_user_id: string | null;
  kind: string;
  body: string;
  topic: string | null;
  edited_at: string | null;
  client_visible: boolean;
  contractor_visible: boolean;
  kantata_id: string | null;
  kantata_level: string | null;
  created_at: string;
  updated_at: string;
}

function toApi(m: MessageRow) {
  return {
    id: m.id,
    accountId: m.account_id,
    author: m.author,
    authorUserId: m.author_user_id,
    kind: m.kind,
    body: m.body,
    ...(m.topic ? { topic: m.topic } : {}),
    ...(m.edited_at ? { editedAt: m.edited_at } : {}),
    clientVisible: m.client_visible,
    contractorVisible: m.contractor_visible,
    ...(m.kantata_id ? { kantataId: m.kantata_id } : {}),
    ...(m.kantata_level ? { kantataLevel: m.kantata_level } : {}),
    createdAt: m.created_at,
    updatedAt: m.updated_at,
  };
}

async function handleCreate(
  body: unknown,
  userId: string,
  res: { status: (code: number) => { json: (body: unknown) => void } },
  graphToken: string | null,
): Promise<void> {
  const b = body as {
    accountId?: unknown;
    body?: unknown;
    topic?: unknown;
    kantataId?: unknown;
    kantataLevel?: unknown;
    clientVisible?: unknown;
    contractorVisible?: unknown;
  };
  const accountId = typeof b.accountId === "string" ? b.accountId : "";
  const messageBody = typeof b.body === "string" ? b.body.trim() : "";
  if (!accountId || !messageBody) {
    res.status(400).json({ error: { code: "validation_failed", message: "accountId and body are required" } });
    return;
  }
  const topic = typeof b.topic === "string" && b.topic.trim() ? b.topic.trim() : null;
  const kantataLevel = typeof b.kantataLevel === "string" && KANTATA_LEVELS.has(b.kantataLevel) ? b.kantataLevel : null;
  const kantataId = typeof b.kantataId === "string" && b.kantataId ? b.kantataId : null;

  try {
    const result = await withUserContext(userId, async (tx) => {
      const [me] = await tx<{ display_name: string }[]>`select display_name from collab.app_user where id = ${userId}`;
      const [external] = await tx<{ name: string; role: string }[]>`
        select name, role from collab.external_link where account_id = ${accountId} and user_id = ${userId}
      `;

      let author: string;
      let finalKantataId: string | null;
      let finalKantataLevel: string | null;
      let clientVisible: boolean;
      let contractorVisible: boolean;

      if (external) {
        if (!kantataId || kantataLevel !== "milestone") {
          return {
            kind: "validation_failed" as const,
            message: "external posts require kantataId and kantataLevel: 'milestone' — the milestone thread being replied to",
          };
        }
        author = external.name;
        finalKantataId = kantataId;
        finalKantataLevel = "milestone";
        clientVisible = external.role === "client";
        contractorVisible = external.role === "contractor";
      } else {
        author = me?.display_name ?? "Unknown";
        finalKantataId = kantataId;
        finalKantataLevel = kantataId ? kantataLevel : null;
        clientVisible = b.clientVisible === true;
        contractorVisible = b.contractorVisible === true;
      }

      const ancestorIds = finalKantataId ? [finalKantataId] : [];

      const [created] = await tx<MessageRow[]>`
        insert into collab.thread_message (
          account_id, author, author_user_id, body, topic,
          client_visible, contractor_visible, kantata_id, kantata_level, kantata_ancestor_ids
        )
        values (
          ${accountId}, ${author}, ${userId}, ${messageBody}, ${topic},
          ${clientVisible}, ${contractorVisible}, ${finalKantataId}, ${finalKantataLevel}, ${ancestorIds}
        )
        returning id, account_id, author, author_user_id, kind, body, topic, edited_at,
                  client_visible, contractor_visible, kantata_id, kantata_level, created_at, updated_at
      `;
      if (!created) throw new Error("insert returned no row");

      // For the best-effort Teams notification (below): the account's Team id
      // and the members we could @mention. Only queried when the client
      // forwarded a Graph token AND the post contains an "@" — otherwise there
      // is nothing to send and we skip the extra reads entirely.
      let teamId: string | null = null;
      let roster: { name: string; email: string }[] = [];
      if (graphToken && messageBody.includes("@")) {
        const [acct] = await tx<{ ms_team_id: string | null }[]>`
          select ms_team_id from collab.client_account where id = ${accountId}
        `;
        teamId = acct?.ms_team_id ?? null;
        if (teamId) {
          const members = await tx<{ name: string; email: string | null }[]>`
            select name, email from collab.account_member where account_id = ${accountId} and email is not null
          `;
          roster = members.filter((m): m is { name: string; email: string } => !!m.email);
        }
      }

      return { kind: "ok" as const, created, teamId, roster };
    });

    if (result.kind === "validation_failed") {
      res.status(400).json({ error: { code: "validation_failed", message: result.message } });
      return;
    }

    // Best-effort Teams notification: mirror an @mention into the account's
    // Team channel so Teams natively pings the person. Never blocks or fails
    // the post — the message is already committed above. The result is returned
    // as a non-fatal diagnostic (`teamsNotify`) so a pilot can SEE whether the
    // ping fired and, if not, exactly why — a silent best-effort is untestable.
    let teamsNotify: { sent: boolean; reason?: string; notified?: number };
    if (!graphToken) teamsNotify = { sent: false, reason: "no Graph token — sign in with Microsoft" };
    else if (!messageBody.includes("@")) teamsNotify = { sent: false, reason: "no @mention in the message" };
    else if (!result.teamId) teamsNotify = { sent: false, reason: "this workspace has no Microsoft Team provisioned yet" };
    else {
      const mentions = matchedMentions(messageBody, result.roster);
      if (mentions.length === 0) teamsNotify = { sent: false, reason: "no @mentioned member has a resolved email on this account" };
      else {
        try {
          teamsNotify = await notifyTeamsMentions({
            token: graphToken,
            teamId: result.teamId,
            authorName: result.created.author,
            body: messageBody,
            mentions,
          });
        } catch (e) {
          // A Teams-send failure must never affect the saved post.
          teamsNotify = { sent: false, reason: e instanceof Error ? e.message.slice(0, 120) : "teams send failed" };
        }
      }
    }

    res.status(200).json({ data: { ...toApi(result.created), teamsNotify } });
  } catch (err) {
    const { status, body: errBody } = toApiError(err);
    res.status(status).json(errBody);
  }
}

async function handleUpdate(
  body: unknown,
  userId: string,
  res: { status: (code: number) => { json: (body: unknown) => void } },
): Promise<void> {
  const b = body as { messageId?: unknown; body?: unknown; expectedUpdatedAt?: unknown };
  const messageId = typeof b.messageId === "string" ? b.messageId : "";
  const newBody = typeof b.body === "string" ? b.body.trim() : "";
  const expectedUpdatedAt = typeof b.expectedUpdatedAt === "string" ? b.expectedUpdatedAt : "";
  if (!messageId || !newBody || !expectedUpdatedAt) {
    res.status(400).json({ error: { code: "validation_failed", message: "messageId, body and expectedUpdatedAt are required" } });
    return;
  }

  try {
    const result = await withUserContext(userId, async (tx) => {
      const [current] = await tx<{ author_user_id: string | null; updated_at: string }[]>`
        select author_user_id, updated_at from collab.thread_message where id = ${messageId}
      `;
      // thread_message_read's policy denies silently — missing here means
      // either the id is wrong or the caller cannot see it at all.
      if (!current) return { kind: "not_found" as const };
      // The caller CAN see this message (the select above succeeded) but
      // isn't its author — a genuine authorization refusal, not a
      // not_found, since we already know the row exists and is visible.
      if (current.author_user_id !== userId) return { kind: "forbidden" as const };
      if (new Date(expectedUpdatedAt).getTime() !== new Date(current.updated_at).getTime()) {
        return { kind: "conflict" as const };
      }

      const [updated] = await tx<MessageRow[]>`
        update collab.thread_message
        set body = ${newBody}, edited_at = now()
        where id = ${messageId} and author_user_id = ${userId}
        returning id, account_id, author, author_user_id, kind, body, topic, edited_at,
                  client_visible, contractor_visible, kantata_id, kantata_level, created_at, updated_at
      `;
      if (!updated) return { kind: "not_found" as const };
      return { kind: "ok" as const, updated };
    });

    if (result.kind === "not_found") {
      res.status(404).json({ error: { code: "not_found", message: "message not found" } });
    } else if (result.kind === "forbidden") {
      res.status(403).json({ error: { code: "forbidden", message: "only the author may edit this message" } });
    } else if (result.kind === "conflict") {
      res.status(409).json({ error: { code: "conflict", message: "message changed since expectedUpdatedAt" } });
    } else {
      res.status(200).json({ data: toApi(result.updated) });
    }
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
  const messageId = typeof (body as { messageId?: unknown })?.messageId === "string" ? (body as { messageId: string }).messageId : "";
  if (!messageId) {
    res.status(400).json({ error: { code: "validation_failed", message: "messageId is required" } });
    return;
  }

  try {
    const result = await withUserContext(userId, async (tx) => {
      const [current] = await tx<{ author_user_id: string | null }[]>`
        select author_user_id from collab.thread_message where id = ${messageId}
      `;
      if (!current) return { kind: "not_found" as const };
      if (current.author_user_id !== userId) return { kind: "forbidden" as const };

      const [deleted] = await tx<{ id: string }[]>`
        delete from collab.thread_message where id = ${messageId} and author_user_id = ${userId} returning id
      `;
      if (!deleted) return { kind: "not_found" as const };
      return { kind: "ok" as const, deleted };
    });

    if (result.kind === "not_found") {
      res.status(404).json({ error: { code: "not_found", message: "message not found" } });
    } else if (result.kind === "forbidden") {
      res.status(403).json({ error: { code: "forbidden", message: "only the author may delete this message" } });
    } else {
      res.status(200).json({ data: { id: result.deleted.id } });
    }
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

  if (req.method !== "POST" && req.method !== "PATCH" && req.method !== "DELETE") {
    res.status(405).json({ error: { code: "validation_failed", message: "POST, PATCH or DELETE" } });
    return;
  }

  const authHeader = typeof req.headers?.authorization === "string" ? req.headers.authorization : undefined;
  const auth = await requireUser(authHeader);
  if (!auth.authorized) {
    res.status(auth.status).json(auth.body);
    return;
  }

  if (req.method === "POST") await handleCreate(req.body, auth.userId!, res, graphTokenFrom(req.headers));
  else if (req.method === "PATCH") await handleUpdate(req.body, auth.userId!, res);
  else await handleDelete(req.body, auth.userId!, res);
}
