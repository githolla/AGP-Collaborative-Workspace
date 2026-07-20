# CLAUDE CODE BUILD PROMPT — AGP Project Command v2
## A Self-Assembling, Self-Anticipating Project Workspace for AGP

Copy everything below into Claude Code as the kickoff prompt. Keep it in the repo as `SPEC.md`.

---

## Role & Mandate

You are the lead engineer building **AGP Project Command** from scratch: an AI-native collaborative workspace for AGP (a nonprofit-focused fundraising/marketing agency), delivered inside Microsoft Teams, orchestrating Kantata OX (PSA — projects, budgets, tasks, allocations, time, invoices) and HubSpot (CRM — companies, deals, contacts, engagements, tickets, campaigns). Stack: React + TypeScript, Supabase (Postgres) as the intelligence store and mirror, Anthropic API for all intelligence, Vercel for dev previews, production deployed to AGP's Azure environment, Microsoft Graph for Teams/Entra integration.

You own sequencing and timeline. Propose a milestone plan with your own estimates before writing code, then execute. Maintain `BLOCKERS.md` from day one listing every credential/approval requiring human action (Entra app registration + admin consent, Teams custom app upload approval, Kantata admin OAuth app, HubSpot app + webhook config, Azure resources) with owner and lead-time risk. When real API behavior contradicts this spec, trust reality, adapt, and record it in an ADR.

## Product Philosophy (governs every design decision)

The collaborator's job is **initiate and approve — never assemble, never ask, never configure.**

1. **Proactive by default.** The system anticipates needs from context (calendar position, project stage, data signals) and delivers before anyone asks. A question a user has to type is a missed prediction.
2. **Approval-by-exception.** Claude acts autonomously on reversible, high-confidence actions (with undo windows + audit); drafts anything consequential (money, client-facing, staffing) for one-tap human approval; interrupts only for genuine ambiguity. Implement as an explicit **autonomy-tier system** (see Cross-Cutting).
3. **Never a blank page.** Every artifact, message, plan, and decision arrives pre-drafted from institutional history.
4. **Provenance always.** Every AI-supplied number, claim, or suggestion carries a traceable source ("based on Riverside 2024 actuals") one tap away. No vibes.
5. **Self-configuring.** No user-facing thresholds or settings required to operate. The system infers "normal" per project/client from history and adapts to user behavior (repeated dismissals suppress a signal class for that user; repeated engagement promotes it). Admin screens exist for override, not operation.
6. **Respectful automation.** People are invited, not conscripted; managers can require routing through them; capability/performance inference is never surfaced to peers; every automated action explains its trigger in one sentence.

## Non-Negotiable Technical Constraints

1. **Kantata has NO push webhooks.** Subscribed Events API only: ~9-day retention, admin token, events lag minutes, arrive out of order, duplicate. Ingestion must be idempotent, poll-based, resumable (poll → dirty-flag → hydrate). A **nightly full-reconcile** (updated_at cursor diff) is mandatory so an outage never silently loses data.
2. **HubSpot webhooks require a public app.** Build behind a `SourceAdapter` interface with a polling fallback (search on `hs_lastmodifieddate`) so the product works on a private-app token.
3. **Auth:** Entra ID SSO (Teams SSO in-tab, browser fallback for testing). Kantata/HubSpot service tokens server-side only. Secrets in env config, never code.
4. **Graph channel provisioning is lazy.** Retry-with-backoff, trigger `filesFolder`, "workspace preparing" UX state.
5. **AI calls are server-side only**, prompt templates versioned in `/src/ai/prompts/`. All model outputs that could write data pass through the autonomy-tier gate.
6. **Rate-limit-aware clients** for both APIs (backoff on 429), correlation IDs through every saga, every external write in `audit_log` with before/after.
7. **Tenant grounding is authoritative:** `kantata-tenant-grounding.md` (repo root) documents AGP's actual Kantata instance — existing taxonomy custom fields ("Service Line Detail" etc.), GL-coded COGS expense categories for the fee/pass-through split, bill+cost rates on time entries, the hard/soft allocation flag, the workspace_groups↔HubSpot company join, story-tree roll-up rules, dead endpoints, and normalization gotchas. Conform the mirror schema, adapters, and financial math to it; where it conflicts with generic Kantata documentation, the grounding doc wins.

