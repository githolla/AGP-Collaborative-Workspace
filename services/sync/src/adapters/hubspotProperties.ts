/**
 * Canonical HubSpot property manifest — every property name here was
 * validated against the AGP portal export ("HubSpot Property Reference —
 * AGP Audience Intelligence", pulled 2026-07-17; 734 company / 794 contact
 * properties). See docs/hubspot-property-map.md for the full alignment.
 *
 * Least-privilege by design until SSO lands: no revenue/AR fields, no
 * contact PII. Widen deliberately, one field at a time, when auth exists.
 *
 * NOTE: api/mirror.ts (the Vercel function) inlines this list because it
 * must stay self-contained for bundling. Change it there too.
 */

/** Company properties the live pull requests. */
export const HUBSPOT_COMPANY_PROPERTIES = [
  // Identity + classification
  "name",
  "domain",
  "agp_industry", // AGP's custom vertical (select) — our mirror "vertical"
  "industry", // standard fallback when agp_industry is empty
  "lifecyclestage", // "customer" = Client in AGP's pipeline labeling
  "type",
  "ownername",
  // Account health & lifecycle (internal-only surfaces)
  "client_health_index__c", // touchpoint group — Client Health Index
  "health_score_current_month",
  "renewal", // renewal date
  "contract_start_date",
  "onboarding_date",
  // GivingDNA product context
  "gdna_subscription_level",
  "gdna_client_type",
  "constituent_records_on_gdna",
  // Buying-intent radar (company_signals group)
  "hs_signals_summary",
  "hs_count_intent_signals_created_last_30_days",
  "hs_latest_intent_signal_occurred_at",
  // Activity + change tracking
  "hs_last_sales_activity_type",
  "notes_last_contacted",
  "num_associated_deals",
  "hs_lastmodifieddate",
] as const;

/**
 * Deal properties. Deals were NOT in the portal export (companies + contacts
 * only) — these are HubSpot-standard names present in every portal. If AGP
 * has custom deal fields worth mirroring, export the deal properties the
 * same way and extend this list.
 * Deliberately excluded until auth lands: "amount".
 */
export const HUBSPOT_DEAL_PROPERTIES = [
  "dealname",
  "dealstage",
  "pipeline",
  "closedate",
  "hs_lastmodifieddate",
] as const;

/**
 * Contacts: deliberately NOT pulled yet. The portal has 794 contact
 * properties incl. PII; nothing in the workspace needs person-level data
 * before SSO/RLS exists. Revisit for the audience-intelligence work.
 */
export const HUBSPOT_CONTACT_PROPERTIES: readonly string[] = [] as const;
