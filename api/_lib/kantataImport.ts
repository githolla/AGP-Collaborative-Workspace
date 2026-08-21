/**
 * Kantata import orchestration — the server-side equivalent of
 * apps/tab/src/workspace/store.ts's `populateFromKantata`, for
 * POST /api/account-import, /api/account-deepen, /api/account-scope and
 * /api/account-projects (docs/api-spec-workspace-mutations.md's Kantata
 * import group). Not imported across the boundary — ported, same reason as
 * every other api/_lib file.
 *
 * DELIBERATE SIMPLIFICATION FROM THE CLIENT: no fuzzy title-matching. The
 * client's `campaignsFromMirror`/`accountLiveContext` fall back to matching
 * Kantata workspace TITLES against a derived client directory
 * (`findDirectoryClient`/`projectMatcher`) when an account isn't scoped to
 * explicit ids — a whole separate, much fuzzier subsystem
 * (`liveMirror.ts`'s `deriveClientsFromKantata`/`classifyClientTitle`).
 * Confirmed out of scope: this module ALWAYS works from the account's own
 * explicit `kantata_project_ids` — an account with none has nothing to
 * import, full stop. This is also more correct for the new model: accounts
 * are created deliberately now (`POST /api/account`), not auto-matched from
 * a CRM directory the old model derived Kantata-side.
 *
 * GAP FIX vs the client: `campaignsFromMirror` today dedupes/matches
 * campaigns by NAME ONLY — `collab.campaign.kantata_project_id` exists
 * (0007) specifically so this could be fixed, and its own column comment
 * documents this as a known, pre-existing gap. This module populates it.
 */

import type postgres from "postgres";
import { pullKantata, pullWorkspaceStories } from "./kantataMirror.js";
import { projectPhaseResolver, ancestorChain, type HierarchyMilestone, type HierarchyTask } from "./kantataHierarchy.js";
import { reconcileAssignments } from "./taskAssignments.js";
import { logActivity } from "./activity.js";

/** Same tolerant classification as campaignImport.ts's taskIsDone/taskColumn
 * — substring, case-insensitive, so a hyphen or a tenant synonym never
 * misfiles a task's state. */
export function taskIsDone(state: string): boolean {
  return /complet|accepted|closed|finished|done/i.test(state);
}
export function taskColumn(state: string): "doing" | "todo" {
  const s = state.toLowerCase();
  if (/\bnot\b/.test(s)) return "todo";
  return /start|progress|active|doing|wip/.test(s) ? "doing" : "todo";
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface RawProject {
  id: string;
  title: string;
  due_date?: string;
}
interface RawMilestone {
  id: string;
  title: string;
  workspace_id: string;
  due_date?: string;
  state?: string;
  parent_id?: string;
}
interface RawTask {
  id: string;
  title: string;
  workspace_id: string;
  due_date?: string;
  state?: string;
  parent_id?: string;
  start_date?: string;
  estimated_minutes?: number;
  assignees?: string[];
}

export interface CampaignDraft {
  name: string;
  status: "active";
  kantataProjectId: string;
  nextMilestone?: string;
  nextMilestoneDate?: string;
}

/**
 * Server port of campaignsFromMirror, minus the fuzzy-matching branch: every
 * given project belongs (the caller already filtered to the account's own
 * `kantata_project_ids`), and the CRM-deal branch is dropped entirely —
 * HubSpot is off (ADR 0008), so `mirror.campaigns` is always empty now.
 */
export function campaignsFromKantataProjects(
  projects: readonly RawProject[],
  milestones: readonly RawMilestone[],
  clientName: string,
  today: string,
): CampaignDraft[] {
  const prefixRe = new RegExp(`^${escapeRe(clientName)}\\s*[—-]\\s*`, "i");
  return projects.map((p) => {
    const upcoming = milestones
      .filter((m) => m.workspace_id === p.id && m.state !== "completed" && (m.due_date ?? "") >= today)
      .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""))[0];
    const milestone = upcoming
      ? { nextMilestone: upcoming.title, ...(upcoming.due_date ? { nextMilestoneDate: upcoming.due_date } : {}) }
      : p.due_date && p.due_date >= today
        ? { nextMilestone: "Delivery due", nextMilestoneDate: p.due_date }
        : {};
    return {
      name: p.title.replace(prefixRe, ""),
      status: "active" as const,
      kantataProjectId: p.id,
      ...milestone,
    };
  });
}

