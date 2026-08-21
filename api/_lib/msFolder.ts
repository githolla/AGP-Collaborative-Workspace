/**
 * Server-side folder-tree computation for collab.ms_folder
 * (teams-provisioning-plan.md B3/B4). Ported from
 * apps/tab/src/workspace/msTeams.ts's `folderTreeOf` / `folderNameFor` /
 * `plannedProvisioning` — NOT imported across the boundary (api/*.ts files
 * are self-contained; see api/mirror.ts and api/_lib/kantataHierarchy.ts,
 * which ports `projectPhaseResolver` the same way). Keep this in sync with
 * msTeams.ts's algorithm by hand; there is no shared package this pass
 * introduces to do it automatically. (msTeams.ts's own `folderPathFor` has
 * no server-side counterpart — nothing here needs a rendered path string,
 * only real Graph item ids, which `ensureFolderChain` below resolves by
 * walking the tree directly.)
 *
 * DATA SOURCE, corrected 2026-08-18: this originally queried
 * `mirror.kantata_workspaces`/`mirror.kantata_stories` directly — tables
 * that turn out to be permanently empty in this deployment. Every other
 * Kantata-touching endpoint in this codebase (api/mirror.ts,
 * api/account-import.ts, api/account-deepen.ts) pulls LIVE from Kantata's
 * own API through api/_lib/kantataMirror.ts and never persists into that
 * mirror schema at all — it is dead infrastructure from an earlier,
 * superseded sync-layer design (0007's own comment already flagged 0001-0006
 * as "the pre-pivot sync layer... left alone", which this module should have
 * read as "don't depend on it" rather than "safe to query"). This now uses
 * the same live-pull functions as everything else, via a `kantataToken`
 * (`process.env.KANTATA_API_TOKEN`, read by the caller — this module has no
 * env access of its own, matching kantataMirror.ts's own convention).
 *
 * The client computes a similar tree from its own live mirror fetch
 * (accountLiveContext) for preview/display. This module exists because the
 * WRITE path — actually creating/renaming folders and persisting ms_folder —
 * must not trust a tree the client computed and posted; the server derives
 * it itself, directly from Kantata, and decides authoritatively what gets
 * created.
 */

import type postgres from "postgres";
import { graphFetch } from "./graph.js";
import { pullWorkspaceStories, pullWorkspaceTitles } from "./kantataMirror.js";

export interface PlannedFolder {
  kantataId: string;
  title: string;
  level: "project" | "milestone" | "phase" | "task" | "folder";
  parentKantataId?: string;
}

/** A folder with no Kantata correspondence (browsed live in SharePoint, not
 * synced from a Kantata project/milestone/phase/task) is identified by this
 * synthetic kantata_id — "graph:" + its real Microsoft Graph driveItem id.
 * `collab.holds_grant()`'s flat string match, and every RLS policy built on
 * it, already treats this exactly like any other kantata_id, so nothing
 * about authorization needed to change to support it (docs/... see
 * supabase/migrations/0017_folder_level_grants.sql). Kantata (Mavenlink)
 * ids are purely numeric, so this prefix can't collide with a real one. */
const SYNTHETIC_PREFIX = "graph:";

export function isSyntheticFolderId(kantataId: string): boolean {
  return kantataId.startsWith(SYNTHETIC_PREFIX);
}

export function syntheticIdFor(graphFolderId: string): string {
  return `${SYNTHETIC_PREFIX}${graphFolderId}`;
}

export function graphIdFromSynthetic(kantataId: string): string {
  return kantataId.slice(SYNTHETIC_PREFIX.length);
}

