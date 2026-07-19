# ADR 0002 — Sync foundation: poll → dirty-flag → hydrate, with nightly reconcile

**Status:** accepted · **Date:** 2026-07-19

## Context

Kantata has no push webhooks — only the Subscribed Events API (~9-day retention,
admin token, minutes of lag, out-of-order delivery, duplicates). HubSpot webhooks
require a public app we may not have on day one. The mirror must never silently
lose data (SPEC.md constraint #1).

## Decision

1. **Change signals are hints, not truths.** Adapters emit `ChangeRef`s
   (source, entity type, source id) from events/webhooks/polls. A change ref only
   marks the mirror row dirty and enqueues hydration; the hydration worker always
   fetches the *current* entity state from the source API. This makes duplicates
   and out-of-order delivery harmless by construction: N refs for the same entity
   collapse into one pending hydration job, and hydration is last-write-wins
   against the live API, not the event payload.
2. **Durable dedup queue.** Jobs are keyed `(source, entity_type, source_id)` with
   at most one *pending* job per key (`ON CONFLICT DO NOTHING`); workers claim
   with `FOR UPDATE SKIP LOCKED`. An `InMemorySyncQueue` implements the same
   interface for tests; `sql/queue.sql` documents the Postgres claim queries.
3. **Nightly full reconcile.** For each entity type, list all source records
   updated since the last reconcile window (with overlap) and diff `updated_at`
   against the mirror; any missing/stale row is marked dirty and enqueued. This
   bounds data loss from any outage to one day, independent of event retention.
4. **Adapters behind `SourceAdapter`.** Kantata (subscribed-events polling) and
   HubSpot (polling on `hs_lastmodifieddate`, webhook ingestion when the public
   app exists) implement one interface; GivingDNA slots in later without rework.
   Adapters are constructed over a narrow API-port interface so fixtures can back
   them completely in tests and pre-credential development.

## Consequences

- Hydration costs one API read per dirty entity even when the event carried the
  payload — accepted; correctness over API thrift, and the rate-limited client
  smooths bursts.
- Reconcile relies on source-side `updated_at` filtering; endpoints that can't
  filter must be listed fully (acceptable at AGP's scale, revisit if not).
- Event payloads are still stored raw in `sync_events` for signal mining
  (churn-pattern signatures per SPEC Layer 2a) — dedup happens at job level, not
  event storage.
