/**
 * GET /api/admin/kantata-diagnostic?workspaceIds=45402856,45442936 — app-admin
 * only. The arbitrary-workspace-ids version of the Kantata resourcing-data
 * check (shared core in _lib/kantataHoursCheck). The in-context version each PM
 * uses is api/account-kantata-check (their own account's workspaces, no ids to
 * type). Both answer "does this workspace have hours we can pull?".
 */

import { requireUser } from "../_lib/requireUser.js";
import { isAppAdmin } from "../_lib/requireAppAdmin.js";
import { toApiError } from "../_lib/apiError.js";
import { checkKantataWorkspaces } from "../_lib/kantataHoursCheck.js";

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
  if (!(await isAppAdmin(auth.userId!))) {
    res.status(403).json({ error: { code: "forbidden", message: "app admins only" } });
    return;
  }

  const raw = typeof req.query?.workspaceIds === "string" ? req.query.workspaceIds : "";
  const workspaceIds = raw.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 10);
  if (workspaceIds.length === 0) {
    res.status(400).json({ error: { code: "validation_failed", message: "workspaceIds is required (comma-separated Kantata workspace ids)" } });
    return;
  }

  try {
    res.status(200).json({ data: await checkKantataWorkspaces(workspaceIds) });
  } catch (err) {
    const { status, body } = toApiError(err);
    res.status(status).json(body);
  }
}
