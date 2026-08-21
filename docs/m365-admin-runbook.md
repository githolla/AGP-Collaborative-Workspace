# M365 admin runbook — AGP Collaboration Workspace

Everything AGP's Microsoft 365 admin has to do by hand, in order. Two one-time
passes, then a short repeat for each client workspace.

**Time:** Part 1 is about fifteen minutes of clicking in the Entra admin centre, Part
2 a few more, and Part 3 is creating a Team per client. There is no processing delay
and nothing to wait for — the only variable is getting the admin's attention.

Build detail lives in `docs/teams-provisioning-plan.md`; this document is the
hand-off, and nothing here needs the plan to be read first.

**What the app does and does not do.** Everything the app does runs as the signed-in
AGP user — creating folders, uploading, adding members, sharing a folder with an
outside collaborator. It has **no application permissions and no client secret**, so
it holds no standing access to anything and can never reach a site its user could not.
It does not create Teams; you do (Part 3).

---

## Part 1 — App registration (once)

Extends the existing **AGP Collaboration Workspace** registration used for sign-in.

### 1.1 Add a Single-page application redirect URI

Authentication → Add a platform → **Single-page application** → redirect URI:

```
https://collaboration.teamallegiance.com/
```

The registration currently has a **Web** platform pointing at Supabase's callback.
That one stays; this is a second, separate entry. Without it the app cannot obtain a
Microsoft token in the browser, and nothing below works.

### 1.2 Add delegated permissions, then Grant admin consent

API permissions → Microsoft Graph → **Delegated**:

| Permission | For |
|---|---|
| `Channel.Create` | Creating channels in a client's Team |
| `TeamMember.ReadWrite.All` | Adding AGP staff to a client's Team |
| `User.ReadBasic.All` | Resolving a colleague's email to a user id. **Without it, no member can be added** |
| `Files.ReadWrite.All` | Creating the folder tree, uploading, and sharing a folder with a client or contractor — all as the signed-in person. Bounded by their own access, not tenant-wide |
| `User.Invite.All` | Inviting a client or contractor as a guest |

Then **Grant admin consent for the organization**. User consent is normally
disabled, and nobody should be answering a consent prompt per person.

### 1.3 Expose the API and add `access_as_user`

Expose an API → add a scope named **`access_as_user`**, then pre-authorize the Teams
client applications so sign-in inside a Teams tab is silent.

Without this, a tab pointed at the app hits an interactive Microsoft sign-in *inside
an iframe*, which is exactly where third-party cookie and popup-blocking failures
happen. Test the embed early rather than discovering it at pilot.

### Deliberately not requested

If any of these are offered as a simpler route, please decline — each is far broader
than what the app needs:

- Any **application** permission at all — `Sites.Selected`, `Sites.Read.All`,
  `Sites.ReadWrite.All`, application `Files.ReadWrite.All`. The app runs only as a
  signed-in person, so it needs none of them, and none should be added "to be safe".
- `Group.ReadWrite.All`, `Directory.ReadWrite.All`.
- `Team.Create` — the app does not create Teams; you do (Part 3).

No client secret is needed either, and no admin has to grant the app on any SharePoint
site.

---

## Part 2 — Guest settings (once)

External collaborators are Entra B2B guests, so these three are prerequisites:

- **External sharing on the client team sites.** SharePoint admin center → Policies →
  Sharing → at least **"New and existing guests"**. A site can only be as permissive
  as the org setting — the more restrictive value wins — and new sites do not all
  allow external sharing by default, so check each client Team's site rather than
  assuming.
- **SharePoint/OneDrive integration with Entra B2B.** Without it, external sharing
  creates no guest account and Entra policies do not apply, leaving nothing to track
  or revoke.
- **Guest policy — email one-time passcode.** Entra → External Identities → allow
  guest invitations and enable email OTP, so a contractor on a personal address needs
  no Microsoft account.

**Then test one thing before we build on it:** invite a personal-email address as an
OTP guest and have them sign into the app. If an OTP identity cannot complete sign-in
to this app registration, outside people without a Microsoft account cannot use the
app, and we need to know before the build depends on it.

---

## Part 3 — Teams app upload policy (once)

Allow the AGP Collaboration Workspace app package to be uploaded, or publish it to
the org catalogue. Teams admin center → Teams apps → Setup policies.

Tracked as BLOCKERS #6. Independent of everything else here — the folder and file
work does not wait on it.

---

## Part 4 — Per client workspace (repeat)

Once per client the app manages, and it is only the Team — there is no per-site
permission to grant, because the app acts as your own people. Expect these in batches,
clustered at fiscal-year rollover.

### 4.1 Create the Team

Create a standard Team named for the client.

- **Name the first channel** whatever the team should see first; it need not be
  "General".
- **Add the AGP Collaboration Workspace application admins as Team owners.** Several
  owners, not one — a Team owned by a single person is orphaned when they leave, and
  the app's provisioning runs as an owner.

### 4.2 Hand back the Team

Give the workspace owner the **Team URL** (or the team id). Someone pastes it into
the client's workspace in the app, which resolves the rest for itself.

---

## Verification

After Part 1, an AGP user signing in and opening a client workspace should be able to
create the folder tree. If that fails, the delegated consent in 1.2 did not take.

After Part 2, an AGP user should be able to share a folder with an outside email from
inside the app, and that person should receive an invitation. If the invitation never
arrives, external sharing or the B2B integration is not on.

---

## Where these are tracked

| Runbook part | BLOCKERS row |
|---|---|
| Part 1 | #5 — Entra app registration + admin consent. Sign-in is done; this is the remaining Graph consent pass |
| Part 1.3 `access_as_user` | #5 and #6 — needed for the Teams tab to sign in silently |
| Part 2 | Guest settings — previously listed as optional; now required |
| Part 3 | #6 — Teams custom app upload approval |
| Part 4 | #12 — the pilot answer names the first clients |
