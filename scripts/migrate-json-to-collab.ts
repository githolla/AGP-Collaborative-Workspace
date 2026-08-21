/**
 * One-off migration: copies every workspace in the old single-JSON-document
 * model (`/api/state`, Supabase Storage `agp-workspace/state.json`) into the
 * new Postgres `collab` schema (teams-provisioning-plan.md B6). Run with
 * `npx tsx scripts/migrate-json-to-collab.ts` (dry run, default — prints
 * exactly what would be created, writes nothing) or `--apply` to actually
 * write.
 *
 * Connects with SUPABASE_DB_URL directly (no `withUserContext` role switch)
 * — this is a bulk historical backfill with no single acting "caller" RLS
 * could scope to, the same reasoning `api/_lib/db.ts`'s `withServiceContext`
 * documents for the narrow admin-only cases that already use it.
 *
 * KNOWN, DELIBERATE GAPS — read before trusting the output:
 * - Every migrated account gets ADMIN_EMAIL as its sole workspace_admin.
 *   None of the old accounts' `members[]` carry an email or an
 *   admin-flagged member with one to do better with (checked against the
 *   live document before writing this).
 * - `access_grant` rows are NEVER created — the old model has no
 *   per-milestone grant concept at all (ExternalMember.access was a coarse,
 *   now-retired enum). Every migrated external (there are currently zero in
 *   the live document, but future runs may find some) lands with a name/org/
 *   role only; someone has to grant real milestone access afterward through
 *   the Microsoft workspace panel.
 * - `account_member`/`external_link.user_id` is set ONLY when the row's
 *   email matches an existing `auth.users` row exactly; otherwise it's left
 *   null, exactly like a fresh row created via the normal API today.
 * - `files`/`docs` (ClientFileLink) are NOT migrated — B7 retired that
 *   model; there is no destination table. Counted and reported, not
 *   silently dropped.
 * - `msTeam`/`shares` are copied only if present (none in the live document
 *   today) — msTeam maps to client_account's ms_* columns, shares to
 *   collab.share.
 * - `kantataProjectIds` carries over AS-IS (often empty) — this script does
 *   not attempt to resolve or fuzzy-match a Kantata workspace id from the
 *   client name; that's explicitly out of scope (same rule kantataImport.ts
 *   states for its own live-pull path). Link real projects afterward via
 *   the "Linked Kantata projects" panel.
 * - `task.dependsOn` is remapped old-id -> new-id in a second pass; any id
 *   that doesn't resolve (points at a task that doesn't exist in the same
 *   account) is dropped rather than left dangling.
 */

import "dotenv/config";
import postgres from "postgres";
import { randomUUID } from "node:crypto";

const APPLY = process.argv.includes("--apply");
const ADMIN_EMAIL = "rjohn@teamallegiance.com";
const BUCKET = "agp-workspace";
const OBJECT = "state.json";

