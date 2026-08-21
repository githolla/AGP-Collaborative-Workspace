import { msApiGetPlain, msApiCallPlain } from "./msApiFetch.js";

/**
 * Data layer for the external subtree (teams-provisioning-plan.md C2).
 * Every read here is `GET /api/external-workspace` — a single, RLS-scoped
 * payload; no client-side grant/audience filtering happens anywhere in this
 * file, because the server already only returns rows this caller's policies
 * allow (api/external-workspace.ts's own header explains why).
 */

export interface ExternalTask {
  id: string;
  title: string;
  ownerName: string | null;
  due: string | null;
  label: string | null;
  status: "todo" | "doing" | "done";
  clientVisible: boolean;
  contractorVisible: boolean;
  kantataId: string | null;
  completedAt: string | null;
}

export interface ExternalMessage {
  id: string;
  author: string;
  authorUserId: string | null;
  body: string;
  topic: string | null;
  clientVisible: boolean;
  contractorVisible: boolean;
  kantataId: string | null;
  kantataLevel: "project" | "milestone" | "phase" | "task" | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExternalCampaign {
  id: string;
  name: string;
  status: "active" | "planned" | "complete";
  nextMilestone: string | null;
  nextMilestoneDate: string | null;
  kantataProjectId: string | null;
}

export interface ExternalGrant {
  kantataId: string;
  level: "project" | "milestone" | "phase" | "task" | "folder";
  role: "read" | "write";
  msPermissionId: string | null;
}

export interface ExternalMsFolder {
  kantataId: string;
  folderId: string;
  name: string;
  level: "project" | "milestone" | "phase" | "task" | "folder";
}

export interface ExternalFileApproval {
  id: string;
  msItemId: string;
  name: string;
  purpose: "fyi" | "approval";
  sharedAt: string;
  sharedBy: string;
  decision: "approved" | "changes" | null;
  decidedAt: string | null;
  note: string | null;
}

export interface ExternalWorkspacePayload {
  accountId: string;
  clientName: string;
  myRole: "client" | "contractor" | null;
  tasks: ExternalTask[];
  messages: ExternalMessage[];
  campaigns: ExternalCampaign[];
  grants: ExternalGrant[];
  msFolders: ExternalMsFolder[];
  fileApprovals: ExternalFileApproval[];
}

export async function fetchExternalWorkspace(accountId: string): Promise<ExternalWorkspacePayload> {
  return msApiGetPlain<ExternalWorkspacePayload>(`/api/external-workspace?accountId=${encodeURIComponent(accountId)}`);
}

/** Posting a reply reuses the same `/api/message` route staff use —
 * api/message.ts already server-stamps an external's author/kantataId/
 * audience flag from the token, so this is a plain pass-through. */
export async function postExternalMessage(accountId: string, body: string, kantataId: string, topic?: string): Promise<ExternalMessage> {
  return msApiCallPlain<ExternalMessage>("/api/message", { body: { accountId, body, kantataId, kantataLevel: "milestone", ...(topic ? { topic } : {}) } });
}

export async function decideFileApproval(approvalId: string, decision: "approved" | "changes", note?: string): Promise<ExternalFileApproval> {
  return msApiCallPlain<ExternalFileApproval>("/api/files-approval-decision", { body: { approvalId, decision, ...(note ? { note } : {}) } });
}
