/**
 * GET /api/files?accountId&kantataId (docs/api-spec-workspace-mutations.md
 * "Files and approvals"; teams-provisioning-plan.md B5a). "The folder IS the
 * file list" — this fetches a live Graph listing of the folder that stands
 * for `kantataId`, with the CALLER'S OWN delegated token (X-Graph-Token,
 * forwarded, never stored). The app only displays; SharePoint is what
 * actually enforces who can see what (B7's own architecture note).
 *
 * Authorization is entirely `collab.ms_folder_read`'s policy: it accepts an
 * internal account member/admin, OR an external who `holds_grant` covering
 * this exact `kantataId`. If the row comes back empty, that is either "no
 * folder exists yet for this id" or "not authorized" — collapsed into
 * not_found like every other endpoint's silent-RLS-denial path, so an
 * unauthorized caller learns nothing about which.
 */

import { requireUser } from "./_lib/requireUser.js";
import { withUserContext } from "./_lib/db.js";
import { graphTokenFrom, graphFetch, graphApiError } from "./_lib/graph.js";

interface GraphDriveItem {
  id: string;
  name: string;
  size?: number;
  webUrl?: string;
  lastModifiedDateTime?: string;
  folder?: { childCount: number };
  file?: { mimeType: string };
  children?: GraphDriveItem[];
}

export default async function handler(
  req: {
    method?: string;
    headers?: Record<string, string | string[] | undefined>;
    query?: Record<string, unknown>;
  },
  res: {
    status: (code: number) => { json: (body: unknown) => void };
    setHeader: (k: string, v: string) => void;
  },
): Promise<void> {
  res.setHeader("Cache-Control", "no-store");

  if (req.method && req.method !== "GET") {
    res.status(405).json({ error: { code: "validation_failed", message: "GET only" } });
    return;
  }

  const authHeader = typeof req.headers?.authorization === "string" ? req.headers.authorization : undefined;
  const auth = await requireUser(authHeader);
  if (!auth.authorized) {
    res.status(auth.status).json(auth.body);
    return;
  }

  const accountId = typeof req.query?.accountId === "string" ? req.query.accountId : "";
  const kantataId = typeof req.query?.kantataId === "string" ? req.query.kantataId : "";
  if (!accountId || !kantataId) {
    res.status(400).json({ error: { code: "validation_failed", message: "accountId and kantataId are required" } });
    return;
  }

  const token = graphTokenFrom(req.headers);
  if (!token) {
    res.status(400).json({ error: { code: "graph_token_required", message: "X-Graph-Token header is required" } });
    return;
  }

  try {
    const row = await withUserContext(auth.userId!, async (tx) => {
      const [account] = await tx<{ ms_drive_id: string | null }[]>`select ms_drive_id from collab.client_account where id = ${accountId}`;
      const [folder] = await tx<{ folder_id: string; name: string }[]>`
        select folder_id, name from collab.ms_folder where account_id = ${accountId} and kantata_id = ${kantataId}
      `;
      return account && folder ? { driveId: account.ms_drive_id, folder } : null;
    });

    if (!row || !row.driveId) {
      res.status(404).json({ error: { code: "not_found", message: "folder not found" } });
      return;
    }

    // One round trip for both the folder's own webUrl (the direct-open link
    // — B5a's Files tab has never had one, only per-file links) and its
    // children, via Graph's own $expand rather than a second GET.
    const folderItem = (await graphFetch(
      token,
      `/drives/${row.driveId}/items/${row.folder.folder_id}?$expand=children($select=id,name,size,webUrl,lastModifiedDateTime,folder,file)`,
    )) as GraphDriveItem;

    res.status(200).json({
      data: {
        folderName: row.folder.name,
        folderWebUrl: folderItem.webUrl,
        items: (folderItem.children ?? []).map((item) => ({
          id: item.id,
          name: item.name,
          size: item.size ?? 0,
          webUrl: item.webUrl,
          lastModifiedDateTime: item.lastModifiedDateTime,
          isFolder: !!item.folder,
          mimeType: item.file?.mimeType,
        })),
      },
    });
  } catch (err) {
    try {
      const { status, body } = graphApiError(err);
      res.status(status).json(body);
    } catch {
      res.status(500).json({ error: { code: "internal_error", message: err instanceof Error ? err.message : "query failed" } });
    }
  }
}
