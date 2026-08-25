/**
 * POST /api/teams-subscribe — turn on (or renew) two-way sync for a workspace.
 *
 * Creates a Microsoft Graph change-notification subscription on the account's
 * Team channel messages, pointed at /api/teams-webhook, so replies typed in
 * Teams flow back into the Discussion. The caller must be a member of the
 * account (enforced by RLS on the ms_team_id read). Idempotent: an existing
 * subscription for the account is replaced.
 *
 * Requires the app credential (graphAppConfigured) and TEAMS_WEBHOOK_URL (the
 * public https URL of the webhook). Returns a clear error when either is
 * missing, or when the workspace has no Team connected yet.
 *
 * Renewal: Graph subscriptions expire (~1h). A scheduled job should re-POST
 * this per active account before expiry; calling it again simply refreshes.
 */

import { randomBytes } from "node:crypto";
import { requireUser } from "./_lib/requireUser.js";
import { withUserContext, withServiceContext } from "./_lib/db.js";
import { graphAppConfigured, graphAppFetch } from "./_lib/graphApp.js";
import { toApiError } from "./_lib/apiError.js";

const SUBSCRIPTION_MINUTES = 55;

export default async function handler(
  req: { method?: string; body?: unknown; headers?: Record<string, string | string[] | undefined> },
  res: { status: (code: number) => { json: (body: unknown) => void }; setHeader: (k: string, v: string) => void },
): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.status(405).json({ error: { code: "validation_failed", message: "POST only" } });
    return;
  }

  const auth = await requireUser(typeof req.headers?.authorization === "string" ? req.headers.authorization : undefined);
  if (!auth.authorized) {
    res.status(auth.status).json(auth.body);
    return;
  }

  const accountId = typeof (req.body as { accountId?: unknown })?.accountId === "string" ? (req.body as { accountId: string }).accountId : "";
  if (!accountId) {
    res.status(400).json({ error: { code: "validation_failed", message: "accountId is required" } });
    return;
  }

  const webhookUrl = process.env.TEAMS_WEBHOOK_URL;
  if (!graphAppConfigured() || !webhookUrl) {
    res.status(400).json({
      error: {
        code: "teams_sync_not_configured",
        message: "Two-way Teams sync needs the app credential (GRAPH_APP_*) and TEAMS_WEBHOOK_URL set on the server.",
      },
    });
    return;
  }

  try {
    // Membership + Team check under the caller's RLS: they see this account's
    // ms_team_id only if they belong to it.
    const [acct] = await withUserContext(auth.userId!, async (tx) => {
      return await tx<{ ms_team_id: string | null }[]>`select ms_team_id from collab.client_account where id = ${accountId}`;
    });
    if (!acct) {
      res.status(404).json({ error: { code: "not_found", message: "workspace not found or you're not a member" } });
      return;
    }
    if (!acct.ms_team_id) {
      res.status(400).json({ error: { code: "team_not_connected", message: "Connect a Microsoft Team to this workspace first (Admin tab)." } });
      return;
    }
    const teamId = acct.ms_team_id;

    // Resolve the primary channel with the app token.
    const channel = (await graphAppFetch(`/teams/${teamId}/primaryChannel?$select=id`)) as { id?: string };
    if (!channel?.id) {
      res.status(502).json({ error: { code: "graph_failed", message: "could not resolve the team's primary channel" } });
      return;
    }
    const channelId = channel.id;

    // Replace any existing subscription for this account (best-effort delete).
    const [existing] = await withServiceContext(async (tx) => {
      return await tx<{ subscription_id: string }[]>`select subscription_id from collab.teams_subscription where account_id = ${accountId}`;
    });
    if (existing) {
      try { await graphAppFetch(`/subscriptions/${existing.subscription_id}`, { method: "DELETE" }); } catch { /* stale — ignore */ }
    }

    const clientState = randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + SUBSCRIPTION_MINUTES * 60_000).toISOString();
    const resource = `teams/${teamId}/channels/${channelId}/messages`;

    const created = (await graphAppFetch("/subscriptions", {
      method: "POST",
      body: {
        changeType: "created",
        notificationUrl: webhookUrl,
        resource,
        expirationDateTime: expiresAt,
        clientState,
        latestSupportedTlsVersion: "v1_2",
      },
    })) as { id?: string; expirationDateTime?: string };
    if (!created?.id) {
      res.status(502).json({ error: { code: "graph_failed", message: "subscription was not created" } });
      return;
    }

    const subscriptionId = created.id;
    const storedExpiry = created.expirationDateTime ?? expiresAt;
    await withServiceContext(async (tx) => {
      await tx`
        insert into collab.teams_subscription (account_id, subscription_id, resource, team_id, channel_id, client_state, expires_at, updated_at)
        values (${accountId}, ${subscriptionId}, ${resource}, ${teamId}, ${channelId}, ${clientState}, ${storedExpiry}, now())
        on conflict (account_id) do update set
          subscription_id = excluded.subscription_id,
          resource = excluded.resource,
          team_id = excluded.team_id,
          channel_id = excluded.channel_id,
          client_state = excluded.client_state,
          expires_at = excluded.expires_at,
          updated_at = now()
      `;
    });

    res.status(200).json({ data: { subscribed: true, expiresAt: created.expirationDateTime ?? expiresAt } });
  } catch (err) {
    const { status, body } = toApiError(err);
    res.status(status).json(body);
  }
}