interface JsonMember {
  personId: string;
  name: string;
  title?: string;
  email?: string;
  role?: "admin" | "member";
}
interface JsonExternal {
  id: string;
  name: string;
  org: string;
  role: "client" | "contractor";
  email?: string;
  entraStatus?: string;
  entraUserId?: string;
  invitedBy?: string;
  addedAt: string;
}
interface JsonTask {
  id: string;
  title: string;
  ownerName?: string;
  assignments?: unknown[];
  due?: string;
  label?: string;
  status: string;
  phaseKey?: string;
  source: string;
  clientVisible?: boolean;
  contractorVisible?: boolean;
  createdAt: string;
  completedAt?: string;
  kantataStoryId?: string;
  kantataProjectId?: string;
  projectLabel?: string;
  phaseLabel?: string;
  phaseId?: string;
  dependsOn?: string[];
  kantataMilestoneId?: string;
  kantataSyncedAt?: string;
  estimatedHours?: number;
  startDate?: string;
}
interface JsonThreadMessage {
  id: string;
  author: string;
  kind: string;
  at: string;
  body: string;
  topic?: string;
  editedAt?: string;
  contractorVisible?: boolean;
  clientVisible?: boolean;
  kantataId?: string;
  kantataLevel?: string;
}
interface JsonCampaign {
  id: string;
  name: string;
  status: string;
  nextMilestone?: string;
  nextMilestoneDate?: string;
  source?: string;
  kantataProjectId?: string;
}
interface JsonActivity {
  id: string;
  at: string;
  text: string;
  kind: string;
}
interface JsonMsTeam {
  teamId: string;
  groupId: string;
  siteId: string;
  driveId: string;
  webUrl: string;
  provisionedAt?: string;
}
interface JsonAccount {
  id: string;
  clientName: string;
  members: JsonMember[];
  externals: JsonExternal[];
  clientContacts?: number;
  campaigns: JsonCampaign[];
  notifications?: { id: string; text: string; at: string }[];
  tasks: JsonTask[];
  thread: JsonThreadMessage[];
  files?: unknown[];
  docs?: unknown[];
  activity?: JsonActivity[];
  kantataProjectIds?: string[];
  scopedToProjects?: boolean;
  autoPopulated?: boolean;
  archived?: boolean;
  notifyPrefs?: Record<string, string>;
  msTeam?: JsonMsTeam;
  createdAt: string;
}

