# Collaborative-workspace & AI best practices — research synthesis

Date: 2026-07-20. Method: four parallel research agents (rival platforms;
shipped AI features; client-portal science; human-AI UX literature), ~80
sources. Full source URLs inline. This doc distills what matters for THIS
product and ranks what to do about it.

## 1. The strategic finding

**Kantata OX is documented weak exactly where this product is strong.** G2
reviewers say Kantata's collaboration is "mainly geared toward internal
project teams" — no client feedback workflows, no approvals, no client-safe
status surface. Meanwhile the big work-management platforms shipped AI for
*internal* teams but none packages it as a client-communication layer. This
workspace — Kantata as system of record underneath, a simple client-safe
surface with AI drafting on top — fills a documented gap without fighting any
incumbent's strength. (G2 Kantata reviews; platform survey.)

## 2. What the research VALIDATES in the current build

| Our design | The evidence |
|---|---|
| Draft-review panel (accept before it counts) | The universal pattern behind every *liked* AI feature: Asana Smart Status accept/edit/discard, ClickUp Approval Mode, Copilot-in-Planner acceptance. Notion's worst press came from saving AI edits *before* approval. |
| "Because" on every suggestion + deterministic flags | Provenance separates "trusted" from "gimmick" (Rovo citations, Notion transcript-linked takeaways, Wrike risk factors). Also HAX G1/G2/G11. |
| Observer mode / invite the Copilot in | Matches the industry-convergent agent model (@-mention invocation — Linear, Slack Agentforce, Rovo) and HAX G7/G8 (easy invoke/dismiss). Atlassian's forced-on Rovo rollout is the cautionary opposite. |
| Client-safety firewall (build-time test) | Microsoft Entra least-privilege guest guidance: permissions mapped to data classification. Ours is enforced structurally. |
| No per-client cost | Industry norm: external people are free (Teamwork, Asana, Basecamp). ClickUp's retroactive guest monetization = 2-8× bill shock and community revolt. |
| Copilot posts in threads, humans own every task | "AI teammate" research: teammate framing raises engagement, but AI-owned tasks cause human commitment deficits — plan items must always carry a human owner. |

## 3. The gap list → ranked plan

### NOW (buildable in the current app, no backend)

1. **AI-drafted weekly client digest** ★ shipped with this doc.
   The single highest-ROI AI feature across every platform surveyed (Asana
   Smart Status is "the clearest ROI" of all Asana AI). Format per
   AgencyAnalytics/Databox: lead with the headline + what it means, campaign
   status, done this week, coming up, needs-your-attention, one
   recommendation. Draft-then-approve: the AM edits before posting.
   Push-the-digest / pull-the-portal is the canonical hybrid.
2. **Stale-guest access review prompts** ★ shipped with this doc.
   Entra's canonical pattern: periodic attestation by the resource owner +
   inactivity flagging. We already track last-active; badge guests inactive
   30+ days for review.
3. **Approvals as a first-class object.** #1 client-engagement driver
   (Ziflow: 67% of unplanned revision rounds come from unstructured
   feedback). Approve / approve-with-changes / request-changes statuses, a
   due date, auto-reminders for non-responders only, no client login needed
   (email-link pattern à la Wrike/Teamwork proofs).
4. **Fundraising-calendar awareness.** ~37% of online giving lands in
   December; GivingTuesday/year-end/fiscal-year dates are the nonprofit
   client's real plan. Seed season milestones into client dashboards and
   have the Copilot flag plans that collide with year-end freeze.
5. **Provenance links + rule-vs-judgment labels in the draft review.**
   HAX/NN/g: distinguish deterministic reasons ("no PM — rule") from
   inferred ones ("estimate low vs 3 similar projects — judgment") so users
   know which to challenge; link the source artifact, not just the reason.
6. **@Copilot mention in observer threads.** One-off wake without full
   invite — the convergent agent-interaction pattern (Linear's Agent
   Interaction Guidelines are the reference).

### NEXT (needs the backend/SSO wave)

7. **Magic-link client access.** "Couldn't log in" is a canonical portal
   killer; clients must reach their workspace from an email link with zero
   new credentials. Pairs with Supabase auth.
8. **Scheduled digest delivery** (Productive "Pulse" pattern): the approved
   weekly digest auto-emails the client and links back to the portal.
9. **Board-ready one-pager export.** Nonprofit clients re-report to boards;
   5-6 KPIs vs target + 1-2 insights, exportable — the strongest retention
   lever found in the nonprofit research.
10. **Portal adoption mechanics as product features:** kickoff walkthrough
    mode, adoption metrics (first-week logins, actions-without-reminders),
    portal-first nudges for staff. Portals fail on stale data, login
    friction, and the agency bypassing its own portal.

### LATER (needs history/scale)

11. **Risk prediction on builds/campaigns** (Wrike Work Intelligence is the
    reference: enumerable factors, emailed digests, low/med/high).
12. **Composite client-health score** (unit economics + payment behavior +
    scope discipline + sentiment) — no work-management incumbent has shipped
    this; it pairs our HubSpot health/intent pull with Kantata actuals.
13. **Meeting notetaker → tasks** — rides the Teams shell (M3), not before.

### Anti-patterns to keep refusing (documented failures)

- Forcing AI on (Rovo backlash) — keep observer/opt-in.
- Opaque AI metering that silently stops workflows (Asana AI Studio credits).
- AI edits applied before approval (Notion 3.0 security fallout).
- Autonomy as the whole product (Height.app shut down Sept 2025).
- Feature-everything UI (ClickUp "slow, noisy, 2-4 weeks to onboard") —
  the two-surface cut was the right call.

## 4. Where each claim comes from

Agent A (platforms): Teamwork client users/proofs, Basecamp Clientside,
Productive portal+Pulse, Wrike guest reviewers, Notion guest patterns,
Function Point intake, Asana guests, monday/ClickUp/Scoro pricing, G2
abandonment themes, Kantata G2 gap.
Agent B (AI features): Asana Smart Status/AI Studio/AI Teammates, ClickUp
Brain/Autopilot/Notetaker, monday magic/sidekick/AI Blocks, Rovo, Microsoft
Planner PM Agent, Notion 3.0 agents + meeting notes, Wrike risk prediction,
Motion, Linear agents, Teamwork AI, Height shutdown, ChurnZero health-score
trend.
Agent C (portals): Moxo, CloudRadial, Noloco, Customer-Portals.com,
DigitalSage, AgencyHandy, Ziflow, Filestage, ProofHub, AgencyAnalytics,
Databox, Collect, Microsoft Entra access reviews/B2B, CauseVox, Bloomerang,
Boardable, Fundraise Up.
Agent D (AI UX): Microsoft HAX Toolkit + Copilot ISV guidance, Anthropic
"Building Effective Agents", OpenAI "Practical Guide to Building Agents",
Google PAIR Guidebook, NN/g (explainable AI, accordion/apple-picking,
chatbot dimensions, prompt suggestions), CHI 2025 proactive-AI studies,
AI-teammate commitment-deficit literature, AI-summary trust research.
