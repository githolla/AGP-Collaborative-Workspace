/**
 * Client-facing document sharing and approval — the client side of the file
 * story, matching the contractor handover on the other side.
 *
 * Cara's ask, on the Discussions tab: "where do I include the documents that
 * are shared with the client? … I may want to share the latest strategy
 * document with the client, which is a living document … I can see a need to
 * post files for approval by the client as well." So a document can be shared
 * into the client space two ways:
 *
 *   - FYI       — a living doc the client reads and collaborates on.
 *   - APPROVAL  — a decision is requested; the client approves or asks for
 *                 changes, and the state is visible to everyone.
 *
 * Like the handover, this is a RECORD: an approval or a change request stamps
 * who and when, and re-sharing after changes starts a fresh request rather than
 * erasing the last one. And like the handover, "opened" is only ever set from a
 * real signal — never inferred — so until SharePoint is connected it reads
 * honestly as not-yet-seen.
 *
 * Pure functions over the ClientShare record: client-safe (no financials),
 * testable, shared by the store and the UI.
 */
import type { ClientFileLink, ClientShare } from "./types.js";

export type ApprovalState = "fyi" | "pending" | "approved" | "changes";

/** Where a shared document stands, in one word. */
export function approvalState(share: ClientShare): ApprovalState {
  if (share.purpose === "fyi") return "fyi";
  if (share.decision === "approved") return "approved";
  if (share.decision === "changes") return "changes";
  return "pending";
}

/** Label for a share state, in the words the client space uses. */
export function approvalLabel(share: ClientShare): string {
  switch (approvalState(share)) {
    case "fyi":
      return "Shared to review";
    case "approved":
      return `Approved ${(share.decidedAt ?? "").slice(0, 10)}`.trim();
    case "changes":
      return "Changes requested";
    default:
      return "Awaiting your approval";
  }
}

/** True while an approval request is open (shared for approval, no decision). */
export const isAwaitingApproval = (share: ClientShare): boolean => approvalState(share) === "pending";

/** Only documents actually shared with the client — never internal-only ones. */
export function clientDocuments(files: readonly ClientFileLink[]): ClientFileLink[] {
  return files.filter((f) => !!f.clientShare);
}

/** Split for the client view: what needs a decision vs. everything else. */
export function partitionForClient(files: readonly ClientFileLink[]): {
  awaiting: ClientFileLink[];
  shared: ClientFileLink[];
} {
  const shared = clientDocuments(files);
  return {
    awaiting: shared.filter((f) => f.clientShare && isAwaitingApproval(f.clientShare)),
    shared,
  };
}

/**
 * Build the share record. Sharing a document that was previously decided starts
 * a CLEAN request — the point of re-sharing after "changes requested" is a new
 * round, so the stale decision must not carry over.
 */
export function shareRecord(purpose: ClientShare["purpose"], by: string, at: string): ClientShare {
  return { purpose, sharedAt: at, sharedBy: by };
}

/** Apply the client's decision to a share. Returns a new record (immutable). */
export function decide(
  share: ClientShare,
  decision: "approved" | "changes",
  by: string,
  at: string,
  note?: string,
): ClientShare {
  return {
    ...share,
    decision,
    decidedAt: at,
    decidedBy: by,
    ...(note && note.trim() ? { note: note.trim() } : {}),
  };
}

/** One-line summary for the activity feed. */
export function shareSummary(fileName: string, share: ClientShare): string {
  return share.purpose === "approval"
    ? `Sent to client for approval — ${fileName}`
    : `Shared with client — ${fileName}`;
}

export function decisionSummary(fileName: string, share: ClientShare): string {
  if (share.decision === "approved") return `Client approved — ${fileName}`;
  if (share.decision === "changes") return `Client requested changes — ${fileName}${share.note ? `: "${share.note}"` : ""}`;
  return `Client decision recorded — ${fileName}`;
}
