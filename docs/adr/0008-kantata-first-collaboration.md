# ADR 0008 — Kantata-first: HubSpot demoted to client directory

Date: 2026-07-20. Status: accepted (internal review with Suuchi, Jenna,
Diego); one assumption pending Kara/Kelly validation.

## Context

Internal review of the demo surfaced a positioning problem: HubSpot is
AGP's **pre-acquisition CRM** (prospects, marketing, ABM). The
collaboration workspace and the resource/task tool are **delivery**
surfaces for signed clients, where **Kantata is the system of record**.
Suuchi ("I know HubSpot well… I can't imagine there is anything useful
from HubSpot for you in either of these two tools"), Diego (client-health
work found no post-acquisition HubSpot flow), and Josh (the fields pulled
are "probably redundant… might be confusing" — e.g. two conflicting
"account owners") converged: HubSpot data comes OFF the delivery surfaces.

Also decided: **collaboration is the hero** of this build (Kara's ask;
Kelly's change-management pain is the resource/task tool's job), the next
demo is a **day-in-the-life workflow** (docs/demo-day-in-the-life.md, with
docs/three-surfaces-one-pager.html), and write-back to Kantata is the
integration goal (staged behind approval; lands with the Azure deploy).

## Decision

1. The client workspace displays **Kantata delivery data only**: projects,
   milestones, tasks, team (participants), hours pulse, delivery-quiet.
2. Removed from the workspace UI: the HubSpot account-record card (owner,
   health, renewal, GDNA, intent, ICP, last-touch/next-activity), the CRM
   gone-quiet flag, the open-deals chip, and the deals pipeline section.
3. HubSpot remains, server-side, as the **client directory**: the book of
   business (which companies exist, names, verticals, abbreviation for
   title matching) that workspace creation and Kantata-title matching key
   off. No CRM intelligence renders on delivery surfaces.
4. The matcher still accepts HubSpot deals as import candidates (labeled
   planned campaigns) **pending Kara's answer** — if she confirms deals
   are irrelevant to delivery, they come out too.

## Validation to run with Kara/Kelly (assumptive close)

- "We assume nothing from HubSpot is relevant on these delivery surfaces —
  correct?" (Suuchi: 99.99% yes.)
- "Which Kantata features work well today that we must NOT recreate?"

## Consequences

- The pull (api/mirror) still fetches company fields — they feed the
  directory, matching, and the internal-only Copilot briefings (Sandbox
  side, which IS a BD/internal surface where CRM context is defensible).
  If Kara confirms full removal, trimming the pull is a follow-up.
- The gone-quiet (CRM) radar and ICP/Target work move conceptually to the
  BD side of the house (audience-intelligence project), not delivery.
- Rollback is cheap: display components were removed, not the data path.
