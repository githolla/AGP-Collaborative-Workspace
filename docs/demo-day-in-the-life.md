# Demo runbook — "A day in the life of a project"

Format per Suuchi's guidance (2026-07-20 internal review): do NOT tour
features. Walk ONE project through its life across the three surfaces,
slowly, starting with the why. Internal dry-run first; one more internal
pass before Kara/Kelly see it.

## Opening (60 seconds, no screen)

> "Kantata stays your system of record — we're not replacing it, and the
> things you told us work well stay exactly where they are. We built two
> surfaces for the two things you told us hurt: **Kelly manages project
> changes manually across multiple steps**, and **Kara has no one place to
> collaborate per client** — it's scattered Teams chats. Nobody gets a new
> daily login. A notification pulls you in, you fix the thing, it flows
> back to Kantata. Let me show you one project's day."

Then show the one-pager (docs/three-surfaces-one-pager.html) for ~30
seconds. THEN the screen.

## The walkthrough (the Kelly test project)

| # | Where | Say / do |
|---|---|---|
| 1 | Kantata | "Here's the test project Kelly created — plan, budget, team. Normal Kantata." (One screen, don't linger.) |
| 2 | — | "Now the client calls: hold for two weeks." |
| 3 | Teams/email | Show the notification. "Only the people who need to act get pinged — you each choose Teams or email. Nobody polls a dashboard." |
| 4 | Resource & Task | Click through from the notification. "What needs you" → the drift, AI's suggested fix, hours re-spread, budget impact of the move. |
| 5 | Resource & Task | The staffing gap: "one of six roles unassigned — AI ranks the top two by fit, Aries is free" → one click assigns. |
| 6 | Collaboration | "A judgment question came up — that conversation lives in the client's workspace, on the record." Post the @mention; show the notification landing on Home. Show the milestone already moved on the Client Dashboard. |
| 7 | Kantata | "Kelly approves — and it writes back. Tasks and hours stay accurate in Kantata." (Today: staged behind approval; live write-back with the Azure deploy.) |
| 8 | Collaboration | Friday: "✍ Draft weekly update" → AI-drafted client status → edit → post. "The client never sees internal numbers — that's enforced by a build-time test, not discipline." |

Close: "That's the whole ask from Kara's nine steps — one alert, one fix,
one place to talk, synchronized back to Kantata."

## Questions we ask THEM (validation, not defense)

1. "We assume nothing from HubSpot matters on these delivery surfaces —
   HubSpot is pre-acquisition CRM. We use it only as the client directory.
   Correct?" (Suuchi: 99.99% yes — confirm and it comes fully off.)
2. "Which Kantata features work well today that we must NOT recreate?"
   (Kelly named some — get the list explicitly.)
3. "Teams or email per person — who wants which?"

## Prep checklist before the demo

- [ ] Kelly test project visible in both tools (Kantata ID wired).
- [ ] Seed one drift scenario on the test project (timeline hold) so the
      notification → fix → write-back path is real, not narrated.
- [ ] Collaboration workspace for the test client populated via Review
      import (campaigns + tasks), one @mention thread ready.
- [ ] Demo data leftovers archived; Clients page shows real accounts.
- [ ] One-pager printed/attached to the calendar invite.
- [ ] Slow down. Pause after each surface. Ask "does this match how you
      work?" before moving on.
