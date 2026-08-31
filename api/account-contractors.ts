/**
 * GET /api/account-contractors?accountId= — the Contractor Hub's data, and
 * ONLY that: externals, grants, shares, the discussion thread, and file
 * approvals. Deliberately excludes the account's tasks/campaigns/activity,
 * which the full GET /api/workspace payload carries — on a big client that
 * payload is thousands of task rows the hub never reads, so fetching it just to
 * show contractors was slow. This endpoint returns the handful of collections
 * the hub actually aggregates.
 *
 * RLS-scoped like every collab read (withUserContext): the member/admin gate is
 * enforced, and the thread/shares/etc. come back only for an account the caller
 * can see. Same field mapping as api/workspace.ts so the client types are
 * identical (MsAccountExternal/Grant/Share/Message/FileApproval).
 */

import { requireUser } from "./_lib/requireUser.js";
import { withUserContext } from "./_lib/db.js";
import { toApiError } from "./_lib/apiError.js";

interface ExternalRow { id: string; user_id: string | null; name: string; org: string; role: string; email: string | null; entra_status: string; entra_user_id: string | null }
interface GrantRow { id: string; user_id: string | null; external_link_id: string | null; kantata_id: string; level: string; role: string; ms_permission_id: string | null }
interface ShareRow { id: string; person_name: string; recipient_user_id: string | null; item_kind: string; item_id: string; item_name: string; ms_item_id: string | null; grant_level: string | null; sent_at: string; sent_by: string; opened_at: string | null; open_source: string | null; revoked_at: string | null; revoked_by: string | null }
interface MsgRow { id: string; author: string; author_user_id: string | null; kind: string; body: string; topic: string | null; edited_at: string | null; client_visible: boolean; contractor_visible: boolean; kantata_id: string | null; kantata_level: string | null; created_at: string; updated_at: string }
interface ApprovalRow { id: string; ms_item_id: string; name: string; purpose: string; shared_at: string; shared_by: string; decision: string | null; decided_at: string | null; decided_by: string | null; note: string | null; opened_at: string | null }

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
    const result = await withUserContext(auth.userId!, async (sql) => {
      // Internal-only (defense-in-depth): this returns the richest external-PII
      // payload (emails, entra ids, the whole discussion). Externals are never
      // account_members today, but should one ever be added, this must still
      // never hand them every contractor's data.
      const [me] = await sql<{ kind: string }[]>`select kind from collab.app_user where id = ${auth.userId!}`;
      if (me?.kind === "external") return null;
      const [acct] = await sql<{ id: string; client_name: string }[]>`select id, client_name from collab.client_account where id = ${accountId}`;
      if (!acct) return null;
      const [access] = await sql<{ ok: boolean }[]>`select collab.is_account_member_or_admin(${accountId}) as ok`;
      if (!access?.ok) return null;

      const [externals, grants, thread, shares, fileApprovals] = await Promise.all([
        sql<ExternalRow[]>`select id, user_id, name, org, role, email, entra_status, entra_user_id from collab.external_link where account_id = ${accountId}`,
        sql<GrantRow[]>`select id, user_id, external_link_id, kantata_id, level, role, ms_permission_id from collab.access_grant where account_id = ${accountId}`,
        sql<MsgRow[]>`
          select id, author, author_user_id, kind, body, topic, edited_at, client_visible, contractor_visible, kantata_id, kantata_level, created_at, updated_at
          from collab.thread_message where account_id = ${accountId} order by created_at asc
        `,
        sql<ShareRow[]>`
          select id, person_name, recipient_user_id, item_kind, item_id, item_name, ms_item_id, grant_level, sent_at, sent_by, opened_at, open_source, revoked_at, revoked_by
          from collab.share where account_id = ${accountId}
        `,
        sql<ApprovalRow[]>`
          select id, ms_item_id, name, purpose, shared_at, shared_by, decision, decided_at, decided_by, note, opened_at
          from collab.file_approval where account_id = ${accountId} order by shared_at desc
        `,
      ]);
      return { acct, externals, grants, thread, shares, fileApprovals };
    });

    if (!result) {
      res.status(404).json({ error: { code: "not_found", message: "workspace not found or you're not a member" } });
      return;
    }

    res.status(200).json({
      data: {
        account: { id: result.acct.id, clientName: result.acct.client_name },
        externals: result.externals.map((e) => ({
          id: e.id,
          ...(e.user_id ? { userId: e.user_id } : {}),
          name: e.name,
          org: e.org,
          role: e.role,
          ...(e.email ? { email: e.email } : {}),
          entraStatus: e.entra_status,
          ...(e.entra_user_id ? { entraUserId: e.entra_user_id } : {}),
        })),
        grants: result.grants.map((g) => ({
          id: g.id,
          userId: g.user_id,
          externalLinkId: g.external_link_id,
          kantataId: g.kantata_id,
          level: g.level,
          role: g.role,
          msPermissionId: g.ms_permission_id,
        })),
        thread: result.thread.map((m) => ({
          id: m.id,
          author: m.author,
          ...(m.author_user_id ? { authorUserId: m.author_user_id } : {}),
          kind: m.kind,
          body: m.body,
          ...(m.topic ? { topic: m.topic } : {}),
          ...(m.edited_at ? { editedAt: m.edited_at } : {}),
          clientVisible: m.client_visible,
          contractorVisible: m.contractor_visible,
          ...(m.kantata_id ? { kantataId: m.kantata_id } : {}),
          ...(m.kantata_level ? { kantataLevel: m.kantata_level } : {}),
          createdAt: m.created_at,
          updatedAt: m.updated_at,
        })),
        shares: result.shares.map((s) => ({
          id: s.id,
          personName: s.person_name,
          ...(s.recipient_user_id ? { recipientUserId: s.recipient_user_id } : {}),
          itemKind: s.item_kind,
          itemId: s.item_id,
          itemName: s.item_name,
          ...(s.ms_item_id ? { msItemId: s.ms_item_id } : {}),
          ...(s.grant_level ? { grantLevel: s.grant_level } : {}),
          sentAt: s.sent_at,
          sentBy: s.sent_by,
          ...(s.opened_at ? { openedAt: s.opened_at } : {}),
          ...(s.open_source ? { openSource: s.open_source } : {}),
          ...(s.revoked_at ? { revokedAt: s.revoked_at } : {}),
          ...(s.revoked_by ? { revokedBy: s.revoked_by } : {}),
        })),
        fileApprovals: result.fileApprovals.map((f) => ({
          id: f.id,
          msItemId: f.ms_item_id,
          name: f.name,
          purpose: f.purpose,
          sharedAt: f.shared_at,
          sharedBy: f.shared_by,
          decision: f.decision,
          decidedAt: f.decided_at,
          ...(f.decided_by ? { decidedBy: f.decided_by } : {}),
          note: f.note,
          ...(f.opened_at ? { openedAt: f.opened_at } : {}),
        })),
      },
    });
  } catch (err) {
    const { status, body } = toApiError(err);
    res.status(status).json(body);
  }
}
