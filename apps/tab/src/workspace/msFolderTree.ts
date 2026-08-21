import { msApiGet } from "./msApiFetch.js";

/**
 * Live, expand-on-click browse of an account's real SharePoint folder tree
 * (teams-provisioning-plan.md B7, folder access widened to "any real
 * folder" — not just ones synced from a Kantata project/milestone/phase/
 * task). Backs `api/account-folder-children.ts`: ONE folder's children per
 * call (omit `folderId` for the drive root), never a whole-tree preload —
 * see that endpoint's own header for why.
 *
 * `kantataId` on each node is either a real one (already known via
 * `collab.ms_folder`, e.g. from Kantata sync) or a synthetic `"graph:"`-
 * prefixed one (api/_lib/msFolder.ts) for a folder browsed here for the
 * first time — callers (GrantPanel/FilesPanel pickers) pass either straight
 * through to `grantAccess`/`listFolder`/`uploadFile` unchanged.
 */

export interface FolderTreeNode {
  id: string;
  name: string;
  kantataId: string;
  level: "project" | "milestone" | "phase" | "task" | "folder";
  alreadyKnown: boolean;
  hasChildren: boolean;
}

export interface FolderChildrenResult {
  parentFolderId: string | null;
  truncated: boolean;
  items: FolderTreeNode[];
}

export async function listFolderChildren(accountId: string, folderId?: string | undefined, loginHintEmail?: string | undefined): Promise<FolderChildrenResult> {
  const qs = folderId ? `&folderId=${encodeURIComponent(folderId)}` : "";
  return msApiGet<FolderChildrenResult>(`/api/account-folder-children?accountId=${encodeURIComponent(accountId)}${qs}`, { loginHintEmail });
}
