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

Deploys to Vercel on every push (`vercel.json`). Demo data persists in the
browser; "Reset demo data" restores the seed.

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
  image's `/api` routes read: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `KANTATA_API_TOKEN`, and (once SSO is wired up) `AUTH_REQUIRED`.
- The `stage` branch doesn't exist yet in this repo — create it from `main`
  before relying on `deploy-stage.yml`.
