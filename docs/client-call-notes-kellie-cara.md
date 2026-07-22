# Client call — collaboration requirements (Cara & Kellie)

Verbatim asks from the SPCA-of-Texas demo call, captured so nothing gets lost,
each mapped to where it stands in the product. "Built" = shipped in the app;
"Needs M365" = gated on the Microsoft 365 / SharePoint connection (see
`docs/adr/` and the M365 connection plan); "Planned" = designed, not yet built.

## 1. Files clients & contractors need to reference

> "At the bare minimum what we were hoping to do with this client space and the
> contractor space is be able to reference files that those two audiences want
> to interact with. Right now, the strategy doc is a very important document
> that kind of governs the entire engagement — that is a client-facing
> document." — Cara

> "What I think will be tricky about these spaces, honestly, is the SharePoint
> permissions… SharePoint's pretty locked down, but there are project files we
> do need to share with clients and contractors, and I'm hoping this is where
> we can do it." — Cara

- **Built:** Files tab links documents (incl. the standard core docs — Project
  Brief & Strategy is one), each attachable to a SharePoint/OneDrive URL and
  shareable per access level (client / contractor, full / files-only /
  tasks-only) on the Access tab.
- **Needs M365:** live editable access to a *specific* document without
  granting the whole SharePoint folder — the hard part Cara & Kellie flagged.
  This is per-document sharing + edit tracking via Graph, gated on the Entra
  connection. It is the single most important open item (kills the extranets).

## 2. Contractors editing live documents (kill the extranets)

> "Our copywriter needs to edit the live document… if internally someone makes
> changes while the copywriter has it downloaded, we lose them. That's why we
> moved to contractor extranet sites — we couldn't have contractors in our
> SharePoint folders because that gave them access to everything in the client
> folder. Is there a way to give them live, editable access to documents inside
> our internal SharePoint folders without giving access to the entire folder?"
> — Kellie

- **Needs M365:** yes — this is the target outcome. Per-document permission +
  co-authoring + an edit/audit trail, so a contractor edits one live doc and
  changes reconcile back to SharePoint. The extranets go away. Jaden/Ren scope.

## 3. Reminders / nudges on client deliverables

> "If I said feedback is due in a week, are there drips that push them if they
> haven't opened a document? Right now everything is email, the deadline is in
> the subject line and body, and follow-up is a manual step — some PMs are
> better than others." — Kellie / Josh

- **Built:** a **Remind** action on each client deliverable (Client Dashboard)
  queues a reminder now, logged to the feed; per-person Teams/email preference
  on the Access tab.
- **Needs M365:** the *automatic* nudge — "the system knows it hasn't been
  opened, due date is X, nudge them" — needs the SharePoint read-receipt /
  open-tracking signal. Designed; waiting on the connection.

## 4. Templated phase-transition handoffs

> "There's a lot of templatized emails my team sends — when a job moves from one
> phase to another. E.g. 'ready for copywriting' has a specific subject line,
> and the body includes a link to the copy-document framework, the strategy
> document, and the assets folder. Could the tool create a template that says
> 'here are the things you need to include'?" — Kellie

- **Built:** **Send a handoff** in Discussions — Ready for copywriting / design
  / client review / production — each pre-fills the message *and* an
  "attach these" checklist (copy framework, strategy doc, assets folder), then
  posts to the chosen project thread. Josh's "milestone hit → here's the email
  template to copy, adjust, and send" is exactly this.
- **Planned polish:** fire the handoff automatically when a milestone is hit
  (needs the milestone-trigger + notification wiring).

## 5. Discussions tied to each project / task / file (not one big client thread)

> "SPCA has ~20 projects going at any point. How do I not confuse people about
> which project I'm talking about? If an issue happens and we need to go back
> and look at all the conversations, what does that history look like, and how
> does someone find 'I know I saw someone say something somewhere'?" — Kellie

> "It's tied to each project — here's the communication around that project. And
> you can see all communications, but also detail down: here's around task
> conversations, here's around file conversations, here's around client
> conversations, here's Kellie's notes." — Josh

- **Built:** discussions are **scoped by topic** — a project, a task, a file, or
  General — and every message carries its topic chip.
  - **Collaborate on a task:** "Raise with team" from a task's detail files the
    note under that task.
  - **Collaborate on a file:** "💬 Discuss" on any file/doc files the note under
    that document.
  - **Collaborate on a project:** the composer's topic picker + the per-project
    filter chips.
  - **History, sliced the way Josh described:** filter by **kind** (Projects /
    Tasks / Files / General), by **project**, by **person** (author), by
    **timeframe** (7/30/90 days), plus free-text **search** across every past
    message. Each message shows a kind icon (🗂 project · ✅ task · 📄 file ·
    💬 general) so you can tell at a glance what a conversation is about.
- **Global "Discuss" button:** reachable from anywhere — pick the client, the
  project/topic, the people to include (they're @mentioned and notified, and
  can be quick-added if not yet on the account), post, and it logs.
- **Undecided (pilot):** whether the default scope is task-level, phase-level,
  or project-level. Per Kellie/Suuchi: pilot at the task level, watch real
  usage, then adjust — the model supports all three interchangeably, so no
  rebuild is needed to change the default.

## 6. Client status view — curated, not the full peek behind the curtain

> "Can we limit the tasks they see? They don't need the full peek behind the
> curtain — that was a complaint about Kantata's client view. They want to see
> when copy comes their way, when feedback is due, when designs land." — Kellie

> "Maybe flag it as a *deliverable* task-type instead of a task, and those get
> pulled into the client space." — Cara / Kellie

- **Built:** mark any task **"→ client"** on the Project Plan; the Client
  Dashboard shows only those, as a dated deliverable timeline. Kellie to send
  her job-tracker template + the show/don't-show list to set the defaults.

---

### The three surfaces (confirmed on the call)

Kantata (system of record) · **Task & Resource Allocation** (capacity planning)
· **Collaboration Workspace** (this app). Collaboration stays a **separate
application** — the team explicitly chose this so it can run its own adoption
path while Task & Resource Allocation runs its own. All three anchor on Kantata.
