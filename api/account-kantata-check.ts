/**
 * GET /api/account-kantata-check?accountId= — the in-context Kantata
 * resourcing-data check a PM runs from the Resourcing tab. No workspace ids to
 * type: it reads THIS account's own linked Kantata workspaces
 * (client_account.kantata_project_ids — a Kantata "project" is a workspace) and
 * runs the shared check on them. Internal account members only (resourcing is
 * AGP-internal), so an external can't probe Kantata, and a caller can only ever
 * check their own account's workspaces.
 */

import { requireUser } from "./_lib/requireUser.js";
import { withUserContext } from "./_lib/db.js";
import { toApiError } from "./_lib/apiError.js";
import { checkKantataWorkspaces } from "./_lib/kantataHoursCheck.js";

export default async function handler(
  req: { method?: string; headers?: Record<string, string | string[] | undefined>; query?: Record<string, unknown> },
  res: { status: (code: number) => { json: (body: unknown) => void }; setHeader: (k: string, v: string) => void },
): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  if (req.method && req.method !== "GET") {
    res.status(405).json({ error: { code: "validation_failed", message: "GET only" } });
    return;
  }

  const auth = await requireUser(typeof req.headers?.authorization === "string" ? req.headers.authorization : undefined);
  if (!auth.authorized) {
    res.status(auth.status).json(auth.body);
    return;
  }

  const accountId = typeof req.query?.accountId === "string" ? req.query.accountId : "";
  if (!accountId) {
    res.status(400).json({ error: { code: "validation_failed", message: "accountId is required" } });
    return;
  }

  try {
    const gate = await withUserContext(auth.userId!, async (sql) => {
      const [me] = await sql<{ kind: string }[]>`select kind from collab.app_user where id = ${auth.userId!}`;
      if (me?.kind === "external") return { ok: false as const };
      const [access] = await sql<{ ok: boolean }[]>`select collab.is_account_member_or_admin(${accountId}) as ok`;
      if (!access?.ok) return { ok: false as const };
      const [acct] = await sql<{ kantata_project_ids: string[] | null }[]>`select kantata_project_ids from collab.client_account where id = ${accountId}`;
      return { ok: true as const, ids: acct?.kantata_project_ids ?? [] };
    });

    if (!gate.ok) {
      res.status(404).json({ error: { code: "not_found", message: "workspace not found or you're not a member" } });
      return;
    }
    if (gate.ids.length === 0) {
      res.status(200).json({ data: { configured: true, noKantataLink: true, workspaces: [] } });
      return;
    }

    res.status(200).json({ data: await checkKantataWorkspaces(gate.ids) });
  } catch (err) {
    const { status, body } = toApiError(err);
    res.status(status).json(body);
  }
}
