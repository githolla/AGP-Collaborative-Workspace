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

export function campaignsFromMirror(mirror: AgpMirror, clientName: string, today: string): ImportedCampaign[] {
  const client = mirror.clients.find((c) => normName(c.name) === normName(clientName));
  const canonical = client?.name ?? clientName;
  const belongs = projectMatcher(mirror, canonical, client?.abbreviation);

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

export interface LiveProject {
  title: string;
  status?: string;
  startDate?: string;
  dueDate?: string;
  clientGroup?: string;
  /** Every milestone Kantata has for this project, date-sorted. */
  milestones: LiveMilestone[];
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
}

export interface AccountLiveContext {
  /** Missing = no HubSpot company matched the workspace name. */
  crm?: AccountCrmRecord;
  projects: LiveProject[];
  deals: LiveDeal[];
}

export function accountLiveContext(mirror: AgpMirror, clientName: string): AccountLiveContext {
  const client = mirror.clients.find((c) => normName(c.name) === normName(clientName));
  const canonical = client?.name ?? clientName;
  const belongs = projectMatcher(mirror, canonical, client?.abbreviation);

  const projects: LiveProject[] = mirror.projects.filter(belongs).map((p) => ({
    title: p.title,
    ...(p.status ? { status: p.status } : {}),
    ...(p.startDate ? { startDate: p.startDate } : {}),
    ...(p.dueDate ? { dueDate: p.dueDate } : {}),
    ...(p.clientGroup ? { clientGroup: p.clientGroup } : {}),
    milestones: mirror.milestones
      .filter((m) => m.projectId === p.id)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .map((m) => ({ title: m.title, dueDate: m.dueDate, state: m.state, ...(m.hard ? { hard: true } : {}) })),
  }));

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
      }
    : undefined;

  return { ...(crm ? { crm } : {}), projects, deals };
}
