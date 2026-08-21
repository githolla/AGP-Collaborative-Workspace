import { msApiCallPlain } from "./msApiFetch.js";

/**
 * Client-side writes for `collab.file_approval` (docs/api-spec-workspace-mutations.md
 * "Files and approvals") — the migration off `/api/state`'s `ClientFileLink.clientShare`
 * (shareFileWithClient/unshareFileFromClient/recordClientDecision). Plain
 * Postgres writes, no Graph token (msApiCallPlain), same as msPeople.ts/msTasks.ts.
 * Keyed on the SharePoint item id (`msItemId`), never an app file row — B7's
 * own rule now that there is no app-side file inventory (api/files-approval.ts's
 * own header).
 */

export interface FileApprovalResult {
  id: string;
  accountId: string;
  msItemId: string;
  name: string;
  purpose: "fyi" | "approval";
  sharedAt: string;
  sharedBy: string;
  decision: "approved" | "changes" | null;
  decidedAt: string | null;
  decidedBy: string | null;
  note: string | null;
}

export async function createFileApproval(accountId: string, msItemId: string, name: string, purpose: "fyi" | "approval"): Promise<FileApprovalResult> {
  return msApiCallPlain<FileApprovalResult>("/api/files-approval", { body: { accountId, msItemId, name, purpose } });
}

export async function deleteFileApproval(approvalId: string): Promise<{ id: string }> {
  return msApiCallPlain<{ id: string }>("/api/files-approval", { method: "DELETE", body: { approvalId } });
}

/** Same route the client uses to decide their own approval
 * (externalWorkspaceApi.ts's `decideFileApproval`) — reused here so internal
 * staff can record a decision on the client's behalf (e.g. relayed by
 * phone/email), matching the old `recordClientDecision` proxy-entry mutator. */
export async function decideFileApproval(approvalId: string, decision: "approved" | "changes", note?: string): Promise<FileApprovalResult> {
  return msApiCallPlain<FileApprovalResult>("/api/files-approval-decision", { body: { approvalId, decision, ...(note ? { note } : {}) } });
}
