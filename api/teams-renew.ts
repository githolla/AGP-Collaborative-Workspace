/**
 * Automatic renewal of Microsoft Graph change-notification subscriptions for
 * two-way Teams sync.
 *
 * Graph channel-message subscriptions expire in ~1h (we create them 55 min
 * out). Without renewal, two-way sync silently stops working within the hour —
 * the webhook simply stops receiving notifications and nothing tells anyone.
 *
 * This runs as an IN-PROCESS loop, started from server.mts, on the same
 * long-lived container that already backs the background-provisioning model in
 * teams-subscribe.ts. That keeps renewal "nothing to schedule": no external
 * cron, no extra infra for AGP to stand up. If the app credential or webhook
 * URL isn't configured, the loop no-ops.
 *
 * Each pass extends every subscription due within RENEW_BEFORE_MS via a Graph
 * PATCH (the normal, cheap renewal). If Graph reports the subscription is gone
 * (404 — it already lapsed, or was deleted server-side), it falls back to a full
 * re-provision, which re-validates the webhook and mints a fresh subscription.
 */

import { withServiceContext } from "./_lib/db.js";
import { graphAppFetch, graphAppConfigured, GraphAppError } from "./_lib/graphApp.js";
import { provisionSubscription, SUBSCRIPTION_MINUTES } from "./teams-subscribe.js";

/** Renew a subscription this far ahead of its expiry, so a single missed pass
 * (or a slow Graph call) still leaves margin before it lapses. */
const RENEW_BEFORE_MS = 20 * 60_000;

/** How often the loop wakes. Comfortably more frequent than RENEW_BEFORE_MS so
 * two consecutive passes both fall inside the renewal window. */
const RENEW_INTERVAL_MS = 10 * 60_000;

interface SubRow {
  account_id: string;
  subscription_id: string;
  team_id: string;
  expires_at: string;
}

async function markStatus(accountId: string, state: "active" | "error", lastError: string | null): Promise<void> {
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
    console.error(`[teams-renew] account=${accountId} failed to record status ${state}:`, err);
  }
}

/**
 * Extend one subscription in place via Graph PATCH. On 404 (subscription gone)
 * re-provision from scratch. Records status and never rejects — a single bad
 * subscription must not abort the whole pass or escape as an unhandled
 * rejection.
 */
async function renewOne(sub: SubRow, webhookUrl: string): Promise<void> {
  const newExpiry = new Date(Date.now() + SUBSCRIPTION_MINUTES * 60_000).toISOString();
  try {
    const updated = (await graphAppFetch(`/subscriptions/${sub.subscription_id}`, {
      method: "PATCH",
      body: { expirationDateTime: newExpiry },
    })) as { expirationDateTime?: string } | null;
    const storedExpiry = updated?.expirationDateTime ?? newExpiry;
    await withServiceContext(async (tx) => {
      await tx`
        update collab.teams_subscription
        set expires_at = ${storedExpiry}, updated_at = now()
        where account_id = ${sub.account_id}
      `;
    });
    await markStatus(sub.account_id, "active", null);
    console.log(`[teams-renew] account=${sub.account_id} extended subscription=${sub.subscription_id} expires=${storedExpiry}`);
  } catch (err) {
    if (err instanceof GraphAppError && err.status === 404) {
      // The subscription lapsed or was removed server-side — re-create it.
      console.log(`[teams-renew] account=${sub.account_id} subscription gone (404) — re-provisioning`);
      await provisionSubscription(sub.account_id, sub.team_id, webhookUrl);
      return;
    }
    const message = err instanceof GraphAppError
      ? `Graph rejected the renewal (${err.status}): ${err.message}`
      : err instanceof Error ? err.message : "unexpected error renewing the subscription";
    console.error(`[teams-renew] account=${sub.account_id} renewal failed: ${message}`);
    await markStatus(sub.account_id, "error", message);
  }
}

/** One renewal sweep: extend every subscription due within RENEW_BEFORE_MS.
 * Exported for direct invocation (tests, a manual kick). Never rejects. */
export async function renewExpiringSubscriptions(): Promise<void> {
  const webhookUrl = process.env.TEAMS_WEBHOOK_URL;
  if (!graphAppConfigured() || !webhookUrl) return;

  let due: SubRow[];
  try {
    const cutoff = new Date(Date.now() + RENEW_BEFORE_MS).toISOString();
    due = await withServiceContext(async (tx) => {
      return await tx<SubRow[]>`
        select account_id, subscription_id, team_id, expires_at
        from collab.teams_subscription
        where expires_at < ${cutoff}
        order by expires_at asc
      `;
    });
  } catch (err) {
    console.error("[teams-renew] failed to read subscriptions due for renewal:", err);
    return;
  }

  if (due.length === 0) return;
  console.log(`[teams-renew] renewing ${due.length} subscription(s) due before expiry`);
  // Sequential: renewals are infrequent and low-volume, and serial keeps the
  // Graph call rate gentle and the logs readable.
  for (const sub of due) {
    await renewOne(sub, webhookUrl);
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the in-process renewal loop. Idempotent — a second call is a no-op, so
 * it's safe to call once from server.mts. Runs a first sweep shortly after boot
 * (to catch anything already near expiry after a restart), then every
 * RENEW_INTERVAL_MS. Returns immediately; the loop is detached.
 */
export function startTeamsRenewalLoop(): void {
  if (timer) return;
  const webhookUrl = process.env.TEAMS_WEBHOOK_URL;
  if (!graphAppConfigured() || !webhookUrl) {
    console.log("[teams-renew] not started — app credential or TEAMS_WEBHOOK_URL not configured");
    return;
  }
  console.log(`[teams-renew] renewal loop started (every ${Math.round(RENEW_INTERVAL_MS / 60_000)} min)`);
  // First sweep 30s after boot so it doesn't race container/DB warmup.
  setTimeout(() => { void renewExpiringSubscriptions(); }, 30_000);
  timer = setInterval(() => { void renewExpiringSubscriptions(); }, RENEW_INTERVAL_MS);
  // Don't keep the event loop alive solely for this timer.
  if (typeof timer.unref === "function") timer.unref();
}
