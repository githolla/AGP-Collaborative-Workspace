import {
  PublicClientApplication,
  InteractionRequiredAuthError,
  type AccountInfo,
} from "@azure/msal-browser";

/**
 * Delegated Microsoft Graph token acquisition (docs/teams-provisioning-plan.md
 * B1: "Prove the delegated token" — "nothing else on this track is worth
 * writing until this works, because it decides the shape").
 *
 * WHY THIS IS A SEPARATE MODULE FROM ssoAuth.ts, NOT AN EXTENSION OF IT: the
 * app's sign-in is brokered through Supabase Auth (ssoAuth.ts), requesting
 * only `openid profile email` — Supabase's own session token authorizes
 * calls to THIS app's `/api`, nothing more. A Microsoft Graph access token
 * (for Files.ReadWrite.All, Channel.Create, etc.) is a genuinely different
 * token, for a different audience (graph.microsoft.com, not this app), and
 * B1 explicitly spiked whether Supabase's OAuth session could ALSO surface
 * one directly (`session.provider_token`) before committing to a second
 * token surface. It can't, cheaply: `signInWithOAuth`'s `scopes` option in
 * ssoAuth.ts only ever requested the three sign-in scopes, so no Graph
 * consent has ever been exercised through that path — and even if it were
 * added there, B1's own listed risk stands: Supabase does not reliably
 * surface a REFRESHABLE provider token, only the one issued at sign-in. MSAL
 * owns silent refresh itself (via its own cache + refresh token), which is
 * exactly the property this needs for a token that has to stay live for an
 * entire browsing session, not just the moment right after sign-in.
 *
 * This means the user authenticates against Entra TWICE in effect — once via
 * Supabase's OAuth popup (sign-in), once via MSAL (Graph), the second via an
 * interactive popup whenever no MSAL account is already cached on this
 * browser (see `currentGraphTokenDetailed`'s own comment for why this
 * doesn't attempt `ssoSilent` first), per B1's design: "MSAL.js acquiring
 * Graph tokens directly, alongside the existing Supabase session... costs a
 * second token surface."
 *
 * Requires its OWN SPA platform redirect URI on the Entra app registration
 * (A1① — MSAL.js needs this even though the app already has a Web platform
 * entry for Supabase's callback) and the delegated Graph scopes below
 * consented org-wide (A1②). Until both land, `graphConfigured()` is false
 * (missing env) or every acquisition attempt fails with `AADSTS65001`
 * (consent required) — that failure is not this module's to silently paper
 * over; callers see it.
 */

/** Exactly A1②'s table, in docs/teams-provisioning-plan.md — no more, no
 * less. `Team.Create`, `Sites.Selected`, and every application-only
 * permission are deliberately NOT requested; see that doc's "Not requested,
 * deliberately" list for why each one is excluded.
 *
 * `Team.ReadBasic.All` was added after a live 403: account-team.ts's
 * "adopt Team" flow calls `GET /teams/{teamId}` to confirm the admin-
 * supplied Team id is real before doing anything else with it, and that
 * read was never given a scope in the original table — a genuine gap, not
 * a "decline this" case, since it's the narrowest of Graph's listed
 * alternatives (Team.ReadBasic.All, not Group.Read.All/Directory.Read.All,
 * which the doc already excludes for being tenant-wide-broader than this
 * app needs). */
/** `ChannelMessage.Send` was added for the @mention → Teams notification
 * (api/_lib/teamsNotify.ts): posting a Discussion message that @mentions a
 * member mirrors it into the account's Team channel with a real mention, which
 * is what makes Teams natively notify them. It's delegated (the post is sent as
 * the author) and needs tenant admin consent; until that's granted the channel
 * POST 403s and the notify is skipped — the in-app post still succeeds. */
const GRAPH_SCOPES = ["Channel.Create", "ChannelMessage.Send", "TeamMember.ReadWrite.All", "User.ReadBasic.All", "Files.ReadWrite.All", "User.Invite.All", "Team.ReadBasic.All"];

/** Same pattern as ssoAuth.ts's local `env()` — Vite bakes VITE_* at build
 * time, so this reads import.meta.env directly rather than process.env. */
function env(key: string): string {
  const meta = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  return (meta[key] ?? "").trim();
}

export function graphConfigured(): boolean {
  return !!env("VITE_GRAPH_CLIENT_ID") && !!env("VITE_GRAPH_TENANT_ID");
}

let msal: PublicClientApplication | null = null;
let initializing: Promise<PublicClientApplication | null> | null = null;

/** Lazily constructs and initializes the MSAL instance exactly once, even
 * under concurrent callers — `initialize()` is required before any other
 * MSAL call in this library version and is itself async. */
