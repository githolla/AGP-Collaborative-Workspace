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
 * BACKGROUND MODEL: creating a subscription makes three outbound Microsoft
 * calls (app token, resolve channel, create subscription — the last of which
 * has Graph call our webhook back to validate it). Behind Cloudflare that
 * round-trip can outlive the origin's ~30s connection cap and the browser gets
 * an opaque gateway 502. So POST does the FAST checks synchronously (auth,
 * config, membership, Team connected), returns 202 immediately, and runs the
 * Graph work in the background, recording the outcome — success OR the real
 * Graph error — in collab.teams_subscription_status. The client polls GET for
 * that outcome instead of holding a connection open the whole time. This relies
 * on the long-lived server process (server.mts on the container), where a
 * detached promise runs to completion after the response is sent.
 *
 * GET /api/teams-subscribe?accountId=… — status only: server config, the live
 * subscription (if any), and the last background attempt's state/error.
 *
 * Renewal: Graph subscriptions expire (~1h). A scheduled job should re-POST
 * this per active account before expiry; calling it again simply refreshes.
 */

import { randomBytes } from "node:crypto";
import { requireUser } from "./_lib/requireUser.js";
import { withUserContext, withServiceContext } from "./_lib/db.js";
import { graphAppFetch, graphAppMissing, GraphAppError } from "./_lib/graphApp.js";

const SUBSCRIPTION_MINUTES = 55;

/** Record the background attempt's terminal state so GET can report it. Never
 * throws — this is the last write in a detached task and a rejection here would
 * otherwise become an unhandled rejection. */
async function recordStatus(accountId: string, state: "active" | "error", lastError: string | null): Promise<void> {
  try {
    await withServiceContext(async (tx) => {
      await tx`
        insert into collab.teams_subscription_status (account_id, state, last_error, last_attempt_at, updated_at)
        values (${accountId}, ${state}, ${lastError}, now(), now())
        on conflict (account_id) do update set
          state = excluded.state, last_error = excluded.last_error, updated_at = now()
      `;
    });
  } catch (err) {
    console.error(`[teams-subscribe] account=${accountId} failed to record status ${state}:`, err);
  }
}

/** The actual Graph provisioning, run detached from the HTTP request. Resolves
 * the channel, replaces any existing subscription, creates the new one, and
 * stores it. On ANY failure it records a readable reason to the status table.
 * Returns nothing and never rejects — the caller fire-and-forgets it. */
async function provisionSubscription(accountId: string, teamId: string, webhookUrl: string): Promise<void> {
  try {
    console.log(`[teams-subscribe] account=${accountId} team=${teamId} resolving primary channel`);
    const channel = (await graphAppFetch(`/teams/${teamId}/primaryChannel?$select=id`)) as { id?: string };
    if (!channel?.id) {
      await recordStatus(accountId, "error", "Could not resolve the team's primary channel from Microsoft Graph.");
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

    // Graph validates the notificationUrl synchronously here: it POSTs
    // ?validationToken=… to webhookUrl and needs the echo within 10s. If that
    // round-trip fails (webhook unreachable) OR the app lacks
    // ChannelMessage.Read.All consent, THIS call throws — logged below.
    console.log(`[teams-subscribe] account=${accountId} creating subscription resource=${resource} notificationUrl=${webhookUrl}`);
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
      await recordStatus(accountId, "error", "Microsoft Graph did not return a subscription id.");
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
    console.log(`[teams-subscribe] account=${accountId} subscription active id=${subscriptionId} expires=${storedExpiry}`);
    await recordStatus(accountId, "active", null);
  } catch (err) {
    // Turn the real Graph reason into a readable status. 403 = missing
    // ChannelMessage.Read.All consent (or the webhook failed validation); 400 =
    // Graph couldn't validate the notification URL.
    let message: string;
    if (err instanceof GraphAppError) {
      const hint = err.status === 403
        ? " — grant the app BOTH 'Channel.ReadBasic.All' (to read the team's channel) and 'ChannelMessage.Read.All' (to read messages) as APPLICATION permissions in the Entra app registration, then click Grant admin consent."
        : err.status === 400
          ? " — Graph could not validate the notification URL."
          : "";
      message = `Graph rejected the subscription (${err.status}): ${err.message}${hint}`;
    } else if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
      message = "Microsoft Graph did not respond in time creating the subscription (the outbound call timed out).";
    } else {
      message = err instanceof Error ? err.message : "unexpected error creating the subscription";
    }
    console.error(`[teams-subscribe] account=${accountId} provisioning failed: ${message}`);
    await recordStatus(accountId, "error", message);
  }
}

