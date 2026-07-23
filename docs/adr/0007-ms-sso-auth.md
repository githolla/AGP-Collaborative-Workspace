# ADR 0007 — Authentication is Microsoft SSO (via Supabase Auth)

Date: 2026-07-20 · Status: accepted, amended 2026-07-23 (product owner decision: "it will be MS
SSO auth")

## Decision

Sign-in is Microsoft SSO (Azure AD) brokered through Supabase Auth, in two stages per SPEC v2_1:

1. **Browser sign-in now** — Supabase Auth OAuth (`provider: azure`) in the tab app,
  usable the day the Entra app registration + Supabase provider config exist.
  The signed-in identity replaces the local profile name and gates the shared workspace.
2. **Teams SSO later (M3)** — silent in-tab token via the Teams SDK; the
   browser flow remains the fallback for non-Teams testing.

Server side, every /api function is gated by `api/_lib/authGate.ts`:
bearer token verification against Supabase Auth (`/auth/v1/user`) using the
service-role key. The gate is **dormant** until `AUTH_REQUIRED=true` is set,
so today's open-demo behavior is unchanged and the flip is config, not code.

## Sequencing

- The critical path is the **app registration + admin consent** (BLOCKERS
  #5, 2–6 weeks at nonprofit IT partners) — checklist in BLOCKERS.
- Client-side Microsoft button lands when Supabase Auth Azure provider is
  configured (it is untestable before then; we do not ship untestable auth).
- Browser->API auth uses the Supabase session access token.
- With SSO live: per-user identity flows into posts/audit entries, guest
  (client/contractor) access moves to Entra B2B, and the storage-document
  state gets its planned upgrade to Postgres rows + RLS.

## Rejected

- Rolling our own sessions: never.
