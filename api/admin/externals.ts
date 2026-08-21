/**
 * GET /api/admin/externals — `GET /api/admin/externals`
 * (docs/api-spec-workspace-mutations.md): every external across every
 * workspace, app admin only.
 *
 * Plain `withUserContext`, not the service-role crossing api/admin/users.ts
 * needs — `collab.external_link` already carries its own `email` column
 * (unlike app_user), and `external_link_read`'s policy (0008) already
 * accepts `is_workspace_admin(account_id)`, which `is_app_admin()` satisfies
 * for every account. The caller's own JWT already sees everything here.
 */

import { requireUser } from "../_lib/requireUser.js";
import { withUserContext } from "../_lib/db.js";
import { isAppAdmin } from "../_lib/requireAppAdmin.js";

interface ExternalRow {
  id: string;
  account_id: string;
  client_name: string;
  user_id: string | null;
  name: string;
  org: string;
  role: string;
  email: string | null;
  entra_status: string;
  last_active: string | null;
  created_at: string;
}

export default async function handler(
  req: { method?: string; headers?: Record<string, string | string[] | undefined> },
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
  const callerId = auth.userId!;

  if (!(await isAppAdmin(callerId))) {
    res.status(403).json({ error: { code: "forbidden", message: "app admins only" } });
    return;
  }

  const rows = await withUserContext(callerId, async (tx) => {
    return tx<ExternalRow[]>`
      select el.id, el.account_id, ca.client_name, el.user_id, el.name, el.org, el.role, el.email, el.entra_status, el.last_active, el.created_at
      from collab.external_link el
      join collab.client_account ca on ca.id = el.account_id
      order by el.created_at desc
    `;
  });

  res.status(200).json({
    data: {
      externals: rows.map((e) => ({
        id: e.id,
        accountId: e.account_id,
        clientName: e.client_name,
        ...(e.user_id ? { userId: e.user_id } : {}),
        name: e.name,
        org: e.org,
        role: e.role,
        ...(e.email ? { email: e.email } : {}),
        entraStatus: e.entra_status,
        ...(e.last_active ? { lastActive: e.last_active } : {}),
        createdAt: e.created_at,
      })),
    },
  });
}