## System Architecture

```
HubSpot ──webhooks/poll──▶ ┌────────────────────────────┐
Kantata ──subscribed_events▶│ Sync Service (adapters,    │──▶ Supabase
Org chart upload ──ingest──▶│ queue, reconcile)          │    ├─ mirror (kantata_*, hubspot_*)
                            └────────────────────────────┘    ├─ registry (people, capabilities, playbooks)
                                                              ├─ artifacts (versioned, provenance-linked)
        ┌──────────────── Signals & Rules Engine ◀────────────┤─ signals, actions, autonomy_log
        │                        │                            ├─ embeddings (pgvector corpus index)
        ▼                        ▼                            └─ audit_log
  Needs-You Feed          Auto-Assembly Engine
        │                        │
Teams Tab (React/SSO) ── Teams Bot & Adaptive Cards ── Microsoft Graph (channels, members, cards)
                    └── Anthropic API (intelligence layer) ──┘
```

**Supabase schema groups:**
- **Mirror:** `kantata_workspaces/participations/stories/allocations/assignments/time_entries/invoices/custom_field_values`, `hubspot_companies/deals/contacts/engagements/tickets/line_items` — each with `source_id`, `raw jsonb`, `synced_at`, `dirty`.
- **Registry:** `people` (entra_id, kantata_user_id, hubspot_owner_id, role, function, team, reports_to, routing_mode: direct|via_manager), `capabilities` (person, capability, evidence_refs, confidence — derived from Kantata history, admin-editable), `playbooks` (engagement_type → cast template: function, trigger_point, typical_hours, sequence — derived from completed projects, versioned, admin-editable).
- **Workspace app:** `workspaces_map` (deal ↔ kantata_workspace ↔ teams_channel), `provisioning_jobs` (saga state), `loop_ins` (person, project, trigger, brief_ref, status: proposed|invited|accepted|declined|deferred), `alerts`, `digests`.
- **Intelligence:** `artifacts` (type, project, version, status: draft|approved|live, provenance jsonb of source refs), `signals` (raw detected events), `actions` (proposed/executed with autonomy tier, undo_deadline), `baselines` (learned per-project/client normals), `user_prefs_learned` (per-user signal weights from behavior), `embeddings` (pgvector over time-entry notes, engagement bodies, artifact text, task descriptions).
- RLS on all app tables keyed to Entra object ID; capability/inference tables readable only by service role + admins.

## LAYER 0 — COLLABORATION CONTAINER (the manager's Collaboration Hub — build first inside Layer 1)

The delivery organization has specified a governed M365 collaboration workspace (see `collab-hub-requirements-response.md` for the requirement-by-requirement mapping — treat it as requirements). It is the container everything else lives in:

1. **Two-zone workspace structure, provisioned as one unit:** per client Team; per project a **client zone** (shared channel or guest-enabled standard channel: discussions, shared files, shared task view, milestones, client-safe home tab) and an **internal zone** (private channel: AGP-only discussion, working files, the Project Command tab). Separate memberships, separate SharePoint storage. **HARD RULE, enforce in code and test:** no financial data — budgets, burn, margin, rates, costs — may render on any guest-visible surface. The Project Command tab, bot, and staff cards mount only in internal zones; the guest-safe home tab has no financial component and a build-time-verified component allowlist.
2. **Provisioning-as-template:** the Layer 1c saga expands to create the full template via Graph: both zones, standard SharePoint folder taxonomy (admin-defined, versioned), a Planner plan tabbed into the channel, standard tabs, guest invitations (Entra B2B) with correct scope, and the home tabs. Templates are code: versioned, consistent, auditable.
3. **Kantata ⇄ Planner task sync:** mirror Kantata plan stories into the workspace's Planner plan; flow completion/status back to Kantata. Client-facing tasks are a filtered subset via a client-visible flag (Kantata custom field or platform-side flag) — internal tasks never reach the shared plan. This kills double-entry for AMs and is the delivery org's highest-felt pain; treat as a flagship Layer 0/1 deliverable, built on the same sync service.
4. **Home tabs (two variants, one build):** What's New activity feed (zone-scoped aggregation of posts, file changes, task/milestone updates), My Tasks, file quick links, upcoming milestones. Staff variant adds budget/health. Guests' variant passes the no-financials allowlist.
5. **Guest lifecycle & access register:** live per-workspace access register (person, level, zone, invited-by, last active); one-click cross-workspace offboard (Entra removal) with audit logging; workspace archive on project close (Team archived read-only + platform record retained).
6. Native M365 handles what it's good at — channel discussions, mentions, chat, SharePoint versioning/co-authoring, permission-trimmed search, channel email addresses, Planner views. Do not rebuild these.

