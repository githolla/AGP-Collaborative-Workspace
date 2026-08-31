# AGP Handoff — operations runbook

This is the "AGP can own and run this" document: how the system is deployed,
how to apply database migrations, every environment variable and what it
unlocks, the security posture, how two-way Teams sync stays alive, and a
final checklist to sign off before AGP takes ownership.

It complements — does not replace — the credential/approval tracker in
[BLOCKERS.md](../BLOCKERS.md) and the product overview in
[README.md](../README.md).

---

## 1. What this is, in one paragraph

An AI-native client collaboration workspace. AGP staff open a client
workspace and see that client's real Kantata campaigns, milestones and tasks
(pulled live), a per-client **Resourcing** view and a cross-client **Team
Load** view, file sharing with external contractors, a Discussion thread that
can mirror into a Microsoft Team, and a ROI calculator on every initiative.
It ships as a single container (`server.mts`, an Express app serving the built
`apps/tab` SPA plus the `/api/*` handlers) deployed to Azure Container Apps.

---

## 2. Two data models live in production — know which is which

This is the single most important thing to understand operationally. There are
**two** persistence models, both active:

| | **Legacy JSON store** | **Postgres `collab` schema** |
|---|---|---|
| Where | Supabase Storage, one versioned `state.json` per workspace | Postgres tables under schema `collab`, RLS-enforced |
| Reached by | `/api/state`, `/api/mirror`, `/api/kantata-write` | `/api/account`, `/api/task`, `/api/share`, `/api/team-load`, `/api/my-tasks`, … (most newer endpoints) |
| Auth | **Open unless `AUTH_REQUIRED=true`** | Always per-user, RLS-scoped via `requireUser` → `withUserContext` |
| Role in prod | Original shared-document model; still backs some views | The system of record for accounts, membership, tasks, shares, Teams sync |

The newer collab endpoints connect to Postgres **directly** (`SUPABASE_DB_URL`),
not through Supabase's REST API — the `collab` schema is deliberately not
exposed through PostgREST (`supabase/config.toml` exposes only `public` and
`graphql_public`). Each request re-establishes RLS itself:
`withUserContext(userId, …)` sets the `authenticated` role and the JWT claims
so RLS policies apply; `withServiceContext(…)` runs elevated for the few
admin/bootstrap paths that must cross user boundaries (see `api/_lib/db.ts`).

A one-off backfill from the JSON model into `collab` exists at
`scripts/migrate-json-to-collab.ts` (dry-run by default, `--apply` to write).
Read its header before trusting it — it documents deliberate gaps (e.g. every
migrated account gets `ADMIN_EMAIL` as sole workspace admin).

---

## 3. Database migrations — applying them

Migrations are plain SQL in `supabase/migrations/`, numbered `0001…` upward.
**They are applied manually, in numeric order** — no CI step runs them, by
design (the production database is not something a push should silently alter).

Two supported ways to apply:

