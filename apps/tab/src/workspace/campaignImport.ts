import type { AgpMirror } from "./agpKnowledge.js";

/**
 * Campaign derivation from the live mirror — the bridge from Kantata &
 * HubSpot into Cara's client workspace. Pure so create-and-sync share one
 * behavior and it's testable:
 *
 * - Every Kantata project matching the client becomes an ACTIVE campaign
 *   carrying its nearest upcoming milestone (real title + date) — that's
 *   what fills "Upcoming milestones" on her Home and the dashboard table.
 *   Fallback when a project has no upcoming milestone: its due date.
 * - HubSpot deals become active (won) or planned (open) campaigns; open
 *   deals carry their close date as the next milestone. Lost deals skipped.
 * - Deduped by name — the Kantata project wins over the deal that sold it,
 *   because the project is where delivery dates live.
 */

export interface ImportedCampaign {
  name: string;
  status: "active" | "planned" | "complete";
  nextMilestone?: string;
  nextMilestoneDate?: string;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Corporate filler + sector-generic words that must never drive a match:
 * at an agency serving many food banks and universities, "food", "bank",
 * "university", "direct", "mail" appear in EVERYONE's titles. Live data
 * proved this ("CDW Direct" claiming the whole Direct Mail category). */
const NON_MATCH_WORDS = new Set([
  "the", "of", "and", "for", "inc", "llc", "corp", "org", "assn", "co",
  "foundation", "association", "society", "group", "groups", "fund", "trust",
  "university", "college", "athletics", "direct", "mail", "mailing",
  "marketing", "agency", "media", "digital", "partners", "service", "services",
  "resources", "international", "national", "company", "institute",
  "ministries", "ministry", "health", "hospital", "medical", "community",
  "center", "centre", "church", "charity", "charities", "food", "bank",
  "banks", "more",
]);

const significantWords = (name: string): string[] =>
  name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !NON_MATCH_WORDS.has(w));

/** ALL-CAPS tokens like "KPBX", "ARMS", "UPS" — near-unique identifiers. */
const distinctiveTokens = (name: string): string[] =>
  name.split(/[^A-Za-z0-9]+/).filter((w) => w.length >= 3 && w === w.toUpperCase() && /[A-Z]/.test(w)).map((w) => w.toLowerCase());

/**
 * Token-boundary containment. Hyphens deliberately do NOT count as
 * boundaries so "UPS" can't match inside "sign-ups"; "ARMS:" and "(ARMS)"
 * do match — AGP's live convention prefixes titles with the client
 * abbreviation ("ARMS: Support 25-26", "PATNC: Ongoing Support").
 */
const containsToken = (text: string, token: string): boolean =>
  new RegExp(`(^|[^A-Za-z0-9-])${escapeRe(token)}([^A-Za-z0-9-]|$)`, "i").test(text);

/**
 * Does a Kantata project title belong to this client? Strongest first:
 * 1. HubSpot client abbreviation as a bounded token (the live convention).
 * 2. The full client name appearing in the title.
 * 3. An ALL-CAPS identifier token from the name, bounded.
 * 4. Distinctive name words — two or more, or exactly one when the name
 *    only HAS one (≥5 chars). Sector-generic words never count.
 * Live-data lesson: without the boundaries and the generic-word guard,
 * "CDW Direct" matched 147 unrelated projects.
 */
function projectBelongsToClient(title: string, clientName: string, abbreviation?: string): boolean {
  const abbr = abbreviation?.trim();
  if (abbr && abbr.length >= 2 && containsToken(title, abbr)) return true;
  if (title.toLowerCase().includes(clientName.toLowerCase())) return true;
  if (distinctiveTokens(clientName).some((tok) => containsToken(title, tok))) return true;
  const words = significantWords(clientName);
  const hits = words.filter((w) => containsToken(title, w)).length;
  return words.length === 1 ? hits === 1 && (words[0]?.length ?? 0) >= 5 : hits >= 2;
}

/** Loose equality for the group↔company join: case/punctuation-insensitive. */
const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Legal-entity suffixes pollute a client name: a Kantata group's company
 * field reads "American Water Works Company, Inc." while its project titles
 * say "American Water Works" or "AWW:". Strip the suffix so the initialism
 * and name comparisons run on the real name — otherwise the acronym comes
 * out "AWWCI" (counting Company + Inc) and lines up with nothing.
 */
