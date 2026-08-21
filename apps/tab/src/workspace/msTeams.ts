import type { AccountLiveContext, LiveMilestone } from "./campaignImport.js";
import type { ClientAccount, MsFolder } from "./types.js";

/**
 * Pure data-model helpers for Teams/SharePoint provisioning
 * (docs/teams-provisioning-plan.md B2–B4). No network, no Graph calls — this
 * module only computes the DESIRED folder tree from the Kantata mirror and
 * diffs it against what `ClientAccount.msTeam` already has. Provisioning
 * itself (msProvision.ts, B3) executes the diff this produces.
 */

/**
 * The shape of one planned folder, before it exists. `parentKantataId` is the
 * folder tree's own parent link — the folder ABOVE this one in
 * Documents/<project>/<milestone>/[<phase>/]<task> — which is NOT always the
 * same as the underlying Kantata story's own `parentId` (a task's Kantata
 * parent can be several stories up; its folder parent is the nearest
 * resolved milestone or phase, per LiveTask.milestoneId/phaseId).
 */
export interface PlannedFolder {
  /** Kantata id this folder stands for: a workspace id at "project" level,
   * a story id below. Stable identity — see MsFolder. */
  kantataId: string;
  /** Raw Kantata title, unsanitized. Pass through folderNameFor before use
   * as a real SharePoint name. */
  title: string;
  level: "project" | "milestone" | "phase" | "task";
  /** The kantataId of the immediate ancestor folder. Absent only at the
   * project level, which sits at the library root. */
  parentKantataId?: string;
}

/**
 * Every folder the account's Kantata projects call for — one project node
 * per `LiveProject`, one milestone node per top-level `LiveMilestone`, one
 * phase node per nested milestone, one task node per task that resolved to a
 * milestone or phase. A task with no resolvable milestone context is
 * omitted: there is nowhere sensible to file it until Kantata's own parent
 * chain says otherwise (campaignImport.ts's projectPhaseResolver already
 * declines to guess in that case, and this mirrors that choice).
 *
 * This is the DESIRED state. Whether each node already has a real folder is
 * a separate question — see `plannedProvisioning` and `milestoneFolderOptions`.
 */
export function folderTreeOf(liveCtx: Pick<AccountLiveContext, "projects">): PlannedFolder[] {
  const out: PlannedFolder[] = [];
  for (const p of liveCtx.projects) {
    out.push({ kantataId: p.id, title: p.title, level: "project" });

    const byId = new Map(p.milestones.map((m) => [m.id, m] as const));
    // For each milestone, climb its OWN parentId chain through other
    // milestones in this project to find its top-most milestone ancestor.
    // No ancestor = top-level (a "milestone" folder, its own kantataId).
    // Some ancestor = nested (a "phase" folder under that top-most one) —
    // any depth of nesting collapses to one phase level, the same choice
    // projectPhaseResolver makes for tasks.
    const topAncestorOf = new Map<string, string | undefined>();
    for (const m of p.milestones) {
      topAncestorOf.set(m.id, topMostMilestoneAncestor(m, byId));
    }
    for (const m of p.milestones) {
      const top = topAncestorOf.get(m.id);
      if (top === undefined) {
        out.push({ kantataId: m.id, title: m.title, level: "milestone", parentKantataId: p.id });
      } else {
        out.push({ kantataId: m.id, title: m.title, level: "phase", parentKantataId: top });
      }
    }

    for (const t of p.tasks) {
      const parent = t.phaseId ?? t.milestoneId;
      if (!parent) continue;
      out.push({ kantataId: t.id, title: t.title, level: "task", parentKantataId: parent });
    }
  }
  return out;
}

/** Walks `m`'s own `parentId` chain through `byId` (bounded, cycle-safe) and
 * returns the top-most milestone ancestor's id, or undefined if `m` has none
 * — i.e. `m` is itself top-level. */
function topMostMilestoneAncestor(m: LiveMilestone, byId: Map<string, LiveMilestone>): string | undefined {
  const seen = new Set<string>();
  let cur = m.parentId;
  let top: string | undefined;
  while (cur && byId.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    top = cur;
    cur = byId.get(cur)?.parentId;
  }
  return top;
}

// ---------------------------------------------------------------------------
// Naming — the one place a Kantata title becomes a SharePoint folder name.
// ---------------------------------------------------------------------------

/** SharePoint refuses these in an item name. Colons matter most here — AGP's
 * own `Client: FY27` convention would otherwise be unprovisionable. */