export default async function handler(
  req: { method?: string; body?: unknown; query?: Record<string, unknown>; headers?: Record<string, string | string[] | undefined> },
  res: { status: (code: number) => { json: (body: unknown) => void }; setHeader: (k: string, v: string) => void },
): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST" && req.method !== "GET") {
    res.status(405).json({ error: { code: "validation_failed", message: "GET (status) or POST (enable)" } });
    return;
  }

  const auth = await requireUser(typeof req.headers?.authorization === "string" ? req.headers.authorization : undefined);
  if (!auth.authorized) {
    res.status(auth.status).json(auth.body);
    return;
  }

  const rawAccountId = req.method === "POST"
    ? (req.body as { accountId?: unknown })?.accountId
    : (req.query as { accountId?: unknown } | undefined)?.accountId;
  const accountId = typeof rawAccountId === "string" ? rawAccountId : "";
  if (!accountId) {
    res.status(400).json({ error: { code: "validation_failed", message: "accountId is required" } });
    return;
  }

  // Server-config diagnostics — spell out EXACTLY what's missing, so a pilot can
  // tell "app credential not set" from "webhook url not set" without logs.
  const webhookUrl = process.env.TEAMS_WEBHOOK_URL;
  const missing = [...graphAppMissing(), ...(!webhookUrl ? ["TEAMS_WEBHOOK_URL"] : [])];

  // GET = status only: server config, the live subscription, and how the last
  // background attempt went (state + real error reason).
  if (req.method === "GET") {
    const [[sub], [status]] = await withServiceContext(async (tx) => {
      const subRows = await tx<{ subscription_id: string; expires_at: string }[]>`
        select subscription_id, expires_at from collab.teams_subscription where account_id = ${accountId}
      `;
      const statusRows = await tx<{ state: string; last_error: string | null; last_attempt_at: string }[]>`
        select state, last_error, last_attempt_at from collab.teams_subscription_status where account_id = ${accountId}
      `;
      return [subRows, statusRows] as const;
    });
    res.status(200).json({
      data: {
        configured: missing.length === 0,
        missingEnv: missing,
        webhookUrl: webhookUrl ?? null,
        subscription: sub ? { active: sub.expires_at > new Date().toISOString(), expiresAt: sub.expires_at } : null,
        status: status ? { state: status.state, lastError: status.last_error, lastAttemptAt: status.last_attempt_at } : null,
      },
    });
    return;
  }

  if (missing.length > 0) {
    res.status(400).json({
      error: { code: "teams_sync_not_configured", message: `Two-way Teams sync needs these set on the server: ${missing.join(", ")}.` },
    });
    return;
  }

  // Membership + Team check under the caller's RLS: they see this account's
  // ms_team_id only if they belong to it. This is the fast authorization gate;
  // everything slow (the Graph round-trip) happens in the background AFTER it.
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

  // Mark the attempt 'creating' so a concurrent GET shows progress immediately.
  await withServiceContext(async (tx) => {
    await tx`
      insert into collab.teams_subscription_status (account_id, state, last_error, last_attempt_at, updated_at)
      values (${accountId}, 'creating', null, now(), now())
      on conflict (account_id) do update set state = 'creating', last_error = null, last_attempt_at = now(), updated_at = now()
    `;
  });

  // Detach the Graph work. provisionSubscription never rejects (it records its
  // own failures), but keep a final .catch as a hard guarantee against an
  // unhandled rejection taking down the long-lived server process.
  void provisionSubscription(accountId, teamId, webhookUrl!).catch((err) => {
    console.error(`[teams-subscribe] account=${accountId} background task escaped:`, err);
  });

  // 202 Accepted: the client polls GET for 'active' or 'error'.
  res.status(202).json({ data: { status: "creating" } });
}
