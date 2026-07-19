# AGP Project Command

AI-native collaborative workspace for AGP, delivered inside Microsoft Teams,
orchestrating Kantata OX (PSA) and HubSpot (CRM). See [SPEC.md](./SPEC.md) for the
full product spec, [MILESTONES.md](./MILESTONES.md) for the plan, and
[BLOCKERS.md](./BLOCKERS.md) for credentials/approvals requiring human action.

## Layout

```
apps/tab            React Teams tab (workspace UI)          — scaffold, built in M2/M3
apps/bot            Teams bot + Adaptive Cards              — scaffold, built in M3/M4
services/sync       Source adapters, queue, reconcile       — M0 core implemented
services/signals    Signals & rules engine, Needs-You feed  — scaffold, built in M5
services/assembly   Registry, playbooks, loop-ins           — scaffold, built in M7
packages/shared     Types, provenance, autonomy gate, HTTP  — M0 core implemented
supabase/migrations Postgres schema (all groups)            — M0
docs/adr            Architecture decision records
```

## Develop

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm lint
```

Everything runs on fixtures (`services/sync/fixtures/`) — no credentials required
until M1. AI calls are server-side only; secrets live in env config, never code.
