# AGP Collaboration Workspace

An AI-native collaboration workspace where AGP teams and AI agents craft product
initiatives together — **new product builds** and **AI-added-to-existing-product
iterations** — with the factor-based **ROI calculator running in the background
of every initiative**: live headline, confidence grade, scenario dials, and a
"numbers still to gather" trail.

- Requirements baseline (manager's Collaboration Hub doc → traceability):
  [docs/collab-hub-requirements.md](./docs/collab-hub-requirements.md)
- Product direction: [ADR 0004](./docs/adr/0004-product-pivot-roi-collaboration-workspace.md)
- ROI engine spec: [docs/roi-calculator-spec.md](./docs/roi-calculator-spec.md)
  (engine copied verbatim from `githolla/AIROI`)
- Blockers needing human action: [BLOCKERS.md](./BLOCKERS.md)
- Earlier delivery-ops direction (deprioritized): [SPEC.md](./SPEC.md), [MILESTONES.md](./MILESTONES.md)

## What works today

- **Sandbox with the AGP Copilot** — ideas not tied to any product,
  conversation-first. A manager describes the idea in plain words and the
  Copilot drafts everything with a "because" on each line: classification
  (service line × vertical × client), the ROI basis (tools it replaces,
  manual work it removes, build guess) from AGP process patterns, the
  suggested cast from the org model (respecting dispatch-managed routing —
  production and campaign deployment go via their managers), and related
  Kantata projects / HubSpot campaigns from the mirror. Refine by talking
  ("assume 300 build hours", "drop the Loopio line", "add someone from
  analytics") — approval-by-exception, not forms. **Promote to a build**
  carries the basis, cast, and conversation into a full initiative.
  Deterministic knowledge-base matching today (honest, explainable); the
  same interface goes LLM-backed when the Anthropic key lands.
- **Portfolio view** — rollup of every initiative (annual net, one-time net,
  worst-grade credibility, open-unknowns counter) + one-click new initiative
  seeded from the 12-factor template.
- **Initiative workspace** — factor editor (NEED pills, status chips,
  confirm/lock, evidence lines), exec decision card (payback, 3-yr net, ROI
  multiple), breakdown that always matches the headline, realism-dial
  scenarios (Conservative/Realistic/Optimistic side-by-side, click to apply),
  gather list with owners, snapshot audit trail.
- **Collaboration thread** — people + AI agents per initiative. The **ROI
  Analyst** agent is live now (deterministic, engine-backed — it can never
  disagree with the numbers on screen). LLM agents activate when the Anthropic
  API key is configured server-side; they are never faked.
- **Acceptance invariant** (tested): an empty initiative shows $0, grade ≤ C,
  and the correct still-to-gather count; numbers tighten only as evidence lands.

## Tour + feedback capture

"Take the tour" is both the walkthrough and the research instrument. Each of
the ten steps teaches one thing and then asks one multiple-choice question
(A/B/C) about that screen's design or workflow, with an optional comment box.
Answering is never required — the tour moves on regardless — and answers save
as people step through, including on "Skip tour", so a half-finished run still
contributes. Re-answering a step replaces that person's earlier response.

Alongside the tour, a **floating Feedback button sits on every surface** and
asks about the one you're on — the client directory, each tab of a client
workspace, an initiative's ROI view, an idea draft — naming the screen and the
client in the prompt (`apps/tab/src/workspace/pageContext.ts`, tested). A
generic feedback box collects generic feedback; asking "would you be
comfortable showing this view to SPCA of Texas?" does not. Page reports
**append** rather than replace: the same person on the same screen may have
two separate things to say on two separate days, and a dropped report can't be
recovered, whereas a slightly skewed percentage can be read around. The button
hides on the admin page and while the tour is running.

Both feed the same store, so tour answers and page reports share one roll-up
and one CSV, distinguished by their step key (`page:` prefixed for the button).
Responses pool into the shared workspace document, so every tester's answers
land in one place. Read them at **`#admin/feedback`** — an unlinked route,
passcode-gated via `VITE_FEEDBACK_ADMIN_CODE` (see `.env.example`). It shows a
per-step tally with percentages, every comment attributed and dated, and a
**Download CSV** button (RFC 4180 quoting, UTF-8 BOM, so comments containing
commas, quotes, or line breaks survive Excel).

The passcode is obscurity, not authentication — anyone with the route and the
code can read the responses. That's acceptable for internal testing feedback;
swap it for a sign-in check when Entra SSO lands (BLOCKERS #5).

## Layout (focused per ADR 0005)

```
apps/tab            The product: Clients hub · Sandbox + Copilot · Builds/ROI
packages/roi        ROI engine (verbatim from AIROI) + 12-factor template + tests
packages/shared     Autonomy gate, provenance types, rate-limited HTTP client
services/sync       The data layer: Kantata/HubSpot mirror (fixtures now, live
                    later) — grounds the Copilot and carries Planner/email sync
supabase/migrations Postgres schema for the backend phase
docs/adr            Architecture decision records (0005 = product focus)
```

## Develop

```sh
pnpm install
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @agp/tab dev     # workspace app on fixtures/localStorage
```

Deploys to Vercel on every push (`vercel.json`).

**Live-only — there is no demo workspace.** The app boots empty and fills from
the live Kantata pull (`/api/mirror`): pick a client from the book and its
workspace is created with that client's campaigns, milestones, and tasks
already in it. Any leftover seed content from earlier builds is purged on load
(`DEMO_SEED_IDS` in `apps/tab/src/workspace/store.ts`) and never re-seeded.
"Clear workspace" empties what you've built — it restores nothing.

Two fallbacks remain deliberate, and both say so on screen: when `/api/mirror`
can't answer (no tokens, local dev) the bundled fixture mirror stands in behind
a "Live data unavailable" banner, and the bundled `AGP_PEOPLE` roster backs the
Copilot's cast suggestions until the org-chart seed lands (BLOCKERS #2).

## GitHub CI/CD Pipeline (Azure Container Apps)

Alongside the Vercel deploy above, this repo also has a container path that
fully replaces Vercel (no dependency on it at all) — `server.mts` is a small
Express server that serves the built `apps/tab` SPA and hosts `/api/state` +
`/api/mirror` by calling the same handler functions Vercel runs, unmodified.

- `.github/workflows/deploy-stage.yml` runs on pushes to the `stage` branch
  and deploys to the GitHub `stage` environment.
- `.github/workflows/deploy-prod.yml` runs on pushes to the `main` branch and
  deploys to the GitHub `prod` environment.

Both workflows use GitHub OIDC with Azure, build the image from the `prod`
target in `Dockerfile`, push environment-specific tags to Azure Container
Registry, and roll out a new Azure Container Apps revision.

Required GitHub environment configuration:

- Create `stage` and `prod` environments in GitHub.
- Add these secrets to each environment:
	- `AZURE_CLIENT_ID`
	- `AZURE_TENANT_ID`
	- `AZURE_SUBSCRIPTION_ID`
	- `AZURE_RESOURCE_GROUP`
	- `AZURE_CONTAINER_APP`
	- `AZURE_CONTAINER_REGISTRY_NAME`
	- `AZURE_CONTAINER_REGISTRY_LOGIN_SERVER`
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
  - `VITE_ENABLE_MICROSOFT_LOGIN` (optional, defaults true)
  - `VITE_SUPABASE_REDIRECT_URI` (optional; exact OAuth return URL)
- On the Container App itself (not GitHub), set the runtime env vars this
  image's `/api` routes read. The full, current matrix (build-time vs runtime,
  which are secret, what each unlocks) lives in **[docs/AGP-HANDOFF.md](./docs/AGP-HANDOFF.md)**;
  the minimum to run with real data is `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `SUPABASE_DB_URL` (the collab-schema handlers connect to Postgres directly),
  `KANTATA_API_TOKEN`, and **`AUTH_REQUIRED=true`** (without it the legacy
  endpoints are open — the server logs a loud warning at boot when it's unset).
  Kantata write-back additionally needs `KANTATA_WRITE_ENABLED=true`; two-way
  Teams sync needs `GRAPH_APP_CLIENT_SECRET` + `TEAMS_WEBHOOK_URL` (the client
  and tenant ids are reused from `VITE_GRAPH_*`).
- The `stage` branch doesn't exist yet in this repo — create it from `main`
  before relying on `deploy-stage.yml`.
- **Handoff to AGP:** the operations runbook — how to apply the Supabase
  migrations, the full env matrix, the two-data-model note, the security
  posture, and the "before AGP owns this" checklist — is
  **[docs/AGP-HANDOFF.md](./docs/AGP-HANDOFF.md)**.
