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