export interface TaskDraft {
  title: string;
  status: "todo" | "doing";
  due?: string;
  kantataStoryId: string;
  kantataProjectId: string;
  projectLabel?: string;
  phaseLabel?: string;
  phaseId?: string;
  kantataMilestoneId?: string;
  estimatedHours?: number;
  startDate?: string;
  ownerName?: string;
  assignees?: string[];
  kantataAncestorIds: string[];
}

/**
 * Server port of populateFromKantata's task loop, for ONE Kantata workspace
 * at a time (the resolver is scoped per workspace, same requirement as
 * client-side — never call this with milestones/tasks from more than one
 * workspace mixed together).
 */
export function tasksFromKantataWorkspace(milestones: readonly RawMilestone[], tasks: readonly RawTask[]): TaskDraft[] {
  const hierarchyMilestones: HierarchyMilestone[] = milestones.map((m) => ({ id: m.id, title: m.title, ...(m.parent_id ? { parentId: m.parent_id } : {}) }));
  const hierarchyTasks: HierarchyTask[] = tasks.map((t) => ({ id: t.id, title: t.title, ...(t.parent_id ? { parentId: t.parent_id } : {}) }));
  const resolve = projectPhaseResolver(hierarchyMilestones, hierarchyTasks);

  const drafts: TaskDraft[] = [];
  for (const t of tasks) {
    if (taskIsDone(t.state ?? "")) continue;
    const h = resolve(t.id);
    const assignees = t.assignees ?? [];
    drafts.push({
      title: t.title,
      status: taskColumn(t.state ?? ""),
      ...(t.due_date ? { due: t.due_date } : {}),
      kantataStoryId: t.id,
      kantataProjectId: t.workspace_id,
      ...(h.project ? { projectLabel: h.project.title, kantataMilestoneId: h.project.id } : {}),
      ...(h.phase ? { phaseLabel: h.phase.title, phaseId: h.phase.id } : {}),
      ...(t.estimated_minutes != null ? { estimatedHours: Math.round((t.estimated_minutes / 60) * 10) / 10 } : {}),
      ...(t.start_date ? { startDate: t.start_date } : {}),
      ...(assignees.length === 1 ? { ownerName: assignees[0] } : {}),
      ...(assignees.length > 1 ? { assignees } : {}),
      kantataAncestorIds: ancestorChain(hierarchyMilestones, hierarchyTasks, t.id),
    });
  }
  return drafts;
}

export interface ImportResult {
  campaignsAdded: number;
  campaignsUpdated: number;
  tasksAdded: number;
}

/**
 * The actual Postgres writes, run inside the caller's own withUserContext
 * transaction (RLS-scoped as the caller — this never uses the service
 * role). `scope` mirrors the spec's `POST /api/account/:id/import` body:
 * "all" does both, "campaigns"/"tasks" does one half only.
 */