async function getMsal(): Promise<PublicClientApplication | null> {
  if (msal) return msal;
  if (initializing) return initializing;

  const clientId = env("VITE_GRAPH_CLIENT_ID");
  const tenantId = env("VITE_GRAPH_TENANT_ID");
  if (!clientId || !tenantId) return null;

  initializing = (async () => {
    const instance = new PublicClientApplication({
      auth: {
        clientId,
        authority: `https://login.microsoftonline.com/${tenantId}`,
        // The dedicated SPA platform entry from A1① — Entra matches this by
        // EXACT STRING, and the already-registered production entry (per
        // docs/m365-admin-runbook.md 1.1) is
        // "https://collaboration.teamallegiance.com/" — WITH a trailing
        // slash. `window.location.origin` never has one (it's just
        // "https://collaboration.teamallegiance.com"), so falling back to
        // it bare would send a mismatched redirect_uri and fail even in
        // production. Appending "/" here matches that registered
        // convention by default, with no env var required for the common
        // case; VITE_GRAPH_REDIRECT_URI only needs setting for an
        // environment registered some OTHER way.
        redirectUri: env("VITE_GRAPH_REDIRECT_URI") || `${window.location.origin}/`,
      },
      cache: { cacheLocation: "sessionStorage" },
    });
    await instance.initialize();
    msal = instance;
    return instance;
  })();
  return initializing;
}

function firstAccount(instance: PublicClientApplication): AccountInfo | undefined {
  return instance.getAllAccounts()[0];
}

/** MSAL/AAD errors carry `errorCode`/`errorMessage` beyond the base `Error`
 * fields (e.g. `redirect_uri_mismatch`, or an `AADSTS...` code buried in
 * `errorMessage` for a server-side AAD rejection) — surfaced here because
 * `currentGraphToken`'s own callers (msApiFetch.ts, checkGraphProfile) were
 * previously collapsing every failure to the same generic string, making a
 * real, fixable problem (e.g. the local dev redirect URI never having been
 * registered in Entra) indistinguishable from "consent hasn't landed yet"
 * without opening the browser console. */
function describeMsalError(err: unknown): string {
  if (err && typeof err === "object") {
    const code = (err as { errorCode?: string }).errorCode;
    const detail = (err as { errorMessage?: string }).errorMessage;
    if (code) return detail ? `${code}: ${detail}` : code;
  }
  return err instanceof Error ? err.message : String(err);
}

export interface GraphTokenResult {
  token: string | null;
  /** Present only when `token` is null — the real MSAL/AAD failure reason,
   * not a generic placeholder. */
  reason?: string;
}

/**
 * Resolves a delegated Graph access token:
 *
 *  1. An MSAL account already cached from a prior acquisition on this
 *     browser → `acquireTokenSilent` (refreshes via MSAL's own cache,
 *     no network round-trip to the user at all in the common case).
 *  2. Otherwise → one interactive popup, immediately, straight off
 *     whatever click triggered this call. Never a redirect: this app can
 *     run embedded in a Teams tab iframe, where a top-level redirect
 *     either breaks the embed or is blocked outright — the same reason
 *     BLOCKERS.md's own notes call out third-party-cookie and popup
 *     issues for iframe-hosted interactive sign-in. Also never `ssoSilent`
 *     first — see the comment at that call site for why chaining a popup
 *     behind it backfires.
 *
 * Never throws — every failure (Graph not configured, or every path
 * including the popup failing) resolves to `{ token: null, reason }`, with
 * the real MSAL/AAD error attached rather than swallowed.
 */
