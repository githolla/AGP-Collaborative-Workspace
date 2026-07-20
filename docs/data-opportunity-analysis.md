# Data-opportunity analysis — what we hold vs. what we use

Date: 2026-07-20. Inputs: the AGP HubSpot property export (734 company / 794
contact properties, pulled 2026-07-17), SPEC v2_1's Kantata architecture, and
the current live pull (`api/mirror.ts`).

## 1. Utilization today

| Source | Available | Pulled | Utilization |
|---|---|---|---|
| HubSpot company properties | 734 (317 excluding legacy Salesforce) | 23 | 3.1% (7.3% of non-legacy) |
| HubSpot contact properties | 794 | 0 | 0% (deliberate — PII waits for SSO) |
| HubSpot deals | unknown (not in export) | 5 standard props | — |
| Kantata entity families (per SPEC mirror: workspaces, workspace_groups, custom_field_values, stories, participations, allocations, assignments, time_entries, invoices) | 9 | 4 (workspaces, milestone stories, groups, custom fields) | 44% of families |

Low utilization is *correct* right now — least-privilege until auth exists —
but the gap is where the next several product levels live. This doc maps each
untapped asset to the feature it powers.

## 2. HubSpot company fields — the untapped tiers

### Tier 1 — pullable NOW (non-financial, internal surfaces)

| Field(s) | Feature it powers |
|---|---|
| `hs_notes_next_activity`, `notes_next_activity_date`, `hs_notes_last_activity`, `num_contacted_notes` | **"Gone quiet" radar**: client workspaces flag accounts with no next activity scheduled or long contact gaps — the relationship-health signal account leads actually act on. |
| `engagements_last_meeting_booked` (+ source/medium) | Last/next meeting context in the client workspace header and Copilot briefings. |
| `hs_is_target_account`, `hs_ideal_customer_profile` (ICP tier), `hs_num_decision_makers`, `hs_num_contacts_with_buying_roles` | **BD prioritization** in the book-of-business picker: sort prospects by ICP tier and buying-committee depth, not alphabetically. |
| `hs_analytics_num_page_views`, `hs_analytics_num_visits`, `rollworks_data` group (34 fields) | Marketing-touch intensity per account — pairs with the intent signals we already pull. |
| `days_to_close`, `first_deal_created_date`, `closedate` | Account tenure + sales-cycle context for the Copilot's value calibration. |

### Tier 2 — auth-gated (financial; internal-only after SSO)

| Field(s) | Feature it powers |
|---|---|
| `annual_fundraising_revenue`, `total_money_raised` | **Nonprofit-native account sizing** — these are AGP-specific fields nobody else would have; ROI basis calibration per client scale. |
| `n2017_ar`…`n2022_ar` (six years of AR history) | Account revenue trajectory — growing/shrinking client trend line on internal account views. |
| `annualrevenue`, `total_revenue`, `recent_deal_amount`, `hs_revenue_range` | Portfolio value tiering; pairs with Kantata fee data for the **composite client-health score** the research found no incumbent has shipped (health index + intent + activity + delivery status + revenue trend). |

### Tier 3 — contacts (794 fields; needs PII policy + SSO)

| Group | What's in it | Feature it powers |
|---|---|---|
| `emailinformation` (69) | opens, clicks, bounces, subscription states | Campaign-performance panels in the client dashboard — real send/open/click stats per campaign, client-safe. |
| `conversioninformation` (32) | first/recent conversion events, ad clicks | Attribution context for campaign recaps. |
| `contactlcs` (30) | lifecycle-stage timing per contact | Donor-journey analytics for GivingDNA cross-sell. |
| `wistia` (14), `zoom` (6), `lead_ads` (6) | video/webinar/ads engagement | Content-engagement signals for the audience-intelligence project. |
| `pursuant_email_signatures` (8) | staff signature fields | Auto-populated contact cards in client workspaces. |

### Ignore permanently (per the export's own note)

`salesforceinformation`: 417 company + 193 contact legacy fields — "much of
it historical rather than actively maintained."

## 3. Kantata — entity families vs. the SPEC's intent

| Entity (SPEC mirror) | Status | What pulling it unlocks |
|---|---|---|
| workspaces | ✅ pulled (200, dates, status) | — |
| workspace_groups | ✅ pulled | Exact client↔project join (live now). |
| custom_field_values | ✅ pulled | Service Line Detail / vertical taxonomy (live now). |
| stories (milestones) | ✅ pulled | Client-facing milestone dates (live now). |
| stories (tasks, full tree) | ◻ not yet | Kantata⇄workspace task sync — the SPEC's "flagship deliverable" (kills AM double-entry); rides the existing clientVisible/status-flow-back shape. |
| **participations / assignments** | ◻ not yet | **Who actually works on what** → the Copilot casts teams from real delivery history instead of the static org chart; capability inference (SPEC Layer 4a) starts here. |
| **time_entries** | ◻ not yet | **Actuals vs. estimates** → calibrated build guesses ("this review step ran 2× estimate on the last four appeal campaigns — padded", per SPEC). The single biggest upgrade to ROI credibility. |
| allocations | ◻ not yet | Capacity-aware planning; the write-side is the resourcing-engine project's step 7 (weekly reservations). |
| invoices / expenses | ⛔ grounding-doc-gated | Fee vs. pass-through margin math — needs the GL-coded COGS categories, rate semantics, hard/soft allocation flag from `kantata-tenant-grounding.md`. |
| Subscribed Events | ◻ not yet | Real-time-ish change feed (9-day retention — poller must be deployed promptly once the events scope is granted). |

## 4. Ranked next pulls (impact ÷ effort) — items 1–4 SHIPPED 2026-07-20

1. ✅ **Kantata `time_entries` + participants** — pulled and aggregated
   server-side (minutes + dates only; rates stripped before the wire). Powers
   the per-project delivery pulse (hrs/30d, people, last entry), the
   "delivery quiet" flag, and the real team roster per workspace. Full
   calibrated-estimate use in the Copilot remains open (needs story-level
   join depth).
2. ✅ **HubSpot next/last-activity fields** — `notes_last_contacted`,
   `notes_next_activity_date`, `num_contacted_notes` pulled; "gone quiet"
   radar live in the workspace header + account record card.
3. ✅ **Full Kantata story tree** — `story_type=task` pulled (cap 1000,
   recent-first); open tasks flow into the Project Plan through the same
   review-gated import as campaigns, labeled "from Kantata".
4. ✅ **Target-account/ICP fields** — `hs_ideal_customer_profile` +
   `hs_is_target_account` pulled; ★ Target badge + sort boost in the
   book-of-business picker; ICP fit row in the account record.
5. ◻ **Deal property export** (ask: run the same property-reference export
   for Deals) — unlocks AGP-custom deal fields we can't see today.

## 5. Asks that unblock the rest

- **Deals tab of the property export** (same method as companies/contacts).
- **`kantata-tenant-grounding.md`** — now only blocking *financial* math
  (COGS/rates/allocation semantics), not collaboration features.
- **Kantata token scopes**: verify stories + workspace_groups +
  custom_field_values + (eventually) time_entries/participations read scopes;
  the Live-pill tooltip reports per-endpoint HTTP status.
- **PII policy decision** before any contact-field pull (Tier 3).
