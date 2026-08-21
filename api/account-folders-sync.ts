/**
 * POST /api/account/:id/folders/sync (docs/api-spec-workspace-mutations.md
 * "Provisioning"; teams-provisioning-plan.md B4 §4 "What sync does"). No
 * body — per the spec's own "least surface" rule, this derives everything it
 * needs from data the server already owns: the account's linked Kantata
 * project ids (`client_account.kantata_project_ids`) and the mirrored
 * Kantata hierarchy (`mirror.kantata_workspaces`/`kantata_stories`), diffed
 * against `collab.ms_folder` (api/_lib/msFolder.ts's `desiredFolderTree`,
 * ported from msTeams.ts).
 *
 * Creates a folder for any linked project with none yet, at the drive root.
 * Renames (PATCH) any existing folder — at ANY level, not just project —
 * whose Kantata title changed since it was created, matching B4 §4's own
 * rule that rename applies everywhere even though creation here is
 * project-only. Reports (never deletes) folders whose Kantata id no longer
 * appears in the live tree. Never creates a milestone, phase or task folder
 * — that is the picker (api/account-folders.ts) or a grant (B4 §6).
 *
 * IDEMPOTENT: re-running creates nothing once every linked project has its
 * folder and every name matches.
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

interface MsFolderRow {
  id: string;
  kantata_id: string;
  folder_id: string;
  parent_folder_id: string | null;
  name: string;
  level: string;
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

  const accountId = typeof (req.body as { accountId?: unknown })?.accountId === "string" ? (req.body as { accountId: string }).accountId : "";
  if (!accountId) {
    res.status(400).json({ error: { code: "validation_failed", message: "accountId is required" } });
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

      // Checked explicitly, BEFORE any Graph call: the ms_folder write
      // policies below would eventually deny a non-admin's INSERT too, but
      // only after real SharePoint folders had already been created via the
      // forwarded token — a genuine side effect a plain member should never
      // be able to trigger, not just a DB write to block after the fact.
      const [access] = await tx<{ ok: boolean }[]>`select collab.is_workspace_admin(${accountId}) as ok`;
      if (!access?.ok) return { kind: "not_found" as const };

      if (!account.ms_drive_id) return { kind: "not_provisioned" as const };

      const tree = await desiredFolderTree(kantataToken, account.kantata_project_ids);
      const treeById = new Map(tree.map((n) => [n.kantataId, n] as const));
      const existing = await tx<MsFolderRow[]>`select id, kantata_id, folder_id, parent_folder_id, name, level from collab.ms_folder where account_id = ${accountId}`;
      const existingIds = new Set(existing.map((f) => f.kantata_id));

      const toCreate = tree.filter((n) => n.level === "project" && !existingIds.has(n.kantataId));
      const toRename = existing
        .map((f) => {
          const node = treeById.get(f.kantata_id);
          if (!node) return null;
          const newName = folderNameFor(node.title);
          return newName !== f.name ? { row: f, newName } : null;
        })
        .filter((x): x is { row: MsFolderRow; newName: string } => x !== null);
      const goneFromKantata = existing.filter((f) => !treeById.has(f.kantata_id));

      const created: { kantataId: string; name: string }[] = [];
      for (const node of toCreate) {
        const name = folderNameFor(node.title);
        let folder = (await graphFetch(token, `/drives/${account.ms_drive_id}/root:/${encodeURIComponent(name)}`, { tolerate404: true })) as { id: string } | null;
        if (!folder) {
          folder = (await graphFetch(token, `/drives/${account.ms_drive_id}/items/root/children`, {
            method: "POST",
            body: { name, folder: {}, "@microsoft.graph.conflictBehavior": "fail" },
          })) as { id: string };
        }
        await tx`
          insert into collab.ms_folder (account_id, kantata_id, folder_id, parent_folder_id, name, level)
          values (${accountId}, ${node.kantataId}, ${folder.id}, null, ${name}, 'project')
          on conflict (account_id, kantata_id) do update set folder_id = excluded.folder_id, name = excluded.name
        `;
        created.push({ kantataId: node.kantataId, name });
      }

      const renamed: { kantataId: string; name: string }[] = [];
      for (const { row, newName } of toRename) {
        await graphFetch(token, `/drives/${account.ms_drive_id}/items/${row.folder_id}`, { method: "PATCH", body: { name: newName } });
        await tx`update collab.ms_folder set name = ${newName} where id = ${row.id}`;
        renamed.push({ kantataId: row.kantata_id, name: newName });
      }

      return {
        kind: "ok" as const,
        created,
        renamed,
        goneFromKantata: goneFromKantata.map((f) => ({ kantataId: f.kantata_id, name: f.name, level: f.level })),
      };
    });

    if (result.kind === "not_found") {
      res.status(404).json({ error: { code: "not_found", message: "account not found" } });
      return;
    }
    if (result.kind === "not_provisioned") {
      res.status(409).json({ error: { code: "conflict", message: "account has no adopted Team yet — call POST /api/account/:id/team first" } });
      return;
    }

    res.status(200).json({ data: { created: result.created, renamed: result.renamed, goneFromKantata: result.goneFromKantata } });
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
