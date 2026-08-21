/**
 * POST /api/account/:id/folders — `api/account-folders.ts`
 * (docs/api-spec-workspace-mutations.md "Provisioning"; teams-provisioning-plan.md
 * B4 §5 "The milestone picker"). Body: `{ kantataIds: string[] }` — the
 * ticked rows from the picker's list. Creates a folder for each, under its
 * project's existing folder; the project folder itself must already exist
 * (api/account-folders-sync.ts), since B4 §5 only ever creates milestone
 * folders on demand, never a project folder as a side effect of this call.
 *
 * Only true top-level milestones are valid here — a nested milestone
 * ("phase" in the tree) is created on demand from a grant or upload instead
 * (B4 §5's own text), never from this bulk picker. Requesting one is a
 * validation error, not silently ignored.
 *
 * IDEMPOTENT (api-spec rule 5, B4 §4 test "picking the same milestone twice
 * creating one folder"): get-by-path before create, same as sync.
 */

import { requireUser } from "./_lib/requireUser.js";
import { withUserContext } from "./_lib/db.js";
import { toApiError } from "./_lib/apiError.js";
import { graphTokenFrom, graphFetch, graphApiError } from "./_lib/graph.js";
import { desiredFolderTree, folderNameFor } from "./_lib/msFolder.js";

interface AccountRow {
  id: string;
  ms_drive_id: string | null;
  kantata_project_ids: string[];
}

export default async function handler(
  req: { method?: string; body?: unknown; headers?: Record<string, string | string[] | undefined> },
  res: {
    status: (code: number) => { json: (body: unknown) => void };
    setHeader: (k: string, v: string) => void;
  },
): Promise<void> {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.status(405).json({ error: { code: "validation_failed", message: "POST only" } });
    return;
  }

  const authHeader = typeof req.headers?.authorization === "string" ? req.headers.authorization : undefined;
  const auth = await requireUser(authHeader);
  if (!auth.authorized) {
    res.status(auth.status).json(auth.body);
    return;
  }

  const b = req.body as { accountId?: unknown; kantataIds?: unknown };
  const accountId = typeof b.accountId === "string" ? b.accountId : "";
  const kantataIds = Array.isArray(b.kantataIds) ? b.kantataIds.filter((k): k is string => typeof k === "string" && k.length > 0) : [];
  if (!accountId || kantataIds.length === 0) {
    res.status(400).json({ error: { code: "validation_failed", message: "accountId and a non-empty kantataIds are required" } });
    return;
  }

  const token = graphTokenFrom(req.headers);
  if (!token) {
    res.status(400).json({ error: { code: "graph_token_required", message: "X-Graph-Token header is required" } });
    return;
  }
  const kantataToken = process.env.KANTATA_API_TOKEN;
  if (!kantataToken) {
    res.status(500).json({ error: { code: "internal_error", message: "KANTATA_API_TOKEN not set" } });
    return;
  }

  try {
    const result = await withUserContext(auth.userId!, async (tx) => {
      const [account] = await tx<AccountRow[]>`
        select id, ms_drive_id, kantata_project_ids from collab.client_account where id = ${accountId}
      `;
      if (!account) return { kind: "not_found" as const };

      const [access] = await tx<{ ok: boolean }[]>`select collab.is_workspace_admin(${accountId}) as ok`;
      if (!access?.ok) return { kind: "not_found" as const };
      if (!account.ms_drive_id) return { kind: "not_provisioned" as const };

      const tree = await desiredFolderTree(kantataToken, account.kantata_project_ids);
      const treeById = new Map(tree.map((n) => [n.kantataId, n] as const));
      const projectFolders = await tx<{ kantata_id: string; folder_id: string }[]>`
        select kantata_id, folder_id from collab.ms_folder where account_id = ${accountId} and level = 'project'
      `;
      const projectFolderIdByKantataId = new Map(projectFolders.map((f) => [f.kantata_id, f.folder_id] as const));
      const alreadyFoldered = new Set(
        (await tx<{ kantata_id: string }[]>`select kantata_id from collab.ms_folder where account_id = ${accountId} and kantata_id = any(${kantataIds})`).map((r) => r.kantata_id),
      );

      const createdFolders: { kantataId: string; name: string }[] = [];
      const alreadyHadFolder: string[] = [];
      const invalid: { kantataId: string; reason: string }[] = [];

      for (const kantataId of kantataIds) {
        if (alreadyFoldered.has(kantataId)) {
          alreadyHadFolder.push(kantataId);
          continue;
        }
        const node = treeById.get(kantataId);
        if (!node) {
          invalid.push({ kantataId, reason: "not a known Kantata id for this account's linked projects" });
          continue;
        }
        if (node.level !== "milestone") {
          invalid.push({ kantataId, reason: `level is '${node.level}', not a top-level milestone — nested milestones and tasks are created on demand, not from the picker` });
          continue;
        }
        const parentFolderId = node.parentKantataId ? projectFolderIdByKantataId.get(node.parentKantataId) : undefined;
        if (!parentFolderId) {
          invalid.push({ kantataId, reason: "its project has no folder yet — run folders/sync first" });
          continue;
        }

        const name = folderNameFor(node.title);
        let folder = (await graphFetch(token, `/drives/${account.ms_drive_id}/items/${parentFolderId}:/${encodeURIComponent(name)}`, { tolerate404: true })) as { id: string } | null;
        if (!folder) {
          folder = (await graphFetch(token, `/drives/${account.ms_drive_id}/items/${parentFolderId}/children`, {
            method: "POST",
            body: { name, folder: {}, "@microsoft.graph.conflictBehavior": "fail" },
          })) as { id: string };
        }
        await tx`
          insert into collab.ms_folder (account_id, kantata_id, folder_id, parent_folder_id, name, level)
          values (${accountId}, ${kantataId}, ${folder.id}, ${parentFolderId}, ${name}, 'milestone')
          on conflict (account_id, kantata_id) do update set folder_id = excluded.folder_id, name = excluded.name
        `;
        createdFolders.push({ kantataId, name });
      }

      return { kind: "ok" as const, createdFolders, alreadyHadFolder, invalid };
    });

    if (result.kind === "not_found") {
      res.status(404).json({ error: { code: "not_found", message: "account not found" } });
      return;
    }
    if (result.kind === "not_provisioned") {
      res.status(409).json({ error: { code: "conflict", message: "account has no adopted Team yet — call POST /api/account/:id/team first" } });
      return;
    }

    res.status(200).json({
      data: {
        created: result.createdFolders,
        alreadyHadFolder: result.alreadyHadFolder,
        ...(result.invalid.length > 0 ? { invalid: result.invalid } : {}),
      },
    });
  } catch (err) {
    try {
      const { status, body } = graphApiError(err);
      res.status(status).json(body);
    } catch {
      const { status, body } = toApiError(err);
      res.status(status).json(body);
    }
  }
}