## LAYER 1 — OPERATE (foundation + workspace + provisioning)

### 1a. Sync foundation (build first)
Kantata + HubSpot adapters, durable queue (`FOR UPDATE SKIP LOCKED`), dirty-flag hydration, nightly reconcile, seed/fixture data so UI never blocks on credentials. Backfill jobs for history (all completed projects, all closed deals, time entries, engagements) — the intelligence layers are only as good as the corpus.

### 1b. Workspace UI (Teams configurable tab + personal tab)
- **Project dashboard:** status, timeline, milestones, budget vs. burn, projected margin — computed from mirror.
- **Resource planner:** read/write allocations against real Kantata structure; auto-derived hour envelopes from contract value; weekly peaks-and-valleys grid; what-if scenarios as draft allocations, written to Kantata only on approve.
- **Engagement ROI card:** value, cost (allocations × rates), margin, trend.
- **Teams shell:** Agents Toolkit manifest, configurable tab bound to a project via config page, Teams SSO with on-behalf-of exchange, Entra↔Kantata identity mapping by email, Teams context autoload, desktop/web/mobile rendering, theme tokens.

### 1c. Deal-to-delivery provisioning (saga, resumable, idempotent)
Deal hits configured stage → create Kantata workspace (mapped fields; admin-editable mapping UI) → invoke Layer 4 auto-assembly for the cast plan → create Teams channel (retry pattern) → pin tab → kickoff Adaptive Card (deal summary, budget, proposed cast, approve/open actions) → ongoing backflow to HubSpot deal (`delivery_status`, `budget_burn_pct`, `margin_estimate`, `health_narrative` ≤400 chars). Lost-deal: archive, never delete, notify channel, flag admin. Duplicate triggers must be no-ops.

**Acceptance:** tab opens with silent auth showing real synced data; allocation edit round-trips to Kantata; test deal at trigger stage yields workspace + channel + tab + kickoff card within 5 minutes, idempotently.

## LAYER 2 — ANTICIPATE (the ask-nothing surface)

### 2a. Signals & Rules Engine
Continuous evaluation over the mirror producing typed `signals`: budget burn deviation vs. learned baseline, allocation conflict, milestone slip, stale timesheet, unbilled aging, payment lag, deal-stage movement, ticket-volume spike, engagement-content triggers (scope keywords in client emails), churn-pattern signatures mined from Subscribed Events history (e.g., repeated mid-flight budget edits + task reassignment churn in weeks 2–4). Baselines are learned per project/client (`baselines`), not configured.

### 2b. Needs-You Feed
Per-person, role-computed daily surface (personal tab home + morning Teams card): **max 5 items**, ranked by dollar impact × deadline proximity, each a one-tap action (approve / edit / dismiss). Everything below the cut is silently handled or held. An account lead sees "approve Jordan's hours; client not updated in 9 days — email drafted"; a designer sees this week's tasks + one flag; a partner sees portfolio exceptions only. Empty feed states "nothing needs you" — that is a success state. Dismissal/engagement patterns update `user_prefs_learned` and reweight future ranking per user.

### 2c. Anticipatory delivery
Predictable needs are fulfilled before being asked: milestone-adjacent Monday → status brief already posted; timesheet deadline → personal nudge with calendar-inferred draft entries pre-filled for one-tap approve; deal enters late stage → SOW draft (Layer 3) auto-started and placed in the account lead's feed; sick-day allocation gap detected → three re-staffing options pre-computed and ranked by margin impact.

