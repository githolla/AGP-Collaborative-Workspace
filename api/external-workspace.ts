/**
 * GET /api/external-workspace?accountId= — the external's scoped payload for
 * one account (teams-provisioning-plan.md C2). Not in the api-spec doc's
 * literal route list (that spec predates C2's own write-up) — this is C2's
 * read side, built the same way `api/workspace.ts` extended for B3-B7: one
 * endpoint assembling what the new client-safe subtree needs.
 *
 * DELIBERATELY THIN: every query below is a plain `select * from <table>
 * where account_id = $1`, run under the caller's own JWT (withUserContext).
 * There is no grant-filtering logic written here at all — 0008's RLS
 * policies already do it, per table, exactly per C2's rule ("everything an
 * external sees is filtered by their grants first, then by the audience
 * flag"): `task_read`/`thread_message_read` check `holds_grant` +
 * `client_visible`/`contractor_visible`; `ms_folder_read` checks
 * `holds_grant`; `campaign_read`/`file_approval_read` check
 * `external_role() = 'client'`. A row this handler doesn't even see was
 * filtered by Postgres, not by this file forgetting to ask — that is the
 * whole point of building the server-side projection in B6 before C2 needed
 * it.
 *
 * `role: any` — an internal member calling this for an account they belong
 * to gets the same shape back (RLS lets a member see everything), which is
 * harmless and untested-for; this endpoint exists for the external subtree,
 * not for them.
 */

import { requireUser } from "./_lib/requireUser.js";
import { withUserContext } from "./_lib/db.js";

interface TaskRow {
  id: string;
  title: string;
  owner_name: string | null;
  due: string | null;
  label: string | null;
  status: string;
  client_visible: boolean;
  contractor_visible: boolean;
  // collab.task has no plain kantata_id column — kantata_story_id is this
  // task's own Kantata identity (the direct analogue of thread_message's
  // real kantata_id column, one level down: a message can attach to any
  // project/milestone/phase/task node, a task IS one specific story).
  kantata_story_id: string | null;
  completed_at: string | null;
}

interface MessageRow {
  id: string;
  author: string;
  author_user_id: string | null;
  body: string;
  topic: string | null;
  client_visible: boolean;
  contractor_visible: boolean;
  kantata_id: string | null;
  kantata_level: string | null;
  created_at: string;
  updated_at: string;
}

interface CampaignRow {
  id: string;
  name: string;
  status: string;
  next_milestone: string | null;
  next_milestone_date: string | null;
  kantata_project_id: string | null;
}

interface GrantRow {
  kantata_id: string;
  level: string;
  role: string;
  ms_permission_id: string | null;
}

interface MsFolderRow {
  kantata_id: string;
  folder_id: string;
  name: string;
  level: string;
}

interface FileApprovalRow {
  id: string;
  ms_item_id: string;
  name: string;
  purpose: string;
  shared_at: string;
  shared_by: string;
  decision: string | null;
  decided_at: string | null;
  note: string | null;
}

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

  const userId = auth.userId!;

  try {
    const result = await withUserContext(userId, async (tx) => {
      const [account] = await tx<{ client_name: string }[]>`select client_name from collab.client_account where id = ${accountId}`;
      if (!account) return null;

      const [myLink] = await tx<{ role: string }[]>`select role from collab.external_link where account_id = ${accountId} and user_id = ${userId}`;

      const [tasks, messages, campaigns, grants, msFolders, fileApprovals] = await Promise.all([
        tx<TaskRow[]>`select id, title, owner_name, due, label, status, client_visible, contractor_visible, kantata_story_id, completed_at from collab.task where account_id = ${accountId}`,
        tx<MessageRow[]>`
          select id, author, author_user_id, body, topic, client_visible, contractor_visible, kantata_id, kantata_level, created_at, updated_at
          from collab.thread_message where account_id = ${accountId} order by created_at asc
        `,
        tx<CampaignRow[]>`select id, name, status, next_milestone, next_milestone_date, kantata_project_id from collab.campaign where account_id = ${accountId}`,
        tx<GrantRow[]>`select kantata_id, level, role, ms_permission_id from collab.access_grant where account_id = ${accountId} and user_id = ${userId}`,
        tx<MsFolderRow[]>`select kantata_id, folder_id, name, level from collab.ms_folder where account_id = ${accountId}`,
        tx<FileApprovalRow[]>`
          select id, ms_item_id, name, purpose, shared_at, shared_by, decision, decided_at, note
          from collab.file_approval where account_id = ${accountId} order by shared_at desc
        `,
      ]);

      return { clientName: account.client_name, myRole: myLink?.role ?? null, tasks, messages, campaigns, grants, msFolders, fileApprovals };
    });

    if (!result) {
      res.status(404).json({ error: { code: "not_found", message: "account not found" } });
      return;
    }

    res.status(200).json({
      data: {
        accountId,
        clientName: result.clientName,
        myRole: result.myRole,
        tasks: result.tasks.map((t) => ({
          id: t.id,
          title: t.title,
          ownerName: t.owner_name,
          due: t.due,
          label: t.label,
          status: t.status,
          clientVisible: t.client_visible,
          contractorVisible: t.contractor_visible,
          kantataId: t.kantata_story_id,
          completedAt: t.completed_at,
        })),
        messages: result.messages.map((m) => ({
          id: m.id,
          author: m.author,
          authorUserId: m.author_user_id,
          body: m.body,
          topic: m.topic,
          clientVisible: m.client_visible,
          contractorVisible: m.contractor_visible,
          kantataId: m.kantata_id,
          kantataLevel: m.kantata_level,
          createdAt: m.created_at,
          updatedAt: m.updated_at,
        })),
        campaigns: result.campaigns.map((c) => ({
          id: c.id,
          name: c.name,
          status: c.status,
          nextMilestone: c.next_milestone,
          nextMilestoneDate: c.next_milestone_date,
          kantataProjectId: c.kantata_project_id,
        })),
        grants: result.grants.map((g) => ({ kantataId: g.kantata_id, level: g.level, role: g.role, msPermissionId: g.ms_permission_id })),
        msFolders: result.msFolders.map((f) => ({ kantataId: f.kantata_id, folderId: f.folder_id, name: f.name, level: f.level })),
        fileApprovals: result.fileApprovals.map((f) => ({
          id: f.id,
          msItemId: f.ms_item_id,
          name: f.name,
          purpose: f.purpose,
          sharedAt: f.shared_at,
          sharedBy: f.shared_by,
          decision: f.decision,
          decidedAt: f.decided_at,
          note: f.note,
        })),
      },
    });
  } catch (err) {
    res.status(500).json({ error: { code: "internal_error", message: err instanceof Error ? err.message : "query failed" } });
  }
}