1. **Supabase SQL editor (what's been used):** open each new migration file,
   paste it into Project → SQL editor, run it. Apply them in order. Files use
   `create or replace` / `if not exists` / `drop … if exists` so re-running an
   already-applied migration is safe. (A benign "Potential issue detected"
   warning from the editor on `drop policy if exists` lines is expected.)
2. **`psql` against the pooler:** `psql "$SUPABASE_DB_URL" -f supabase/migrations/00XX_*.sql`.
   Use the transaction-pooler connection string (port 6543), same as the app.

**Fresh database:** apply `0001` through the highest-numbered file in order.

**Existing database:** apply only the files newer than what's already there.
As of this handoff the latest is `0028_view_config_admin_only.sql`. The
Teams-sync / resourcing additions from this workstream are `0024`–`0028`:

| File | What it adds |
|---|---|
| `0024_teams_subscription` | stores the Graph change-notification subscription per account |
| `0025_teams_subscription_status` | records the background subscribe/renew attempt state so the UI can poll it |
| `0026_account_view_config` | per-account view-tier config + `set_view_config` |
| `0027_person_capacity` | per-person weekly capacity for Team Load + `set_person_capacity` |
| `0028_view_config_admin_only` | tightens `set_view_config` to workspace admins only |

There is no down-migration mechanism; forward-only. Keep a database backup
before applying a batch to production.

---

## 4. Environment variables — the complete matrix

`.env.example` is the canonical, commented source. Summary of what production
actually needs, by phase. **Build-time** vars (`VITE_*`) are baked into the
browser bundle when the image is built and must be present in the GitHub
environment at build; **runtime** vars are read by the container at request
time and are set on the Container App.

### Always required (real data)
| Var | Kind | Secret | Unlocks |
|---|---|---|---|
| `SUPABASE_URL` | runtime | no | Supabase REST + auth token verification |
| `SUPABASE_SERVICE_ROLE_KEY` | runtime | **yes** | server-side Supabase (JSON store, token verify) |
| `SUPABASE_DB_URL` | runtime | **yes** | direct Postgres for all `collab` endpoints (use the **transaction pooler**, port 6543) |
| `KANTATA_API_TOKEN` | runtime | **yes** | live Kantata pull (`/api/mirror`) |
| `VITE_SUPABASE_URL` | build | no | client Supabase |
| `VITE_SUPABASE_ANON_KEY` | build | no (safe by design; RLS protects) | client Supabase |
| `AUTH_REQUIRED=true` | runtime | no | **turns off open mode** — see Security below |

### Sign-in (Microsoft SSO via Supabase Auth)
| Var | Kind | Notes |
|---|---|---|
| `VITE_ENABLE_MICROSOFT_LOGIN` | build | defaults true |
| `VITE_SUPABASE_REDIRECT_URI` | build | optional explicit OAuth return URL |

### Microsoft Graph — delegated (Teams provisioning, folders, membership)
| Var | Kind | Notes |
|---|---|---|
| `VITE_GRAPH_CLIENT_ID` | build | Entra app (client) id — public |
| `VITE_GRAPH_TENANT_ID` | build | Entra tenant id — public |
| `VITE_GRAPH_REDIRECT_URI` | build | optional; defaults to app origin |

### Kantata write-back
| Var | Kind | Notes |
|---|---|---|
| `KANTATA_WRITE_ENABLED=true` | runtime | **kill switch.** Unset ⇒ `/api/kantata-write` is a dry run (validates + reports the calls it *would* make, sends nothing). Set true only when workspace edits should change AGP's system of record. Requires the token to carry story + workspace_allocation write scope. |

### Two-way Teams sync (replies typed in Teams flow into the Discussion)
| Var | Kind | Secret | Notes |
|---|---|---|---|
| `GRAPH_APP_CLIENT_SECRET` | runtime | **yes** | the ONE genuinely new secret. App-credential (client-credentials) flow. **Never** give it a `VITE_` prefix. |
| `TEAMS_WEBHOOK_URL` | runtime | no | `<origin>/api/teams-webhook` — where Graph posts channel notifications |
| `GRAPH_APP_CLIENT_ID` / `GRAPH_APP_TENANT_ID` | runtime | no | optional; reused automatically from `VITE_GRAPH_*` if unset |

Graph app permissions needed (admin-consented, application not delegated):
`ChannelMessage.Read.All` and `Channel.ReadBasic.All`. Without the secret and
webhook URL, two-way sync stays fully off and every code path no-ops cleanly.

### AI agents
| Var | Kind | Secret | Notes |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | runtime | **yes** | activates the LLM collaboration agents AND the Contractor Hub assistant. See §7. |
| `CONTRACTOR_CHAT_MODEL` | runtime | no | optional model override for the Contractor Hub assistant (default `claude-opus-5`). |

### Admin / feedback (interim)
| Var | Kind | Notes |
|---|---|---|
| `VITE_APP_ADMIN_EMAILS` | build | gates the `#admin` route client-side — presentation-layer only, not the security boundary (server RLS is) |
| `VITE_FEEDBACK_ADMIN_CODE` | build | passcode for `#admin/feedback`; obscurity, not auth |

---

## 5. Security posture

- **`AUTH_REQUIRED` must be `true` in production.** When it is unset, the
  legacy endpoints `/api/state`, `/api/mirror`, `/api/kantata-write` authorize
  every request (an acceptable pre-SSO default, not acceptable for real client
  data). The server now logs a loud `[security]` warning at boot when it is
  unset so this can never be the silent state. The `collab` endpoints are
  always RLS-scoped regardless and are unaffected.
- **RLS is the real boundary.** Role tiers in the UI (Account Manager /
  Project Manager / Delivery) are presentation-layer; server enforcement is
  Postgres RLS via `withUserContext`. Elevated `withServiceContext` is used
  only for narrow, audited bootstrap/admin paths (documented in `db.ts`).
- **The Graph app secret** lives only in `api/_lib/graphApp.ts`, is never a
  `VITE_` var, and is never logged. The app token is sent only to
  `https://graph.microsoft.com/` — a hard allowlist in `graphAppFetch` refuses
  any other URL (SSRF defense).
- **The Teams webhook is intentionally unauthenticated** (Graph has no
  session). It authenticates each notification by matching the
  per-subscription `clientState` secret, and only trusts a notification's
  `resource` path when it names that subscription's own team and channel.
- **Echo protection**: the app's own outbound Teams posts carry an invisible
  zero-width sentinel so they never round-trip back into the Discussion as if a
  person typed them.

---

## 6. Two-way Teams sync — how it stays alive

- **Enabling** (`POST /api/teams-subscribe`) does fast auth/config/membership
  checks, returns `202 {status:"creating"}`, and creates the Graph
  subscription in the background — because the Graph round-trip (which has
  Graph call the webhook back to validate it) can outlive Cloudflare's ~30s
  origin cap and surface as an opaque 502 if done synchronously. The client
  polls `GET /api/teams-subscribe?accountId=…` for `active` / `error` and the
  real error reason.
- **Renewal is automatic.** Graph channel-message subscriptions expire in ~1h.
  `api/teams-renew.ts` runs an in-process loop (started from `server.mts`) that
  extends every subscription due within 20 min, every ~10 min, via a Graph
  PATCH — and re-provisions from scratch if Graph reports one already lapsed
  (404). This relies on the container being long-lived (the same assumption the
  background-provisioning model already makes). **Nothing external to
  schedule.** It no-ops entirely when the app secret / webhook URL are unset.
- **Diagnosing**: the `GET` status endpoint returns `configured`, `missingEnv`
  (exactly which vars are absent), the live subscription's expiry, and the last
  attempt's `state` + `lastError`. That plus the `[teams-subscribe]` /
  `[teams-renew]` container logs are the first stop for "sync stopped working".

---

## 7. AI agents — the honest status

There is **no Anthropic-powered agent swarm running in production today.** The
one live collaboration agent is the **ROI Analyst**, which is
deterministic/engine-backed — it reads the ROI engine's numbers and can never
disagree with what's on screen. The LLM agents (Product Strategist, Brief
Drafter, and the Copilot's generative drafting) activate **only** when
`ANTHROPIC_API_KEY` is configured server-side, and are never faked in the
meantime — until the key lands, the Copilot uses deterministic knowledge-base
matching. If someone asks "is an AI writing these?", the answer today is: the
ROI analysis is engine math, everything else is deterministic matching, and the
generative layer is dark until the key is set (BLOCKERS #8).

The **Contractor Hub assistant** ("Ask about your contractors") is the same
story: it calls Claude with the account's contractor data assembled
server-side (RLS-scoped), and returns an honest "not switched on yet" message
until `ANTHROPIC_API_KEY` is set. The Contractor Hub itself — adding
contractors, sharing files, the activity and discussion history — works fully
without the key; only the chat box waits on it. No new database migration is
needed for the hub; it reads the tables already in place.

---

## 8. Build, deploy, verify

```sh
pnpm install
pnpm typecheck && pnpm lint && pnpm test   # gate
pnpm build                                  # apps/tab → dist
pnpm start                                  # server.mts locally on :3000
```

Deploy is via GitHub Actions → Azure Container Apps
(`.github/workflows/deploy-prod.yml` on `main`, `deploy-stage.yml` on `stage`).
Both build the `prod` target in `Dockerfile`, push to ACR, and roll a new
revision. The Dockerfile's prod stage promotes `VITE_GRAPH_CLIENT_ID` /
`VITE_GRAPH_TENANT_ID` to runtime env so the app-credential flow can reuse
them. See README §"GitHub CI/CD Pipeline" for the required GitHub secrets.

---

## 9. Before AGP owns this — sign-off checklist

**Security / config**
- [ ] `AUTH_REQUIRED=true` set on the Container App (confirm the boot log no
      longer prints the `[security]` open-mode warning).
- [ ] `SUPABASE_DB_URL` set to the **transaction pooler** string (port 6543).
- [ ] `GRAPH_APP_CLIENT_SECRET` stored as a secret, not `VITE_`-prefixed, and
      rotated on a known schedule with an owner.
- [ ] `KANTATA_WRITE_ENABLED` deliberately set (off until write-back is
      intended; on only after exercising the dry-run preview).

**Database**
- [ ] All migrations through `0028` applied to the production database.
- [ ] A database backup/restore path is in place before any future migration
      batch.

**Teams sync**
- [ ] `ChannelMessage.Read.All` + `Channel.ReadBasic.All` application
      permissions admin-consented on the Entra app.
- [ ] `TEAMS_WEBHOOK_URL` points at the real production origin.
- [ ] Enabled sync on one pilot account and confirmed a Teams reply lands in
      the Discussion, and that it still works >1h later (renewal verified).

**Ownership**
- [ ] Real owners assigned for every open BLOCKERS row (they are placeholders).
- [ ] Someone at AGP can read the container logs and the Supabase dashboard.
- [ ] The remaining Microsoft approvals (BLOCKERS #5 `access_as_user`, #6
      Teams app upload) have named owners and dates.

**Known limitations to accept or schedule**
- [ ] Two data models coexist (§2) — decide whether/when to complete the JSON→
      collab consolidation.
- [ ] Role tiers are UI-level; full server-side role enforcement beyond RLS
      (the "B6" hardening) is not done.
- [ ] The `#admin/feedback` passcode is obscurity, not authentication — replace
      with a sign-in check when convenient.
