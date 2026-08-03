/**
 * Running inside Microsoft Teams.
 *
 * Teams renders a tab in an iframe and will not show it until the embedded
 * page calls `app.initialize()` — without that the tab sits on a spinner
 * forever. Everything here is therefore load-bearing for the tab and a no-op
 * in a browser: the SDK is imported lazily so people opening the normal URL
 * never download it, and every failure path leaves the app running exactly as
 * it does today. A Teams integration must never be able to break the browser.
 */

export interface TeamsHost {
  /** True when the page really is hosted by Teams. */
  inTeams: boolean;
  /** Teams' current theme, so the app can follow it later if we choose to. */
  theme?: string;
  /** Channel/chat the tab was added to, when Teams tells us. */
  channelName?: string;
  teamName?: string;
}

/**
 * Cheap synchronous guess, used before the SDK loads.
 *
 * Being in an iframe is necessary but not sufficient, so we also look for the
 * markers Teams puts on the URL when it loads a tab. This only decides whether
 * to *try* initializing — the SDK's own answer is authoritative.
 */
export function looksLikeTeams(): boolean {
  try {
    const framed = window.self !== window.top;
    const url = new URL(window.location.href);
    const hinted =
      url.searchParams.has("theme") ||
      /teams|msteams/i.test(url.searchParams.get("hostClientType") ?? "") ||
      /Teams/i.test(window.navigator.userAgent);
    return framed || hinted;
  } catch {
    // Cross-origin access to window.top throws — which itself means framed.
    return true;
  }
}

/**
 * Initialize the Teams SDK if we're inside Teams. Resolves with what the host
 * told us; resolves with `inTeams: false` in a plain browser, and on any
 * failure — a tab that can't initialize is a Teams problem, not a reason to
 * take the web app down with it.
 */
export async function initTeams(): Promise<TeamsHost> {
  if (!looksLikeTeams()) return { inTeams: false };
  try {
    const teams = await import("@microsoft/teams-js");
    await teams.app.initialize();
    const ctx = await teams.app.getContext();
    // Tell Teams the tab is ready, or it keeps showing its own loading state.
    teams.app.notifySuccess();
    return {
      inTeams: true,
      ...(ctx.app?.theme ? { theme: ctx.app.theme } : {}),
      ...(ctx.channel?.displayName ? { channelName: ctx.channel.displayName } : {}),
      ...(ctx.team?.displayName ? { teamName: ctx.team.displayName } : {}),
    };
  } catch {
    // Framed by something that isn't Teams, or the SDK failed to load.
    return { inTeams: false };
  }
}

/**
 * The tab configuration screen Teams opens when someone adds a channel tab.
 * Teams requires the page to declare a content URL and mark itself valid
 * before its "Save" button becomes clickable.
 */
export async function setupTabConfig(contentUrl: string, tabName: string): Promise<boolean> {
  try {
    const teams = await import("@microsoft/teams-js");
    await teams.app.initialize();
    teams.pages.config.registerOnSaveHandler((event) => {
      void teams.pages.config
        .setConfig({ contentUrl, entityId: "agp-collaboration", suggestedDisplayName: tabName, websiteUrl: contentUrl })
        .then(() => event.notifySuccess())
        .catch(() => event.notifyFailure("Could not save the tab configuration"));
    });
    await teams.pages.config.setValidityState(true);
    return true;
  } catch {
    return false;
  }
}