const CORP_SUFFIX = /[\s,]+(?:inc|incorporated|llc|llp|lp|ltd|limited|corp|corporation|co|company|plc|pllc)\.?$/i;
export function stripCorpSuffix(name: string): string {
  let n = name.trim();
  for (let i = 0; i < 4; i += 1) {
    const next = n.replace(CORP_SUFFIX, "").trim();
    if (next === n || next.length === 0) break; // never strip to empty
    n = next;
  }
  return n;
}

/** "Syracuse University Athletics" → "SUA"; "American Water Works Company,
 * Inc." → "AWW" (legal suffix + connector words skipped). */
const SMALL_WORDS = new Set(["of", "the", "at", "and", "a", "an", "for", "in"]);
export function initialism(name: string): string {
  const words = stripCorpSuffix(name)
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w.length > 0 && !SMALL_WORDS.has(w.toLowerCase()));
  if (words.length < 2) return "";
  return words.map((w) => w[0]!.toUpperCase()).join("");
}

/** Auto-abbreviation for a Kantata client that carries no explicit one: its
 * clean acronym, but ONLY when it's a distinctive 3–6 letters. Two letters
 * ("GM") would over-match; this stays bounded (containsToken) at the match
 * site, so it can't fire inside unrelated words. */
export function autoAbbreviation(name: string): string | undefined {
  const init = initialism(name);
  return init.length >= 3 && init.length <= 6 ? init : undefined;
}

/**
 * Find a directory client for a workspace name. Kantata's derived directory
 * often speaks in abbreviations ("SUA") while workspaces carry full names
 * ("Syracuse University Athletics") — the initialism bridges them, both
 * ways. Exact (normalized) match always wins.
 */
function findDirectoryClient(mirror: AgpMirror, name: string): AgpMirror["clients"][number] | undefined {
  const n = normName(name);
  const exact = mirror.clients.find((c) => normName(c.name) === n);
  if (exact) return exact;
  const init = initialism(name).toLowerCase();
  if (init.length >= 2) {
    const viaInitials = mirror.clients.find(
      (c) => normName(c.name) === init || c.abbreviation?.trim().toLowerCase() === init,
    );
    if (viaInitials) return viaInitials;
  }
  // Reverse: the workspace name IS an abbreviation of a directory client.
  if (n.length >= 2 && n.length <= 8 && !n.includes(" ")) {
    const reverse = mirror.clients.find((c) => initialism(c.name).toLowerCase() === n);
    if (reverse) return reverse;
  }
  return undefined;
}

/**
 * A group strictly belongs to a client when it IS the client name, contains
 * the full client name, or equals the client's abbreviation. Never the
 * reverse — live data showed AGP's groups can be CATEGORIES ("Direct Mail"),
 * and letting "CDW Direct" claim the "Direct" category imported 147 wrong
 * projects into one workspace.
 */
function groupOwnedBy(group: string, clientName: string, abbreviation?: string): boolean {
  const g = normName(group);
  const n = normName(clientName);
  if (g.length === 0) return false;
  if (g === n || g.includes(n)) return true;
  const abbr = abbreviation?.trim();
  return !!abbr && abbr.length >= 2 && g === normName(abbr);
}

/** Per-mirror memo: which client (if any) strictly owns each project's group. */
const ownerCache = new WeakMap<AgpMirror, Map<string, string | null>>();
function groupOwners(mirror: AgpMirror): Map<string, string | null> {
  const cached = ownerCache.get(mirror);
  if (cached) return cached;
  const owners = new Map<string, string | null>();
  for (const p of mirror.projects) {
    if (!p.clientGroup) {
      owners.set(p.id, null);
      continue;
    }
    const matches = mirror.clients.filter((c) => groupOwnedBy(p.clientGroup!, c.name, c.abbreviation));
    // Exactly one owner = trustworthy; zero or ambiguous = category group.
    owners.set(p.id, matches.length === 1 ? matches[0]!.name : null);
  }
  ownerCache.set(mirror, owners);
  return owners;
}

/**
 * One matcher for both consumers: campaigns (import) and live context
 * (display). Owner join first, title evidence only for category groups.
 */
function projectMatcher(mirror: AgpMirror, clientName: string, abbreviation?: string) {
  const owners = groupOwners(mirror);
  return (p: (typeof mirror.projects)[number]): boolean => {
    const owner = p.clientGroup ? owners.get(p.id) ?? null : null;
    if (owner === clientName) return true; // exact join
    if (owner !== null) return false; // strictly someone else's
    // Category/no group → title evidence decides.
    return projectBelongsToClient(p.title, clientName, abbreviation);
  };
}

