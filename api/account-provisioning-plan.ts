/**
 * GET /api/account/:id/provisioning-plan — `api/account-provisioning-plan.ts`
 * (docs/api-spec-workspace-mutations.md "Provisioning"; teams-provisioning-plan.md
 * B4 §7 "Confirm the project list before the first provision"). No Graph
 * call — X-Graph-Token isn't needed — but it DOES need a live Kantata pull
 * (`KANTATA_API_TOKEN`) to compute the tree; see `desiredFolderTree`'s own
 * header for why this isn't a plain Postgres read. Returns the FULL desired
 * folder tree for the account's linked Kantata projects, plus which nodes
 * already have a real folder.
 *
 * This is deliberately the one place the client asks for the whole tree
 * instead of computing it itself: the tab app's own `accountLiveContext`/
 * `folderTreeOf` machinery is keyed to the OLD single-JSON-document
 * `ClientAccount` model, not `collab.client_account` — reusing it here would
 * require bridging two account universes that are not bridged yet (a
 * separate, larger piece of work). The server already derives this same
 * tree for the WRITE path (account-folders-sync.ts, account-folders.ts,
 * grant.ts); exposing it as a read is the same computation, not a second
 * implementation.
 *
 * `workspace_admin`, per the spec — this previews exactly what a provision
 * or a milestone-picker run would create, which is not anyone's business
 * to see who cannot also trigger it.
 */

import { requireUser } from "./_lib/requireUser.js";
import { withUserContext } from "./_lib/db.js";
import { desiredFolderTree } from "./_lib/msFolder.js";

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
  if (!accountId) {
    res.status(400).json({ error: { code: "validation_failed", message: "accountId is required" } });
    return;
  }
  const kantataToken = process.env.KANTATA_API_TOKEN;
  if (!kantataToken) {
    res.status(500).json({ error: { code: "internal_error", message: "KANTATA_API_TOKEN not set" } });
    return;
  }

  try {
    const result = await withUserContext(auth.userId!, async (tx) => {
      const [account] = await tx<{ kantata_project_ids: string[] }[]>`select kantata_project_ids from collab.client_account where id = ${accountId}`;
      if (!account) return { kind: "not_found" as const };

      const [access] = await tx<{ ok: boolean }[]>`select collab.is_workspace_admin(${accountId}) as ok`;
      if (!access?.ok) return { kind: "not_found" as const };

      const tree = await desiredFolderTree(kantataToken, account.kantata_project_ids);
      const existing = await tx<{ kantata_id: string }[]>`select kantata_id from collab.ms_folder where account_id = ${accountId}`;
      const existingIds = new Set(existing.map((f) => f.kantata_id));

      return {
        kind: "ok" as const,
        tree: tree.map((n) => ({ kantataId: n.kantataId, title: n.title, level: n.level, parentKantataId: n.parentKantataId, hasFolder: existingIds.has(n.kantataId) })),
      };
    });

    if (result.kind === "not_found") {
      res.status(404).json({ error: { code: "not_found", message: "account not found" } });
      return;
    }

    res.status(200).json({ data: { tree: result.tree } });
  } catch (err) {
    res.status(500).json({ error: { code: "internal_error", message: err instanceof Error ? err.message : "query failed" } });
  }
}
