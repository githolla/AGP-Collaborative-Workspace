/**
 * GET /api/account-folder-children?accountId=&folderId= (teams-provisioning-plan.md
 * B7, folder access widened to "any real SharePoint folder", not only ones
 * that map to a Kantata project/milestone/phase/task). Lazily lists ONE
 * folder's direct children in the account's adopted drive (omit `folderId`
 * for the drive root) — the live, expand-on-click counterpart to
 * account-provisioning-plan.ts's Kantata-derived preview tree. Folders
 * only: this is an access-grant/browse picker, not a file listing —
 * api/files.ts already does that per selected folder.
 *
 * Deliberately NOT a recursive whole-tree walk: a wide/deep drive would risk
 * a timeout and heavy Graph throttling for no UI benefit an expand-on-click
 * tree doesn't already give for free. Each call is bounded to one folder's
 * children (paginated, capped at MAX_PAGES, `truncated` reported honestly
 * rather than silently dropping items past the cap).
 *
 * Read-only: never writes a collab.ms_folder row for anything newly seen —
 * a row is only ever created on first grant or first upload
 * (api/_lib/msFolder.ts's ensureMsFolderForGraphId), matching the existing
 * "create on demand" pattern ensureFolderChain already uses. The one
 * exception is an opportunistic refresh of name/parent_folder_id on an
 * ALREADY-known row when the live Graph data (already in hand for this
 * call) shows it's drifted — otherwise a browsed folder's display would
 * never self-heal after a SharePoint rename/move the way Kantata-synced
 * folders do via account-folders-sync.ts's own diff.
 *
 * account member or workspace_admin — any internal staffer on the account,
 * not just admins, since ClientWorkspace.tsx's own Files tab (not just the
 * admin-side "what could I grant" browse) now uses this same tree. Still
 * nothing exposed to an external.
 */

import { requireUser } from "./_lib/requireUser.js";
import { withUserContext } from "./_lib/db.js";
import { graphTokenFrom, graphFetch, graphApiError } from "./_lib/graph.js";
import { syntheticIdFor } from "./_lib/msFolder.js";

const MAX_PAGES = 10;

interface GraphFolderChild {
  id: string;
  name: string;
  folder?: { childCount?: number };
  parentReference?: { id?: string };
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
  const folderId = typeof req.query?.folderId === "string" ? req.query.folderId : "";
  if (!accountId) {
    res.status(400).json({ error: { code: "validation_failed", message: "accountId is required" } });
    return;
  }

  const token = graphTokenFrom(req.headers);
  if (!token) {
    res.status(400).json({ error: { code: "graph_token_required", message: "X-Graph-Token header is required" } });
    return;
  }

  try {
    const result = await withUserContext(auth.userId!, async (tx) => {
      const [account] = await tx<{ ms_drive_id: string | null }[]>`select ms_drive_id from collab.client_account where id = ${accountId}`;
      const [access] = await tx<{ ok: boolean }[]>`select collab.is_account_member_or_admin(${accountId}) as ok`;
      if (!account || !access?.ok) return { kind: "not_found" as const };
      if (!account.ms_drive_id) return { kind: "no_drive" as const };
      const driveId = account.ms_drive_id;

      const base = folderId ? `/drives/${driveId}/items/${folderId}/children` : `/drives/${driveId}/root/children`;
      let next: string | null = `${base}?$select=id,name,folder,parentReference&$top=200`;
      const children: GraphFolderChild[] = [];
      let truncated = false;
      for (let page = 0; next && page < MAX_PAGES; page++) {
        const listing = (await graphFetch(token, next)) as { value: GraphFolderChild[]; "@odata.nextLink"?: string };
        children.push(...listing.value);
        next = listing["@odata.nextLink"] ?? null;
        if (next && page === MAX_PAGES - 1) truncated = true;
      }

      const folders = children.filter((c) => !!c.folder);
      const folderIds = folders.map((f) => f.id);
      const known =
        folderIds.length === 0
          ? []
          : await tx<{ kantata_id: string; folder_id: string; level: string; name: string; parent_folder_id: string | null }[]>`
              select kantata_id, folder_id, level, name, parent_folder_id from collab.ms_folder
              where account_id = ${accountId} and folder_id = any(${folderIds})
            `;
      const knownByFolderId = new Map(known.map((k) => [k.folder_id, k] as const));

      for (const f of folders) {
        const row = knownByFolderId.get(f.id);
        const parentId = f.parentReference?.id ?? null;
        if (row && (row.name !== f.name || row.parent_folder_id !== parentId)) {
          await tx`update collab.ms_folder set name = ${f.name}, parent_folder_id = ${parentId} where account_id = ${accountId} and folder_id = ${f.id}`;
        }
      }

      return {
        kind: "ok" as const,
        truncated,
        items: folders.map((f) => {
          const row = knownByFolderId.get(f.id);
          return {
            id: f.id,
            name: f.name,
            kantataId: row?.kantata_id ?? syntheticIdFor(f.id),
            level: row?.level ?? "folder",
            alreadyKnown: !!row,
            hasChildren: (f.folder?.childCount ?? 0) > 0,
          };
        }),
      };
    });

    if (result.kind === "not_found") {
      res.status(404).json({ error: { code: "not_found", message: "account not found" } });
      return;
    }
    if (result.kind === "no_drive") {
      res.status(200).json({ data: { parentFolderId: folderId || null, truncated: false, items: [] } });
      return;
    }

    res.status(200).json({ data: { parentFolderId: folderId || null, truncated: result.truncated, items: result.items } });
  } catch (err) {
    try {
      const { status, body } = graphApiError(err);
      res.status(status).json(body);
    } catch {
      res.status(500).json({ error: { code: "internal_error", message: err instanceof Error ? err.message : "query failed" } });
    }
  }
}