export function campaignsFromMirror(
  mirror: AgpMirror,
  clientName: string,
  today: string,
  linkedProjectIds?: readonly string[],
  /** Scoped: import only from the linked projects. */
  scoped?: boolean,
): ImportedCampaign[] {
  const client = findDirectoryClient(mirror, clientName);
  const canonical = client?.name ?? clientName;
  const linked = new Set(linkedProjectIds ?? []);
  const scopeOnly = scoped === true && linked.size > 0;
  const matcherBelongs = projectMatcher(mirror, canonical, client?.abbreviation);
  // A human-linked project ALWAYS belongs — links beat heuristics. When the
  // workspace is scoped, the links are the whole story.
  const belongs = (p: (typeof mirror.projects)[number]): boolean =>
    scopeOnly ? linked.has(p.id) : linked.has(p.id) || matcherBelongs(p);

  const fromProjects: ImportedCampaign[] = mirror.projects
    .filter(belongs)
    .map((p) => {
      const upcoming = mirror.milestones
        .filter((m) => m.projectId === p.id && m.state !== "completed" && m.dueDate >= today)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
      const milestone = upcoming
        ? { nextMilestone: upcoming.title, nextMilestoneDate: upcoming.dueDate }
        : p.dueDate && p.dueDate >= today
          ? { nextMilestone: "Delivery due", nextMilestoneDate: p.dueDate }
          : {};
      return {
        // Kantata titles often lead with the client name — trim it.
        name: p.title.replace(new RegExp(`^${escapeRe(canonical)}\\s*[—-]\\s*`, "i"), ""),
        status: "active" as const,
        ...milestone,
      };
    });

  const fromDeals: ImportedCampaign[] = mirror.campaigns
    .filter((c) => c.kind === "deal" && normName(c.clientName) === normName(canonical) && c.stage !== "closedlost")
    .map((c) => ({
      name: c.title,
      status: c.stage === "closedwon" ? ("active" as const) : ("planned" as const),
      ...(c.stage !== "closedwon" && c.closeDate && c.closeDate >= today
        ? { nextMilestone: "Close date", nextMilestoneDate: c.closeDate.slice(0, 10) }
        : {}),
    }));

  return [...fromProjects, ...fromDeals].filter(
    (c, i, all) => all.findIndex((x) => x.name.toLowerCase() === c.name.toLowerCase()) === i,
  );
}

// ---------------------------------------------------------------------------
// Live context — everything the mirror knows about ONE client, as plain data.
// The workspace renders it; computing it here keeps the guest import graph
// clean (the component receives props, never touches the mirror itself).
// ---------------------------------------------------------------------------

export interface LiveMilestone {
  title: string;
  dueDate: string;
  state: string;
  hard?: boolean;
}

/**
 * Build a task→project resolver for one Kantata workspace.
 *
 * At AGP a workspace is a fiscal-year contract and the FIRST level of stories
 * inside it are the real projects, with phases and tasks nested under them via
 * each story's parent id. Tenants file that first level two ways: some as a
 * Kantata "milestone" story, some as an ordinary parent task/deliverable. This
 * resolver handles both, so we don't depend on a single Kantata convention:
 *
 *   - Walk up the parent chain from the task.
 *   - If a MILESTONE is found on the way up, that's the project (nearest wins).
 *   - Otherwise the TOP-MOST ancestor within the workspace is the project —
 *     the first-level story the task ultimately hangs under.
 *
 * A task with no ancestor in the set (filed straight under the workspace) has
 * no project and stays ungrouped, rather than being forced under a wrong label.
 */
