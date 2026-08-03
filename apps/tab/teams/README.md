# Teams tab — package and sideload

The workspace runs as a **tab inside Microsoft Teams**. The tab is a wrapper
around the same URL and the same data — nothing behaves differently inside
Teams, and the web app is untouched when this is unused.

## Build the package

```sh
pnpm teams:package
# or, for a preview deployment:
TEAMS_APP_URL=https://<preview-host> pnpm teams:package
```

Output: `apps/tab/teams/dist/agp-collaboration-teams.zip` — manifest plus the
two icons, which is the only shape Teams accepts. The URL is substituted at
build time, so the same manifest serves production and previews.

## What AGP's Teams admin has to allow

Sideloading a custom app is **off by default**. In Teams admin centre →
**Teams apps → Setup policies**, turn on *Upload custom apps* for the pilot
group — or publish the package to the org app catalog, which is the same
upload done once centrally.

Until that's on, the zip cannot be added at all. This is the only hard
dependency (BLOCKERS #6).

## Adding the tab

**Channel tab:** channel → **+** → *Manage apps / Upload a custom app* → pick
the zip → the config screen (`#teams-config`) opens → **Save**.

**Personal tab:** the app appears in the left rail after upload; pin it.

## If the tab loads but sign-in fails

This is the failure worth expecting, and it is not a bug in the package.

Microsoft sign-in went live on 2026-07-29, so a tab now hits an **interactive**
sign-in *inside an iframe* — exactly where third-party cookie policy and popup
blocking break OAuth. Symptoms: a blank frame, a sign-in that loops, or a
popup that closes without returning.

The fix is Teams SSO rather than interactive sign-in:

1. On the Entra app registration, **Expose an API** → Application ID URI
   `api://collaboration.teamallegiance.com/<client-id>`.
2. Add the delegated scope **`access_as_user`**.
3. **Pre-authorize the Teams client applications** for that scope (Teams
   desktop/mobile and Teams web), then grant admin consent.

That is the same admin pass as the Graph consent, so it is worth requesting
together rather than discovering separately.

## Hosting requirement (already done)

Teams frames the app, so the host must permit it. Both deployments send:

```
Content-Security-Policy: frame-ancestors 'self' teams.microsoft.com *.teams.microsoft.com …
```

set in `vercel.json` and in `server.mts` (the Azure Container Apps path).
`X-Frame-Options` is deliberately not set — its `ALLOW-FROM` is ignored by
current browsers, and a bare `SAMEORIGIN` would block Teams outright.

## Files

| File | Purpose |
|---|---|
| `manifest.json` | App definition — tabs, icons, valid domains |
| `color.png` (192×192) | Full-colour icon |
| `outline.png` (32×32) | Transparent silhouette; Teams tints it per theme |
| `build-package.mjs` | Substitutes the URL and writes the zip |
| `../src/teams/teamsHost.ts` | SDK init; no-op outside Teams |
| `../src/components/TeamsConfig.tsx` | The `#teams-config` setup screen |
