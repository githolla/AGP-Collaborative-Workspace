/**
 * Per-person handover — the record of what an outside person was given.
 *
 * The Contractor Access tab used to answer one question: who has access. The
 * questions actually asked when a contractor finishes are different, and none
 * of them were answerable:
 *
 *   What did we send them?      → every share, with the item named at send time
 *   When did they get it?       → sentAt, and by whom
 *   Have they opened it?        → openedAt, and how we know
 *   What do we revoke now?      → everything still live, in one list
 *
 * So a share is a RECORD, not a permission. Revoking one does not delete it —
 * it stamps `revokedAt` and keeps the row. "This contractor was sent the brand
 * guidelines on 3 August, opened them on 4 August, and access was revoked on
 * 20 August" is the sentence the tab has to be able to produce a year later,
 * and it can only produce it if nothing is thrown away.
 *
 * WHAT "OPENED" HONESTLY MEANS. Two sources, and the difference is visible in
 * the UI rather than blurred:
 *   - "workspace" — the person opened the link from inside this app. We
 *     observed it directly. True today.
 *   - "sharepoint" — Microsoft reported the open. Needs the Graph connection
 *     (BLOCKERS #5, `Sites.Selected`). Until that lands, a file someone opened
 *     straight from a SharePoint link we can't see reads as "not opened yet",
 *     and the tab says so instead of implying we watched and saw nothing.
 *
 * Pure data + pure functions: client-safe (no financials), testable, shared by
 * the store and the UI.
 */
import type { ClientAccount, Share, Task } from "./types.js";

/** Days after which an unopened share is worth chasing. */
export const CHASE_AFTER_DAYS = 5;

const dayDiff = (from: string, to: string): number =>
  Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000);

/** Names arrive from Kantata, from typing, and from Microsoft. Compare loosely. */
export const samePerson = (a: string, b: string): boolean =>
  a.trim().toLowerCase().replace(/\s+/g, " ") === b.trim().toLowerCase().replace(/\s+/g, " ");

export type ShareState = "opened" | "waiting" | "chase" | "revoked-unopened" | "revoked";

/**
 * What state a share is in, for one row of the handover view.
 *
 * "revoked-unopened" is deliberately its own state: a contractor whose access
 * ended without them ever opening what they were sent is a real failure —
 * either they never got it, or they never needed it. Both are worth seeing.
 */
export function shareState(share: Share, today: string): ShareState {
  if (share.revokedAt) return share.openedAt ? "revoked" : "revoked-unopened";
  if (share.openedAt) return "opened";
  return dayDiff(share.sentAt, today) >= CHASE_AFTER_DAYS ? "chase" : "waiting";
}

export const isLive = (share: Share): boolean => !share.revokedAt;

/** One person's whole handover picture. */
export interface PersonHandover {
  personName: string;
  /** Everything ever sent to them, newest first. */
  shares: Share[];
  /** Still live — the exact list "revoke when they're done" acts on. */
  live: Share[];
  /** Sent, live, and never opened past the chase window. */
  chase: Share[];
  /** Open tasks in this workspace that name them as owner. */
  openTasks: Task[];
  /** Counts for the header line. */
  sent: number;
  opened: number;
}

export function personHandover(
  account: Pick<ClientAccount, "shares" | "tasks">,
  personName: string,
  today: string,
): PersonHandover {
  const shares = (account.shares ?? [])
    .filter((s) => samePerson(s.personName, personName))
    .slice()
    .sort((a, b) => b.sentAt.localeCompare(a.sentAt));
  const live = shares.filter(isLive);
  return {
    personName,
    shares,
    live,
    chase: live.filter((s) => shareState(s, today) === "chase"),
    openTasks: account.tasks.filter((t) => t.status !== "done" && !!t.ownerName && samePerson(t.ownerName, personName)),
    sent: shares.length,
    opened: shares.filter((s) => !!s.openedAt).length,
  };
}

/**
 * Everything that must be dealt with before this person is done. Returned as
 * plain sentences because this is what gets read aloud — or pasted into a
 * ticket — at offboarding time.
 */
export function offboardChecklist(handover: PersonHandover): string[] {
  const out: string[] = [];
  if (handover.live.length > 0) {
    out.push(`Revoke ${handover.live.length} live item${handover.live.length === 1 ? "" : "s"}: ${handover.live.map((s) => s.itemName).join(", ")}`);
  }
  if (handover.openTasks.length > 0) {
    out.push(
      `Reassign ${handover.openTasks.length} open task${handover.openTasks.length === 1 ? "" : "s"}: ${handover.openTasks
        .map((t) => t.title)
        .join(", ")}`,
    );
  }
  const neverOpened = handover.live.filter((s) => !s.openedAt);
  if (neverOpened.length > 0) {
    out.push(`${neverOpened.length} item${neverOpened.length === 1 ? " was" : "s were"} never opened — check they had what they needed`);
  }
  if (out.length === 0) out.push("Nothing outstanding — access can be removed cleanly.");
  return out;
}

/** Short label for a share's state, in the words the tab uses. */
export function stateLabel(state: ShareState, share: Share): string {
  switch (state) {
    case "opened":
      return `Opened ${(share.openedAt ?? "").slice(0, 10)}`;
    case "revoked":
      return `Revoked ${(share.revokedAt ?? "").slice(0, 10)}`;
    case "revoked-unopened":
      return `Revoked — never opened`;
    case "chase":
      return "Not opened yet";
    default:
      return "Sent";
  }
}

/**
 * Everything in the workspace that can be handed to someone, as a flat pick
 * list. Tasks are included: "what they received" is not only documents — a
 * contractor is handed work as well as files.
 */
export interface ShareableItem {
  kind: Share["itemKind"];
  itemId: string;
  itemName: string;
}

export function shareableItems(account: Pick<ClientAccount, "files" | "docs" | "tasks">): ShareableItem[] {
  return [
    ...account.files.map((f) => ({ kind: "file" as const, itemId: f.id, itemName: f.name })),
    ...account.docs.map((d) => ({ kind: "doc" as const, itemId: d.id, itemName: d.name })),
    ...account.tasks.filter((t) => t.status !== "done").map((t) => ({ kind: "task" as const, itemId: t.id, itemName: t.title })),
  ];
}

/**
 * Items not already live with this person — the default pick list, so nobody
 * sends the same brief three times and then can't tell which send they opened.
 */
export function unsharedWith(items: readonly ShareableItem[], handover: PersonHandover): ShareableItem[] {
  const held = new Set(handover.live.map((s) => `${s.itemKind}:${s.itemId}`));
  return items.filter((i) => !held.has(`${i.kind}:${i.itemId}`));
}

/**
 * Workspace-wide roll-up: everyone with something outstanding. Drives the
 * "needs attention" line at the top of the tab, so a chase doesn't depend on
 * someone thinking to open each person's card.
 */
export function needsAttention(
  account: Pick<ClientAccount, "shares" | "tasks" | "externals">,
  today: string,
): { personName: string; chase: number; openTasks: number }[] {
  return account.externals
    .map((e) => {
      const h = personHandover(account, e.name, today);
      return { personName: e.name, chase: h.chase.length, openTasks: h.openTasks.length };
    })
    .filter((r) => r.chase > 0)
    .sort((a, b) => b.chase - a.chase);
}