const ILLEGAL_CHARS = /["*:<>?/\\|]/g;
const MAX_NAME_LENGTH = 255;

export function folderNameFor(title: string): string {
  let name = title.replace(ILLEGAL_CHARS, " ").replace(/\s+/g, " ").trim();
  name = name.replace(/^[.\s]+|[.\s]+$/g, "");
  if (name.length === 0) name = "Untitled";
  if (name.length > MAX_NAME_LENGTH) name = name.slice(0, MAX_NAME_LENGTH).trim();
  return name;
}

interface StoryRow {
  id: string;
  workspace_id: string;
  parent_id?: string;
  title: string;
}

/** Same collapse rule as msTeams.ts's `topMostMilestoneAncestor`: walk a
 * milestone's own parent chain through OTHER milestones only; the first
 * ancestor that is not itself a milestone ends the walk. */
function topMostMilestoneAncestor(id: string, milestoneParent: Map<string, string | undefined>): string | undefined {
  const seen = new Set<string>();
  let cur = milestoneParent.get(id);
  let top: string | undefined;
  while (cur && milestoneParent.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    top = cur;
    cur = milestoneParent.get(cur);
  }
  return top;
}

/**
 * The full desired folder tree for one client_account, built from its linked
 * Kantata workspaces' mirrored stories — one project node per linked
 * workspace, one milestone/phase node per milestone story (any depth of
 * milestone nesting collapses to one phase level), one task node per
 * non-milestone story whose nearest ancestor that IS a genuine milestone
 * story is known. A story with no milestone ancestor anywhere in its chain
 * gets no folder here — the server's own "nowhere sensible to file it" rule.
 *
 * NOT identical to msTeams.ts's client-side preview in this one respect:
 * campaignImport.ts's `projectPhaseResolver` (which `LiveTask.milestoneId`
 * is derived from) falls back to the top-most ancestor of ANY type when a
 * task's chain has no milestone at all, and msTeams.ts's `folderTreeOf`
 * doesn't filter that fallback back out — so for a tenant that files a
 * "project" as an ordinary parent task rather than a milestone story, the
 * client's preview can show a task folder parented to an id this function
 * will never create a node for. This function's stricter rule is the one
 * that's actually enforced (it decides what gets created); the client
 * preview's looser one is a pre-existing, separate divergence in
 * campaignImport.ts/msTeams.ts, not something this port replicates.
 */
export async function desiredFolderTree(kantataToken: string, kantataProjectIds: readonly string[]): Promise<PlannedFolder[]> {
  if (kantataProjectIds.length === 0) return [];

  const ids = [...kantataProjectIds];
  const [workspaces, focus] = await Promise.all([pullWorkspaceTitles(kantataToken, ids), pullWorkspaceStories(kantataToken, ids)]);

  const toStoryRow = (raw: Record<string, unknown>): StoryRow | null => {
    const id = raw.id;
    const title = raw.title;
    const workspaceId = raw.workspace_id;
    if (typeof id !== "string" || typeof title !== "string" || (typeof workspaceId !== "string" && typeof workspaceId !== "number")) return null;
    const parentId = raw.parent_id;
    return { id, title, workspace_id: String(workspaceId), ...(typeof parentId === "string" ? { parent_id: parentId } : {}) };
  };
  const allMilestones = focus.milestones.map(toStoryRow).filter((s): s is StoryRow => s !== null);
  const allOthers = focus.tasks.map(toStoryRow).filter((s): s is StoryRow => s !== null);

  const out: PlannedFolder[] = [];
  for (const ws of workspaces) {
    out.push({ kantataId: ws.id, title: ws.title, level: "project" });

    const milestones = allMilestones.filter((s) => s.workspace_id === ws.id);
    const others = allOthers.filter((s) => s.workspace_id === ws.id);

    const milestoneParent = new Map<string, string | undefined>();
    for (const m of milestones) milestoneParent.set(m.id, m.parent_id);

    for (const m of milestones) {
      const top = topMostMilestoneAncestor(m.id, milestoneParent);
      if (top === undefined) {
        out.push({ kantataId: m.id, title: m.title, level: "milestone", parentKantataId: ws.id });
      } else {
        out.push({ kantataId: m.id, title: m.title, level: "phase", parentKantataId: top });
      }
    }

    const milestoneIds = new Set(milestones.map((m) => m.id));
    const wsStories = [...milestones, ...others];
    for (const t of others) {
      // Nearest ancestor that is itself a milestone — walking through
      // non-milestone parents first (a task's immediate parent is often
      // another task/deliverable before reaching its milestone).
      const allParent = new Map<string, string | undefined>();
      for (const s of wsStories) allParent.set(s.id, s.parent_id);
      let cur = allParent.get(t.id);
      const seen = new Set<string>();
      let parent: string | undefined;
      while (cur && !seen.has(cur)) {
        if (milestoneIds.has(cur)) {
          parent = cur;
          break;
        }
        seen.add(cur);
        cur = allParent.get(cur);
      }
      if (!parent) continue;
      out.push({ kantataId: t.id, title: t.title, level: "task", parentKantataId: parent });
    }
  }
  return out;
}

/**
 * Ensures a real folder exists for `kantataId`, creating it AND every
 * missing ancestor above it in `tree` (project first, down to the leaf) —
 * B4 §5/§6's "created on demand": a phase or task folder that has never
 * been picked or granted still gets created the moment an upload targets it.
 * Get-by-path before create at every level, so a partially-provisioned chain
 * (e.g. the project folder exists but its milestone doesn't) never
 * duplicates the levels that already exist. Returns the leaf folder's Graph
 * item id.
 */
export async function ensureFolderChain(
  tx: postgres.TransactionSql,
  token: string,
  accountId: string,
  driveId: string,
  tree: readonly PlannedFolder[],
  kantataId: string,
): Promise<string> {
  const byId = new Map(tree.map((n) => [n.kantataId, n] as const));
  const node = byId.get(kantataId);
  if (!node) throw new Error(`unknown Kantata id for this account's linked projects: ${kantataId}`);

  // Walk from the leaf up to the root, then create root-down so no child is
  // ever created before its parent.
  const chain: PlannedFolder[] = [];
  let cur: PlannedFolder | undefined = node;
  const seen = new Set<string>();
  while (cur && !seen.has(cur.kantataId)) {
    seen.add(cur.kantataId);
    chain.unshift(cur);
    cur = cur.parentKantataId ? byId.get(cur.parentKantataId) : undefined;
  }

  let parentFolderId: string | null = null;
  let leafFolderId = "";
  for (const n of chain) {
    // Bypasses the caller's own RLS visibility on purpose (0020's own
    // header explains why) — an ancestor folder above whatever kantataId
    // the caller is actually authorized to write into is never something
    // they hold a grant on themselves, so a plain RLS-scoped SELECT here
    // would find nothing even when the row is real, and this loop would
    // try to recreate an already-existing folder at Microsoft Graph.
    const [existing] = await tx<{ folder_id: string }[]>`select folder_id from collab.ms_folder_lookup(${accountId}, ${n.kantataId})`;
    if (existing) {
      parentFolderId = existing.folder_id;
      leafFolderId = existing.folder_id;
      continue;
    }

    const name = folderNameFor(n.title);
    const lookupPath = parentFolderId ? `/drives/${driveId}/items/${parentFolderId}:/${encodeURIComponent(name)}` : `/drives/${driveId}/root:/${encodeURIComponent(name)}`;
    let folder = (await graphFetch(token, lookupPath, { tolerate404: true })) as { id: string } | null;
    if (!folder) {
      const createPath = parentFolderId ? `/drives/${driveId}/items/${parentFolderId}/children` : `/drives/${driveId}/items/root/children`;
      folder = (await graphFetch(token, createPath, { method: "POST", body: { name, folder: {}, "@microsoft.graph.conflictBehavior": "fail" } })) as { id: string };
    }
    // Same bypass as the lookup above — ms_folder_insert's policy requires
    // is_workspace_admin(account_id), which an external caller (the whole
    // reason this function exists — B4 §5/§6's "created on demand" folder
    // for someone with a write grant but no admin role) never satisfies.
    await tx`select collab.ms_folder_upsert(${accountId}, ${n.kantataId}, ${folder.id}, ${parentFolderId}, ${name}, ${n.level})`;
    parentFolderId = folder.id;
    leafFolderId = folder.id;
  }
  return leafFolderId;
}

/**
 * Resolves (or, the first time this exact Graph folder is touched through
 * the app, creates) the collab.ms_folder row standing for a real,
 * already-existing SharePoint folder discovered via the live browse picker
 * (api/account-folder-children.ts) — NOT via desiredFolderTree/
 * ensureFolderChain, since a browsed folder is by definition not
 * necessarily a node in that Kantata-derived tree, and there is nothing to
 * "create" here (the folder already exists; this only needs to look it up).
 *
 * If a row already exists for this folder_id under ANY kantata_id — a real
 * one from Kantata sync, or a previously-synthesized one — that row is
 * reused, so a Kantata-synced folder is never double-represented once
 * someone also browses to it directly.
 */
export async function ensureMsFolderForGraphId(
  tx: postgres.TransactionSql,
  token: string,
  accountId: string,
  driveId: string,
  graphFolderId: string,
): Promise<{ kantataId: string; folderId: string }> {
  // Same RLS bypass as ensureFolderChain, and for the same reason: whoever
  // browsed to this folder may hold no grant on it yet (that's often the
  // point of granting it right after), so a plain RLS-scoped SELECT could
  // miss an already-synthesized row.
  const [existing] = await tx<{ kantata_id: string }[]>`select kantata_id from collab.ms_folder_lookup_by_graph_id(${accountId}, ${graphFolderId})`;
  if (existing) return { kantataId: existing.kantata_id, folderId: graphFolderId };

  const item = (await graphFetch(token, `/drives/${driveId}/items/${graphFolderId}`, { tolerate404: true })) as
    | { id: string; name: string; parentReference?: { id?: string } }
    | null;
  if (!item) throw new Error(`Graph folder ${graphFolderId} no longer exists`);

  const kantataId = syntheticIdFor(item.id);
  await tx`select collab.ms_folder_upsert(${accountId}, ${kantataId}, ${item.id}, ${item.parentReference?.id ?? null}, ${item.name}, 'folder')`;
  return { kantataId, folderId: item.id };
}