export async function currentGraphTokenDetailed(loginHintEmail?: string): Promise<GraphTokenResult> {
  const instance = await getMsal();
  if (!instance) return { token: null, reason: "Graph not configured — VITE_GRAPH_CLIENT_ID/VITE_GRAPH_TENANT_ID unset" };

  const account = firstAccount(instance);
  if (account) {
    try {
      const result = await instance.acquireTokenSilent({ scopes: GRAPH_SCOPES, account });
      return { token: result.accessToken };
    } catch (err) {
      // Falls through to the popup below for two cases, not just MSAL's own
      // InteractionRequiredAuthError (interaction genuinely required —
      // expired consent, revoked grant): also its own `timed_out` error code
      // (BrowserAuthErrorCodes.timedOut). acquireTokenSilent can still fall
      // back to a hidden-iframe renewal against Entra when the cached
      // account's refresh token needs re-validation — the exact same class
      // of failure this function already avoids `ssoSilent` for on the
      // no-cached-account path below, just reachable here too. Confirmed
      // live: "Sync Project folders" failing with exactly this code and no
      // popup ever shown — a stalled iframe round-trip, not a real refusal,
      // and the button click's gesture is still fresh here (we haven't
      // burned it on a slow ssoSilent first), so popping up now works.
      // Any OTHER error (network, bad config) still isn't a cue to prompt.
      if (!(err instanceof InteractionRequiredAuthError) && !isMsalTimeout(err)) {
        return { token: null, reason: describeMsalError(err) };
      }
    }
  }
  // No `ssoSilent` attempt here, deliberately — it used to run before the
  // popup fallback below whenever there was no cached account, but that's
  // exactly backwards in practice: `ssoSilent` runs its whole exchange in a
  // hidden iframe, which is where third-party-cookie restrictions (Safari
  // ITP, Chrome's phase-out, Firefox ETP — BLOCKERS.md's own noted risk)
  // bite hardest, and MSAL's iframe timeout (several seconds) is longer
  // than the browser's "recent user gesture" window a `window.open()` call
  // needs. Caught live: `ssoSilent` timed out, and by the time the code
  // fell through to `acquireTokenPopup` the click that triggered this
  // whole call had aged out of gesture eligibility, so the popup itself
  // was then blocked (`popup_window_error`) — ssoSilent failing wasn't
  // just a delay, it was actively causing the fallback to fail too. Going
  // straight to the popup keeps it inside the original click's gesture.

  const popupArgs = { scopes: GRAPH_SCOPES, ...(loginHintEmail ? { loginHint: loginHintEmail } : {}) };
  try {
    const result = await instance.acquireTokenPopup(popupArgs);
    return { token: result.accessToken };
  } catch (err) {
    // MSAL tracks "an interaction is already running" in a storage flag
    // (verified against the installed @azure/msal-browser's own source:
    // BrowserCacheManager/CacheKeys — the literal key is `msal.interaction
    // .status`, written to whichever `cacheLocation` this app configured
    // (sessionStorage), with no client-id segment, so clearing it can't
    // touch any cached token). A popup that errors out abnormally — closed
    // mid-flow, a redirect_uri mismatch, a timeout — can leave that flag
    // stuck set, and every subsequent attempt then fails immediately with
    // `interaction_in_progress` even though nothing is actually running
    // (caught live: exactly this, after a redirect_uri-mismatch popup
    // failure). One clear-and-retry recovers without the user having to
    // close the tab or clear storage by hand.
    if (isInteractionInProgress(err)) {
      clearStuckInteractionFlag();
      try {
        const retry = await instance.acquireTokenPopup(popupArgs);
        return { token: retry.accessToken };
      } catch (err2) {
        return { token: null, reason: describeMsalError(err2) };
      }
    }
    return { token: null, reason: describeMsalError(err) };
  }
}

function isInteractionInProgress(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { errorCode?: string }).errorCode === "interaction_in_progress";
}

/** MSAL's `BrowserAuthErrorCodes.timedOut` ("timed_out") — a stalled hidden-
 * iframe round-trip during `acquireTokenSilent`'s own background renewal,
 * not a real refusal. Checked by raw errorCode, same as
 * `isInteractionInProgress` above, rather than importing `BrowserAuthError`
 * for one string comparison. */
function isMsalTimeout(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { errorCode?: string }).errorCode === "timed_out";
}

const MSAL_INTERACTION_STATUS_KEY = "msal.interaction.status";

function clearStuckInteractionFlag(): void {
  try {
    window.sessionStorage.removeItem(MSAL_INTERACTION_STATUS_KEY);
  } catch {
    // sessionStorage unavailable — nothing to clear, and nothing more to do
  }
}

/** Thin wrapper over `currentGraphTokenDetailed` for callers that only need
 * the token, not the failure reason (kept for the existing call sites). */
export async function currentGraphToken(loginHintEmail?: string): Promise<string | null> {
  return (await currentGraphTokenDetailed(loginHintEmail)).token;
}

export interface GraphProfileCheck {
  ok: boolean;
  status?: number;
  profile?: { displayName?: string; mail?: string; userPrincipalName?: string; id?: string };
  error?: string;
}

/**
 * B1's own acceptance test, made runnable: "the signed-in AGP user's own
 * profile, fetched from Graph, in the browser." Fetches `GET /me` with
 * whatever token `currentGraphToken` resolves — the one-call proof that A1
 * (admin consent) and this module actually work together, without needing
 * any of B2 onward (folders, uploads, guest invites) built first. Wire this
 * to a button once Graph consent is believed to have landed; nothing else
 * on this track needs to exist for that check to be meaningful.
 */
export async function checkGraphProfile(loginHintEmail?: string): Promise<GraphProfileCheck> {
  const { token, reason } = await currentGraphTokenDetailed(loginHintEmail);
  if (!token) return { ok: false, error: reason ?? "no Graph token available" };

  try {
    const res = await fetch("https://graph.microsoft.com/v1.0/me", { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return { ok: false, status: res.status, error: await res.text() };
    const profile = (await res.json()) as NonNullable<GraphProfileCheck["profile"]>;
    return { ok: true, status: res.status, profile };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "network error" };
  }
}
