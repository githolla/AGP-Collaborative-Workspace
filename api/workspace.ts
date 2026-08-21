/**
 * GET /api/workspace — the first collab-schema endpoint
 * (docs/api-spec-workspace-mutations.md), and the proof that the whole chain
 * works: verified identity (requireUser.ts) -> Postgres RLS as that identity
 * (db.ts) -> a payload containing only what the caller's policies allow.
 *
 * `?accountId=` implements `GET /api/workspace/:accountId` (one account,
 * same projection) as a query param rather than a path segment, per this
 * repo's flat/no-dynamic-route convention. Filtering happens IN SQL
 * (`where id = accountId`), not by fetching everything and picking one in
 * JS: an accountId the caller cannot see must come back as not_found via
 * the exact same silent-RLS-denial path every other endpoint uses, never as
 * a visible-but-filtered-out row that would leak "this id exists".
 *
 * SCOPE OF THIS SLICE: the accounts the caller can see -- internal member or
 * linked external, exactly as collab.client_account_read's policy decides,
 * nothing more, for the LIST branch (no `?accountId=`). Tasks, campaigns and
 * the thread — the fuller nested payload the spec describes — are still real
 * follow-on work.
 *
 * For a single-account fetch (`?accountId=`), the B3-B7 build
 * (teams-provisioning-plan.md) needs its own data: the Microsoft Team/site/
 * drive ids, provisioned folders, members, externals and grants. Each is
 * gated by its OWN table's RLS policy — an external sees their own grants
 * and folders reachable through them, an internal member sees the lot — so
 * this never widens what a caller can see beyond what those policies already
 * decide; it only assembles more of it into one response for the accounts
 * this task's UI needs to render.
 *
 * ADDED (docs/... migration plan, "Foundation" phase): tasks, the thread,
 * campaigns, shares and file approvals — the "still real follow-on work"
 * this file's own comment used to flag. This is what unblocks
 * `ClientWorkspace.tsx`/`store.ts` moving off the single JSON document
 * (`/api/state`) onto this schema, same tables `api/external-workspace.ts`
 * already reads for the external subtree, just the FULL internal row shape
 * here (assignments, dependsOn, hours, dates, ancestor ids, etc.) rather
 * than that endpoint's deliberately-reduced external projection — no
 * explicit visibility check needed beyond RLS itself, same as
 * msFolders/grants above: each table's own read policy (task_read,
 * thread_message_read, campaign_read, share_read, file_approval_read)
 * already resolves member/admin/external correctly for whoever is calling.
 *
 * ADDED (Phase 6, "People, grants, handover, activity"): `collab.activity`,
 * the internal "what's new" feed — never external (activity_read's policy is
 * account_member-or-admin only, no external branch), capped at the 50 most
 * recent rows per account, same reasoning as file_approval's own ordering.
 */

import { requireUser } from "./_lib/requireUser.js";
import { withUserContext } from "./_lib/db.js";
import { toDateOnly } from "./_lib/dates.js";

interface AccountRow {
  id: string;
  client_name: string;
  archived: boolean;
  created_at: string;
  ms_team_id: string | null;
  ms_team_name: string | null;
  ms_group_id: string | null;
  ms_site_id: string | null;
  ms_drive_id: string | null;
  ms_web_url: string | null;
  ms_provisioned_at: string | null;
  kantata_project_ids: string[];
  scoped_to_projects: boolean;
}

interface MsFolderRow {
  id: string;
  kantata_id: string;
  folder_id: string;
  parent_folder_id: string | null;
  name: string;
  level: string;
}

interface MemberRow {
  id: string;
  person_id: string;
  name: string;
  title: string | null;
  email: string | null;
}

interface ExternalRow {
  id: string;
  user_id: string | null;
  name: string;
  org: string;
  role: string;
  email: string | null;
  entra_status: string;
  entra_user_id: string | null;
}

interface GrantRow {
  id: string;
  user_id: string | null;
  external_link_id: string | null;
  kantata_id: string;
  level: string;
  role: string;
  ms_permission_id: string | null;
}

interface TaskRow {
  id: string;
  title: string;
  owner_name: string | null;
  assignments: unknown;
  due: Date | null;
  label: string | null;
  status: string;
  phase_key: string | null;
  source: string;
  client_visible: boolean;
  contractor_visible: boolean;
  created_at: string;
  completed_at: string | null;
  kantata_story_id: string | null;
  kantata_project_id: string | null;
  project_label: string | null;
  phase_label: string | null;
  phase_id: string | null;
  depends_on: string[];
  kantata_milestone_id: string | null;
  kantata_synced_at: string | null;
  estimated_hours: number | null;
  start_date: Date | null;
  ms_folder_id: string | null;
  updated_at: string;
}

