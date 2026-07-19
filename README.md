# AGP Collaboration Workspace

An AI-native collaboration workspace where AGP teams and AI agents craft product
initiatives together — **new product builds** and **AI-added-to-existing-product
iterations** — with the factor-based **ROI calculator running in the background
of every initiative**: live headline, confidence grade, scenario dials, and a
"numbers still to gather" trail.

- Product direction: [ADR 0004](./docs/adr/0004-product-pivot-roi-collaboration-workspace.md)
- ROI engine spec: [docs/roi-calculator-spec.md](./docs/roi-calculator-spec.md)
  (engine copied verbatim from `githolla/AIROI`)
- Blockers needing human action: [BLOCKERS.md](./BLOCKERS.md)
- Earlier delivery-ops direction (deprioritized): [SPEC.md](./SPEC.md), [MILESTONES.md](./MILESTONES.md)

## What works today

- **Sandbox** — ideas not tied to any product. A manager drops an idea in
  plain words, roughs out what it would replace (tools avoided, manual work
  removed, build guess) with the ROI Analyst, sees back-of-napkin math that
  never flatters (empty lines stay unknown), and **promotes it to a real
  build** — the basis, conversation, and gather list carry over.
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

## Layout

```
apps/tab            React workspace app (portfolio, initiative, thread)
packages/roi        ROI engine (verbatim from AIROI) + 12-factor template + tests
packages/shared     Provenance types, autonomy gate, rate-limited HTTP client
services/sync       Kantata/HubSpot sync foundation (dormant — see ADR 0004)
services/signals    Scaffold (dormant)
services/assembly   Scaffold (dormant)
apps/bot            Scaffold (dormant)
supabase/migrations Postgres schema (spec §10 tables land next)
docs/adr            Architecture decision records
```

## Develop

```sh
pnpm install
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @agp/tab dev     # workspace app on fixtures/localStorage
```

Deploys to Vercel on every push (`vercel.json`). Demo data persists in the
browser; "Reset demo data" restores the seed.