export function milestoneResolver(
  milestones: readonly { id: string; title: string; parentId?: string }[],
  tasks: readonly { id: string; parentId?: string; title?: string }[],
): (taskId: string) => { id: string; title: string } | undefined {
  const milestoneIds = new Set(milestones.map((m) => m.id));
  const titleById = new Map<string, string>();
  const parentOf = new Map<string, string | undefined>();
  for (const m of milestones) {
    titleById.set(m.id, m.title);
    parentOf.set(m.id, m.parentId);
  }
  // Tasks after milestones so a real title always wins if an id somehow appears
  // in both buckets.
  for (const t of tasks) {
    if (t.title) titleById.set(t.id, t.title);
    parentOf.set(t.id, t.parentId);
  }

  const cache = new Map<string, { id: string; title: string } | undefined>();
  return (taskId: string) => {
    if (cache.has(taskId)) return cache.get(taskId);
    const seen = new Set<string>();
    let nearestMilestone: string | undefined;
    let topMost: string | undefined;
    // Only climb through ancestors that are actually stories in this workspace;
    // a parent id pointing outside the set (or absent) means we've reached the
    // top. Bounded by `seen` so a malformed cycle can't loop forever.
    let cur: string | undefined = parentOf.get(taskId);
    while (cur && parentOf.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      if (nearestMilestone === undefined && milestoneIds.has(cur)) nearestMilestone = cur;
      topMost = cur;
      cur = parentOf.get(cur);
    }
    const pick = nearestMilestone ?? topMost;
    const result = pick && titleById.has(pick) ? { id: pick, title: titleById.get(pick)! } : undefined;
    cache.set(taskId, result);
    return result;
  };
}

export interface LiveTask {
  /**
   * Kantata story id. Carried so an imported task can be written BACK —
   * `PUT /stories/{id}` needs it, and without it the only write available is
   * `POST /stories`, which would duplicate work Kantata already has.
   */
  id: string;
  /** Kantata workspace id the story lives in — needed to create siblings. */
  projectId: string;
  title: string;
  state: string;
  dueDate?: string;
  /**
   * The milestone (real project) this task hangs under, resolved by walking
   * the Kantata parent chain. At AGP a workspace is a fiscal-year contract and
   * its milestones are the projects, so this is the label that tells a viewer
   * WHICH project a task belongs to — the thing Kellie's team needs.
   */
  milestoneId?: string;
  projectLabel?: string;
  /** Kantata owner(s) — who's accountable for the work. */
  assignees?: string[];
  percent?: number;
}

/** A Kantata post surfaced in the workspace — the project conversation. */
export interface LivePost {
  message: string;
  author: string;
  createdAt: string;
}

/**
 * Kantata story states vary by tenant and version — "started" / "not started"
 * / "completed" / "accepted" / "in progress". Classify TOLERANTLY (substring,
 * case-insensitive) so a finished task never imports as open, and an active
 * one never lands in the wrong column, over a hyphen or a synonym. Same
 * fragile-exact-enum class as the story_type=task pull bug.
 */
export const taskIsDone = (state: string): boolean => /complet|accepted|closed|finished|done/i.test(state);
export const taskColumn = (state: string): "doing" | "todo" => {
  const s = state.toLowerCase();
  // "not started" / "not yet started" contains "start" — negation wins.
  if (/\bnot\b/.test(s)) return "todo";
  return /start|progress|active|doing|wip/.test(s) ? "doing" : "todo";
};

export interface LiveProject {
  /** Kantata workspace id — the key the focus deepen pulls by. */
  id: string;
  title: string;
  status?: string;
  startDate?: string;
  dueDate?: string;
  clientGroup?: string;
  /** Every milestone Kantata has for this project, date-sorted. */
  milestones: LiveMilestone[];
  /** Kantata task tree for this project (open + done). */
  tasks: LiveTask[];
  /** Real delivery team — Kantata participants. */
  team?: string[];
  /** Time logged, minutes (rates never pulled). */
  minutes30d?: number;
  minutesRecent?: number;
  lastEntryDate?: string;
  people30d?: number;
}

export interface LiveDeal {
  title: string;
  stage: string;
  won: boolean;
  closeDate?: string;
}

/** The HubSpot company record fields we pull (internal surfaces only). */
export interface AccountCrmRecord {
  name: string;
  vertical?: string;
  abbreviation?: string;
  lifecycleStage?: string;
  healthIndex?: string;
  renewal?: string;
  gdnaLevel?: string;
  intentSummary?: string;
  intentCount30d?: number;
  owner?: string;
  lastTouch?: string;
  nextActivity?: string;
  touches?: number;
  icpTier?: string;
  targetAccount?: boolean;
}

export interface AccountLiveContext {
  /** Missing = no directory client matched the workspace name. */
  crm?: AccountCrmRecord;
  projects: LiveProject[];
  deals: LiveDeal[];
  /** The project conversation — recent Kantata posts for this client's work. */
  posts: LivePost[];
  /** What the whole mirror holds — so a zero-match workspace can show the
   * denominator ("422 projects pulled, 0 matched") instead of a bare blank. */
  book: { clients: number; projects: number; milestones: number; tasks: number; deals: number };
  /** EVERY live project, minimal — the Project Finder searches this so a
   * human can hand-link work no naming convention could find. */
  searchable: { id: string; title: string; dueDate?: string; clientGroup?: string }[];
}

