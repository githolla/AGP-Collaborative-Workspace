import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { broadcastResponseToMainFrame } from "@azure/msal-browser/redirect-bridge";
import { App } from "./App.js";
import "./styles.css";

/**
 * MSAL's `acquireTokenPopup` (graphAuth.ts) does NOT poll the popup window's
 * location for the auth response the way older msal-browser versions did —
 * this installed version (5.18.0, verified by reading
 * node_modules/@azure/msal-browser/dist/interaction_client/PopupClient.mjs)
 * waits on a BroadcastChannel instead, and expects the page that loads
 * inside the popup (our own redirectUri — this app's own root, since there
 * is no dedicated blank redirect page) to itself call
 * `broadcastResponseToMainFrame()` from `@azure/msal-browser/redirect-bridge`
 * to parse the response out of the URL, post it to that channel, and close
 * the popup. Without this, the popup just boots the full app normally and
 * sits there forever — exactly the bug this fixes (popup shows the site,
 * never closes, opener's wait times out silently).
 *
 * `window.opener` is only ever set for us here by MSAL's own popup (see
 * graphAuth.ts) — the only other window.open() call in this app
 * (ClientWorkspace.tsx's file links) uses "noreferrer", which never sets
 * opener, and targets external SharePoint URLs, not this app's origin. So
 * gating on it is a safe, cheap pre-filter; `broadcastResponseToMainFrame`
 * also independently validates the URL actually carries a parseable auth
 * response (it throws otherwise), so a false-positive opener (e.g. Teams
 * opening this app in a new window for an unrelated reason) safely falls
 * through to a normal app mount below.
 */
async function handleMsalPopupBridge(): Promise<boolean> {
  if (!window.opener) return false;
  try {
    await broadcastResponseToMainFrame();
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (await handleMsalPopupBridge()) return;

  const rootEl = document.getElementById("root");
  if (!rootEl) throw new Error("missing #root element");
  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void main();
