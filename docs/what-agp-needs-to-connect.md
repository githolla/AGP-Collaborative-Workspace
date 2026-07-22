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
- **Decide the default channel** (Teams, email, or per-person choice — the app
  already lets each person pick).

---

## 4. Hosting — Azure in AGP's tenant

Host the app on **Azure within AGP's Microsoft environment** (the plan already in
motion) so identity, files, and audit all stay inside their tenant. IT provisions
the Azure target and gives us the **final URL** — which becomes the redirect URI
in #1.

---

## 5. Kantata — the live data pull

- Provide the **Kantata API token** (OAuth app / token) for the live pull.
  *(Cara is already setting this up.)* We need the **callback URL** confirmed —
  pending Ren's Azure URL for the app.

---

## Who does what

| Owner | Tasks |
|---|---|
| **AGP Microsoft / IT admin** | App registration + permissions + **admin consent**; turn on external sharing for the client sites; guest (B2B) policy; grant `Sites.Selected` to the specific sites; enable the Purview audit log; approve the Teams webhook. |
| **AGP (Cara / Kellie)** | Confirm which docs are client-shareable and the file structure; pick the notification default; provide the Kantata token. |
| **Nine-67 team (us)** | Wire the IDs; build the Graph per-document sharing + version/audit read + notifications; host on Azure. |

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