export function accountLiveContext(
  mirror: AgpMirror,
  clientName: string,
  linkedProjectIds?: readonly string[],
  /** Scoped: the workspace is ONLY the linked projects, not the whole client. */
  scoped?: boolean,
): AccountLiveContext {
  const client = findDirectoryClient(mirror, clientName);
  const canonical = client?.name ?? clientName;
  const linked = new Set(linkedProjectIds ?? []);
  const matcherBelongs = projectMatcher(mirror, canonical, client?.abbreviation);
  // A scoped workspace ignores name matching entirely: two projects under one
  // client can have completely different teams, and folding them together is
  // what Cara flagged as wrong. An empty selection can't scope to nothing —
  // that would silently empty the workspace — so it falls back to the client.
  const scopeOnly = scoped === true && linked.size > 0;
  const belongs = (p: (typeof mirror.projects)[number]): boolean =>
    scopeOnly ? linked.has(p.id) : linked.has(p.id) || matcherBelongs(p);

  const projects: LiveProject[] = mirror.projects.filter(belongs).map((p) => {
    const projMilestones = mirror.milestones.filter((m) => m.projectId === p.id);
    const projTasks = (mirror.tasks ?? []).filter((t) => t.projectId === p.id);
    // Resolve which milestone each task belongs to by walking the parent chain
    // (milestone → task → sub-task). Precomputed once per project so the
    // per-task lookup is O(depth), not O(tasks).
    const resolveMilestone = milestoneResolver(projMilestones, projTasks);
    return {
    id: p.id,
    title: p.title,
    ...(p.status ? { status: p.status } : {}),
    ...(p.startDate ? { startDate: p.startDate } : {}),
    ...(p.dueDate ? { dueDate: p.dueDate } : {}),
    ...(p.clientGroup ? { clientGroup: p.clientGroup } : {}),
    milestones: projMilestones
      .slice()
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .map((m) => ({ title: m.title, dueDate: m.dueDate, state: m.state, ...(m.hard ? { hard: true } : {}) })),
    tasks: projTasks.map((t) => {
      const ms = resolveMilestone(t.id);
      return {
        id: t.id,
        projectId: t.projectId,
        title: t.title,
        state: t.state,
        ...(ms ? { milestoneId: ms.id, projectLabel: ms.title } : {}),
        ...(t.dueDate ? { dueDate: t.dueDate } : {}),
        ...(t.assignees && t.assignees.length > 0 ? { assignees: t.assignees } : {}),
        ...(t.percent != null ? { percent: t.percent } : {}),
      };
    }),
    ...(p.team && p.team.length > 0 ? { team: p.team } : {}),
    ...(p.minutes30d != null ? { minutes30d: p.minutes30d } : {}),
    ...(p.minutesRecent != null ? { minutesRecent: p.minutesRecent } : {}),
    ...(p.lastEntryDate ? { lastEntryDate: p.lastEntryDate } : {}),
    ...(p.people30d != null ? { people30d: p.people30d } : {}),
    };
  });

  const deals: LiveDeal[] = mirror.campaigns
    .filter((c) => c.kind === "deal" && normName(c.clientName) === normName(canonical) && c.stage !== "closedlost")
    .map((c) => ({
      title: c.title,
      stage: c.stage,
      won: c.stage === "closedwon",
      ...(c.closeDate ? { closeDate: c.closeDate.slice(0, 10) } : {}),
    }));

  const crm: AccountCrmRecord | undefined = client
    ? {
        name: client.name,
        ...(client.vertical ? { vertical: client.vertical } : {}),
        ...(client.abbreviation ? { abbreviation: client.abbreviation } : {}),
        ...(client.lifecycleStage ? { lifecycleStage: client.lifecycleStage } : {}),
        ...(client.healthIndex ? { healthIndex: client.healthIndex } : {}),
        ...(client.renewal ? { renewal: client.renewal.slice(0, 10) } : {}),
        ...(client.gdnaLevel ? { gdnaLevel: client.gdnaLevel } : {}),
        ...(client.intentSummary ? { intentSummary: client.intentSummary } : {}),
        ...(client.intentCount30d != null ? { intentCount30d: client.intentCount30d } : {}),
        ...(client.owner ? { owner: client.owner } : {}),
        ...(client.lastTouch ? { lastTouch: client.lastTouch.slice(0, 10) } : {}),
        ...(client.nextActivity ? { nextActivity: client.nextActivity.slice(0, 10) } : {}),
        ...(client.touches != null ? { touches: client.touches } : {}),
        ...(client.icpTier ? { icpTier: client.icpTier } : {}),
        ...(client.targetAccount ? { targetAccount: true } : {}),
      }
    : undefined;

  // The project conversation for this client's matched projects, newest first.
  const projectIds = new Set(projects.map((p) => p.id));
  const posts: LivePost[] = (mirror.posts ?? [])
    .filter((post) => projectIds.has(post.projectId) && post.message.trim().length > 0)
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    .slice(0, 50)
    .map((post) => ({ message: post.message, author: post.author, createdAt: post.createdAt }));

  return {
    ...(crm ? { crm } : {}),
    projects,
    deals,
    posts,
    book: {
      clients: mirror.clients.length,
      projects: mirror.projects.length,
      milestones: mirror.milestones.length,
      tasks: (mirror.tasks ?? []).length,
      deals: mirror.campaigns.filter((c) => c.kind === "deal").length,
    },
    searchable: mirror.projects.map((p) => ({
      id: p.id,
      title: p.title,
      ...(p.dueDate ? { dueDate: p.dueDate } : {}),
      ...(p.clientGroup ? { clientGroup: p.clientGroup } : {}),
    })),
  };
}

