/**
 * POST /api/account, PATCH /api/account — collab-schema account lifecycle
 * (docs/api-spec-workspace-mutations.md). One file, dispatched on method —
 * matching api/kantata-write.ts's convention, not a Vercel `[id]` dynamic
 * route: this repo has never used one, and a dynamic segment lands in
 * `req.query` under Vercel but `req.params` under Express (server.mts, for
 * the Azure host), which would need its own compatibility shim for no real
 * benefit. The account id travels in the body instead, for both methods.
 *
 * POST creates the workspace AND makes the caller its first workspace admin,
 * in one transaction — the bootstrap path collab.user_role_insert's policy
 * exists for (0008: "did the caller create this account?", via
 * collab.created_this_account, not a plain subquery, because a plain one
 * would deadlock against client_account_read's own policy). Both writes
 * happen here for exactly that reason: an account with no admin is not
 * useful to anyone, itself included.
 *
 * `fromMirror` is accepted for shape-compatibility with the client's
 * `createAccountFromMirror`, but NOT implemented in this pass — pulling
 * Kantata's live mirror into a new account is real, separate work
 * (`POST /api/account/:id/import` in the spec) and is not attempted here.
 * A request with `fromMirror: true` still creates a plain empty workspace
 * and says so in the response, rather than silently ignoring the flag.
 */

import { randomUUID } from "node:crypto";
import { requireUser } from "./_lib/requireUser.js";
import { withUserContext, withServiceContext } from "./_lib/db.js";
import { toApiError } from "./_lib/apiError.js";
import { logActivity } from "./_lib/activity.js";

interface AccountRow {
  id: string;
  client_name: string;
  archived: boolean;
  created_at: string;
}

function toApi(a: AccountRow) {
  return { id: a.id, clientName: a.client_name, archived: a.archived, createdAt: a.created_at };
}

async function handleCreate(
  body: unknown,
  userId: string,
  res: { status: (code: number) => { json: (body: unknown) => void } },
): Promise<void> {
  const clientName = typeof (body as { clientName?: unknown })?.clientName === "string" ? (body as { clientName: string }).clientName.trim() : "";
  if (!clientName) {
    res.status(400).json({ error: { code: "validation_failed", message: "clientName is required" } });
    return;
  }
  const fromMirror = (body as { fromMirror?: unknown })?.fromMirror === true;

  // GET-OR-CREATE by name, run under the ELEVATED context so it can see a
  // canonical account for this client even when the caller isn't a member yet.
  // Without this, account visibility is per-member but identity is by name, so
  // two internal people opening the same client each minted their OWN row and
  // silently forked the workspace. Now everyone binds to one account per name,
  // and the caller is added as a member/admin if not already.
  //
  // Internal-only: creating/joining an account by name is an AGP-staff action
  // (externals never reach this — they use ExternalWorkspace), so an external
  // can't self-join a workspace by guessing its name.
  const account = await withServiceContext(async (tx) => {
    const [who] = await tx<{ kind: string }[]>`select kind from collab.app_user where id = ${userId}`;
    if (who?.kind === "external") throw new Error("only internal users can create a workspace");

    const [existing] = await tx<AccountRow[]>`
      select id, client_name, archived, created_at from collab.client_account
      where lower(client_name) = lower(${clientName}) and not archived
      order by created_at asc limit 1
    `;
    const accountId = existing?.id ?? randomUUID();
    if (!existing) {
      await tx`insert into collab.client_account (id, client_name, created_by) values (${accountId}, ${clientName}, ${userId})`;
      await logActivity(tx, accountId, "Workspace created", "workspace");
    }

    // Ensure the caller is a workspace admin + member (only if not already, so
    // re-opening never duplicates rows).
    const [hasRole] = await tx<{ x: number }[]>`select 1 as x from collab.user_role where user_id = ${userId} and account_id = ${accountId} limit 1`;
    if (!hasRole) {
      await tx`insert into collab.user_role (user_id, role, account_id, granted_by) values (${userId}, 'workspace_admin', ${accountId}, ${userId})`;
    }
    const [isMember] = await tx<{ x: number }[]>`select 1 as x from collab.account_member where account_id = ${accountId} and user_id = ${userId} limit 1`;
    if (!isMember) {
      const [me] = await tx<{ display_name: string; title: string | null }[]>`select display_name, title from collab.app_user where id = ${userId}`;
      await tx`insert into collab.account_member (account_id, user_id, person_id, name, title) values (${accountId}, ${userId}, ${"u-" + userId}, ${me?.display_name ?? "Unknown"}, ${me?.title ?? null})`;
    }

    const [row] = await tx<AccountRow[]>`select id, client_name, archived, created_at from collab.client_account where id = ${accountId}`;
    if (!row) throw new Error("could not read back the account");
    return row;
  });

  res.status(200).json({
    data: {
      ...toApi(account),
      ...(fromMirror ? { note: "fromMirror was requested but Kantata import is not built yet — this is a plain, empty workspace" } : {}),
    },
  });
}

async function handleUpdate(
  body: unknown,
  userId: string,
  res: { status: (code: number) => { json: (body: unknown) => void } },
): Promise<void> {
  const b = body as { id?: unknown; clientName?: unknown; archived?: unknown };
  const id = typeof b?.id === "string" ? b.id : "";
  if (!id) {
    res.status(400).json({ error: { code: "validation_failed", message: "id is required" } });
    return;
  }
  const clientName = typeof b.clientName === "string" ? b.clientName.trim() : null;
  const archived = typeof b.archived === "boolean" ? b.archived : null;
  if (clientName === null && archived === null) {
    res.status(400).json({ error: { code: "validation_failed", message: "clientName or archived is required" } });
    return;
  }

  const [updated] = await withUserContext(userId, async (tx) => {
    const [row] = await tx<AccountRow[]>`
      update collab.client_account
      set
        client_name = coalesce(${clientName}, client_name),
        archived = coalesce(${archived}, archived)
      where id = ${id}
      returning id, client_name, archived, created_at
    `;
    if (row) {
      if (clientName !== null) await logActivity(tx, id, `Workspace linked to CRM client "${clientName}"`, "workspace");
      if (archived !== null) await logActivity(tx, id, archived ? "Workspace archived — history retained" : "Workspace restored from archive", "workspace");
    }
    return row ? [row] : [];
  });

  // RLS silently returns zero rows for both "doesn't exist" and "exists but
  // you are not its workspace admin" — collapsed here into not_found rather
  // than distinguished, so a caller with no access learns nothing about
  // whether the id is even real.
  if (!updated) {
    res.status(404).json({ error: { code: "not_found", message: "account not found" } });
    return;
  }

  res.status(200).json({ data: toApi(updated) });
}

export default async function handler(
  req: { method?: string; body?: unknown; headers?: Record<string, string | string[] | undefined> },
  res: {
    status: (code: number) => { json: (body: unknown) => void };
    setHeader: (k: string, v: string) => void;
  },
): Promise<void> {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST" && req.method !== "PATCH") {
    res.status(405).json({ error: { code: "validation_failed", message: "POST or PATCH" } });
    return;
  }

  const authHeader = typeof req.headers?.authorization === "string" ? req.headers.authorization : undefined;
  const auth = await requireUser(authHeader);
  if (!auth.authorized) {
    res.status(auth.status).json(auth.body);
    return;
  }

  try {
    if (req.method === "POST") await handleCreate(req.body, auth.userId!, res);
    else await handleUpdate(req.body, auth.userId!, res);
  } catch (err) {
    const { status, body } = toApiError(err);
    res.status(status).json(body);
  }
}
