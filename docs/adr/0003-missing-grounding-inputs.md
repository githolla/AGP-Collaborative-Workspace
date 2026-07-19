# ADR 0003 — Proceeding without the tenant grounding doc and org registry seed

**Status:** accepted · **Date:** 2026-07-19

## Context

SPEC.md declares `kantata-tenant-grounding.md` authoritative for AGP's Kantata
instance and `agp-org-registry-seed.json` as the registry seed. Neither file was
present at kickoff (repo was empty). Both are tracked as BLOCKERS #1 and #2.

## Decision

Build M0–M2 on generic Kantata/HubSpot semantics plus synthetic fixtures shaped
by the spec's own domain facts (fee vs. pass-through expense categories, bill+cost
rates on time entries, hard/soft allocation flag, workspace_groups↔HubSpot company
join). Keep tenant-specific mappings (expense-category → fee/pass-through, custom
field names, dead endpoints) in admin-editable config tables and adapter-level
mapping modules — never inline in financial math — so the grounding doc lands as
data + small mapping edits, not a schema rewrite.

## Consequences

- Financial figures computed before the grounding doc arrives are *illustrative*
  and must not be shown to AGP as real numbers.
- When the files arrive: diff fixtures against reality, revise mappings, record
  divergences in a follow-up ADR.
