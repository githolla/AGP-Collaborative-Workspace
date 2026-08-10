import type { ClientAccount, Task } from "./types.js";

/**
 * The "working picture" of who's on a workspace — Cara and Kellie's pilot
 * feedback (2026-07-30 / 08-04). A Kantata fiscal-year contract lists everyone
 * who ever touched the account (invoicing, admin, leadership dropping in for
 * support) — ~45 people — so the raw roster "doesn't mean anything to the team
 * members working on it" (Kellie) and the view showed "people missing or extra"
 * (Cara). This splits the roster into the people actually delivering the work
 * now vs. everyone else on the contract, and lets the owner hide names that
 * don't belong — without deleting them, because they're real Kantata records.
 *
 * Pure so it's testable and the same definition drives the People hub and Home.
 */

export interface WorkspaceMember {
  personId: string;
  name: string;
  title: string;
}

export interface WorkingPicture<M extends WorkspaceMember> {
  /** People delivering the work now: the owner + anyone on an open task. */
  active: M[];
  /** Everyone else on the contract — real, but not on current work. Collapsed. */
  contract: M[];
  /** Names the owner has hidden from the picture (kept as data, not deleted). */
  hidden: M[];
}

/** Every person carrying an open task — as owner or as a named assignee. Done
 * tasks don't count: a name only on finished work isn't "working" now. */
export function activeWorkerNames(tasks: readonly Task[]): Set<string> {
  const names = new Set<string>();
  for (const t of tasks) {
    if (t.status === "done") continue;
    if (t.ownerName) names.add(t.ownerName);
    for (const a of t.assignments ?? []) names.add(a.name);
  }
  return names;
}

/**
 * Bucket a workspace's members into active / contract / hidden.
 *
 * - The workspace OWNER is always active (they run it, even between tasks).
 * - Anyone on an open task is active.
 * - Muted names are hidden regardless — the owner said they don't belong.
 * - Everyone else is "also on the contract", shown collapsed.
 */
export function workingPicture<M extends WorkspaceMember>(
  members: readonly M[],
  tasks: readonly Task[],
  ownerName?: string,
  mutedMembers: readonly string[] = [],
): WorkingPicture<M> {
  const muted = new Set(mutedMembers);
  const workers = activeWorkerNames(tasks);
  const active: M[] = [];
  const contract: M[] = [];
  const hidden: M[] = [];
  for (const m of members) {
    if (muted.has(m.name)) hidden.push(m);
    else if (m.name === ownerName || workers.has(m.name)) active.push(m);
    else contract.push(m);
  }
  return { active, contract, hidden };
}

/** Resolve the effective owner: the stored owner if still on the account,
 * otherwise none (a departed owner shouldn't silently keep the badge). */
export function resolveOwner(account: Pick<ClientAccount, "ownerName" | "members">): string | undefined {
  const { ownerName, members } = account;
  if (ownerName && members.some((m) => m.name === ownerName)) return ownerName;
  return undefined;
}
