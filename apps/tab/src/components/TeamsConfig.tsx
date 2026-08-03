import { useEffect, useState } from "react";
import { T } from "../theme.js";
import { setupTabConfig } from "../teams/teamsHost.js";

/**
 * The screen Teams shows while someone adds this app as a channel tab. Teams
 * opens it inside its own dialog and keeps Save disabled until the page
 * declares what the tab will point at.
 *
 * Reached at #teams-config — never linked, because a person browsing the web
 * app has no use for it.
 */
export function TeamsConfig() {
  const [ready, setReady] = useState<boolean | null>(null);
  const contentUrl = `${window.location.origin}/`;

  useEffect(() => {
    void setupTabConfig(contentUrl, "Collaboration").then(setReady);
  }, [contentUrl]);

  return (
    <div style={{ maxWidth: 520, margin: "48px auto", padding: "0 18px", fontFamily: "inherit" }}>
      <h1 style={{ fontSize: 18, fontWeight: 800, color: T.roi.navy }}>Add the Collaboration Workspace</h1>
      <p style={{ fontSize: 13, color: T.inkSecondary, lineHeight: 1.6, marginTop: 8 }}>
        This tab opens the AGP Collaboration Workspace for your team — the same workspace as the web app, with
        the same sign-in. Choose <strong>Save</strong> to add it to this channel.
      </p>

      <div style={{ border: `1px solid ${T.grid}`, borderRadius: 10, padding: "12px 14px", marginTop: 14 }}>
        <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", color: T.inkMuted }}>
          The tab will open
        </div>
        <div style={{ fontSize: 13, color: T.ink, marginTop: 4, wordBreak: "break-all" }}>{contentUrl}</div>
      </div>

      {/* Say plainly when Teams isn't driving this page, rather than leaving
          someone staring at a Save button that will never enable. */}
      {ready === false && (
        <div style={{ fontSize: 12.5, color: "#8a6d1a", background: "#faf3dc", border: "1px solid #e7c66f", borderRadius: 8, padding: "10px 12px", marginTop: 14, lineHeight: 1.55 }}>
          This page is meant to be opened by Teams while adding a tab. Opened directly in a browser it can't
          configure anything — nothing is wrong with the app itself.
        </div>
      )}
      {ready === null && <div style={{ fontSize: 12, color: T.inkMuted, marginTop: 14 }}>Talking to Teams…</div>}
    </div>
  );
}
