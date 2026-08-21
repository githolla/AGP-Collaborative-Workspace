/**
 * POST /api/external, DELETE /api/external — external (client/contractor)
 * link lifecycle (docs/api-spec-workspace-mutations.md's
 * `POST /api/account/:id/externals` / `DELETE .../externals/:externalId`).
 * Flat, method-dispatched, ids in the body — same convention as
 * api/account.ts and api/task.ts.
 *
 * This is the record that an external PERSON belongs to a workspace at all
 * (collab.external_link) — it carries no access by itself. What they can
 * actually reach is entirely `access_grant` rows (api/grant.ts): a workspace
 * admin adds someone here, then grants them specific milestones there. There
 * is no coarse "access" level on this row (unlike the old client-side
 * ExternalMember.access enum) — the whole point of the grant model is that
 * access is per-milestone, not a single workspace-wide setting.
 *
 * RETURNING is safe on both POST and DELETE here, unlike account creation:
 * external_link_insert/delete's policy is `is_workspace_admin(account_id)`,
 * and external_link_read's policy also accepts `is_workspace_admin(account_id)`
 * — the same admin who can write the row can always read it back, so there is
 * no bootstrap timing gap the way there is between creating an account and
 * becoming its first member.
 */

import { requireUser } from "./_lib/requireUser.js";
import { withUserContext, withServiceContext } from "./_lib/db.js";
import { toApiError } from "./_lib/apiError.js";
import { logActivity } from "./_lib/activity.js";
import { graphTokenFrom } from "./_lib/graph.js";
import { revokeGrantSharePoint, describeGrantRevokeOutcome } from "./_lib/grantRevoke.js";

interface ExternalRow {
  id: string;
  account_id: string;
  user_id: string | null;
  name: string;
  org: string;
  role: string;
  email: string | null;
  entra_status: string;
  entra_user_id: string | null;
  invited_by: string | null;
  last_active: string | null;
  created_at: string;
}

function toApi(e: ExternalRow) {
  return {
    id: e.id,
    accountId: e.account_id,
    ...(e.user_id ? { userId: e.user_id } : {}),
    name: e.name,
    org: e.org,
    role: e.role,
    ...(e.email ? { email: e.email } : {}),
    entraStatus: e.entra_status,
    ...(e.entra_user_id ? { entraUserId: e.entra_user_id } : {}),
    ...(e.invited_by ? { invitedBy: e.invited_by } : {}),
    ...(e.last_active ? { lastActive: e.last_active } : {}),
    createdAt: e.created_at,
  };
}

/**
 * PATCH /api/external — `{ externalId, resolveIdentity: true }`. A grant
 * (api/grant.ts) targets `collab.app_user.id`, which only exists once
 * someone has actually signed in — an external_link row added before that
 * has no `user_id` at all and cannot be granted anything yet. Nothing
 * populates it automatically: the auth trigger (0007) creates an app_user
 * row on first sign-in but has no way to know which external_link row(s) an
 * email belongs to, and `collab.app_user` deliberately carries no email
 * column to match against under RLS. This is the one bridge: an explicit,
 * admin-triggered lookup against `auth.users` (service role — the only
 * place email lives), matched to the SAME email already on this record
 * (never a different one supplied here), and only ever run after an
 * explicit is_workspace_admin check inside a real withUserContext
 * transaction (same discipline api/admin/users.ts documents for its own use
 * of withServiceContext).
 */
async function handleResolveIdentity(
  body: unknown,
  userId: string,
  res: { status: (code: number) => { json: (body: unknown) => void } },
): Promise<void> {
  const externalId = typeof (body as { externalId?: unknown })?.externalId === "string" ? (body as { externalId: string }).externalId : "";
  if (!externalId) {
    res.status(400).json({ error: { code: "validation_failed", message: "externalId is required" } });
    return;
  }

  try {
    const existing = await withUserContext(userId, async (tx) => {
      const [row] = await tx<ExternalRow[]>`
        select id, account_id, user_id, name, org, role, email, entra_status, entra_user_id, invited_by, last_active, created_at
        from collab.external_link where id = ${externalId}
      `;
      if (!row) return null;
      const [access] = await tx<{ ok: boolean }[]>`select collab.is_workspace_admin(${row.account_id}) as ok`;
      return access?.ok ? row : null;
    });
    if (!existing) {
      res.status(404).json({ error: { code: "not_found", message: "external not found" } });
      return;
    }
    if (existing.user_id) {
      res.status(200).json({ data: { ...toApi(existing), note: "already resolved" } });
      return;
    }
    if (!existing.email) {
      res.status(200).json({ data: { ...toApi(existing), note: "no email on file — nothing to match against" } });
      return;
    }

    const [authUser] = await withServiceContext(async (tx) => tx<{ id: string }[]>`select id from auth.users where lower(email) = lower(${existing.email}) limit 1`);
    if (!authUser) {
      res.status(200).json({ data: { ...toApi(existing), note: `no signed-in account found for ${existing.email} yet` } });
      return;
    }

    const [updated] = await withUserContext(userId, async (tx) => {
      const row = await tx<ExternalRow[]>`
        update collab.external_link set user_id = ${authUser.id}
        where id = ${externalId}
        returning id, account_id, user_id, name, org, role, email, entra_status, entra_user_id, invited_by, last_active, created_at
      `;
      // Graduates any grant(s) made before this person ever signed in
      // (api/grant.ts's externalLinkId path — the real Microsoft B2B invite
      // already fired off their email alone at grant time) into ordinary
      // resolved grants, now that a real user_id exists to connect them to.
      // Nothing is re-invited here; this only unlocks the app's own
      // RLS-gated screens (tasks/discussions), which key on auth.uid().
      await tx`
        update collab.access_grant set user_id = ${authUser.id}, external_link_id = null
        where external_link_id = ${externalId} and user_id is null
      `;
      return row;
    });
    if (!updated) throw new Error("update returned no row");
    res.status(200).json({ data: toApi(updated) });
  } catch (err) {
    const { status, body: errBody } = toApiError(err);
    res.status(status).json(errBody);
  }
}

