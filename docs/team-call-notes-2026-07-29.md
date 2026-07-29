# Internal call — Ren / Josh / Suuchi / Jenna, 2026-07-29

Working notes from the Monday application review, kept because several
long-standing open questions in `what-agp-needs-to-connect.md` and `BLOCKERS.md`
were answered on this call. Only the items touching **this** app are recorded;
the lead-response and audience-intelligence threads are noted where they change
a decision here.

---

## 1. This workspace is the Teams-tab pilot

> "We want a Teams tab collaborative workspace — a way to get this system
> instead of having to go to the URL, it's actually a tab in Teams… We're
> starting with the collaborative workspace for this. It's kind of just a
> testing to see if this works." — Josh

> "The collaboration aspect of any of the other applications could also become
> a team room if that works out. So that'd be cool to test." — Suuchi

The motive is **adoption** — people get pinged and stay where they already work
instead of opening a URL. If it lands here, the collaboration layer of the other
apps follows the same pattern. That makes this app the proof, not just the first
implementation.

**Open — Ren cannot start without it (BLOCKERS #12):**

> "Do we know which team we wanted to add a tab to?" — Ren
> "I'll get you a list of exact users that we're going to test it to… that way
> we can just create the tabs in each of those." — Josh

Needed: 5–8 named people with AGP emails, and which Teams team/channel each tab
belongs to. Josh owns pulling the list.

**Our side (BLOCKERS #13):** the repo has no Teams app package yet — no
`manifest.json`, no icons, no `@microsoft/teams-js`, no `frame-ancestors`
header. About a day's work, needs nothing from AGP, should be built while the
admin approval sits in the queue.

**Cheaper than the doc implied:** round one needs no Entra work at all. Auth is
dormant, so a tab pointed at the deployed URL just loads. The only external
dependency is Jaden allowing custom app upload in Teams admin (1–3 weeks —
the longest pole on this path, BLOCKERS #6).

## 2. SharePoint — Ren has a precedent, and Jaden holds the keys

> "I probably need to work on the SharePoint integration… I did it for the
> proposal generator. So I'll probably need to know the site we're integrating
> and set up the permissions, the graph permissions, and all that. And that
> will need me and Jaden because he has the admin rights." — Ren

Ren will re-read the emails to confirm what was asked for, then get on a call
with Jaden — the same way he and Jesse walked through the proposal generator
setup. So the answer to "what exactly were you asking for for the permissions"
is §2d of `what-agp-needs-to-connect.md`: **`Sites.Selected`**, granted to the
specific client site(s) — which means naming the pilot client account also
settles which SharePoint site to scope.

## 3. Open/edit tracking — we can answer Josh's question

> "We also want to see when they opened them, when they edited them, track that
> type of stuff. I don't know if that's AI collaboration on our side, but also
> SharePoint features." — Josh
> "SharePoint tracks that, but within SharePoint. I don't know if it shares
> that information… I have no idea on that feature set." — Ren

Left unresolved on the call, and Josh said he'd go research it. **§2f already
answers it:** version history covers edits (on by default), and the **Microsoft
Purview unified audit log** records opens/views/downloads per user — that's the
signal behind the automatic "they haven't opened it, feedback is due" nudge.
Send Josh §2f rather than letting him redo the research.

## 4. Email — SendGrid, settled

> "We use SendGrid because we have a paid account with them for sending emails…
> We have it wired up with some other apps already. I can send you the API key
> — it takes about five minutes." — Ren
> "That's the way I have it wired up with the CPM. It worked fine to send out
> the emails directly from the application." — Suuchi

This closes the open choice in §3: **SendGrid, not `Mail.Send`** — which also
removes a round of Entra admin consent from the critical path. Ren attaches the
key at the application level and sets the reply-to address as an environment
variable, so we owe him that address.

## 5. Deploy workflow — confirmed unchanged

> "I'm able to test in Vercel, update code, and then push new code merges to
> AGP. Is that okay?" — Josh
> "Yeah, you should just be able to keep that workflow. As soon as it gets
> pushed into our branch, then it merges automatically." — Ren

Suuchi added that for smaller, stable changes she pushes straight to AGP and
leaves Vercel dormant — reasonable while user testing hasn't started.

## 6. Where the timeline sits

User testing is starting; the lead-response app was demoed to leadership the
same morning. Suuchi's framing: the applications that move leads and revenue
fastest go to users first. Nothing on this call changed what's built here — it
changed who owns which approval, and removed two items from the critical path.

---

### What changed in the repo as a result

- `BLOCKERS.md` — #6 gets the pilot context and Jaden/Ren as owners; #12 (pilot
  user list) and #13 (Teams app package) added; critical-path notes revised.
- `docs/what-agp-needs-to-connect.md` — §3 records the SendGrid decision; §6
  gains the round-one/round-two split.
