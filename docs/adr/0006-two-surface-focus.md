# ADR 0006 — Two surfaces: Cara's client workspace + the Sandbox

Date: 2026-07-20 · Status: accepted

## Context

After the draft-review + intake work, the app had four top-level sections
(Home, Clients, Builds, Sandbox). The user's verdict: "it's clunky. I think
we just need Cara's wireframe view of clients and the sandbox."

## Decision

Navigation is reduced to exactly two surfaces:

- **Clients** (default view) — the client-account execution workspace,
  exactly per Cara's wireframe. Unchanged.
- **Sandbox** — where anything starts: tap-to-fill intake, Copilot drafting,
  draft review, blank collaboration.

Removed: the Home landing page (needs-you list, jump-back-in) and the Builds
portfolio page. `HomePage.tsx`, `needsYou.ts`, and `Portfolio.tsx` are
deleted, not hidden.

**The ROI machinery stays.** Promoted ideas still open their full build
workspace (Numbers, Plan & Tasks, Discussion, zone pairing); it is reached
from the idea's "Open the build →" card and via search, not from a nav pill.
The `#i/<id>` route, the ROI engine, and the client-safety wall are untouched.

A small profile panel (avatar → change display name, localStorage-backed,
separate key so demo resets keep it) rides along; Teams SSO replaces it at M3.

## Consequences

- First open lands on Cara's world — the view she reviews.
- Fewer concepts for users; the buildable surface area shrinks to what the
  manager asked for plus the sandbox the user asked for.
- If a portfolio overview is wanted later, `computePortfolio` still exists in
  `@agp/roi`; only the page was deleted (recoverable from git history).