async function handleCreate(
  body: unknown,
  userId: string,
  res: { status: (code: number) => { json: (body: unknown) => void } },
): Promise<void> {
  const b = body as { accountId?: unknown; name?: unknown; org?: unknown; email?: unknown; role?: unknown; userId?: unknown };
  const accountId = typeof b.accountId === "string" ? b.accountId : "";
  const name = typeof b.name === "string" ? b.name.trim() : "";
  const org = typeof b.org === "string" ? b.org.trim() : "";
  const role = b.role === "client" || b.role === "contractor" ? b.role : "";
  if (!accountId || !name || !org || !role) {
    res.status(400).json({ error: { code: "validation_failed", message: "accountId, name, org and role ('client' or 'contractor') are required" } });
    return;
  }
  const email = typeof b.email === "string" && b.email.trim() ? b.email.trim() : null;
  // Set only by the "pick an existing person" picker (ClientAdminPanel.tsx),
  // never typed by hand — an already-known collab.app_user id, so the row
  // is born resolved instead of waiting on a future "Resolve sign-in".
  const knownUserId = typeof b.userId === "string" && b.userId.trim() ? b.userId.trim() : null;

  try {
    const result = await withUserContext(userId, async (tx) => {
      if (knownUserId) {
        const existingRows = await tx<ExternalRow[]>`
          select id, account_id, user_id, name, org, role, email, entra_status, entra_user_id, invited_by, last_active, created_at
          from collab.external_link where account_id = ${accountId} and user_id = ${knownUserId}
        `;
        if (existingRows[0]) return { kind: "existing" as const, row: existingRows[0] };

        const [knownUser] = await tx<{ id: string }[]>`select id from collab.app_user where id = ${knownUserId}`;
        if (!knownUser) throw new Error("no known person with that id");
      }

      const [me] = await tx<{ display_name: string }[]>`select display_name from collab.app_user where id = ${userId}`;
      // ON CONFLICT, not a plain INSERT: (account_id, lower(trim(name)))
      // is now a real unique index (0023) — the free-text "invite" path had
      // no dedup at all before, unlike the "pick an existing person"
      // picker above. IDEMPOTENT BY DESIGN (api-spec rule 5), same as
      // api/member.ts's own duplicate-add path: adding someone already on
      // the account by name is a no-op success, not a 409.
      const rows = await tx<ExternalRow[]>`
        insert into collab.external_link (account_id, user_id, name, org, role, email, invited_by)
        values (${accountId}, ${knownUserId}, ${name}, ${org}, ${role}, ${email}, ${me?.display_name ?? "Unknown"})
        on conflict (account_id, lower(trim(name))) do nothing
        returning id, account_id, user_id, name, org, role, email, entra_status, entra_user_id, invited_by, last_active, created_at
      `;
      if (rows[0]) {
        await logActivity(tx, accountId, `${role === "client" ? "Client" : "Contractor"} access granted — ${name} (${org})`, "team");
        return { kind: "created" as const, row: rows[0] };
      }
      const [existing] = await tx<ExternalRow[]>`
        select id, account_id, user_id, name, org, role, email, entra_status, entra_user_id, invited_by, last_active, created_at
        from collab.external_link where account_id = ${accountId} and lower(trim(name)) = lower(trim(${name}))
      `;
      if (!existing) throw new Error("insert returned no row and no existing row found");
      return { kind: "existing" as const, row: existing };
    });

    res.status(200).json({
      data: {
        ...toApi(result.row),
        ...(result.kind === "existing" ? { note: "already on this account — no change made" } : {}),
      },
    });
  } catch (err) {
    const { status, body: errBody } = toApiError(err);
    res.status(status).json(errBody);
  }
}