const ILLEGAL_CHARS = /["*:<>?/\\|]/g;

/** SharePoint's per-item name ceiling. */
const MAX_NAME_LENGTH = 255;

/** SharePoint's practical total-path ceiling — the budget `folderPathFor`
 * truncates its leaf segment against. */
const MAX_PATH_LENGTH = 400;

/**
 * Deterministic, idempotent sanitization: illegal character → space,
 * collapse whitespace, trim, strip leading/trailing dots (SharePoint refuses
 * both) — but internal periods survive, so "44061.01" is untouched and
 * "CWS: FY27" becomes "CWS FY27" every time, not "CWS" or "CWS_FY27" or
 * anything that varies run to run. Never re-numbers, never reformats beyond
 * what SharePoint actually refuses.
 */
export function folderNameFor(node: Pick<PlannedFolder, "title">): string {
  let name = node.title.replace(ILLEGAL_CHARS, " ").replace(/\s+/g, " ").trim();
  name = name.replace(/^[.\s]+|[.\s]+$/g, "");
  if (name.length === 0) name = "Untitled";
  if (name.length > MAX_NAME_LENGTH) name = name.slice(0, MAX_NAME_LENGTH).trim();
  return name;
}

/**
 * The full `<project>/<milestone>/[<phase>/]<task>` path for one node in
 * `tree`, each segment sanitized. If the joined path would exceed
 * SharePoint's practical length ceiling, only the LEAF segment is
 * truncated — an ancestor folder can never be orphaned or forked by a task
 * whose title happens to be long.
 */
export function folderPathFor(tree: readonly PlannedFolder[], kantataId: string): string {
  const byId = new Map(tree.map((n) => [n.kantataId, n] as const));
  const chain: PlannedFolder[] = [];
  const seen = new Set<string>();
  let cur = byId.get(kantataId);
  while (cur && !seen.has(cur.kantataId)) {
    seen.add(cur.kantataId);
    chain.unshift(cur);
    cur = cur.parentKantataId ? byId.get(cur.parentKantataId) : undefined;
  }
  const names = chain.map((n) => folderNameFor(n));
  const ancestors = names.slice(0, -1);
  let leaf = names[names.length - 1] ?? "";
  const ancestorPath = ancestors.join("/");
  const budget = MAX_PATH_LENGTH - (ancestorPath.length > 0 ? ancestorPath.length + 1 : 0);
  if (budget > 0 && leaf.length > budget) leaf = leaf.slice(0, budget).trim();
  return [...ancestors, leaf].filter((s) => s.length > 0).join("/");
}

// ---------------------------------------------------------------------------
// The provisioning diff — the preview, and what the picker renders.
// ---------------------------------------------------------------------------

export interface ProvisioningPlan {
  /** Project-level folders with nothing provisioned yet. Sync creates only
   * these — never a milestone, phase, or task folder (B4 §4/§5). */
  toCreate: PlannedFolder[];
  /** Existing folders, at any level, whose Kantata title has changed since
   * they were created — a rename PATCHes these, never duplicates them. */
  toRename: { existing: MsFolder; newName: string }[];
  /** Folders that exist in `msTeam.folders` but whose Kantata id no longer
   * appears in the live tree. Reported, never deleted — files may be in
   * them, and the absence could be a transient mirror gap. */
  goneFromKantata: MsFolder[];
}

/**
 * The diff between the desired tree and what has actually been provisioned.
 * Pure, so this IS the preview a human confirms before the first provision
 * (B4 §7) — no separate dry-run mode is needed anywhere.
 */
export function plannedProvisioning(
  account: Pick<ClientAccount, "msTeam">,
  liveCtx: Pick<AccountLiveContext, "projects">,
): ProvisioningPlan {
  const tree = folderTreeOf(liveCtx);
  const existing = account.msTeam?.folders ?? [];
  const existingIds = new Set(existing.map((f) => f.kantataId));
  const treeById = new Map(tree.map((n) => [n.kantataId, n] as const));

  const toCreate = tree.filter((n) => n.level === "project" && !existingIds.has(n.kantataId));

  const toRename: { existing: MsFolder; newName: string }[] = [];
  for (const f of existing) {
    const node = treeById.get(f.kantataId);
    if (!node) continue; // handled below as goneFromKantata
    const newName = folderNameFor(node);
    if (newName !== f.name) toRename.push({ existing: f, newName });
  }

  const goneFromKantata = existing.filter((f) => !treeById.has(f.kantataId));

  return { toCreate, toRename, goneFromKantata };
}

/** One row for the milestone-folder picker (B4 §5): every milestone Kantata
 * has for one project, and whether it already has a folder. */
export interface MilestoneFolderOption {
  kantataId: string;
  title: string;
  hasFolder: boolean;
}

export function milestoneFolderOptions(
  account: Pick<ClientAccount, "msTeam">,
  liveCtx: Pick<AccountLiveContext, "projects">,
  projectId: string,
): MilestoneFolderOption[] {
  const existingIds = new Set((account.msTeam?.folders ?? []).map((f) => f.kantataId));
  return folderTreeOf(liveCtx)
    .filter((n) => n.level === "milestone" && n.parentKantataId === projectId)
    .map((n) => ({ kantataId: n.kantataId, title: n.title, hasFolder: existingIds.has(n.kantataId) }));
}

// ---------------------------------------------------------------------------
// Team display name.
// ---------------------------------------------------------------------------

/**
 * Deterministic Team display name for a client — trimmed and
 * whitespace-collapsed, so the same client always proposes the same name and
 * two accidental spaces never produce two visually-identical Teams.
 * Microsoft Teams names allow far more characters than a SharePoint folder
 * name, so this does not run the folder sanitizer.
 */
export function teamDisplayName(account: Pick<ClientAccount, "clientName">): string {
  const name = account.clientName.replace(/\s+/g, " ").trim();
  return name.length > 0 ? name : "Untitled client";
}