### 2d. Autonomy tiers (the gate all actions pass through)
- **Tier A (auto-execute + undo window + audit):** reversible, high-confidence — routine field sync, internal digest posting, archiving dead-deal workspaces, feed curation.
- **Tier B (draft, one-tap approve):** anything touching money, client-facing sends, staffing commits, Kantata/HubSpot writes beyond routine sync.
- **Tier C (interrupt with question):** genuine ambiguity only. Each interruption must state why it couldn't proceed.
Tier assignment per action type lives in a config table with safe defaults; nothing client-facing or financial may ever be Tier A.

**Acceptance:** seeded scenario data produces a correctly ranked 5-item feed per role; a forced baseline breach yields exactly one alert in the right channel; a repeated dismissal measurably deprioritizes that signal class for that user; Tier A action executes, logs, and cleanly undoes.

## LAYER 3 — CREATE (the build surface / artifact studio)

The workspace is where AGP's work products get made, with Claude assembling the first 80% from institutional history.

### 3a. Corpus & retrieval
pgvector index over: time-entry notes, task names/descriptions, HubSpot engagement bodies (emails, calls, meeting notes), deal descriptions/line items, and prior artifacts. Retrieval always returns source refs; generation prompts require citing them. Approved/won/successful artifacts are tagged back into the corpus so each build improves the next (`artifacts.status = live` + outcome tags).

### 3b. Artifact studio
"New →" picker in every workspace; each type is a template pipeline: minimal human inputs (client, intent, constraints) → retrieval of comparables → generated draft with inline provenance chips → collaborative edit → approve → the artifact becomes **live and load-bearing**, not an export:
- **SOW / proposal:** 3 most-similar won deals + their delivered actuals → scope, task structure, hour estimates calibrated to real historical effort (never original guesses), pricing consistent with client history, voice from past winning proposals. On approve, the SOW becomes the scope baseline the scope-creep sentinel diffs against.
- **Project plan / WBS:** task tree from best-performing comparables, dated to contract timeline, pre-assigned against live availability, annotated with historical calibration ("this review step ran 2× estimate on the last four appeal campaigns — padded"). Approve → written into Kantata as real structure.
- **Campaign / creative brief:** client mission, audience, past campaign performance and stated wants from the HubSpot record + patterns from similar successful nonprofit campaigns.
- **Budget / staffing model:** rate cards + actuals, live margin as the user adjusts, inline alternatives with margin math (PM-only framing; never peer-visible performance commentary).
- **Client report / QBR / status email:** live project data + campaign outcomes + impact framing (dollars raised where available), drafted in the account lead's learned voice from their sent HubSpot emails, in the client's established format.
- **Change order:** auto-drafted by the scope-creep sentinel with dollar quantification from the actual-vs-SOW diff.

### 3c. Scope-creep sentinel & estimation intelligence
Continuous diff of actual tasks/hours vs. live SOW baseline → unsold work quantified in dollars → Tier B change-order draft to the account lead. At provisioning, estimation calibration: compare new engagement against comparable actuals and adjust drafted plan/roster with stated deltas ("engagements like this ran ~20% over on creative hours").

**Acceptance:** with a backfilled corpus, generating an SOW for a seeded "new deal" produces a draft whose every hour estimate and price carries a provenance chip resolving to real source records; approving it creates the live baseline; injecting unsold tasks triggers exactly one change-order draft with correct dollar math.

## LAYER 4 — ASSEMBLE (auto-assembly of the team)

### 4a. Org & capability registry
- **Registry seed provided:** `agp-org-registry-seed.json` (in repo root) contains the parsed AGP org chart — ~60 people with titles, entity tags, reporting lines, works-with edges, inferred functions, functional groups, and routing defaults. Ingest it as the initial registry; the registry remains the living source with an admin UI for corrections and future re-upload diffs. Resolve Entra identities at ingest by name-match against the M365 tenant, flagging ambiguities for admin review. The seed's `known_gaps` lists teams not covered (creative, media, technology ICs, Beaconfire web staff) — the registry must gracefully handle people who appear in Kantata but not the seed.
- **Entity/heritage dimension:** people carry entity tags (PG Agency / PG Software / PG Ops / Staff). Preserve as a registry dimension — it powers the playbook-canonization comparisons and merger-integration reporting.
- **AGP structural facts that shape assembly:**
  - **AGP runs an in-house print/mail production facility** (digital press, variable-data programming, mail services, warehouse, under the COO). Hard-date chains for direct mail are therefore **internal capacity scheduling problems**, not only vendor lead times: model production as a schedulable resource pool (press time, mail-shop slots) with its own calendar, routed via production managers — never individual loop-in invites to press operators.
  - **Campaign deployment is a hub:** the Data Solutions & Campaign Deployment team ("Managed Services") has the widest collaboration graph in the org — nearly every campaign routes through it. Treat it as a dispatch-controlled queue (via-manager routing) with its own capacity view; expect it to be the first bottleneck the seasonality forecaster surfaces.
  - **The primary daily operators are the PM team** (an AVP-led group of senior PMs). Design and pilot the Needs-You feed for this persona first.
