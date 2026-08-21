/**
 * POST /api/grant, DELETE /api/grant/:grantId — the milestone grant
 * (docs/api-spec-workspace-mutations.md, "People, grants and access"). Flat,
 * method-dispatched, ids in the body — same convention as api/account.ts and
 * api/task.ts. `POST /api/grant/revoke-all` is a distinct route (a real
 * static path segment, not a dynamic one) and lives in api/grant/revoke-all.ts.
 *
 * The spec documents this as a TWO-effect mutation: it writes the
 * collab.access_grant row AND issues a SharePoint invite on the milestone's
 * folder, via the caller's own delegated Graph token (X-Graph-Token) —
 * api/account-team.ts and api/account-folders*.ts now write collab.ms_folder,
 * so the invite is attempted for real. The folder is created first if it
 * doesn't exist yet (B4 §6, via ensureFolderChain) rather than refusing —
 * granting a milestone with no folder is the single-item path to the same
 * place the picker (B4 §5) reaches in bulk. `retainInheritedPermissions` is
 * pinned true (B7: false strips every inherited grant, internal staff
 * included). If the account has no adopted Team/drive yet, or the target
 * user has no resolvable email (external_link.email — the invite address is
 * always the one on the person's own record, never re-typed, B7's own rule),
 * the SharePoint half is reported honestly as failed with a reason: the row
 * is real, the UI shows a half-grant with a retry, never a silent gap.
 * `/invite` itself returning an empty `value` is NOT one of those genuine
 * failures — Graph does that when the recipient already holds some
 * permission on the item, so `issueSharePointInvite` falls back to reading
 * the item's actual permissions before it reports a failure that isn't real
 * (confirmed live: a grant reported "failed" here still let the person
 * upload directly in SharePoint).
 *
 * RETURNING is safe on POST here: access_grant_insert's policy is
 * `is_workspace_admin(account_id)`, and access_grant_read's policy also
 * accepts `is_workspace_admin(account_id)` (or `user_id = auth.uid()`) — the
 * admin who can write the row can always read it back, no bootstrap gap.
 *
 * IDEMPOTENT (api-spec rule 5): re-granting the same (account, user,
 * kantataId) — the table's own unique constraint — checks for an existing
 * row first rather than letting a repeat POST hit the constraint and 409.
 * A repeat with the SAME role is a true no-op ("unchanged"); a repeat with a
 * DIFFERENT role updates it in place ("updated") rather than silently
 * ignoring a real role-change request the caller explicitly asked for.
 */

import { requireUser } from "./_lib/requireUser.js";
import { withUserContext } from "./_lib/db.js";
import { toApiError } from "./_lib/apiError.js";
import { graphTokenFrom, graphFetch, graphApiError } from "./_lib/graph.js";
import { revokeGrantSharePoint } from "./_lib/grantRevoke.js";
import { desiredFolderTree, ensureFolderChain, ensureMsFolderForGraphId, isSyntheticFolderId, graphIdFromSynthetic } from "./_lib/msFolder.js";
import type postgres from "postgres";

const LEVELS = new Set(["project", "milestone", "phase", "task", "folder"]);
const ROLES = new Set(["read", "write"]);

interface GrantRow {
  id: string;
  account_id: string;
  // Exactly one of user_id/external_link_id is ever null — a grant can be
  // created for a person who hasn't signed in yet (targeted by
  // external_link_id alone; api/external.ts's "Resolve sign-in" backfills
  // user_id and clears external_link_id once they do), or for an already-
  // resolved person (the original, still-supported path).
  user_id: string | null;
  external_link_id: string | null;
  kantata_id: string;
  level: string;
  role: string;
  ms_permission_id: string | null;
  created_at: string;
}

interface SharePointOutcome {
  sharePoint: "granted" | "failed";
  detail: string;
  msPermissionId?: string;
}

interface PermissionLike {
  id: string;
  grantedToV2?: { user?: { id?: string; email?: string } };
  grantedToIdentitiesV2?: { user?: { id?: string; email?: string } }[];
  invitation?: { email?: string };
}

