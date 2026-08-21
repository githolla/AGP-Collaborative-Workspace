/**
 * POST /api/files/upload-session (docs/api-spec-workspace-mutations.md
 * "Files and approvals"; teams-provisioning-plan.md B5a). Body:
 * `{ accountId, kantataId, name, size }`. Creates the folder `kantataId`
 * resolves to if it doesn't exist yet — B4 §5's own rule that a phase or
 * task folder is created "on demand... when someone uploads into one" — then
 * opens a Graph `createUploadSession` and returns its `uploadUrl` directly to
 * the caller.
 *
 * This endpoint never sees file bytes: `size` decides nothing server-side
 * (Graph's upload-session URL works the same for a 10KB or 100MB file), it
 * only exists so the caller can show a size before uploading. The browser
 * PUTs the actual content straight to `uploadUrl` in chunks — a pre-signed
 * Graph URL, not this API — and reads the finished `driveItem` (with its
 * real id) off Graph's own last-chunk response, not from us.
 *
 * Role: member, or an external whose OWN grant on `kantataId` is `write`
 * (holds_grant alone isn't enough — a client's grant is always read-only per
 * B7's "two audiences" table, so the role itself must be checked, not just
 * that a grant row exists).
 */

import { requireUser } from "./_lib/requireUser.js";
import { withUserContext } from "./_lib/db.js";
import { toApiError } from "./_lib/apiError.js";
import { graphTokenFrom, graphFetch, graphApiError } from "./_lib/graph.js";
import { desiredFolderTree, ensureFolderChain, ensureMsFolderForGraphId, isSyntheticFolderId, graphIdFromSynthetic } from "./_lib/msFolder.js";

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

  const b = req.body as { accountId?: unknown; kantataId?: unknown; name?: unknown; size?: unknown };
  const accountId = typeof b.accountId === "string" ? b.accountId : "";
  const kantataId = typeof b.kantataId === "string" ? b.kantataId : "";
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!accountId || !kantataId || !name) {
    res.status(400).json({ error: { code: "validation_failed", message: "accountId, kantataId and name are required" } });
    return;
  }

  const token = graphTokenFrom(req.headers);
  if (!token) {
    res.status(400).json({ error: { code: "graph_token_required", message: "X-Graph-Token header is required" } });
    return;
  }
  try {
    const result = await withUserContext(auth.userId!, async (tx) => {
      const [account] = await tx<{ ms_drive_id: string | null; kantata_project_ids: string[] }[]>`
        select ms_drive_id, kantata_project_ids from collab.client_account where id = ${accountId}
      `;
      if (!account) return { kind: "not_found" as const };

      const [access] = await tx<{ is_member: boolean; write_grant: boolean }[]>`
        select
          exists (select 1 from collab.account_member m where m.account_id = ${accountId} and m.user_id = auth.uid()) or collab.is_workspace_admin(${accountId}) as is_member,
          exists (select 1 from collab.access_grant g where g.account_id = ${accountId} and g.user_id = auth.uid() and g.kantata_id = ${kantataId} and g.role = 'write') as write_grant
      `;
      if (!access?.is_member && !access?.write_grant) return { kind: "not_found" as const };
      if (!account.ms_drive_id) return { kind: "not_provisioned" as const };

      let folderId: string;
      if (isSyntheticFolderId(kantataId)) {
        folderId = (await ensureMsFolderForGraphId(tx, token, accountId, account.ms_drive_id, graphIdFromSynthetic(kantataId))).folderId;
      } else {
        const kantataToken = process.env.KANTATA_API_TOKEN;
        if (!kantataToken) return { kind: "no_kantata_token" as const };
        const tree = await desiredFolderTree(kantataToken, account.kantata_project_ids);
        folderId = await ensureFolderChain(tx, token, accountId, account.ms_drive_id, tree, kantataId);
      }
      return { kind: "ok" as const, driveId: account.ms_drive_id, folderId };
    });

    if (result.kind === "not_found") {
      res.status(404).json({ error: { code: "not_found", message: "account or folder not found" } });
      return;
    }
    if (result.kind === "not_provisioned") {
      res.status(409).json({ error: { code: "conflict", message: "account has no adopted Team yet" } });
      return;
    }
    if (result.kind === "no_kantata_token") {
      res.status(500).json({ error: { code: "internal_error", message: "KANTATA_API_TOKEN not set" } });
      return;
    }

    const session = (await graphFetch(token, `/drives/${result.driveId}/items/${result.folderId}:/${encodeURIComponent(name)}:/createUploadSession`, {
      method: "POST",
      body: { item: { "@microsoft.graph.conflictBehavior": "rename" } },
    })) as { uploadUrl: string; expirationDateTime: string };

    res.status(200).json({ data: { uploadUrl: session.uploadUrl, expirationDateTime: session.expirationDateTime } });
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