- **Capability inference:** mine Kantata participations + time entries to learn demonstrated capabilities per person and typical entry pattern (stage, hours, week). Store with evidence refs and confidence. **Hard rule:** inference informs matching only; comparative performance framing is visible to PMs as schedule math at most, never to peers, never in any client-facing or channel-visible surface.
- **Playbooks:** derive per engagement type the standard cast (function, trigger point, typical hours, sequence) from completed projects; versioned and admin-editable; every derived playbook shows its source projects.

### 4b. Kickoff assembly
Provisioning invokes assembly: scope (SOW/line items) × playbook × registry × live availability → **cast plan card** to the PM: who, when, why, hours; later-stage members scheduled for future loop-in, not added day one. PM can prune; 24h silence = proceed (Tier B with timed default). Capacity rule: never propose someone over threshold utilization without flagging and offering the available alternative with tradeoff math.

### 4c. Signal-driven mid-project loop-ins
Triggers: task/scope keywords matching a capability ("donor segmentation" → the person who owns that function), client-email content signals (accessibility, compliance, media), scope expansion into a new service line, approaching playbook trigger points. Each fires a **loop-in card** to the person (or their manager if `routing_mode = via_manager`): project, task, estimated hours, window, one-tap accept/decline/defer, with the auto-generated 60-second onboarding brief attached (what the project is, decisions so far, what's expected, who's who — generated from the corpus). Accept → channel membership via Graph, draft allocation in Kantata, task assignment. Decline/defer → next-best proposal + PM notification. Every loop-in states its trigger in one sentence.

**Acceptance:** uploading a sample org chart (fixture) yields an editable registry; a seeded project with a matching playbook produces a correct cast plan; adding a task named for a registered capability fires exactly one loop-in to the right person with a brief; decline routes to the alternate and notifies the PM; a person at over-threshold utilization is flagged, never silently assigned.

## Cross-Cutting Requirements

- **Provenance system:** unified `source_ref` type (system, entity, id, snapshot_at) attached to every generated claim; UI chip component resolving to the source record. No generation path may emit unreferenced quantitative claims.
- **Explainability:** every automated action (feed item, alert, loop-in, Tier A execution) carries a one-sentence machine-generated "because," stored with the action.
- **Privacy boundaries:** HubSpot engagement content (client emails/notes) is used for briefs, triggers, and voice learning — scope OAuth minimally and document it. **Do not** ingest or analyze Teams channel messages for sentiment or monitoring; Teams is a delivery surface, not a data source.
- **Learning loops:** artifact outcomes → corpus; user behavior → feed weights; project completions → playbook/capability/baseline refresh (scheduled jobs).
- **Metrics of success (instrument these):** taps per user per week (down), minutes-from-signal-to-decision (down), feed items acted on vs. dismissed (up), artifacts approved with <20% edit distance (up), Kantata direct logins by workspace users (down).

## AGP Domain Requirements (shape the data model and intelligence to these)

AGP is the 2025+ unification of four firms — Allegiance Group (direct mail heritage), Pursuant (digital fundraising), GivingDNA (donor analytics product), and Beaconfire RED (web/app development) — serving nonprofit verticals (hospitals, health & human services, food banks, public media, arts & culture, environment/animal welfare, associations, faith-based, societal benefit) across service lines (direct mail, digital fundraising, email & automation, advertising & media, analytics, brand & creative, mid/major gifts, web & AI development, GivingDNA). Their M365 tenant is confirmed (SharePoint employee portal). Build these domain rules in:

