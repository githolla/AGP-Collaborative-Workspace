# BLOCKERS — credentials, approvals, and inputs requiring human action

Every item here blocks a milestone. Owners are placeholders until AGP assigns names —
each needs a real owner assigned. Lead-time risk is the estimated wall-clock time from
"someone starts" to "we have working access," based on typical org/vendor turnaround.

Status legend: 🔴 not started · 🟡 in progress · 🟢 done

| # | Blocker | Needed for | Owner | Lead-time risk | Status |
|---|---------|-----------|-------|----------------|--------|
| 1 | **`kantata-tenant-grounding.md`** — the spec (SPEC.md §Non-Negotiable Constraints #7) declares this repo-root doc authoritative for AGP's Kantata instance (taxonomy custom fields, GL-coded COGS categories, rate semantics, hard/soft allocation flag, workspace_groups↔HubSpot join, dead endpoints). **It is not in the repo.** Mirror schema and financial math are built on generic Kantata semantics until it arrives; expect schema/adapter revisions when it lands. **2026-07-20: the workspace_groups↔company join and workspace custom-field values (Service Line Detail, vertical) are now pulled generically per SPEC §7 — the doc remains authoritative for GL-coded COGS categories, rate semantics, the hard/soft allocation flag, story roll-up rules, and dead endpoints.** | M1 (sync/mirror correctness), M6 (financial math) | Barry / AGP ops | Low if doc exists; **high rework risk the longer it's missing** | 🔴 |
| 2 | **`agp-org-registry-seed.json`** — parsed org chart (~60 people) the registry ingests (SPEC.md Layer 4a). **Not in the repo.** Registry work proceeds on a synthetic fixture until it arrives. | M7 (assembly/registry) | Barry / AGP ops | Low if file exists | 🔴 |
| 3 | **Kantata admin OAuth app / service token** with Subscribed Events API access. Events have ~9-day retention — once granted, polling must start promptly and stay up, and backfill should run early. Scope note: the **resourcing-engine project** (separate build — see `docs/resourcing-engine-fit.md`) additionally needs write access to resource allocations/scheduled hours for weekly reservations; request both scopes in one approval pass. **2026-07-20: API key in hand (Barry) — to be entered in Vercel as `KANTATA_API_TOKEN` per `.env.example`; adapter cut-over from fixtures is the next eng step.** | M1 live sync (fixtures unblock dev); resourcing engine steps 7–9 | AGP Kantata admin | 1–2 weeks (admin availability + Kantata support if OAuth app needed) | 🟡 |
| 4 | **HubSpot access** — private-app token (day one, polling fallback) and, later, a **public app** with webhook subscriptions + minimal OAuth scopes (incl. engagement content — document scope justification). **2026-07-20: private-app token in hand (Barry) — to be entered in Vercel as `HUBSPOT_PRIVATE_APP_TOKEN` per `.env.example`.** | M1 polling (private token), M5+ webhooks (public app) | AGP HubSpot admin | Private token: days. Public app: 2–4 weeks (app review + scope decisions) | 🟡 |
| 5 | **Entra ID app registration + admin consent** — Teams SSO (tab), Graph scopes for channel/member management and lazy `filesFolder` provisioning. Admin consent for Graph application permissions is often the single longest approval at nonprofits' IT partners. | M3 (Teams shell), M4 (provisioning) | AGP M365 admin | **2–6 weeks** (security review for app-level Graph perms) | 🔴 |
| 6 | **Teams custom app upload approval** — org app catalog policy must allow sideloading/upload of the Agents Toolkit manifest, or IT must publish it. | M3 (Teams shell) | AGP M365 admin | 1–3 weeks | 🔴 |
| 7 | **Supabase project** (Postgres + pgvector) — dev instance can be free-tier and self-serve; production placement (Supabase cloud vs. self-hosted in Azure) needs an AGP infra decision. **2026-07-20: Barry creating the dev project — env names per `.env.example` (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` server-side; `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` browser-safe).** | M1 (dev DB), M8 (prod) | Eng + AGP IT | Dev: hours. Prod decision: 1–2 weeks | 🟡 |
| 8 | **Anthropic API key** with production rate limits — now the top blocker: activates the LLM collaboration agents (Product Strategist, Brief Drafter) server-side. ROI Analyst runs engine-backed without it. | LLM agents (ADR 0004) | Eng | Days | 🔴 |
| 9 | **Vercel project** for dev previews (team + env vars). Repo connected 2026-07-19; previews build from `apps/tab` on every push. | M2 (preview URLs) | Eng | Hours | 🟢 |
| 10 | **Azure production environment** — subscription, resource group, container hosting for services, secrets store (Key Vault), deployment pipeline credentials. | M8 (production deploy) | AGP IT | **3–6 weeks** (procurement/policy) | 🔴 |
| 11 | **GivingDNA API credentials** — Phase-later; `SourceAdapter` is stubbed so the connector adds without rework. | Post-M8 | AGP product team | Unknown; not on critical path | 🔴 |

## Critical-path notes

- **Longest poles:** #5 (Entra admin consent) and #10 (Azure). Start both immediately even
  though their milestones are weeks away.
- **#3 caution:** Kantata's 9-day event retention means the gap between "token granted" and
  "poller deployed and running" must be < 9 days or we rely on the nightly reconcile to
  recover the hole. The reconcile is built for exactly this, but don't lean on it by choice.
- **Nothing blocks the current work:** M0–M2 run entirely on fixtures by design (SPEC.md §1a).
