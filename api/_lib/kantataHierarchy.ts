/**
 * Kantata parent-chain resolution, ported from
 * apps/tab/src/workspace/campaignImport.ts's `projectPhaseResolver` — not
 * imported across the boundary (api/*.ts files are self-contained, no
 * workspace imports; see api/mirror.ts). This is the algorithm 0007's own
 * schema comment on `collab.task.kantata_ancestor_ids` points at: "computed
 * by the API layer the same way projectPhaseResolver/folderTreeOf already
 * do client-side."
 *
 * AGP's Kantata shape: a "workspace" is a fiscal-year CONTRACT, not a
 * project — the real project ("the job", with its job number) is the
 * TOP-MOST milestone story inside that workspace, and a "phase" is just a
 * milestone nested under another milestone via `parent_id`. There is no
 * separate phase story_type in raw Kantata data.
 */

export interface HierarchyMilestone {
  id: string;
  title: string;
  parentId?: string;
}

export interface HierarchyTask {
  id: string;
  title?: string;
  parentId?: string;
}

export interface HierarchyNode {
  id: string;
  title: string;
}

export interface ResolvedHierarchy {
  project?: HierarchyNode;
  phase?: HierarchyNode;
}

/**
 * Builds a resolver, scoped to ONE Kantata workspace's milestones+tasks
 * (never call this across workspaces — the parent-chain walk assumes every
 * id it might encounter belongs to the same workspace). For a given task id:
 *
 *  - **project** = the TOP-MOST milestone ancestor, if any milestone exists
 *    in the chain; else the top-most ancestor of any type (so an ungrouped
 *    workspace still gets a label instead of nothing).
 *  - **phase** = the NEAREST milestone ancestor, but ONLY when it differs
 *    from the top-most one (i.e. there are 2+ milestones in the chain) — a
 *    task with exactly one milestone ancestor has a project but no phase.
 *
 * Memoized per task id (one resolver instance is built once per workspace
 * and reused for every task in it).
 */
export function projectPhaseResolver(
  milestones: readonly HierarchyMilestone[],
  tasks: readonly HierarchyTask[],
): (taskId: string) => ResolvedHierarchy {
  const milestoneIds = new Set(milestones.map((m) => m.id));
  const titleById = new Map<string, string>();
  const parentOf = new Map<string, string | undefined>();
  for (const m of milestones) {
    titleById.set(m.id, m.title);
    parentOf.set(m.id, m.parentId);
  }
  // Anti-orphan fallback: a task whose parent milestone wasn't in the fetched
  // set resolves to no project and renders as its own top-level item. When the
  // workspace has exactly ONE root milestone (its single "job"), that is the
  // unambiguous home for such a task — attach it there rather than orphaning
  // it. With multiple root milestones we can't guess, so we leave it untouched.
  const rootMilestones = milestones.filter((m) => !m.parentId || !milestoneIds.has(m.parentId));
  const soleRootId = rootMilestones.length === 1 ? rootMilestones[0]!.id : undefined;
  // Tasks inserted AFTER milestones — a real title wins if an id somehow
  // collides in both buckets.
  for (const t of tasks) {
    if (t.title) titleById.set(t.id, t.title);
    parentOf.set(t.id, t.parentId);
  }

  const cache = new Map<string, ResolvedHierarchy>();
  return (taskId: string): ResolvedHierarchy => {
    const hit = cache.get(taskId);
    if (hit) return hit;

    const seen = new Set<string>();
    const milestoneChain: string[] = []; // nearest -> top
    let topMostAny: string | undefined;
    let cur = parentOf.get(taskId);
    while (cur && parentOf.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      if (milestoneIds.has(cur)) milestoneChain.push(cur);
      topMostAny = cur;
      cur = parentOf.get(cur);
    }

    const node = (id: string | undefined): HierarchyNode | undefined =>
      id && titleById.has(id) ? { id, title: titleById.get(id)! } : undefined;

    const projectId = milestoneChain.length > 0 ? milestoneChain[milestoneChain.length - 1] : (topMostAny ?? soleRootId);
    const phaseId = milestoneChain.length > 1 ? milestoneChain[0] : undefined;
    const project = node(projectId);
    const phase = phaseId && phaseId !== projectId ? node(phaseId) : undefined;

    const result: ResolvedHierarchy = { ...(project ? { project } : {}), ...(phase ? { phase } : {}) };
    cache.set(taskId, result);
    return result;
  };
}

/**
 * The FULL ancestor id chain for one task — its own id plus every ancestor
 * of any type (milestone or task), nearest-first. This is deliberately
 * fuller than `projectPhaseResolver`'s project/phase pair (which only keeps
 * the nearest and top-most milestone): `collab.access_grant`/`holds_grant()`
 * matches by literal id membership against this array, so a grant held at
 * ANY level in the chain — not just the two `projectPhaseResolver` surfaces
 * for display — must still match. Same cycle guard as the resolver above;
 * scoped to one workspace for the same reason.
 */
export function ancestorChain(milestones: readonly HierarchyMilestone[], tasks: readonly HierarchyTask[], taskId: string): string[] {
  const parentOf = new Map<string, string | undefined>();
  for (const m of milestones) parentOf.set(m.id, m.parentId);
  for (const t of tasks) parentOf.set(t.id, t.parentId);

  const chain = [taskId];
  const seen = new Set<string>([taskId]);
  let cur = parentOf.get(taskId);
  while (cur && parentOf.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    chain.push(cur);
    cur = parentOf.get(cur);
  }
  return chain;
}