1. **Engagement taxonomy = vertical × service line × commercial model.** Tag every workspace with all three. Playbooks, estimation calibration, baselines, and benchmarks key on vertical × service (a food-bank acquisition campaign ≠ a public-media pledge drive ≠ a hospital grateful-patient program), never service alone.
2. **Commercial models burn differently.** Support at minimum: retainer (monthly envelope, steady-burn baseline), fixed-fee campaign, sprint-based build (Beaconfire-style), and product/support (GivingDNA). Burn/margin alert logic is per-model; one generic burn model is a defect.
3. **Fee vs. pass-through separation.** Direct mail and media engagements carry pass-through costs (print, postage, media buys) in budgets and Kantata expenses. All margin math, ROI cards, and health scores compute on **fee revenue net of pass-through**. Classify expense categories accordingly (admin-editable mapping).
4. **Seasonality-aware capacity.** Maintain a fundraising surge calendar (year-end Oct–Dec, Giving Tuesday, spring appeals, public-media pledge drives, vertical-specific dates) as data, seeded with defaults and learned from historical allocation curves. The resource planner and Needs-You feed must forecast surge-window oversubscription **months ahead** ("November creative is 140% booked as of July") — this is a flagship capability, not an alert type.
5. **Hard-date milestone class.** Mail drop dates, in-home dates, campaign/pledge-drive launch dates are immovable. Model vendor lead-time chains (print, list, postage) so countdown alerts fire against the *latest safe start*, with escalating severity. Slippage on a hard-date chain is always Tier B-interrupting, never digest-only.
6. **Client-level rollup above project level.** The client (HubSpot company) is the atomic unit of health: aggregate all active/past engagements per client — revenue history, margin trend, health, communication recency — into a client card. Project health feeds it; renewal risk and account strategy briefs read from it.
7. **Cross-sell whitespace grid.** Client × service-line matrix from the full HubSpot deal history: which clients have never bought which AGP solution areas, ranked by fit signals (vertical norms, current engagement data, tenure). Feeds Layer 2 expansion prompts to deal owners. This is the merged entity's growth thesis made visible — treat as a first-class leadership view.
8. **Outcome benchmark scoreboard.** AGP publicly markets performance (donor retention, donor replacement rate, direct-mail response, email response, digital revenue mix). Compute these per client/campaign from HubSpot (and GivingDNA when connected) vs. AGP's marketed benchmarks and industry baselines. Surfaces: renewal decks, client reports (Layer 3), and an internal scoreboard. When a campaign beats benchmark, auto-draft a **case-study candidate** one-pager (Layer 3 artifact) routed to marketing.
9. **Playbook canonization for merger integration.** Playbooks derive from history but support a `canonical` flag: leadership designates the AGP-standard playbook per engagement type, unifying legacy-firm process variants. Derived variants remain visible for comparison ("legacy Pursuant pattern vs. canonical") to inform standardization decisions.
10. **GivingDNA as a future source adapter.** Design the `SourceAdapter` interface and schema so a GivingDNA connector (donor analytics, campaign outcomes) can be added without rework; stub it now, note it in `BLOCKERS.md` as a Phase-later credential.

## Engineering Standards

Monorepo (pnpm): `/apps/tab`, `/apps/bot`, `/services/sync`, `/services/signals`, `/services/assembly`, `/packages/shared` (types, clients, provenance, prompts). Typed rate-limited API clients. Migrations for all schema. Tests hardest on: sync never-miss (reconcile catches an injected gap), provisioning idempotency, autonomy-tier gating (Tier A cannot touch financial/client-facing paths — enforce in code, test it), loop-in single-fire. ADRs for consequential decisions. CI: typecheck/lint/test; Vercel previews; documented Azure production pipeline.

## Sequencing Guidance (you own the plan)

Foundation order is fixed: sync + mirror + backfill → workspace UI on fixtures → Teams shell → provisioning. After that, prefer **thin vertical slices of Layers 2–4 over completing any layer fully**: one real signal type end-to-end into a feed, one artifact type end-to-end with provenance, one loop-in trigger end-to-end — then broaden. Demo-able beats complete. Ship something AGP can touch as early as possible.

## First Actions

1. `BLOCKERS.md` with owners and lead-time risk.
2. Milestone plan + dependency graph, your estimates.
3. Scaffold monorepo + schema migrations; build sync foundation with fixtures.
4. Then follow the sequencing guidance above.
