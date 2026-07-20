# HubSpot property alignment — portal reality vs. our mirror

Source of truth: **"HubSpot Property Reference — AGP Audience Intelligence"**
(xlsx pulled from the AGP portal via API, 2026-07-17): 734 company properties,
794 contact properties. This doc records what our mirror assumed, what the
portal actually has, and the corrections applied.

## Verdict

Everything the workspace needs **exists** in the portal — but two of our
fixture assumptions used wrong names, now corrected. The portal also holds
account-intelligence fields far richer than we were modeling; the live pull
now requests them (least-privilege subset).

## Corrections (our assumption → portal reality)

| We assumed | Portal reality | Fix |
|---|---|---|
| `company.vertical` | **No `vertical` property exists.** AGP's custom field is `agp_industry` (select, `company_information` group); standard `industry` is the fallback | Mirror maps `vertical ← agp_industry ?? industry` |
| Engagements with `subject` / `engagement_type` | Engagements are a legacy v1 API; the export covers CRM objects only | Campaign context now = **deals** (standard v3 objects); engagement sync deferred to the public-app/webhooks phase (BLOCKERS #4) |
| Deals shaped like fixtures | **Deals were not in the export** (companies + contacts only) | Live pull uses HubSpot-standard deal properties (`dealname`, `dealstage`, `pipeline`, `closedate`) — present in every portal. If AGP has custom deal fields, export them the same way and we'll extend |

## Confirmed present (request list, validated name-by-name)

Identity/classification: `name`, `domain`, `agp_industry`, `industry`,
`lifecyclestage` (AGP relabels `customer` → "Client"), `type`, `ownername`.

Account health (internal-only): `client_health_index__c`,
`health_score_current_month`, `renewal`, `contract_start_date`,
`onboarding_date`.

GivingDNA: `gdna_subscription_level`, `gdna_client_type`,
`constituent_records_on_gdna`.

Buying intent: `hs_signals_summary`,
`hs_count_intent_signals_created_last_30_days`,
`hs_latest_intent_signal_occurred_at`.

Activity: `hs_last_sales_activity_type`, `notes_last_contacted`,
`num_associated_deals`, `hs_lastmodifieddate` (the polling watermark our
adapter was already built on — confirmed real).

## Deliberately NOT pulled yet (least-privilege until SSO/RLS)

- **Revenue fields** (`annualrevenue`, `total_revenue`, touchpoint `n20xx_ar`
  history): financial — waits for the auth layer, then internal-only surfaces.
- **Contacts** (794 properties incl. PII): nothing in the workspace needs
  person-level data yet.
- **`salesforceinformation`** (417 company / 193 contact fields): legacy
  Salesforce migration, per the export's own note "much of it historical
  rather than actively maintained." Ignore unless a specific field is asked
  for.

## High-value discoveries (now flowing into the Copilot's grounding)

- `client_health_index__c` + `health_score_current_month` — real client
  health, straight from HubSpot.
- `renewal` / `contract_start_date` — renewal risk timing.
- `gdna_subscription_level` / `constituent_records_on_gdna` — GivingDNA
  footprint per client.
- Intent signals (`hs_signals_summary`, 30-day counts) — buying-intent radar.

These render on **internal surfaces only** (sandbox Copilot briefings and
flags). The client-safety wall (`clientSafety.test.ts`) keeps them off guest
surfaces structurally. Note: full enforcement (the deployment itself being
internal-only) still rides on SSO — tracked in BLOCKERS #5.

## Where the live pull runs

`api/mirror.ts` — a Vercel serverless function. Tokens
(`HUBSPOT_PRIVATE_APP_TOKEN`, `KANTATA_API_TOKEN`) stay server-side; the
browser fetches `/api/mirror` and falls back to bundled fixtures when the
endpoint or tokens are absent (dev, or keys not yet configured). Kantata
custom fields (service line, vertical, commercial model per workspace) still
depend on the tenant grounding doc — BLOCKERS #1.