/**
 * "Gone quiet" (relationship): no future activity is booked AND the last
 * logged touch is 30+ days old (or missing entirely). CRM-activity signal —
 * internal surfaces only.
 */
export function crmGoneQuiet(crm: AccountCrmRecord | undefined, today: string): boolean {
  if (!crm) return false;
  if (crm.nextActivity && crm.nextActivity >= today) return false;
  const cutoff = new Date(new Date(`${today}T00:00:00Z`).getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  return !crm.lastTouch || crm.lastTouch < cutoff;
}

/** Is this workspace name an actual client in the (live) book? Full names
 * bridge to abbreviation-style directory entries via initialism. */
export function isInBook(mirror: AgpMirror, name: string): boolean {
  return !!findDirectoryClient(mirror, name);
}

/**
 * Closest live clients to a workspace name that matched nothing — powers the
 * one-click "Link to …" rescue for demo-seeded or misspelled workspaces.
 * Scored by exact/containment first, then shared distinctive words (generic
 * sector words never count, same rule as matching).
 */
export function suggestClients(mirror: AgpMirror, name: string, limit = 3): string[] {
  const targetNorm = normName(name);
  const targetWords = new Set(significantWords(name));
  const targetTokens = new Set(distinctiveTokens(name));
  const targetInit = initialism(name).toLowerCase();
  return mirror.clients
    .map((c) => {
      const cNorm = normName(c.name);
      let score = 0;
      if (cNorm === targetNorm) score += 100;
      else if (cNorm.includes(targetNorm) || targetNorm.includes(cNorm)) score += 50;
      // Initialism bridge, both ways: "Syracuse University Athletics" ↔ "SUA".
      const abbr = c.abbreviation?.trim().toLowerCase();
      if (targetInit.length >= 2 && (cNorm === targetInit || abbr === targetInit)) score += 60;
      if (initialism(c.name).toLowerCase() === targetNorm && targetNorm.length >= 2) score += 60;
      score += significantWords(c.name).filter((w) => targetWords.has(w)).length * 10;
      score += distinctiveTokens(c.name).filter((t) => targetTokens.has(t)).length * 15;
      if (abbr && (targetTokens.has(abbr) || targetWords.has(abbr))) score += 25;
      return { name: c.name, score };
    })
    .filter((s) => s.score >= 10)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((s) => s.name);
}

/**
 * "Delivery quiet": Kantata projects exist and hours data was pulled, but
 * nobody has logged time in 30 days — work sold but not moving.
 */
export function deliveryQuiet(projects: LiveProject[]): boolean {
  const withHours = projects.filter((p) => p.minutesRecent != null || p.minutes30d != null);
  if (withHours.length === 0) return false;
  return withHours.every((p) => (p.minutes30d ?? 0) === 0);
}
