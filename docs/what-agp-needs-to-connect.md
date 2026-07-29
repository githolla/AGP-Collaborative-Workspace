# What AGP needs to provide to connect Nine-67 (Collaboration Workspace)

The app is built and running on demo data. To go live in AGP's Microsoft
environment — and especially to **replace the contractor extranets with secure,
per-document file sharing that tracks opens and edits** — AGP's Microsoft 365 /
IT admin needs to set up the items below and hand us a few public IDs. Nothing
here is a secret except where noted.

Split into **(1) sign-in**, **(2) the files story — the key ask**, **(3)
notifications**, **(4) hosting**, **(5) Kantata**. Only #1 is needed to pilot
sign-in; #1 + #2 is the real pilot Cara and Kellie care about.

---

## 1. Sign-in — Microsoft Entra ID app registration  *(foundation, required)*

AGP's Entra admin registers one app; everything else reuses it.

- **Entra admin center → App registrations → New registration.** Name it
  e.g. `Nine-67 Collaboration`.
- **Platform:** Single-page application (SPA). **Redirect URI** = the app's web
  address (we confirm the exact URL once it's hosted on Azure — see #4).
- **API permissions → Microsoft Graph → Delegated → add + Grant admin consent:**
  - `User.Read` — sign-in. *(the only one needed for a sign-in-only pilot)*
- **Hand us two IDs** (both public, not secrets):
  - **Directory (tenant) ID**
  - **Application (client) ID**

We set `VITE_ENTRA_TENANT_ID` and `VITE_ENTRA_CLIENT_ID`, flip `AUTH_REQUIRED=true`,
and single sign-on goes live. (The server already validates the token; the
button is already built.)

---

## 2. Files — get off the extranet, secure view/edit/save, track opens & edits  *(the key ask)*

The goal Kellie described: a contractor or client edits **one live document**
(the strategy doc, a copy doc) — changes save back and are tracked — **without
getting access to the whole internal SharePoint folder**. Here's what makes that
possible in Microsoft, and what IT has to decide/enable:

**a. Item-level sharing (this is the part that removes Kellie's fear).**
Microsoft Graph/SharePoint can share a **single file or subfolder** — not the
parent library. So AGP does **not** have to restructure everything; they have to
**allow item-level external sharing** and let our app create those scoped shares.

**b. Turn on external sharing for the collaboration sites *(SharePoint admin).***
Today it's locked down. IT sets external sharing to at least **"New and existing
guests"** (or "Existing guests only" if they pre-invite people). This can be
**scoped to just the client-collaboration sites**, not the whole tenant — so the
rest of SharePoint stays as locked as it is now.

**c. Decide where shareable project files live.**
Confirm a structure where client-shareable docs are separable from internal-only
ones — a SharePoint site (or document library) per client, or a "client-shared"
area. They mostly have this; we just need it confirmed so a shared link never
exposes an internal folder.

**d. Graph permissions for files — least privilege (`Sites.Selected`).**
On the same app registration, add and admin-consent:
  - **`Sites.Selected`** (Application) — then **grant the app access to only the
    specific client site(s)**. This is the security-friendly option: the app can
    touch *only* the sites IT names, nothing else in SharePoint.
    *(Alternative if they prefer not to per-site: `Files.ReadWrite.All` /
    `Sites.ReadWrite.All` — broader, so `Sites.Selected` is recommended.)*

**e. Guest access for clients & contractors (Entra External ID / B2B).**
Allow inviting **client and contractor emails as guests** — or enable **email
one-time-passcode** for guests so they don't need a Microsoft account. This is
what replaces the extranet logins. IT sets the guest policy.

**f. Tracking opens & edits (powers the "they haven't opened it — nudge them").**
  - **Edits/versions:** SharePoint **version history** is on by default — who
    changed what, when, is already captured (this covers "track edits/saves").
  - **Opens/views:** enable the **unified audit log (Microsoft Purview)** if it
    isn't already — it records file opens/views/downloads per user. This is the
    signal behind the automatic reminder ("the client hasn't opened the doc,
    feedback is due — nudge them").

> Co-authoring (multiple people editing the live doc at once) is **native** in
> SharePoint / Office for the web once access is granted — no extra setup.

**Net:** with (b) external sharing on for the client sites, (d) `Sites.Selected`
granted to those sites, (e) guest access, and (f) the audit log on, the
extranets go away — a contractor edits one live doc, it saves back with version
history, and we can see when the client opened it.

---

## 3. Notifications — Teams and/or email  *(choose the default)*

People don't live in the tool; a nudge brings them in. Provide one or both:
- **Teams:** approve a Teams **incoming webhook** (simplest) or a small Teams app
  that can post notifications.
- **Email:** either add **`Mail.Send`** (delegated/application) to the app
  registration, or provide a **SendGrid** (or similar) send key.
  **Settled on the 2026-07-29 call: use SendGrid.** AGP has a paid account
  already wired to other apps, Ren holds the API key and attaches it at the
  application level, and it has been proven on another build. That takes
  `Mail.Send` — and one more round of Entra admin consent — off the list.
  Ren also sets the **reply-to address** as an environment variable, so we need
  to tell him which address replies should come back to.
- **Decide the default channel** (Teams, email, or per-person choice — the app
  already lets each person pick).

---

## 4. Hosting — Azure in AGP's tenant

> **Status 2026-07-29: the Azure environment is in hand.** What's left is
> configuration, not procurement — the final URL, the env vars below, and
> pointing the pipeline at the repo. See BLOCKERS #10.

Host the app on **Azure within AGP's Microsoft environment** (the plan already in
motion) so identity, files, and audit all stay inside their tenant. IT provisions
the Azure target and gives us the **final URL** — which becomes the redirect URI
in #1.

**Division of responsibility once on Azure:** the Nine-67 side **just pushes
code**. The **Azure owner (Ren) manages the environment** — the environment
variables and backend config live in Azure, not in the code. So the flow is:
AGP/IT hands over the **values** (tenant ID, client ID, Kantata token, any mail
key), Ren **sets them as env vars in Azure** and runs the backend, and we push
code that reads them. The env keys the Azure config needs:
- **Build-time (baked into the web app):** `VITE_ENTRA_TENANT_ID`,
  `VITE_ENTRA_CLIENT_ID` — must be present when the Azure pipeline **builds**.
- **Runtime (backend / serverless):** `AUTH_REQUIRED=true`, `ENTRA_TENANT_ID`,
  `ENTRA_CLIENT_ID`, the Kantata token, and any notification key.

Ren owns setting these in Azure; we own the code that consumes them.

---

## 5. Kantata — the live data pull

- Provide the **Kantata API token** (OAuth app / token) for the live pull.
  *(Cara is already setting this up.)* We need the **callback URL** confirmed —
  pending Ren's Azure URL for the app.

---

## 6. Teams tab — embed the whole workspace inside Teams  *(optional, higher adoption)*

Josh's "put this in Teams" idea: open the entire Nine-67 workspace as a **tab
inside a Teams channel or chat**, so people never leave the tools they already
use. This reuses the **same Entra app registration** from #1 — it is additive.

**What the Nine-67 team builds (us):**
- A **Teams app package** — a `manifest.json` plus two icons (color + outline).
  Declares the app, the tab (a configurable channel/chat tab and/or a personal
  tab), the content URL, and `validDomains`.
- **Teams JS SDK** wiring — `microsoftTeams.app.initialize()`, and the tab
  config page for configurable tabs.
- Make the app **iframe-embeddable inside Teams** — the host must send
  `Content-Security-Policy: frame-ancestors teams.microsoft.com *.teams.microsoft.com`
  (and serve over HTTPS). Hosting/config change on our side.
- **Teams SSO (silent sign-in)** so people are signed in automatically inside
  Teams (this is the "Teams SSO later / M3" in ADR 0007).

**What AGP's Microsoft / Teams admin does:**
- On the **same Entra app**, enable **"Expose an API"**:
  - Set the **Application ID URI** to `api://<app-domain>/<client-id>`.
  - Add a delegated scope **`access_as_user`** (admin-consentable).
  - **Pre-authorize the Teams client apps** for that scope (Microsoft's Teams
    client IDs for desktop/mobile and web) so sign-in is silent — **and grant
    admin consent.**
- **Teams admin center:** either **allow custom app upload/sideloading** (for
  the pilot — simplest), or **approve/publish** our app to the organization's
  **app catalog** (a one-time admin step) so anyone can add the tab.

**Minimum to pilot the Teams tab:** the same two IDs from #1, the "Expose an
API" `access_as_user` scope + pre-authorized Teams clients + admin consent, and
**custom app upload allowed** in Teams admin. Then a channel owner adds the tab.

> **A first round is much cheaper than that — everything above is round two.**
> Sign-in is currently dormant (`AUTH_REQUIRED` unset means the server
> authorizes every request), so a tab pointed at the deployed URL simply loads.
> No app registration, no `access_as_user`, no admin consent. The **only**
> external dependency for round one is **custom app upload allowed in Teams
> admin** — Jaden's approval, 1–3 weeks, so start it now. On our side we still
> owe the app package itself: `manifest.json`, a colour and an outline icon,
> the Teams JS SDK `app.initialize()` call, and a `frame-ancestors
> teams.microsoft.com *.teams.microsoft.com` header so the app embeds. None of
> that exists in the repo yet; it is about a day's work and needs nothing from
> AGP (BLOCKERS #13).
>
> Round one runs on the live Kantata book and proves the mechanics — does it
> load, does it feel native, does navigation survive the iframe. It will not
> tell you whether people adopt it, which was Josh's actual reason for wanting
> tabs; that needs round two pointed at a real client account. Worth saying out
> loud so "it works" isn't mistaken for "it'll get used."
>
> One thing to warn testers about: shared state today is a single workspace
> document, so everyone with the URL edits the same one and sees each other's
> changes live (BLOCKERS #7, accepted until SSO). For a collaboration test
> that's arguably the point — but say it first, or the first "my note
> disappeared" comes back as a bug.

> Note: the Teams tab is a *packaging/embedding* layer on top of the running web
> app — everything the app does (files, discussions, dashboard) works the same
> whether opened in a browser or as a Teams tab. Sign-in and files still depend
> on #1 and #2; the Teams tab does not replace them.

---

## How people access it

**It's a normal web app at a normal URL** (e.g. `https://nine67.agp.com`, hosted
on Azure). Everyone opens the same URL in any browser — the Teams tab is an
**optional wrapper around that same URL**, never a replacement.

- **AGP staff** — open the URL and sign in with **Microsoft SSO** (their AGP
  account). They see their book of business / the workspaces they're on. If they
  prefer Teams, they add the tab; if not, they just use the URL. **Both work at
  once — same app, same data.**
- **Clients** — open the same app (typically a direct link to *their* workspace)
  and sign in. They see **only their own account** — no cross-visibility, no
  internal financials — by rule.
- **Contractors** — same as clients: a link + sign-in, scoped to what they're
  granted (e.g. files-only or the tasks/docs they need).

**Sign-in for clients & contractors** (two options, both supported):
- **Microsoft guest (Entra B2B / email one-time-passcode)** — recommended once
  M365 is connected; they use their own email, no AGP account needed.
- **Email + password** — the interim sign-in already built, so external people
  can get in before the Entra guest setup lands.

So: no one is forced into Teams. Teams is there for people who live in it; the
URL is there for everyone else — and it's the **same workspace** either way.

## Who does what

| Owner | Tasks |
|---|---|
| **AGP Microsoft / IT admin** | App registration + permissions + **admin consent**; turn on external sharing for the client sites; guest (B2B) policy; grant `Sites.Selected` to the specific sites; enable the Purview audit log; approve the Teams webhook. **For the Teams tab:** add the "Expose an API" `access_as_user` scope + pre-authorize the Teams clients (admin consent), and allow custom app upload or publish our app to the org app catalog. |
| **AGP (Cara / Kellie)** | Confirm which docs are client-shareable and the file structure; pick the notification default; provide the Kantata token. |
| **Nine-67 team (us)** | Wire the IDs; build the Graph per-document sharing + version/audit read + notifications; host on Azure. **For the Teams tab:** build the Teams app package (manifest + icons), wire the Teams JS SDK + silent SSO, and make the app iframe-embeddable in Teams. |

## Minimum to pilot

- **Sign-in pilot:** #1 with just `User.Read` + the two IDs.
- **Real pilot (the file story):** #1 with `Sites.Selected` + #2b external
  sharing on for one client site + #2e guest access + #2f audit log on. That's
  the end-to-end "off the extranet, secure edit, tracked opens" demo.

## The one-line ask to AGP IT

> "Register one Entra app for us and grant admin consent (`User.Read` +
> `Sites.Selected`); turn on external guest sharing for the client-collaboration
> SharePoint sites and grant our app access to them; allow inviting client/
> contractor emails as guests; and make sure the Microsoft Purview audit log is
> on. Then send us the tenant ID and client ID. That lets a contractor edit one
> live document — saved, versioned, and with opens tracked — without access to
> anything else, and replaces the extranets."