/** Every email a permission object names, anywhere Graph might put one —
 * the direct grantee, one of several identities on a shared link, or the
 * original invite address — lower-cased for a case-insensitive match. */
function permissionEmails(p: PermissionLike): string[] {
  const emails = [p.grantedToV2?.user?.email, p.invitation?.email, ...(p.grantedToIdentitiesV2 ?? []).map((i) => i.user?.email)];
  return emails.filter((e): e is string => !!e).map((e) => e.toLowerCase());
}

/**
 * Issues the actual SharePoint invite for a just-written/updated grant row.
 * Never throws — a Graph or lookup failure is reported as `sharePoint:
 * "failed"` with a reason (api-spec rule 6: partial failure returned, never
 * swallowed and never a 4xx by itself), since the Postgres row is already
 * real either way.
 */
async function issueSharePointInvite(tx: postgres.TransactionSql, token: string | undefined, grant: GrantRow, role: string): Promise<SharePointOutcome> {
  if (!token) return { sharePoint: "failed", detail: "no X-Graph-Token provided" };

  const [account] = await tx<{ ms_drive_id: string | null; kantata_project_ids: string[] }[]>`
    select ms_drive_id, kantata_project_ids from collab.client_account where id = ${grant.account_id}
  `;
  if (!account?.ms_drive_id) return { sharePoint: "failed", detail: "account has no adopted Team/drive yet" };

  // Matches on WHICHEVER of the two is set — grant.external_link_id for a
  // still-pending grant (the whole point: this invite must fire off email
  // alone, before any sign-in), grant.user_id for an already-resolved one.
  const [target] = await tx<{ email: string | null }[]>`
    select email from collab.external_link where account_id = ${grant.account_id} and (id = ${grant.external_link_id} or user_id = ${grant.user_id})
  `;
  const email = target?.email;
  if (!email) return { sharePoint: "failed", detail: "no email on record for this person (external_link.email) — nothing to invite" };

  try {
    let folderId: string;
    if (isSyntheticFolderId(grant.kantata_id)) {
      // A browsed, non-Kantata folder — no tree to walk, the folder already
      // exists in SharePoint, this just resolves/records it.
      folderId = (await ensureMsFolderForGraphId(tx, token, grant.account_id, account.ms_drive_id, graphIdFromSynthetic(grant.kantata_id))).folderId;
    } else {
      const kantataToken = process.env.KANTATA_API_TOKEN;
      if (!kantataToken) return { sharePoint: "failed", detail: "KANTATA_API_TOKEN not set" };
      const tree = await desiredFolderTree(kantataToken, account.kantata_project_ids);
      folderId = await ensureFolderChain(tx, token, grant.account_id, account.ms_drive_id, tree, grant.kantata_id);
    }

    const invite = (await graphFetch(token, `/drives/${account.ms_drive_id}/items/${folderId}/invite`, {
      method: "POST",
      body: {
        recipients: [{ email }],
        roles: [role === "write" ? "write" : "read"],
        requireSignIn: true,
        sendInvitation: true,
        retainInheritedPermissions: true,
      },
    })) as { value: PermissionLike[] };

    let granted = invite.value?.[0];
    if (!granted) {
      // Graph documents `/invite` returning an EMPTY `value` — not an error —
      // when the recipient already holds some permission on the item, since
      // there is then no NEW permission object to hand back. Confirmed live:
      // a grant reported "failed" here still let the person upload directly
      // in SharePoint. So an empty value isn't itself proof of failure —
      // check the item's actual permissions for this email before reporting
      // one that isn't real.
      const perms = (await graphFetch(token, `/drives/${account.ms_drive_id}/items/${folderId}/permissions`)) as { value: PermissionLike[] };
      granted = perms.value?.find((p) => permissionEmails(p).includes(email.toLowerCase()));
    }
    if (!granted) return { sharePoint: "failed", detail: "Graph returned no permission for the invited recipient" };

    const entraUserId = granted.grantedToV2?.user?.id;
    await tx`
      update collab.external_link set entra_status = 'invited', entra_user_id = coalesce(${entraUserId ?? null}, entra_user_id)
      where account_id = ${grant.account_id} and (id = ${grant.external_link_id} or user_id = ${grant.user_id})
    `;

    return { sharePoint: "granted", detail: "invited", msPermissionId: granted.id };
  } catch (err) {
    return { sharePoint: "failed", detail: err instanceof Error ? err.message : "Graph request failed" };
  }
}