interface ThreadMessageRow {
  id: string;
  author: string;
  author_user_id: string | null;
  kind: string;
  body: string;
  topic: string | null;
  edited_at: string | null;
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
  source: string | null;
  kantata_project_id: string | null;
  created_at: string;
}

interface ShareRow {
  id: string;
  person_name: string;
  recipient_user_id: string | null;
  item_kind: string;
  item_id: string;
  item_name: string;
  ms_item_id: string | null;
  grant_level: string | null;
  sent_at: string;
  sent_by: string;
  opened_at: string | null;
  open_source: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
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
  decided_by: string | null;
  note: string | null;
  opened_at: string | null;
}

interface ActivityRow {
  id: string;
  at: string;
  text: string;
  kind: string;
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

  try {
    const { accounts, extras } = await withUserContext(auth.userId!, async (sql) => {
      if (!accountId) {
        const rows = await sql<AccountRow[]>`select id, client_name, archived, created_at from collab.client_account order by created_at desc`;
        return { accounts: rows, extras: null };
      }

      const rows = await sql<AccountRow[]>`
        select id, client_name, archived, created_at, ms_team_id, ms_team_name, ms_group_id, ms_site_id, ms_drive_id, ms_web_url, ms_provisioned_at, kantata_project_ids, scoped_to_projects
        from collab.client_account
        where id = ${accountId}
      `;
      if (rows.length === 0) return { accounts: rows, extras: null };

      // The AGP staff roster is an internal-only surface (the "AGP team"
      // list in ClientAdminPanel) — account_member_read's RLS
      // policy (can_read_account) does not itself scope it that way, since
      // it also accepts any external_link on the account with no grant
      // required. Checked explicitly here rather than trusting the table's
      // own read policy to keep every external caller from seeing every
      // staffer's name/title/email the moment they're linked, before any
      // milestone grant exists.
      const [access, msFolders, membersRaw, externals, grants, tasks, thread, campaigns, shares, fileApprovals, activity] = await Promise.all([
        sql<{ ok: boolean }[]>`select collab.is_account_member_or_admin(${accountId}) as ok`,
        sql<MsFolderRow[]>`select id, kantata_id, folder_id, parent_folder_id, name, level from collab.ms_folder where account_id = ${accountId}`,
        sql<MemberRow[]>`select id, person_id, name, title, email from collab.account_member where account_id = ${accountId}`,
        sql<ExternalRow[]>`select id, user_id, name, org, role, email, entra_status, entra_user_id from collab.external_link where account_id = ${accountId}`,
        sql<GrantRow[]>`select id, user_id, external_link_id, kantata_id, level, role, ms_permission_id from collab.access_grant where account_id = ${accountId}`,
        sql<TaskRow[]>`
          select id, title, owner_name, assignments, due, label, status, phase_key, source, client_visible, contractor_visible,
                 created_at, completed_at, kantata_story_id, kantata_project_id, project_label, phase_label, phase_id,
                 depends_on, kantata_milestone_id, kantata_synced_at, estimated_hours, start_date, ms_folder_id, updated_at
          from collab.task where account_id = ${accountId}
        `,
        sql<ThreadMessageRow[]>`
          select id, author, author_user_id, kind, body, topic, edited_at, client_visible, contractor_visible, kantata_id, kantata_level, created_at, updated_at
          from collab.thread_message where account_id = ${accountId} order by created_at asc
        `,
        sql<CampaignRow[]>`select id, name, status, next_milestone, next_milestone_date, source, kantata_project_id, created_at from collab.campaign where account_id = ${accountId}`,
        sql<ShareRow[]>`
          select id, person_name, recipient_user_id, item_kind, item_id, item_name, ms_item_id, grant_level, sent_at, sent_by, opened_at, open_source, revoked_at, revoked_by
          from collab.share where account_id = ${accountId}
        `,
        sql<FileApprovalRow[]>`
          select id, ms_item_id, name, purpose, shared_at, shared_by, decision, decided_at, decided_by, note, opened_at
          from collab.file_approval where account_id = ${accountId} order by shared_at desc
        `,
        sql<ActivityRow[]>`select id, at, text, kind from collab.activity where account_id = ${accountId} order by at desc limit 50`,
      ]);
      const members = access[0]?.ok ? membersRaw : [];
      return { accounts: rows, extras: { msFolders, members, externals, grants, tasks, thread, campaigns, shares, fileApprovals, activity } };
    });

    if (accountId && accounts.length === 0) {
      res.status(404).json({ error: { code: "not_found", message: "account not found" } });
      return;
    }

    res.status(200).json({
      data: {
        accounts: accounts.map((a) => ({
          id: a.id,
          clientName: a.client_name,
          archived: a.archived,
          createdAt: a.created_at,
          ...(accountId
            ? {
                msTeam: {
                  teamId: a.ms_team_id,
                  teamName: a.ms_team_name,
                  groupId: a.ms_group_id,
                  siteId: a.ms_site_id,
                  driveId: a.ms_drive_id,
                  webUrl: a.ms_web_url,
                  provisionedAt: a.ms_provisioned_at,
                },
                kantataProjectIds: a.kantata_project_ids,
                scopedToProjects: a.scoped_to_projects,
              }
            : {}),
        })),
        ...(extras
          ? {
              msFolders: extras.msFolders.map((f) => ({
                id: f.id,
                kantataId: f.kantata_id,
                folderId: f.folder_id,
                parentFolderId: f.parent_folder_id,
                name: f.name,
                level: f.level,
              })),
              members: extras.members.map((m) => ({
                id: m.id,
                personId: m.person_id,
                name: m.name,
                ...(m.title ? { title: m.title } : {}),
                ...(m.email ? { email: m.email } : {}),
              })),
              externals: extras.externals.map((e) => ({
                id: e.id,
                ...(e.user_id ? { userId: e.user_id } : {}),
                name: e.name,
                org: e.org,
                role: e.role,
                ...(e.email ? { email: e.email } : {}),
                entraStatus: e.entra_status,
                ...(e.entra_user_id ? { entraUserId: e.entra_user_id } : {}),
              })),
              grants: extras.grants.map((g) => ({
                id: g.id,
                userId: g.user_id,
                externalLinkId: g.external_link_id,
                kantataId: g.kantata_id,
                level: g.level,
                role: g.role,
                msPermissionId: g.ms_permission_id,
              })),
              tasks: extras.tasks.map((t) => {
                const due = toDateOnly(t.due);
                const startDate = toDateOnly(t.start_date);
                return {
                  id: t.id,
                  title: t.title,
                  ...(t.owner_name ? { ownerName: t.owner_name } : {}),
                  assignments: t.assignments,
                  ...(due ? { due } : {}),
                  ...(t.label ? { label: t.label } : {}),
                  status: t.status,
                  ...(t.phase_key ? { phaseKey: t.phase_key } : {}),
                  source: t.source,
                  clientVisible: t.client_visible,
                  contractorVisible: t.contractor_visible,
                  createdAt: t.created_at,
                  ...(t.completed_at ? { completedAt: t.completed_at } : {}),
                  ...(t.kantata_story_id ? { kantataStoryId: t.kantata_story_id } : {}),
                  ...(t.kantata_project_id ? { kantataProjectId: t.kantata_project_id } : {}),
                  ...(t.project_label ? { projectLabel: t.project_label } : {}),
                  ...(t.phase_label ? { phaseLabel: t.phase_label } : {}),
                  ...(t.phase_id ? { phaseId: t.phase_id } : {}),
                  dependsOn: t.depends_on,
                  ...(t.kantata_milestone_id ? { kantataMilestoneId: t.kantata_milestone_id } : {}),
                  ...(t.kantata_synced_at ? { kantataSyncedAt: t.kantata_synced_at } : {}),
                  ...(t.estimated_hours != null ? { estimatedHours: t.estimated_hours } : {}),
                  ...(startDate ? { startDate } : {}),
                  ...(t.ms_folder_id ? { msFolderId: t.ms_folder_id } : {}),
                  updatedAt: t.updated_at,
                };
              }),
              thread: extras.thread.map((m) => ({
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
              campaigns: extras.campaigns.map((c) => ({
                id: c.id,
                name: c.name,
                status: c.status,
                ...(c.next_milestone ? { nextMilestone: c.next_milestone } : {}),
                ...(c.next_milestone_date ? { nextMilestoneDate: c.next_milestone_date } : {}),
                ...(c.source ? { source: c.source } : {}),
                ...(c.kantata_project_id ? { kantataProjectId: c.kantata_project_id } : {}),
                createdAt: c.created_at,
              })),
              shares: extras.shares.map((s) => ({
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
              fileApprovals: extras.fileApprovals.map((f) => ({
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
              activity: extras.activity.map((a) => ({ id: a.id, at: a.at, text: a.text, kind: a.kind })),
            }
          : {}),
      },
    });
  } catch (err) {
    // Not one of the api-spec's enumerated codes (unauthenticated, forbidden,
    // not_found, conflict, validation_failed, graph_token_required,
    // graph_failed, partial) -- those describe request-shaped or
    // authorization outcomes. This is a genuine infrastructure failure (a bad
    // connection, a query bug), which RLS itself would never surface this
    // way: a denied SELECT just returns fewer rows, it never throws.
    res.status(500).json({ error: { code: "internal_error", message: err instanceof Error ? err.message : "query failed" } });
  }
}