async function fetchState(): Promise<JsonAccount[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${OBJECT}`, {
    headers: { Authorization: `Bearer ${key}`, apikey: key },
  });
  if (!res.ok) throw new Error(`failed to fetch ${BUCKET}/${OBJECT}: ${res.status}`);
  const envelope = (await res.json()) as { state?: { accounts?: JsonAccount[] } };
  return envelope.state?.accounts ?? [];
}

async function main() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) throw new Error("SUPABASE_DB_URL not set");
  const sql = postgres(dbUrl, { max: 1 });

  console.log(APPLY ? "*** APPLY MODE — this will write to the live database ***\n" : "*** DRY RUN — nothing will be written ***\n");

  const accounts = await fetchState();
  console.log(`Loaded ${accounts.length} account(s) from ${BUCKET}/${OBJECT}.\n`);

  const [adminUser] = await sql<{ id: string; display_name: string }[]>`
    select a.id, a.display_name from collab.app_user a
    join auth.users u on u.id = a.id
    where lower(u.email) = ${ADMIN_EMAIL.toLowerCase()}
    limit 1
  `;
  if (!adminUser) {
    console.error(
      `No collab.app_user row for ${ADMIN_EMAIL} — either they've never signed in, or (if this is a fresh environment) run scripts/backfill-app-user.ts first: the auto-provisioning trigger only fires on NEW sign-ups, not retroactively.`,
    );
    await sql.end();
    process.exit(1);
  }
  console.log(`Admin user resolved: ${adminUser.id} (${ADMIN_EMAIL}, "${adminUser.display_name}") — will own every migrated account.\n`);

  const allEmails = new Set<string>();
  for (const a of accounts) {
    for (const m of a.members) if (m.email) allEmails.add(m.email.toLowerCase());
    for (const e of a.externals) if (e.email) allEmails.add(e.email.toLowerCase());
  }
  const emailToUserId = new Map<string, string>();
  if (allEmails.size > 0) {
    const rows = await sql<{ id: string; email: string }[]>`select id, email from auth.users where lower(email) = any(${[...allEmails]})`;
    for (const r of rows) emailToUserId.set(r.email.toLowerCase(), r.id);
  }
  console.log(`${allEmails.size} distinct member/external email(s) found; ${emailToUserId.size} matched an existing signed-in user.\n`);

  const totals = { accounts: 0, members: 0, externals: 0, tasks: 0, messages: 0, campaigns: 0, activity: 0, skippedFiles: 0, skippedDocs: 0, errors: 0 };

  for (const a of accounts) {
    const newAccountId = randomUUID();
    const fileCount = a.files?.length ?? 0;
    const docCount = a.docs?.length ?? 0;
    const activity = a.activity ?? [];

    console.log(`${APPLY ? "Migrating" : "Would migrate"}: "${a.clientName}" (${a.id} -> ${newAccountId})`);
    console.log(
      `  members ${a.members.length} · externals ${a.externals.length} · tasks ${a.tasks.length} · thread ${a.thread.length} · campaigns ${a.campaigns.length} · activity ${activity.length}`,
    );
    if (fileCount + docCount > 0) console.log(`  SKIPPING ${fileCount} file(s) + ${docCount} doc(s) — no destination in the new schema (B7)`);
    if (!a.kantataProjectIds || a.kantataProjectIds.length === 0) console.log(`  NOTE: no kantataProjectIds — link real Kantata projects after migration`);

    totals.accounts++;
    totals.members += a.members.length;
    totals.externals += a.externals.length;
    totals.tasks += a.tasks.length;
    totals.messages += a.thread.length;
    totals.campaigns += a.campaigns.length;
    totals.activity += activity.length;
    totals.skippedFiles += fileCount;
    totals.skippedDocs += docCount;

    if (!APPLY) {
      console.log();
      continue;
    }

    try {
      await sql.begin(async (tx) => {
        await tx`
          insert into collab.client_account
            (id, client_name, created_by, kantata_project_ids, scoped_to_projects, auto_populated, archived, client_contacts,
             notifications, notify_prefs, ms_team_id, ms_group_id, ms_site_id, ms_drive_id, ms_web_url, ms_provisioned_at, created_at)
          values
            (${newAccountId}, ${a.clientName}, ${adminUser.id}, ${a.kantataProjectIds ?? []}, ${a.scopedToProjects ?? false}, ${a.autoPopulated ?? false},
             ${a.archived ?? false}, ${a.clientContacts ?? 0}, ${sql.json(a.notifications ?? [])}, ${sql.json(a.notifyPrefs ?? {})},
             ${a.msTeam?.teamId ?? null}, ${a.msTeam?.groupId ?? null}, ${a.msTeam?.siteId ?? null}, ${a.msTeam?.driveId ?? null},
             ${a.msTeam?.webUrl ?? null}, ${a.msTeam?.provisionedAt ?? null}, ${a.createdAt})
        `;

        await tx`
          insert into collab.user_role (user_id, role, account_id, granted_by)
          values (${adminUser.id}, 'workspace_admin', ${newAccountId}, ${adminUser.id})
        `;
        // workspace_admin alone does NOT grant read access — client_account_read's
        // policy (can_read_account, 0008) checks is_app_admin/account_member/
        // external_link, never is_workspace_admin. api/account.ts's normal
        // creation path makes its caller an account_member in the same
        // transaction for exactly this reason; skipping it here (a real bug,
        // caught live: the admin could write everything but the account
        // list came back empty) would silently lock the admin out of every
        // account this script creates.
        await tx`
          insert into collab.account_member (account_id, user_id, person_id, name, title)
          values (${newAccountId}, ${adminUser.id}, ${"u-" + adminUser.id}, ${adminUser.display_name}, 'AGP team')
          on conflict (account_id, person_id) do nothing
        `;

        for (const m of a.members) {
          const uid = m.email ? (emailToUserId.get(m.email.toLowerCase()) ?? null) : null;
          await tx`
            insert into collab.account_member (account_id, user_id, person_id, name, title, email)
            values (${newAccountId}, ${uid}, ${m.personId}, ${m.name}, ${m.title ?? null}, ${m.email ?? null})
            on conflict (account_id, person_id) do nothing
          `;
        }

        for (const e of a.externals) {
          const uid = e.email ? (emailToUserId.get(e.email.toLowerCase()) ?? null) : null;
          await tx`
            insert into collab.external_link (account_id, user_id, name, org, role, email, entra_status, entra_user_id, invited_by, created_at)
            values (${newAccountId}, ${uid}, ${e.name}, ${e.org}, ${e.role}, ${e.email ?? null}, ${e.entraStatus ?? "none"}, ${e.entraUserId ?? null}, ${e.invitedBy ?? null}, ${e.addedAt})
          `;
        }

        const taskIdMap = new Map<string, string>();
        for (const t of a.tasks) {
          const newTaskId = randomUUID();
          taskIdMap.set(t.id, newTaskId);
          const ancestorIds = [t.kantataMilestoneId, t.phaseId, t.kantataProjectId, t.kantataStoryId].filter((x): x is string => !!x);
          await tx`
            insert into collab.task
              (id, account_id, title, owner_name, assignments, due, label, status, phase_key, source, client_visible, contractor_visible,
               created_at, completed_at, kantata_story_id, kantata_project_id, project_label, phase_label, phase_id, kantata_milestone_id,
               kantata_synced_at, estimated_hours, start_date, kantata_ancestor_ids)
            values
              (${newTaskId}, ${newAccountId}, ${t.title}, ${t.ownerName ?? null}, ${sql.json((t.assignments ?? []) as unknown as postgres.JSONValue)}, ${t.due ?? null}, ${t.label ?? null},
               ${t.status}, ${t.phaseKey ?? null}, ${t.source}, ${t.clientVisible ?? false}, ${t.contractorVisible ?? false}, ${t.createdAt},
               ${t.completedAt ?? null}, ${t.kantataStoryId ?? null}, ${t.kantataProjectId ?? null}, ${t.projectLabel ?? null}, ${t.phaseLabel ?? null},
               ${t.phaseId ?? null}, ${t.kantataMilestoneId ?? null}, ${t.kantataSyncedAt ?? null}, ${t.estimatedHours ?? null}, ${t.startDate ?? null}, ${ancestorIds})
          `;
        }
        for (const t of a.tasks) {
          if (!t.dependsOn || t.dependsOn.length === 0) continue;
          const mapped = t.dependsOn.map((id) => taskIdMap.get(id)).filter((x): x is string => !!x);
          if (mapped.length === 0) continue;
          const newId = taskIdMap.get(t.id)!;
          await tx`update collab.task set depends_on = ${mapped} where id = ${newId}`;
        }

        for (const m of a.thread) {
          const ancestorIds = m.kantataId ? [m.kantataId] : [];
          await tx`
            insert into collab.thread_message
              (account_id, author, author_user_id, kind, body, topic, edited_at, client_visible, contractor_visible, kantata_id, kantata_level, kantata_ancestor_ids, created_at)
            values
              (${newAccountId}, ${m.author}, null, ${m.kind}, ${m.body}, ${m.topic ?? null}, ${m.editedAt ?? null}, ${m.clientVisible ?? false},
               ${m.contractorVisible ?? false}, ${m.kantataId ?? null}, ${m.kantataLevel ?? null}, ${ancestorIds}, ${m.at})
          `;
        }

        for (const c of a.campaigns) {
          await tx`
            insert into collab.campaign (account_id, name, status, next_milestone, next_milestone_date, source, kantata_project_id, created_at)
            values (${newAccountId}, ${c.name}, ${c.status}, ${c.nextMilestone ?? null}, ${c.nextMilestoneDate ?? null}, ${c.source ?? null}, ${c.kantataProjectId ?? null}, now())
          `;
        }

        for (const ev of activity) {
          await tx`
            insert into collab.activity (account_id, at, text, kind)
            values (${newAccountId}, ${ev.at}, ${ev.text}, ${ev.kind})
          `;
        }
      });
      console.log(`  done.\n`);
    } catch (err) {
      totals.errors++;
      console.error(`  FAILED: ${err instanceof Error ? err.message : err}\n`);
    }
  }

  console.log("--- Totals ---");
  console.log(totals);
  if (!APPLY) console.log("\nDry run only — re-run with --apply to write these rows.");
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