async function handleCreate(
  body: unknown,
  userId: string,
  headers: Record<string, string | string[] | undefined> | undefined,
  res: { status: (code: number) => { json: (body: unknown) => void } },
): Promise<void> {
  const b = body as { accountId?: unknown; userId?: unknown; externalLinkId?: unknown; kantataId?: unknown; level?: unknown; role?: unknown };
  const accountId = typeof b.accountId === "string" ? b.accountId : "";
  const targetUserId = typeof b.userId === "string" ? b.userId : "";
  // Grants a not-yet-signed-in external directly by their external_link row
  // — the fix for the ordering bug where a real Microsoft B2B invite (which
  // only ever needed an email address) couldn't fire until the person had
  // already signed in. Used only when userId isn't given.
  const externalLinkId = typeof b.externalLinkId === "string" ? b.externalLinkId : "";
  const kantataId = typeof b.kantataId === "string" ? b.kantataId : "";
  const level = typeof b.level === "string" && LEVELS.has(b.level) ? b.level : "";
  const role = typeof b.role === "string" && ROLES.has(b.role) ? b.role : "";
  if (!accountId || (!targetUserId && !externalLinkId) || !kantataId || !level || !role) {
    res.status(400).json({
      error: {
        code: "validation_failed",
        message: "accountId, one of userId/externalLinkId, kantataId, level ('project'|'milestone'|'phase'|'task'|'folder') and role ('read'|'write') are required",
      },
    });
    return;
  }
  // 'folder' names a browsed, non-Kantata folder (its kantataId is the
  // synthetic "graph:"-prefixed id from api/_lib/msFolder.ts) — the two
  // must agree, or issueSharePointInvite's branch below would be fed an id
  // shaped for the wrong resolution path.
  if ((level === "folder") !== isSyntheticFolderId(kantataId)) {
    res.status(400).json({ error: { code: "validation_failed", message: "level 'folder' requires a graph:-prefixed kantataId, and vice versa" } });
    return;
  }

  try {
    const graphToken = graphTokenFrom(headers) ?? undefined;
    const result = await withUserContext(userId, async (tx) => {
      // Checked explicitly, BEFORE any read/write below: POST /api/grant is
      // workspace_admin-only, but the "unchanged" branch (an existing grant
      // whose role/level already match) never touches an INSERT or UPDATE —
      // the only two places is_workspace_admin is otherwise enforced
      // (access_grant_insert, 0013's access_grant_update). Without this
      // check, a non-admin who already holds a grant could re-submit their
      // own exact grant to reach issueSharePointInvite (a real Graph folder-
      // creation + invite call) with no admin-gated write ever executing.
      const [access] = await tx<{ ok: boolean }[]>`select collab.is_workspace_admin(${accountId}) as ok`;
      if (!access?.ok) return { kind: "forbidden" as const };

      // Resolves to exactly one of the two targeting modes. If externalLinkId
      // was given but that row turns out to already have a user_id (resolved
      // since the caller last loaded this list), fall through to the normal
      // resolved-user path rather than creating a second, duplicate pending
      // row for someone who no longer needs one.
      let effectiveUserId = targetUserId || null;
      let effectiveExternalLinkId = effectiveUserId ? null : externalLinkId || null;
      if (effectiveExternalLinkId) {
        const [ext] = await tx<{ user_id: string | null; account_id: string }[]>`
          select user_id, account_id from collab.external_link where id = ${effectiveExternalLinkId}
        `;
        if (!ext || ext.account_id !== accountId) return { kind: "forbidden" as const };
        if (ext.user_id) {
          effectiveUserId = ext.user_id;
          effectiveExternalLinkId = null;
        }
      }

      const [existing] = effectiveUserId
        ? await tx<GrantRow[]>`
            select id, account_id, user_id, external_link_id, kantata_id, level, role, ms_permission_id, created_at
            from collab.access_grant
            where account_id = ${accountId} and user_id = ${effectiveUserId} and kantata_id = ${kantataId}
          `
        : await tx<GrantRow[]>`
            select id, account_id, user_id, external_link_id, kantata_id, level, role, ms_permission_id, created_at
            from collab.access_grant
            where account_id = ${accountId} and external_link_id = ${effectiveExternalLinkId} and user_id is null and kantata_id = ${kantataId}
          `;
      let row: "unchanged" | "updated" | "created";
      let grant: GrantRow;
      if (existing) {
        // The unique constraints are (account_id, user_id, kantata_id) and
        // (account_id, external_link_id, kantata_id) only — level is NOT
        // part of either, so an existing row's level can genuinely differ
        // from what this request asks for even when role matches. Checking
        // role alone (as an earlier pass here did) would silently swallow a
        // level-only or level+role change and report "unchanged" for a
        // request that asked for a real one.
        if (existing.role === role && existing.level === level) {
          row = "unchanged";
          grant = existing;
        } else {
          const [updated] = await tx<GrantRow[]>`
            update collab.access_grant set role = ${role}, level = ${level}
            where id = ${existing.id}
            returning id, account_id, user_id, external_link_id, kantata_id, level, role, ms_permission_id, created_at
          `;
          if (!updated) throw new Error("update returned no row");
          row = "updated";
          grant = updated;
        }
      } else {
        const [created] = await tx<GrantRow[]>`
          insert into collab.access_grant (account_id, user_id, external_link_id, kantata_id, level, role, granted_by)
          values (${accountId}, ${effectiveUserId}, ${effectiveExternalLinkId}, ${kantataId}, ${level}, ${role}, ${userId})
          returning id, account_id, user_id, external_link_id, kantata_id, level, role, ms_permission_id, created_at
        `;
        if (!created) throw new Error("insert returned no row");
        row = "created";
        grant = created;
      }

      // Re-issued on every call where the SharePoint half hasn't already
      // succeeded (no ms_permission_id yet) — the visible half-grant retry
      // B7 requires. Skipped when "unchanged" AND already granted: Graph's
      // own invite action isn't guaranteed to be idempotent for a repeat
      // call to the same recipient/role (it may hand back a NEW permission
      // object rather than the existing one), so re-issuing on every no-op
      // reload risks leaving earlier permissions untracked and un-revokable
      // through this app — worth avoiding when nothing actually needs retrying.
      const sharePoint =
        row === "unchanged" && grant.ms_permission_id
          ? { sharePoint: "granted" as const, detail: "already granted", msPermissionId: grant.ms_permission_id }
          : await issueSharePointInvite(tx, graphToken, grant, role);
      if (sharePoint.msPermissionId) {
        const [withPermission] = await tx<GrantRow[]>`
          update collab.access_grant set ms_permission_id = ${sharePoint.msPermissionId}
          where id = ${grant.id}
          returning id, account_id, user_id, external_link_id, kantata_id, level, role, ms_permission_id, created_at
        `;
        if (withPermission) grant = withPermission;
      }
      return { kind: "ok" as const, row, grant, sharePoint };
    });

    if (result.kind === "forbidden") {
      // Collapsed into not_found, same as every other endpoint's write-miss
      // path — this never tells an unauthorized caller whether the account
      // or grant they asked about is even real.
      res.status(404).json({ error: { code: "not_found", message: "account not found" } });
      return;
    }

    res.status(200).json({
      data: {
        grantId: result.grant.id,
        row: result.row,
        sharePoint: result.sharePoint.sharePoint,
        detail: result.sharePoint.detail,
        ...(result.sharePoint.msPermissionId ? { msPermissionId: result.sharePoint.msPermissionId } : {}),
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
  const grantId = typeof (body as { grantId?: unknown })?.grantId === "string" ? (body as { grantId: string }).grantId : "";
  if (!grantId) {
    res.status(400).json({ error: { code: "validation_failed", message: "grantId is required" } });
    return;
  }

  try {
    const graphToken = graphTokenFrom(headers) ?? undefined;
    const result = await withUserContext(userId, async (tx) => {
      // Read the row BEFORE deleting it — revoke has to reverse the
      // SharePoint half too, which needs account_id/ms_permission_id/
      // kantata_id that a row count alone would not give us after it's gone.
      const [existing] = await tx<GrantRow[]>`
        select id, account_id, user_id, external_link_id, kantata_id, level, role, ms_permission_id, created_at from collab.access_grant where id = ${grantId}
      `;
      if (!existing) return { kind: "not_found" as const };

      // Checked explicitly, BEFORE the Graph revoke call: access_grant_read's
      // policy lets the grant's own holder read this row (admin OR
      // user_id = auth.uid()), so without this check a non-admin could
      // reach a real Graph permission-revoke using their own token before
      // access_grant_delete's admin-only policy ever gets a chance to deny
      // the DB delete below — a real side effect from an unauthorized caller.
      const [access] = await tx<{ ok: boolean }[]>`select collab.is_workspace_admin(${existing.account_id}) as ok`;
      if (!access?.ok) return { kind: "not_found" as const };

      // The DB row and the real SharePoint permission must never diverge:
      // revoke means BOTH are gone, not "our record is gone, theirs might
      // still be there." So when a real permission exists (ms_permission_id
      // set), the Graph delete must actually succeed before the row is
      // touched — a missing token, an unresolvable folder, or a Graph error
      // all fail the WHOLE revoke rather than quietly deleting the row
      // anyway. Only a grant that never had a real SharePoint permission in
      // the first place (a half-grant) has nothing to revoke there.
      const outcome = await revokeGrantSharePoint(tx, existing.account_id, existing.kantata_id, existing.ms_permission_id, graphToken);
      if (outcome.kind !== "ok") return outcome;

      const [deleted] = await tx<{ id: string }[]>`delete from collab.access_grant where id = ${grantId} returning id`;
      // access_grant_delete's policy denies silently (0 rows) — a missing
      // row here means the caller cannot manage it (existing was read under
      // the same policy set, so this only fires on a genuine race), collapsed
      // into not_found like every other endpoint's write-miss path.
      if (!deleted) return { kind: "not_found" as const };

      return { kind: "ok" as const, grantId: deleted.id };
    });

    if (result.kind === "not_found") {
      res.status(404).json({ error: { code: "not_found", message: "grant not found" } });
      return;
    }
    if (result.kind === "graph_token_required") {
      res.status(400).json({ error: { code: "graph_token_required", message: "X-Graph-Token header is required to revoke this SharePoint permission" } });
      return;
    }
    if (result.kind === "unresolvable") {
      res.status(409).json({ error: { code: "conflict", message: "account or folder no longer resolvable — cannot confirm the SharePoint permission was removed, so the grant was not deleted" } });
      return;
    }
    if (result.kind === "graph_failed") {
      const { status, body: errBody } = graphApiError(result.err);
      res.status(status).json(errBody);
      return;
    }

    res.status(200).json({ data: { grantId: result.grantId, row: "deleted" } });
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

  if (req.method !== "POST" && req.method !== "DELETE") {
    res.status(405).json({ error: { code: "validation_failed", message: "POST or DELETE" } });
    return;
  }

  const authHeader = typeof req.headers?.authorization === "string" ? req.headers.authorization : undefined;
  const auth = await requireUser(authHeader);
  if (!auth.authorized) {
    res.status(auth.status).json(auth.body);
    return;
  }

  if (req.method === "POST") await handleCreate(req.body, auth.userId!, req.headers, res);
  else await handleDelete(req.body, auth.userId!, req.headers, res);
}