async function handleDelete(
  body: unknown,
  userId: string,
  headers: Record<string, string | string[] | undefined> | undefined,
  res: { status: (code: number) => { json: (body: unknown) => void } },
): Promise<void> {
  const externalId = typeof (body as { externalId?: unknown })?.externalId === "string" ? (body as { externalId: string }).externalId : "";
  if (!externalId) {
    res.status(400).json({ error: { code: "validation_failed", message: "externalId is required" } });
    return;
  }

  try {
    const graphToken = graphTokenFrom(headers) ?? undefined;
    const result = await withUserContext(userId, async (tx) => {
      const [ext] = await tx<{ id: string; account_id: string; user_id: string | null; name: string; org: string }[]>`
        select id, account_id, user_id, name, org from collab.external_link where id = ${externalId}
      `;
      // external_link_read's policy denies silently — a missing row here
      // means either the id is wrong or the caller cannot manage it,
      // collapsed into not_found like every other endpoint's write-miss path.
      if (!ext) return { kind: "not_found" as const };

      // Removing an external MUST revoke everything real they held first —
      // this row is the only thing standing between them and re-adding
      // themselves back with the same name, so leaving a live SharePoint
      // permission behind here is exactly the silent, stale hole this
      // action's own job is to close. Grants can be keyed by either
      // external_link_id (never signed in yet) or user_id (resolved) —
      // never both for the same grant, but a person can hold either kind
      // depending on when each grant was made relative to their sign-in.
      const grants = await tx<{ id: string; kantata_id: string; ms_permission_id: string | null }[]>`
        select id, kantata_id, ms_permission_id from collab.access_grant
        where account_id = ${ext.account_id} and (external_link_id = ${externalId} or user_id = ${ext.user_id})
      `;
      const failures: { kantataId: string; detail: string }[] = [];
      for (const g of grants) {
        const outcome = await revokeGrantSharePoint(tx, ext.account_id, g.kantata_id, g.ms_permission_id, graphToken);
        if (outcome.kind === "ok") {
          await tx`delete from collab.access_grant where id = ${g.id}`;
        } else {
          failures.push({ kantataId: g.kantata_id, detail: describeGrantRevokeOutcome(outcome) });
        }
      }
      // Any grant that couldn't be confirmed revoked blocks the whole
      // removal — the external_link row stays (and so do its still-real
      // grants), rather than removing "them" from the account while they
      // can still open the files.
      if (failures.length > 0) return { kind: "incomplete" as const, failures };

      const [row] = await tx<{ id: string; account_id: string; name: string; org: string }[]>`
        delete from collab.external_link where id = ${externalId} returning id, account_id, name, org
      `;
      if (!row) return { kind: "not_found" as const };
      await logActivity(tx, row.account_id, `Access removed — ${row.name} (${row.org})`, "team");
      return { kind: "ok" as const, id: row.id };
    });

    if (result.kind === "not_found") {
      res.status(404).json({ error: { code: "not_found", message: "external not found" } });
      return;
    }
    if (result.kind === "incomplete") {
      res.status(409).json({
        error: {
          code: "conflict",
          message: `could not confirm ${result.failures.length} SharePoint permission${result.failures.length === 1 ? "" : "s"} were revoked — access was NOT removed`,
          detail: result.failures.map((f) => `${f.kantataId}: ${f.detail}`).join("; "),
        },
      });
      return;
    }
    res.status(200).json({ data: { id: result.id } });
  } catch (err) {
    const { status, body: errBody } = toApiError(err);
    res.status(status).json(errBody);
  }
}

export default async function handler(
  req: { method?: string; body?: unknown; headers?: Record<string, string | string[] | undefined> },
  res: {
    status: (code: number) => { json: (body: unknown) => void };
    setHeader: (k: string, v: string) => void;
  },
): Promise<void> {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST" && req.method !== "DELETE" && req.method !== "PATCH") {
    res.status(405).json({ error: { code: "validation_failed", message: "POST, PATCH or DELETE" } });
    return;
  }

  const authHeader = typeof req.headers?.authorization === "string" ? req.headers.authorization : undefined;
  const auth = await requireUser(authHeader);
  if (!auth.authorized) {
    res.status(auth.status).json(auth.body);
    return;
  }

  if (req.method === "POST") await handleCreate(req.body, auth.userId!, res);
  else if (req.method === "PATCH") await handleResolveIdentity(req.body, auth.userId!, res);
  else await handleDelete(req.body, auth.userId!, req.headers, res);
}