export async function writeKantataImport(
  tx: postgres.TransactionSql,
  accountId: string,
  clientName: string,
  today: string,
  scope: "all" | "campaigns" | "tasks",
  campaignDrafts: readonly CampaignDraft[],
  taskDrafts: readonly TaskDraft[],
): Promise<ImportResult> {
  let campaignsAdded = 0;
  let campaignsUpdated = 0;
  let tasksAdded = 0;

  if (scope === "all" || scope === "campaigns") {
    for (const c of campaignDrafts) {
      // Dedup by kantata_project_id first, as TWO SEPARATE queries in a
      // real priority order — not a single `OR`, which previously let an
      // unrelated row with a merely-coincidental matching NAME win over the
      // row that actually owns this kantata_project_id, whenever both
      // existed (Postgres gives no ordering guarantee across an OR with no
      // ORDER BY). Falls back to name only when no id-linked row exists yet
      // — the one legitimate case, a pre-existing manual/legacy campaign
      // that predates this column being populated — and ONLY against a row
      // that has no kantata_project_id of its OWN yet (`is null`). Without
      // that filter, two DISTINCT linked projects that happen to reduce to
      // the same name (a real, observed case — identically-named contracts
      // under one client) would take turns "finding" and overwriting
      // each other's row on every import: the second one's id-lookup
      // correctly misses, falls back to the name match, finds the row the
      // first one just wrote, and steals it — one row silently absorbing
      // two projects' campaigns instead of getting one row each.
      const [byProjectId] = await tx<{ id: string }[]>`
        select id from collab.campaign where account_id = ${accountId} and kantata_project_id = ${c.kantataProjectId} limit 1
      `;
      const existing =
        byProjectId ??
        (await tx<{ id: string }[]>`
          select id from collab.campaign where account_id = ${accountId} and kantata_project_id is null and lower(name) = ${c.name.toLowerCase()} limit 1
        `)[0];
      if (existing) {
        await tx`
          update collab.campaign
          set name = ${c.name}, status = ${c.status}, next_milestone = ${c.nextMilestone ?? null},
              next_milestone_date = ${c.nextMilestoneDate ?? null}, source = 'kantata', kantata_project_id = ${c.kantataProjectId}
          where id = ${existing.id}
        `;
        campaignsUpdated += 1;
      } else {
        await tx`
          insert into collab.campaign (account_id, name, status, next_milestone, next_milestone_date, source, kantata_project_id)
          values (${accountId}, ${c.name}, ${c.status}, ${c.nextMilestone ?? null}, ${c.nextMilestoneDate ?? null}, 'kantata', ${c.kantataProjectId})
        `;
        campaignsAdded += 1;
      }
    }
  }

  if (scope === "all" || scope === "tasks") {
    for (const t of taskDrafts) {
      const [dup] = await tx<{ id: string }[]>`
        select id from collab.task where account_id = ${accountId} and kantata_story_id = ${t.kantataStoryId} limit 1
      `;
      if (dup) continue;

      await tx`
        insert into collab.task (
          account_id, title, status, due, source, label,
          kantata_story_id, kantata_synced_at, kantata_project_id, project_label,
          phase_label, phase_id, kantata_milestone_id, estimated_hours, start_date,
          owner_name, assignments, kantata_ancestor_ids
        )
        values (
          ${accountId}, ${t.title}, ${t.status}, ${t.due ?? null}, 'manual', 'from Kantata',
          ${t.kantataStoryId}, now(), ${t.kantataProjectId}, ${t.projectLabel ?? null},
          ${t.phaseLabel ?? null}, ${t.phaseId ?? null}, ${t.kantataMilestoneId ?? null}, ${t.estimatedHours ?? null}, ${t.startDate ?? null},
          ${t.ownerName ?? null},
          ${tx.json((t.assignees && t.assignees.length > 0 ? reconcileAssignments([], t.assignees) : []) as unknown as postgres.JSONValue)},
          ${t.kantataAncestorIds}
        )
      `;
      tasksAdded += 1;
    }
  }

  if (campaignsAdded > 0 || campaignsUpdated > 0 || tasksAdded > 0) {
    const parts = [
      ...(campaignsAdded > 0 ? [`${campaignsAdded} campaign${campaignsAdded === 1 ? "" : "s"} added`] : []),
      ...(campaignsUpdated > 0 ? [`${campaignsUpdated} updated`] : []),
      ...(tasksAdded > 0 ? [`${tasksAdded} task${tasksAdded === 1 ? "" : "s"} added`] : []),
    ];
    await logActivity(tx, accountId, `Imported from Kantata — ${parts.join(", ")}`, "task");
  }

  return { campaignsAdded, campaignsUpdated, tasksAdded };
}

/**
 * The full "pull fresh Kantata data for these specific project ids, then
 * write campaigns/tasks" sequence — shared by api/account-import.ts,
 * api/account-scope.ts and api/account-projects.ts, all of which end in
 * exactly this step (the last two after first changing which ids the
 * account is linked to). Always exhaustive per project
 * (`pullWorkspaceStories`), never the tenant-wide recency slice, and always
 * scoped to a resolver-per-workspace (never mixing two workspaces' stories
 * into one parent-chain walk).
 *
 * Capped at 12 project ids — the same limit `pullWorkspaceStories`/the
 * client's own `deepenWorkspaces` already enforce, so this never silently
 * truncates differently than the rest of the system already does.
 */
