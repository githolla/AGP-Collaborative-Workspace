# Decision memo — the file model, and what the storage layer becomes

**Decided.** Both are now reflected in `docs/teams-provisioning-plan.md`; this memo
keeps the options and reasoning.

| Decision | Outcome |
|---|---|
| 1 — where the file list comes from | **Option A** — read the SharePoint folder. No app-side file inventory |
| 1a — internal upload | **In scope**, delegated as the signed-in PM (plan B5a) |
| 2 — storage | **Option B** — Supabase Postgres, with row-level security enforced via the caller's JWT |
| 2a — `jsonb` | Real columns for the collaboration model and anything a policy reads; `jsonb` only for open shapes no access decision touches — the ROI side, per-row extras |

Two decisions block the external-access build (`docs/teams-provisioning-plan.md`,
B6 and B7).

---

## Decision 1 — Where does the file list come from?

**The question in one sentence:** when someone opens "Files" on a milestone, is
that list read live from the SharePoint folder, or is it a list AGP maintains
inside the app?

### Where we are

The app's file model is a hand-typed row: a name, and a link that is usually
empty. `addAccountLink(id, name, kind, url?)` is the only way one is created, and
there is no upload anywhere in the app. So today "Files" is a list of names, mostly
pointing at nothing.

### The three options

**Option A — read the folder.**
The list is whatever is sitting in that milestone's SharePoint folder right now.

- A PM drops a file in the folder and the contractor has it. Nothing to remember.
- Access is decided **once**, when you grant the milestone.
- The flip side: everything in that folder is visible to whoever holds the
  milestone. If it shouldn't be shared, it shouldn't be in there.

**Option B — maintain a list.**
Every file that an external should see is added to an app-side list, one at a time.

- Precise: you choose file by file.
- Someone has to do it, every time, forever. And when they forget, the contractor
  simply doesn't have the file — and nobody finds out until it's late.
- It also fights the model you already chose: a milestone grant is supposed to
  cover work added later. This makes every new file a separate decision.

**Option C — read the folder, and keep records only where they're needed.**
The list comes from the folder (exactly like A). The app additionally keeps a row
for documents that need to be *tracked* rather than merely shared — anything sent
for client approval, which has to know which document it's asking about.

- Access behaves like A: grant the milestone, done.
- Approvals keep working, because an approval names a specific document.

### Decided: Option A

B's per-file control sounds safer and isn't — its failure mode is silent, and it
contradicts a milestone grant that is supposed to cover work added later. C's only
advantage over A was giving approvals a document to point at, and that is had more
simply: **an approval keys on the SharePoint item id**, which internal upload
returns anyway. No second file model is needed.

What changes in the code:

- The Files view — internal and external — is a Graph listing of the milestone
  folder.
- `ClientFileLink` and its `contractorAccessible` / `contractorWritable` flags are
  removed, along with `contractorFiles()` and `contractorUploadTargets()` in
  `contractorScope.ts`, and the `addAccountLink` flow that created the rows.
- `clientApproval.ts` is unchanged except that a `ClientShare` names an item id.
- `contractorTasks()`, `Task.contractorVisible` and `Task.clientVisible` are
  untouched — tasks are app data, not files.

### Internal upload — in scope

Internal staff upload documents through the app. It is the easier of the two upload
paths: it runs delegated as the signed-in PM, needs no app-only token, no site
grant, and no permission check beyond what that person already has in SharePoint.

It also fixes the Files tab, which is currently a list of names with no files
behind them. Uploading from the app puts the file in the right milestone folder and
gives the app the item id — which is exactly what an approval request needs, so it
gets recorded without anyone typing a link.

`PUT /drives/{driveId}/items/{parentId}:/{name}:/content` for small files,
`createUploadSession` for large ones. Both delegated.

---

## Decision 2 — How the app stores and protects its data

**The question in one sentence:** the app currently keeps everything in a single
file that is rewritten on every save and handed out whole on every load — what
replaces it?

### Where we are

`/api/state` stores the entire workspace as one JSON document:
`{ initiatives, ideas, accounts, team, feedback }`.

- **Every load returns every client.** Filtering happens in the browser.
- **Every save rewrites the whole document.** Two people working on two different
  clients collide on the same version counter; the loser gets a 409 and adopts.
- **`team` contains password salts and hashes** — inside the document that is
  handed to any authorized caller.

The third one is a problem today, not only once externals can sign in. It has to
change under all three options.

### The three options

**Option A — keep the one document, cut it up on the server.**
The server opens the big document, takes out the part this person is allowed to
see, and sends only that.

- Fixes the "everyone gets everything" problem.
- Does **not** fix saving: it is still one document, so two people saving at once
  still collide, and it gets worse as more people (now including externals) arrive.
- To answer "can this contractor open this file?", the server has to load the
  entire company's data first. Every request pays for every client.
- Cheapest to build, and the least it buys.

**Option B — move everything into a proper database.**
Accounts, tasks, members, grants, shares all become database tables, and the
database enforces who can read what.

- The correct end state, and eventually where this goes.
- It is a rewrite of how the app reads and writes everything, all at once — and it
  fixes a schema for a data model that is still changing week to week. You would be
  writing database migrations for product changes.
- Most work, most risk, right answer at the wrong time.

**Option C — split it by what the data is for.**
Two stores, one rule: **anything that decides access goes in the database;
anything that is just content stays a document.**

- *Database:* who people are, their roles, which accounts they belong to, which
  milestones they've been granted, and the audit trail.
- *Documents:* the workspace content — but **one document per client** instead of
  one for everything.

What that gets you:

- "Can this contractor open this file?" is a single small lookup. No client's data
  is loaded to answer a question about another.
- Two PMs on two different clients stop colliding, because they're saving different
  documents.
- The content model can keep changing shape without a database migration every
  time — it's still JSON.
- Roles, grants and audit are queryable, which the admin screens need in order to
  answer "what does this vendor have access to, across everything?"

The cost: two stores to keep straight, and the discipline to hold the rule above.

### Decided: Option B, enforced by RLS through the caller's JWT

Enforcement in the database is the whole point, so every handler builds its Supabase
client from the caller's token and policies key on `auth.uid()`.
`SUPABASE_SERVICE_ROLE_KEY` **bypasses RLS**, so it leaves the request path
entirely: migrations and deliberate admin operations only. One policy set then
covers both audiences, since externals authenticate through Supabase Auth too.

On the schema-churn cost that made C tempting: **real columns for the collaboration
model** — accounts, tasks, members, externals, grants, shares, audit — because
anything a policy reads must be a column for the policy to see it. `jsonb` is
reserved for shapes that are genuinely open and that no access decision touches: the
ROI side (`initiatives`, `ideas`, their nested factors and snapshots) and per-row
extras. Used more widely it becomes the JSON document again with extra steps.

### How we get there

1. Create the schema and policies. Nothing reads them yet.
2. **Move identity to Supabase Auth and delete `team` from the document.** The
   password hashes are the most urgent thing to remove — do this first regardless
   of the rest.
3. Backfill accounts and their content into the tables, with the document still the
   source of truth meanwhile.
4. Switch reads to Postgres under RLS, then writes.
5. Delete the whole-document path and the storage bucket.

Each step ships on its own, and the app works between them.

---

## What these unblock

| Decision | Unblocks |
|---|---|
| 1 — file model | B7 external file access, C2's Files view, internal upload, the shape of the external payload |
| 2 — storage | All of B6, D1–D3 roles, D5 admin screens, and the grant model everything checks against |

Codeable now, independent of both: B2's data model and pure helpers,
`LiveMilestone.id`/`parentId`, and closing the three ungated surfaces.
