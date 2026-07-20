# ADR 0007 — Authentication is Microsoft Entra SSO

Date: 2026-07-20 · Status: accepted (product owner decision: "it will be MS
SSO auth")

## Decision

Sign-in is Microsoft Entra ID (Azure AD), in two stages per SPEC v2_1:

1. **Browser sign-in now** — MSAL auth-code + PKCE flow in the tab app,
   usable the day the Entra app registration exists. The signed-in identity
   replaces the local profile name and gates the shared workspace.
2. **Teams SSO later (M3)** — silent in-tab token via the Teams SDK; the
   browser flow remains the fallback for non-Teams testing.

Server side, every /api function is gated by `api/_lib/entraAuth.ts`:
RS256 signature against the tenant JWKS, issuer, audience, expiry — no
dependencies, verified by crafted-key tests (valid/aud/iss/expiry/kid/
tampered-signature/garbage). The gate is **dormant** until
`AUTH_REQUIRED=true` + `ENTRA_TENANT_ID` + `ENTRA_CLIENT_ID` are set, so
today's open-demo behavior is unchanged and the flip is config, not code.

## Sequencing

- The critical path is the **app registration + admin consent** (BLOCKERS
  #5, 2–6 weeks at nonprofit IT partners) — checklist in BLOCKERS.
- Client-side MSAL UI lands when the client ID exists (it is untestable
  before then; we do not ship untestable auth).
- Interim token: the Entra **ID token** (audience = our client ID). When we
  add "Expose an API" scopes, the client switches to a proper access token —
  a validation-constant change only.
- With SSO live: per-user identity flows into posts/audit entries, guest
  (client/contractor) access moves to Entra B2B, and the storage-document
  state gets its planned upgrade to Postgres rows + RLS.

## Rejected

- Supabase Auth (email magic links): good product, wrong identity source —
  AGP lives in M365, and Teams SSO is the destination anyway.
- Rolling our own sessions: never.