export interface ImportSelection {
  /** Only import campaigns whose Kantata project id is in this list — the
   * server port of the client's review panel picking specific candidates.
   * Omitted (not empty — actually absent) means "every campaign found",
   * same as before this existed. */
  campaignProjectIds?: readonly string[];
  /** Same idea, for tasks, keyed on Kantata story id. */
  taskStoryIds?: readonly string[];
}

export async function runKantataImport(
  tx: postgres.TransactionSql,
  token: string,
  accountId: string,
  clientName: string,
  projectIds: readonly string[],
  scope: "all" | "campaigns" | "tasks",
  selected?: ImportSelection,
): Promise<ImportResult> {
  const ids = [...new Set(projectIds)].slice(0, 12);
  if (ids.length === 0) return { campaignsAdded: 0, campaignsUpdated: 0, tasksAdded: 0 };

  const focus = await pullWorkspaceStories(token, ids);
  const today = new Date().toISOString().slice(0, 10);
  // Both pull functions return `Record<string, unknown>[]` (kantataMirror.ts
  // keeps its shapes loose — Kantata's own API is read defensively there,
  // field-by-field). These casts assert the specific fields THIS module
  // actually reads off them, same category as db.ts's own narrow, documented
  // driver-typing casts — not a strictness bypass.
  const focusMilestones = focus.milestones as unknown as RawMilestone[];
  const focusTasks = focus.tasks as unknown as RawTask[];

  let campaignDrafts: CampaignDraft[] = [];
  if (scope === "all" || scope === "campaigns") {
    const pull = await pullKantata(token);
    const projects = (pull.projects as unknown as RawProject[]).filter((p) => ids.includes(p.id));
    campaignDrafts = campaignsFromKantataProjects(projects, focusMilestones, clientName, today);
    // Review-gated import (the client's "confirm import" candidate picker):
    // re-pull fresh live data exactly as an "import all" would, then keep
    // only what was actually picked — fresher and more correct than trusting
    // client-cached candidate fields, and no separate write path to drift
    // out of sync with the "all" one below.
    if (selected?.campaignProjectIds) {
      const want = new Set(selected.campaignProjectIds);
      campaignDrafts = campaignDrafts.filter((c) => want.has(c.kantataProjectId));
    }
  }

  let taskDrafts: TaskDraft[] = [];
  if (scope === "all" || scope === "tasks") {
    for (const wsId of ids) {
      const wsMilestones = focusMilestones.filter((m) => m.workspace_id === wsId);
      const wsTasks = focusTasks.filter((t) => t.workspace_id === wsId);
      taskDrafts.push(...tasksFromKantataWorkspace(wsMilestones, wsTasks));
    }
    if (selected?.taskStoryIds) {
      const want = new Set(selected.taskStoryIds);
      taskDrafts = taskDrafts.filter((t) => want.has(t.kantataStoryId));
    }
  }

  return writeKantataImport(tx, accountId, clientName, today, scope, campaignDrafts, taskDrafts);
}

/** Seconds an account must wait between Kantata-triggering calls — see
 * migration 0014's header for why this exists and why it's DB-backed. */
const PULL_COOLDOWN_SECONDS = 10;

/**
 * Claims this account's Kantata-pull slot, or returns false if the cooldown
 * hasn't elapsed yet. MUST be called (and its `false` result respected)
 * before any of api/account-import.ts, api/account-deepen.ts,
 * api/account-scope.ts or api/account-projects.ts proceeds to an actual
 * `pullKantata`/`pullWorkspaceStories` call — those fan out into ~10
 * parallel paginated external API calls with real cost, and this is the
 * only thing standing between "any account member" and looping them.
 */
export async function claimKantataPullSlot(tx: postgres.TransactionSql, accountId: string): Promise<boolean> {
  const [row] = await tx<{ claimed: boolean }[]>`select collab.claim_kantata_pull_slot(${accountId}, ${PULL_COOLDOWN_SECONDS}) as claimed`;
  return row?.claimed === true;
}

export { pullKantata, pullWorkspaceStories };
