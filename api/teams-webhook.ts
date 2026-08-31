/**
 * POST/GET /api/teams-webhook — the inbound side of two-way Teams sync.
 *
 * Microsoft Graph calls this endpoint two ways:
 *  1. VALIDATION: on subscription create/renew it sends `?validationToken=…`;
 *     we must echo it back as text/plain within 10s or the subscription fails.
 *  2. NOTIFICATION: when a message is posted in a subscribed Teams channel it
 *     POSTs `{ value: [{ subscriptionId, clientState, resourceData:{id} }] }`.
 *
 * This route is intentionally UNAUTHENTICATED (Graph has no workspace session).
 * It authenticates each notification by matching the per-subscription
 * `clientState` secret stored at subscribe time. It then reads the message with
 * the application token, skips our own outbound echoes, and writes real Teams
 * replies into the Discussion via the service context.
 *
 * Inert unless the app credential is configured (graphAppConfigured()).
 */

import { graphAppConfigured, graphAppFetch } from "./_lib/graphApp.js";
import { withServiceContext } from "./_lib/db.js";
import { ingestTeamsMessage, isOwnEcho, stripHtml } from "./_lib/teamsInbound.js";

interface WebhookReq {
  method?: string;
  query?: Record<string, unknown>;
  body?: unknown;
}
interface WebhookRes {
  status: (code: number) => WebhookRes;
  setHeader: (k: string, v: string) => void;
  send: (body: string) => void;
  json: (body: unknown) => void;
  end: () => void;
}

interface SubRow {
  account_id: string;
  team_id: string;
  channel_id: string;
  client_state: string;
}

interface GraphMessage {
  id?: string;
  messageType?: string;
  createdDateTime?: string;
  body?: { content?: string };
  from?: { user?: { displayName?: string } };
}

function firstQuery(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return undefined;
}

export default async function handler(req: WebhookReq, res: WebhookRes): Promise<void> {
  // 1. Subscription validation handshake — echo the token as text/plain.
  const validationToken = firstQuery(req.query?.["validationToken"]);
  if (validationToken !== undefined) {
    res.setHeader("Content-Type", "text/plain");
    res.status(200).send(validationToken);
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: { code: "validation_failed", message: "POST only" } });
    return;
  }

  // Acknowledge fast; a per-item failure must not make Graph retry the batch.
  const notifications = (req.body as { value?: unknown })?.value;
  if (!Array.isArray(notifications)) {
    res.status(202).end();
    return;
  }

  if (!graphAppConfigured()) {
    // Nothing to do without the app credential — still ack so Graph stops.
    res.status(202).end();
    return;
  }

  for (const raw of notifications) {
    try {
      const n = raw as { subscriptionId?: string; clientState?: string; resource?: string; resourceData?: { id?: string } };
      const subscriptionId = n.subscriptionId;
      const messageId = n.resourceData?.id;
      if (!subscriptionId || !messageId) continue;

      // Authenticate: the subscription must exist AND its stored clientState
      // must match the one Graph echoed back.
      const [sub] = await withServiceContext(async (tx) => {
        return await tx<SubRow[]>`
          select account_id, team_id, channel_id, client_state
          from collab.teams_subscription where subscription_id = ${subscriptionId}
        `;
      });
      if (!sub || !n.clientState || n.clientState !== sub.client_state) continue;

      // Read the actual message. Prefer the `resource` path Graph hands us — it
      // is correct for BOTH a root channel message AND a threaded reply (which
      // lives at messages/{rootId}/replies/{replyId}, not messages/{replyId}).
      // SECURITY: only trust it when it names THIS subscription's team AND
      // channel, so a (hypothetically) forged notification can't point the
      // tenant-wide app token at some other team's messages. Otherwise
      // reconstruct the path from the trusted subscription row.
      const resourceTrusted = !!n.resource && n.resource.includes(sub.team_id) && n.resource.includes(sub.channel_id);
      const resourcePath = resourceTrusted ? `/${n.resource}` : `/teams/${sub.team_id}/channels/${sub.channel_id}/messages/${messageId}`;
      const msg = (await graphAppFetch(resourcePath)) as GraphMessage;

      if (!msg?.id || (msg.messageType && msg.messageType !== "message")) continue;
      const content = msg.body?.content ?? "";
      if (!content || isOwnEcho(content)) continue; // skip our own outbound echo

      const author = msg.from?.user?.displayName?.trim() || "Teams user";
      await ingestTeamsMessage({
        accountId: sub.account_id,
        teamsMessageId: msg.id,
        author,
        body: stripHtml(content),
        ...(msg.createdDateTime ? { createdAt: msg.createdDateTime } : {}),
      });
    } catch {
      // One bad notification shouldn't fail the batch; idempotency covers a retry.
    }
  }

  res.status(202).end();
}
