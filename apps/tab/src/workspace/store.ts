import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computeProjectROI, standardFactorTemplate, type RoiModel, type WorkspaceFactor } from "@agp/roi";
import type { Initiative, InitiativeType, SandboxIdea, ThreadMessage } from "./types.js";
import type { ClientAccount, ClientFileLink, ExternalMember } from "./types.js";
import { roiAnalystMessage, sandboxAnalystMessage } from "./agents.js";
import { factorsFromBasis } from "./basis.js";
import { accountLiveContext, campaignsFromMirror, taskColumn, taskIsDone } from "./campaignImport.js";
import { deepenWorkspaces } from "./liveMirror.js";
import { AS_OF_TODAY } from "./format.js";
import { DEPARTMENTS, copilotFlags, draftFromIdea, inviteCopilot, observeIdea, refineIdea, replanPreservingStatus, type DraftOverrides } from "./copilot.js";
import { AGP_PEOPLE, FUNCTION_NOTES, loadMirror, personById, type AgpFunction, type AgpPerson, type MirrorStaff } from "./agpKnowledge.js";
import { authenticate, makeTeamAccount, type LocalIdentity, type TeamAccount } from "../auth/localAuth.js";
import { apiFetch } from "../auth/apiFetch.js";
import { samePerson, type ShareableItem } from "./handover.js";
import { decide, decisionSummary, shareRecord, shareSummary } from "./clientApproval.js";
import { tasksFromPlan } from "./planner.js";
import { applyHandoffOrder, applyPersonDone, reconcileAssignments } from "./taskAssignments.js";
import type { TaskAssignment } from "./types.js";
import { TEMPLATES, instantiateTemplate } from "./templates.js";
import type { ActivityEvent, AiMode, Task, TaskStatus, TourFeedback, WorkPackage } from "./types.js";

/**
 * Client-side workspace store, persisted to localStorage. This is the pivot
 * increment's persistence; the Supabase-backed store (projects / factors /
 * roi_snapshots tables per roi-calculator-spec §10) replaces it when the
 * backend lands. On every factor change: recompute → append a snapshot —
 * the audit trail when numbers go in front of finance.
 */

const STORAGE_KEY = "agp-collab-workspace-v1";
const MAX_SNAPSHOTS = 100;

interface PersistedState {
  initiatives: Initiative[];
  ideas: SandboxIdea[];
  accounts: ClientAccount[];
  /** Interim sign-in accounts (email + hashed password) until Microsoft SSO. */
  team: TeamAccount[];
  /** Tour answers from every tester, pooled. Research data, not workspace
   * content — which is why "Clear workspace" leaves it alone. */
  feedback: TourFeedback[];
}

/** Older stored ideas predate newer fields — backfill them by re-drafting. */
function migrateIdea(idea: SandboxIdea): SandboxIdea {
  // Ideas stored before the review panel existed were already "reviewed" —
  // never nag someone about a draft they've been working with for days.
  const base = { ...idea, reviewed: idea.reviewed ?? true };
  if (Array.isArray(idea.team) && idea.classification && idea.plan && idea.aiMode) return base;
  const draft = draftFromIdea(idea.title, idea.pitch);
  return {
    ...base,
    aiMode: idea.aiMode ?? "copilot",
    team: idea.team ?? draft.team,
    classification: idea.classification ?? draft.classification,
    relatedProjects: idea.relatedProjects ?? draft.relatedProjects,
    relatedCampaigns: idea.relatedCampaigns ?? draft.relatedCampaigns,
    plan: idea.plan ?? draft.plan,
  };
}

/** Older stored initiatives predate tasks/activity/archive — backfill. */
function migrateInitiative(i: Initiative): Initiative {
  return {
    ...i,
    tasks: Array.isArray(i.tasks) ? i.tasks : i.plan ? tasksFromPlan(i.plan) : [],
    activity: Array.isArray(i.activity) ? i.activity : [],
    archived: i.archived ?? false,
  };
}

/** Kantata-only (ADR 0008): saved notifications/activity written in the
 * HubSpot era get their wording scrubbed on load — stored text shouldn't
 * contradict the product. */
const scrubHubSpot = (t: string) => t.replace(/Kantata\s*&\s*HubSpot|HubSpot\s*&\s*Kantata/g, "Kantata");
/** Ids of the demo seed content — purged on load so only live data remains. */
const DEMO_SEED_IDS = new Set(["acct-abc-foodbank", "idea-grant-report"]);
/** A member auto-seeded from the bundled AGP_PEOPLE roster has a "u-###" id;
 * real collaborators come from Kantata. Strip the bundled ones — live only. */
const isSeededMember = (personId: string) => /^u-\d/.test(personId);
function migrateAccount(a: ClientAccount): ClientAccount {
  return {
    ...a,
    // Drop any hardcoded/demo teammate — the account team is repopulated from
    // Kantata participants. No dummy people on a live workspace.
    members: (a.members ?? []).filter((m) => !isSeededMember(m.personId)),
    notifications: (a.notifications ?? []).map((n) => ({ ...n, text: scrubHubSpot(n.text) })),
    activity: (a.activity ?? []).map((ev) => ({ ...ev, text: scrubHubSpot(ev.text) })),
  };
}

/**
 * Re-attach items this browser created after the shared document was written.
 * `remote` is authoritative — anything it still holds wins, and anything it
 * dropped stays dropped. Only local items that are BOTH absent from the
 * remote copy and newer than its `savedAt` come back: those cannot have been
 * deleted by a teammate, because they did not exist when that save happened.
 *
 * Timestamps are `new Date().toISOString()` on both sides (the server stamps
 * `savedAt` the same way), so a lexicographic compare is a chronological one.
 */
export function keepLocallyCreated<T extends { id: string; createdAt: string }>(
  remote: readonly T[],
  local: readonly T[],
  savedAt: string,
): T[] {
  const known = new Set(remote.map((r) => r.id));
  const carried = local.filter((l) => !known.has(l.id) && l.createdAt > savedAt);
  return carried.length > 0 ? [...remote, ...carried] : [...remote];
}

/** Apply per-field migrations to any state document (local or shared).
 * Live-only: demo seed content is dropped, never re-seeded. */
function migrateState(parsed: Partial<PersistedState>): PersistedState {
  return {
    initiatives: (Array.isArray(parsed.initiatives) ? parsed.initiatives : []).filter((i) => !DEMO_SEED_IDS.has(i.id)).map(migrateInitiative),
    ideas: (Array.isArray(parsed.ideas) ? parsed.ideas : []).filter((i) => !DEMO_SEED_IDS.has(i.id)).map(migrateIdea),
    accounts: (Array.isArray(parsed.accounts) ? parsed.accounts : []).filter((a) => !DEMO_SEED_IDS.has(a.id)).map(migrateAccount),
    team: Array.isArray(parsed.team) ? parsed.team : [],
    feedback: Array.isArray(parsed.feedback) ? parsed.feedback : [],
  };
}

function load(): PersistedState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      return migrateState(parsed);
    }
  } catch {
    // corrupted storage falls through to an empty (live-only) state
  }
  return { initiatives: [], ideas: [], accounts: [], team: [], feedback: [] };
}

/** Shared-persistence status, surfaced in the footer so the truth is visible. */
export interface SyncStatus {
  mode: "local" | "shared";
  savedAt?: string;
  error?: boolean;
}

function activityEvent(text: string, kind: ActivityEvent["kind"]): ActivityEvent {
  return { id: newId("act"), at: new Date().toISOString(), text, kind };
}

function withSnapshot(initiative: Initiative): Initiative {
  const roi = computeProjectROI(initiative.factors);
  const snapshots = [
    ...initiative.snapshots,
    {
      at: new Date().toISOString(),
      netOneTime: roi.netOneTime,
      netRecurringAnnual: roi.netRecurringAnnual,
      adjustmentMultiplier: roi.adjustmentMultiplier,
      grade: roi.grade,
      hasUnknowns: roi.hasUnknowns,
    },
  ].slice(-MAX_SNAPSHOTS);
  return { ...initiative, snapshots };
}

let idCounter = 0;
function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

function humanMessage(body: string, author: string, topic?: string): ThreadMessage {
  return { id: newId("msg"), author, kind: "human", at: new Date().toISOString(), body, ...(topic ? { topic } : {}) };
}

/**
 * EVERYTHING Kantata holds for this client, merged into the account:
 * campaigns (with their milestones) + open tasks. Idempotent — merge by
 * name/title, so re-running never duplicates. Removal stays one click away
 * in Review import; that's the undo for "populate it all".
 */
function populateFromKantata(a: ClientAccount): { account: ClientAccount; campaignsAdded: number; tasksAdded: number } {
  const mirror = loadMirror();
  const today = AS_OF_TODAY();
  const campaigns = [...a.campaigns];
  let campaignsAdded = 0;
  for (const imp of campaignsFromMirror(mirror, a.clientName, today, a.kantataProjectIds, a.scopedToProjects)) {
    const idx = campaigns.findIndex((c) => c.name.toLowerCase() === imp.name.toLowerCase());
    if (idx === -1) {
      campaigns.push({ ...imp, id: newId("cmp"), source: "kantata" as const });
      campaignsAdded += 1;
    } else campaigns[idx] = { ...campaigns[idx]!, ...imp, id: campaigns[idx]!.id, source: "kantata" as const };
  }
  const ctx = accountLiveContext(mirror, a.clientName, a.kantataProjectIds, a.scopedToProjects);
  // The account team = the REAL Kantata delivery participants on this client's
  // projects. Titles from the live staff roster. Merges with anyone already
  // added; no hardcoded people.
  const staffTitle = new Map((mirror.staff ?? []).map((s) => [s.name, s.title] as const));
  const members = [...a.members];
  for (const person of [...new Set(ctx.projects.flatMap((p) => p.team ?? []))]) {
    if (members.some((m) => m.name === person)) continue;
    members.push({ personId: `k-${person.replace(/\s+/g, "-").toLowerCase()}`, name: person, title: staffTitle.get(person) ?? "AGP team" });
  }
  const tasks = [...a.tasks];
  let tasksAdded = 0;
  for (const p of ctx.projects) {
    for (const t of p.tasks) {
      if (taskIsDone(t.state)) continue;
      if (tasks.some((e) => e.title.toLowerCase() === t.title.toLowerCase())) continue;
      tasks.push({
        id: newId("task"),
        title: t.title,
        status: taskColumn(t.state),
        ...(t.dueDate ? { due: t.dueDate } : {}),
        // The auto-populate path must seed the SAME first-class fields as the
        // review-gated import — otherwise multi-person tasks arriving via
        // create/refresh/link get no team card, no hours, no project nesting,
        // and can't be written back. (Was only ownerName = assignees[0].)
        ...(t.id ? { kantataStoryId: t.id, kantataSyncedAt: new Date().toISOString() } : {}),
        ...(t.projectId ? { kantataProjectId: t.projectId } : {}),
        ...(t.projectLabel ? { projectLabel: t.projectLabel } : {}),
        ...(t.phaseLabel ? { phaseLabel: t.phaseLabel } : {}),
        ...(t.phaseId ? { phaseId: t.phaseId } : {}),
        ...(t.milestoneId ? { kantataMilestoneId: t.milestoneId } : {}),
        ...(t.estimatedHours != null ? { estimatedHours: t.estimatedHours } : {}),
        ...(t.startDate ? { startDate: t.startDate } : {}),
        // The full team, seeded so per-person completion + handoff work at once;
        // a single assignee stays as ownerName.
        ...(t.assignees && t.assignees.length > 1
          ? { assignments: reconcileAssignments([], t.assignees) }
          : t.assignees && t.assignees.length === 1
            ? { ownerName: t.assignees[0]! }
            : {}),
        label: "from Kantata",
        source: "manual" as const,
        createdAt: new Date().toISOString(),
      });
      tasksAdded += 1;
    }
  }
  return { account: { ...a, campaigns, tasks, members }, campaignsAdded, tasksAdded };
}

/**
 * The Kantata workspace ids this account's populate should cover: hand-linked
 * projects plus every project the name-matcher attributes to this client.
 * These are what the focus deepen (complete task tree, not the tenant-wide
 * recency slice) pulls before importing.
 */
function kantataWorkspaceIdsFor(clientName: string, linkedIds?: string[]): string[] {
  const ctx = accountLiveContext(loadMirror(), clientName, linkedIds);
  return [...new Set([...(linkedIds ?? []), ...ctx.projects.map((p) => p.id)])];
}

/**
 * The AGP team roster — LIVE from Kantata when available. Every member of the
 * AGP Kantata account (mirror.staff) becomes an addable teammate; the bundled
 * AGP_PEOPLE list is the fallback (offline / no live pull) and also supplies
 * function/routing metadata for anyone Kantata and the seed both know by name.
 * Kantata is the source of truth, so it wins on ties.
 */
function buildRoster(staff?: MirrorStaff[]): AgpPerson[] {
  // No live pull → the bundled roster (offline / demo). When Kantata DOES
  // answer, it is authoritative: the roster is EXACTLY the AGP account, and
  // the fictional seed people never leak into a real team list. Seed metadata
  // (function/team/routing) still enriches anyone Kantata knows by name.
  if (!staff || staff.length === 0) return AGP_PEOPLE;
  const seedByName = new Map(AGP_PEOPLE.map((p) => [p.name.toLowerCase(), p]));
  return staff
    .map((u) => {
      const seed = seedByName.get(u.name.toLowerCase());
      return {
        id: `k-${u.id}`,
        name: u.name,
        title: u.title || seed?.title || "AGP team",
        fn: seed?.fn ?? "project_management",
        team: seed?.team ?? "",
        entity: seed?.entity ?? "PG Agency",
        routing: seed?.routing ?? "direct",
        ...(seed?.managerId ? { managerId: seed.managerId } : {}),
      } as AgpPerson;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function useWorkspace() {
  const [state, setState] = useState<PersistedState>(load);
  const { initiatives, ideas, accounts, team } = state;
  // The live AGP team from Kantata (mirror.staff), falling back to the bundled
  // roster. Recomputed when the live mirror's staff array changes identity.
  const roster = useMemo(() => buildRoster(loadMirror().staff), [loadMirror().staff]);
  const rosterById = useMemo(() => new Map(roster.map((p) => [p.id, p])), [roster]);

  // ---- shared persistence (Supabase via /api/state) ----------------------
  // Boot: adopt the shared state if one exists (or seed it from this browser
  // if we're first). Saves are debounced; a poll picks up teammates' edits.
  // Unreachable endpoint (local dev, keys unset) = localStorage-only mode.
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ mode: "local" });
  const versionRef = useRef(0);
  const stateRef = useRef(state);
  const adoptingRef = useRef(false);
  const saveTimerRef = useRef(0);
  stateRef.current = state;

  /**
   * Adopt the shared document — without destroying work this browser did
   * after that document was written. The remote copy wins for everything it
   * knows about, so a teammate's edits AND their deletions still land; what
   * gets carried over is only what was created HERE since `savedAt`.
   *
   * The time bound is the whole trick. A plain union would resurrect every
   * deleted workspace on the next poll; replacing wholesale (the old
   * behaviour) silently ate any workspace created in the seconds before a
   * boot fetch, a 25s poll, or a 409 landed — you'd click into the workspace
   * you just made and get "Client workspace not found". An item older than
   * the remote snapshot that the remote no longer has was deleted on
   * purpose; an item newer than it simply hasn't been uploaded yet.
   */
  const adopt = useCallback((envelope: { version: number; savedAt: string; state: unknown }) => {
    versionRef.current = envelope.version;
    const remote = migrateState(envelope.state as Partial<PersistedState>);
    const local = stateRef.current;
    const merged: PersistedState = {
      initiatives: keepLocallyCreated(remote.initiatives, local.initiatives, envelope.savedAt),
      ideas: keepLocallyCreated(remote.ideas, local.ideas, envelope.savedAt),
      accounts: keepLocallyCreated(remote.accounts, local.accounts, envelope.savedAt),
      team: keepLocallyCreated(remote.team, local.team, envelope.savedAt),
      feedback: keepLocallyCreated(remote.feedback, local.feedback, envelope.savedAt),
    };
    // Suppress the follow-up save ONLY when we took the remote document as-is.
    // If we carried anything over, it still has to go up — otherwise the
    // teammate whose save we just adopted never sees it.
    adoptingRef.current =
      merged.initiatives.length === remote.initiatives.length &&
      merged.ideas.length === remote.ideas.length &&
      merged.accounts.length === remote.accounts.length &&
      merged.team.length === remote.team.length &&
      merged.feedback.length === remote.feedback.length;
    setState(merged);
    setSyncStatus({ mode: "shared", savedAt: envelope.savedAt });
  }, []);

  const pushRemote = useCallback(
    async (s: PersistedState) => {
      try {
        const res = await apiFetch("/api/state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ baseVersion: versionRef.current, state: s }),
        });
        if (res.status === 409) {
          // Someone saved first — their version wins for what it contains,
          // and `adopt` carries our newer creations across so the losing
          // side of the race doesn't quietly lose a workspace.
          const j = (await res.json()) as { envelope?: { version: number; savedAt: string; state: unknown } };
          if (j.envelope) adopt(j.envelope);
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = (await res.json()) as { version: number; savedAt: string };
        versionRef.current = j.version;
        setSyncStatus({ mode: "shared", savedAt: j.savedAt });
      } catch {
        setSyncStatus((prev) => (prev.mode === "shared" ? { ...prev, error: true } : prev));
      }
    },
    [adopt],
  );

  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      try {
        const res = await apiFetch("/api/state");
        if (!res.ok) return;
        const j = (await res.json()) as {
          configured?: boolean;
          exists?: boolean;
          envelope?: { version: number; savedAt: string; state: unknown };
        };
        if (cancelled || !j.configured) return;
        if (j.exists && j.envelope) adopt(j.envelope);
        else void pushRemote(stateRef.current); // first visitor seeds the shared store
      } catch {
        // endpoint absent — stay local
      }
    };
    void boot();

    const poll = window.setInterval(async () => {
      try {
        const res = await apiFetch("/api/state");
        if (!res.ok) return;
        const j = (await res.json()) as { exists?: boolean; envelope?: { version: number; savedAt: string; state: unknown } };
        if (j.exists && j.envelope && j.envelope.version > versionRef.current) adopt(j.envelope);
      } catch {
        // transient — next poll retries
      }
    }, 25_000);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
    };
  }, [adopt, pushRemote]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // storage full/unavailable — the session still works in memory
    }
    // Adopting a shared version must not immediately re-save it.
    if (adoptingRef.current) {
      adoptingRef.current = false;
      return;
    }
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => void pushRemote(stateRef.current), 1200);
    return () => window.clearTimeout(saveTimerRef.current);
  }, [state, pushRemote]);

  const mutate = useCallback((id: string, fn: (i: Initiative) => Initiative) => {
    setState((s) => ({ ...s, initiatives: s.initiatives.map((i) => (i.id === id ? fn(i) : i)) }));
  }, []);

  const mutateIdea = useCallback((id: string, fn: (i: SandboxIdea) => SandboxIdea) => {
    setState((s) => ({ ...s, ideas: s.ideas.map((i) => (i.id === id ? fn(i) : i)) }));
  }, []);

  // ---- initiatives ----

  const updateFactor = useCallback(
    (id: string, key: string, patch: Partial<WorkspaceFactor>) => {
      mutate(id, (i) => {
        const label = i.factors.find((f) => f.key === key)?.label ?? key;
        return withSnapshot({
          ...i,
          factors: i.factors.map((f) => (f.key === key ? { ...f, ...patch } : f)),
          activity: [...i.activity, activityEvent(`ROI number updated — ${label}`, "roi")],
        });
      });
    },
    [mutate],
  );

  const addTask = useCallback(
    (id: string, title: string, ownerName?: string, due?: string, label?: string) => {
      const task: Task = {
        id: newId("task"),
        title,
        ...(ownerName ? { ownerName } : {}),
        ...(due ? { due } : {}),
        ...(label ? { label } : {}),
        status: "todo",
        source: "manual",
        createdAt: new Date().toISOString(),
      };
      mutate(id, (i) => ({
        ...i,
        tasks: [...i.tasks, task],
        activity: [...i.activity, activityEvent(`Task added — "${title}"${ownerName ? ` (${ownerName})` : ""}`, "task")],
      }));
    },
    [mutate],
  );

  const setTaskStatus = useCallback(
    (id: string, taskId: string, status: TaskStatus) => {
      mutate(id, (i) => {
        const task = i.tasks.find((t) => t.id === taskId);
        if (!task) return i;
        const label = status === "done" ? "completed" : status === "doing" ? "started" : "reopened";
        return {
          ...i,
          tasks: i.tasks.map((t) => (t.id === taskId ? { ...t, status } : t)),
          activity: [...i.activity, activityEvent(`${task.ownerName ?? "Someone"} ${label} — "${task.title.slice(0, 60)}"`, "task")],
        };
      });
    },
    [mutate],
  );

  const setArchived = useCallback(
    (id: string, archived: boolean) => {
      mutate(id, (i) => ({
        ...i,
        archived,
        activity: [...i.activity, activityEvent(archived ? "Workspace archived — history retained" : "Workspace restored from archive", "workspace")],
      }));
    },
    [mutate],
  );

  const postMessage = useCallback(
    (id: string, body: string, author = "You") => {
      mutate(id, (i) => ({ ...i, thread: [...i.thread, humanMessage(body, author)] }));
    },
    [mutate],
  );

  const askRoiAnalyst = useCallback(
    (id: string) => {
      mutate(id, (i) => ({
        ...i,
        thread: [
          ...i.thread,
          { id: newId("msg"), author: "ROI Analyst", kind: "agent" as const, at: new Date().toISOString(), body: roiAnalystMessage(i) },
        ],
      }));
    },
    [mutate],
  );

  const setSummary = useCallback((id: string, summary: string) => mutate(id, (i) => ({ ...i, summary })), [mutate]);

  const createInitiative = useCallback((name: string, type: InitiativeType): string => {
    const id = newId("init");
    const initiative: Initiative = {
      id,
      name,
      type,
      summary: "",
      factors: standardFactorTemplate(),
      tasks: [],
      activity: [activityEvent("Workspace created", "workspace")],
      thread: [],
      snapshots: [],
      createdAt: new Date().toISOString(),
    };
    setState((s) => ({ ...s, initiatives: [...s.initiatives, withSnapshot(initiative)] }));
    return id;
  }, []);

  // ---- sandbox ideas ----

  const createIdea = useCallback((title: string, pitch: string, aiMode: AiMode = "copilot", overrides?: DraftOverrides, accountId?: string): string => {
    const id = newId("idea");
    let idea: SandboxIdea;
    if (aiMode === "copilot") {
      // The copilot drafts everything from the pitch — never a blank page.
      // Intake picks (department, service line, vertical, client) win over
      // its own inference, and the draft stays unreviewed until accepted.
      const draft = draftFromIdea(title, pitch, undefined, overrides);
      idea = {
        id,
        title,
        aiMode,
        pitch,
        basis: draft.basis,
        plan: draft.plan,
        team: draft.team,
        classification: draft.classification,
        relatedProjects: draft.relatedProjects,
        relatedCampaigns: draft.relatedCampaigns,
        thread: [
          { id: newId("msg"), author: "AGP Copilot", kind: "agent", at: new Date().toISOString(), body: draft.briefing },
        ],
        status: "exploring",
        reviewed: false,
        createdAt: new Date().toISOString(),
      };
    } else {
      // Blank collaboration: humans work; the Copilot observes silently and
      // joins only when invited. It still classifies quietly so context chips
      // and its eventual arrival are informed — intake picks still apply.
      const observed = observeIdea(title, pitch);
      const deptLabel = overrides?.departmentFn ? DEPARTMENTS.find((d) => d.fn === overrides.departmentFn)?.label : undefined;
      idea = {
        id,
        title,
        aiMode,
        pitch,
        basis: { summary: pitch, comparables: [], manual: [], buildHours: 0, buildRate: 100 },
        team: [],
        classification: {
          ...observed.classification,
          ...(deptLabel ? { department: deptLabel } : {}),
          ...(overrides?.serviceLine ? { serviceLine: overrides.serviceLine } : {}),
          ...(overrides?.vertical ? { vertical: overrides.vertical } : {}),
          ...(overrides?.clientName
            ? { clientNames: [...new Set([overrides.clientName, ...observed.classification.clientNames])] }
            : {}),
        },
        relatedProjects: observed.relatedProjects,
        relatedCampaigns: observed.relatedCampaigns,
        thread: [],
        status: "exploring",
        reviewed: true,
        createdAt: new Date().toISOString(),
      };
    }
    if (accountId) idea = { ...idea, accountId };
    setState((s) => ({ ...s, ideas: [...s.ideas, idea] }));
    return id;
  }, []);

  /** Delete a sandbox idea outright — sandbox work is exploratory, so gone
   * is gone (a promoted idea's build lives on independently). */
  const removeIdea = useCallback((id: string) => {
    setState((s) => ({ ...s, ideas: s.ideas.filter((i) => i.id !== id) }));
  }, []);

  /** Tie a legacy/unclaimed idea to a client workspace — the sandbox lives
   * inside each client, so every idea should end up owned by one. */
  const claimIdea = useCallback((id: string, accountId: string) => {
    setState((s) => ({ ...s, ideas: s.ideas.map((i) => (i.id === id ? { ...i, accountId } : i)) }));
  }, []);

  /** The human signed off on the Copilot's draft — the review panel retires. */
  const acceptDraftReview = useCallback(
    (id: string) => {
      mutateIdea(id, (i) => ({
        ...i,
        reviewed: true,
        thread: [
          ...i.thread,
          {
            id: newId("msg"),
            author: "AGP Copilot",
            kind: "agent" as const,
            at: new Date().toISOString(),
            body: "Draft accepted ✓ — I'll keep the numbers, plan, and parts in sync as you refine. Tell me changes in plain words any time.",
          },
        ],
      }));
    },
    [mutateIdea],
  );

  /** Invite the observing Copilot in — it arrives already informed. */
  const inviteCopilotIn = useCallback(
    (id: string) => {
      mutateIdea(id, (i) => {
        if (i.aiMode === "copilot") return i;
        const { idea: joined, briefing } = inviteCopilot(i);
        return {
          ...joined,
          thread: [
            ...joined.thread,
            { id: newId("msg"), author: "AGP Copilot", kind: "agent" as const, at: new Date().toISOString(), body: briefing },
          ],
        };
      });
    },
    [mutateIdea],
  );

  /** Add a teammate by hand (both modes) — replans their part automatically. */
  const addTeamMember = useCallback(
    (id: string, personId: string) => {
      mutateIdea(id, (i) => {
        const person = personById(personId);
        if (!person || i.team.some((m) => m.personId === personId)) return i;
        const viaManager = person.routing === "via_manager" ? personById(person.managerId ?? "")?.name : undefined;
        const next = {
          ...i,
          team: [
            ...i.team,
            {
              personId: person.id,
              name: person.name,
              title: person.title,
              role: "Contributor",
              why: `Added by the team. (${FUNCTION_NOTES[person.fn]}.)`,
              ...(viaManager ? { viaManager } : {}),
            },
          ],
        };
        return { ...next, plan: replanPreservingStatus(next) };
      });
    },
    [mutateIdea],
  );

  const updateIdea = useCallback(
    (id: string, patch: Partial<Pick<SandboxIdea, "title" | "pitch" | "basis" | "team">>) => {
      mutateIdea(id, (i) => {
        const next = { ...i, ...patch };
        // Team or basis edits re-plan the project, keeping invite/part statuses.
        return patch.team || patch.basis ? { ...next, plan: replanPreservingStatus(next) } : next;
      });
    },
    [mutateIdea],
  );

  /** Invite someone to add their part, or record that their part landed. */
  const setPackageStatus = useCallback(
    (scope: "idea" | "initiative", id: string, personId: string, status: WorkPackage["status"]) => {
      const updatePlan = <T extends { plan?: { packages: WorkPackage[] } | undefined; thread: SandboxIdea["thread"] }>(item: T): T => {
        if (!item.plan) return item;
        const pkg = item.plan.packages.find((p) => p.personId === personId);
        if (!pkg) return item;
        const note =
          status === "invited"
            ? `Invite sent to ${pkg.name} for their part — ${pkg.part}${pkg.viaManager ? ` (routed via ${pkg.viaManager}, dispatch-managed)` : ""}${pkg.bring ? ` They're asked to bring: ${pkg.bring}` : ""}`
            : status === "part_added"
              ? `${pkg.name} added their part (${pkg.part.split("—")[0]?.trim() ?? "done"}).`
              : `${pkg.name}'s part reset to proposed.`;
        return {
          ...item,
          plan: { ...item.plan, packages: item.plan.packages.map((p) => (p.personId === personId ? { ...p, status } : p)) },
          thread: [...item.thread, { id: newId("msg"), author: "AGP Copilot", kind: "agent" as const, at: new Date().toISOString(), body: note }],
        };
      };
      if (scope === "idea") mutateIdea(id, (i) => updatePlan(i));
      else
        mutate(id, (i) => {
          const updated = updatePlan(i);
          const pkg = i.plan?.packages.find((p) => p.personId === personId);
          // Plan and tasks are one thing: a part landing completes its task.
          const tasks =
            status === "part_added"
              ? updated.tasks.map((t) => (t.id === `task-${personId}` ? { ...t, status: "done" as const } : t))
              : updated.tasks;
          return {
            ...updated,
            tasks,
            activity: [
              ...updated.activity,
              activityEvent(
                status === "invited" ? `${pkg?.name ?? personId} invited to add their part` : `${pkg?.name ?? personId}'s part landed`,
                "team",
              ),
            ],
          };
        });
    },
    [mutate, mutateIdea],
  );

  /**
   * Post a message. In copilot mode the Copilot applies it as a refinement
   * and replies; in observer mode it stays silent — humans just talk.
   */
  const postIdeaMessage = useCallback(
    (id: string, body: string, author = "You") => {
      mutateIdea(id, (i) => {
        if (i.aiMode !== "copilot") {
          return { ...i, thread: [...i.thread, humanMessage(body, author)] };
        }
        const { idea: refined, reply } = refineIdea(i, body);
        return {
          ...refined,
          thread: [
            ...i.thread,
            humanMessage(body, author),
            { id: newId("msg"), author: "AGP Copilot", kind: "agent" as const, at: new Date().toISOString(), body: reply },
          ],
        };
      });
    },
    [mutateIdea],
  );

  const askIdeaAnalyst = useCallback(
    (id: string) => {
      mutateIdea(id, (i) => ({
        ...i,
        thread: [
          ...i.thread,
          { id: newId("msg"), author: "ROI Analyst", kind: "agent" as const, at: new Date().toISOString(), body: sandboxAnalystMessage(i) },
        ],
      }));
    },
    [mutateIdea],
  );

  /**
   * Promote a sandbox idea into a real build: a new initiative pre-filled from
   * the idea's basis (unfilled basis lines stay honestly unknown), carrying
   * the sandbox conversation over so context is never lost.
   */
  const promoteIdea = useCallback(
    (id: string, type: InitiativeType, author = "You"): string | null => {
      const idea = ideas.find((i) => i.id === id);
      if (!idea || idea.status === "promoted") return idea?.promotedInitiativeId ?? null;

      const initiativeId = newId("init");
      // Gather-list ownership follows the parts: each unknown factor is owned
      // by the person whose function is responsible for bringing that number.
      const OWNER_BY_FACTOR: Record<string, AgpFunction> = {
        fully_loaded_build_cost: "web_development",
        time_saved_cashable: "analytics",
        error_revenue_value: "analytics",
        run_maintenance_cost: "project_management",
        traditional_build_baseline: "business_development",
        license_avoidance: "business_development",
      };
      const ownerFor = (factorKey: string): string | null => {
        const fn = OWNER_BY_FACTOR[factorKey];
        const member = idea.team.find((m) => personById(m.personId)?.fn === fn);
        return member?.name ?? null;
      };
      const factors = factorsFromBasis(idea.basis).map((f) =>
        f.status === "unknown" && ownerFor(f.key) ? { ...f, gatherOwner: ownerFor(f.key) } : f,
      );
      const initiative: Initiative = {
        id: initiativeId,
        name: idea.title,
        type,
        summary: idea.pitch,
        factors,
        ...(idea.plan ? { plan: idea.plan } : {}),
        tasks: idea.plan ? tasksFromPlan(idea.plan) : [],
        activity: [activityEvent("Workspace created — promoted from the sandbox with basis, plan, parts, and tasks", "workspace")],
        thread: [
          ...idea.thread,
          humanMessage(
            `Promoted from the sandbox — basis, plan, and parts carried over. Time to invite the team and harden the numbers.`,
            author,
          ),
        ],
        snapshots: [],
        createdAt: new Date().toISOString(),
      };
      setState((s) => ({
        ...s,
        initiatives: [...s.initiatives, withSnapshot(initiative)],
        ideas: s.ideas.map((i) => (i.id === id ? { ...i, status: "promoted" as const, promotedInitiativeId: initiativeId } : i)),
      }));
      return initiativeId;
    },
    [ideas],
  );

  // ---- client accounts (Collab Hub execution workspaces) ----

  const mutateAccount = useCallback((id: string, fn: (a: ClientAccount) => ClientAccount) => {
    setState((s) => ({ ...s, accounts: s.accounts.map((a) => (a.id === id ? fn(a) : a)) }));
  }, []);

  /**
   * Workspace template (Collab Hub Must): every new client workspace gets the
   * same consistent setup — the four core documents, a delivery-lead member,
   * and a welcome notification. Rows, not choices.
   */
  const createAccount = useCallback((clientName: string): string => {
    const id = newId("acct");
    const now = new Date().toISOString();
    const coreDoc = (name: string): ClientFileLink => ({ id: newId("doc"), name, kind: "doc", addedAt: now });
    const account: ClientAccount = {
      id,
      clientName,
      // No default teammate — the account team comes from Kantata (the real
      // delivery participants), added when the workspace populates. Live only.
      members: [],
      externals: [],
      clientContacts: 0,
      campaigns: [],
      notifications: [{ id: newId("n"), text: `Workspace created from the standard client template — add campaigns, files, and people.`, at: now }],
      tasks: [],
      thread: [],
      files: [],
      docs: [coreDoc("Project Brief & Strategy"), coreDoc("Creative Guidelines"), coreDoc("Client Intake Form"), coreDoc("Team Contact List")],
      activity: [activityEvent("Workspace created from the standard client template", "workspace")],
      createdAt: now,
    };
    setState((s) => ({ ...s, accounts: [...s.accounts, account] }));
    return id;
  }, []);

  /**
   * Create a client workspace from the book of business — the standard
   * template ONLY. Nothing imports automatically: the user populates the
   * workspace when THEY choose, through the Review-import panel.
   */
  const createAccountFromMirror = useCallback(
    (clientName: string): string => {
      const id = createAccount(clientName);
      // Populate EVERYTHING at birth — the workspace opens full, not empty.
      // Review import remains the undo (remove anything, or Remove all).
      mutateAccount(id, (a) => {
        const { account, campaignsAdded, tasksAdded } = populateFromKantata(a);
        const text =
          campaignsAdded + tasksAdded > 0
            ? `Populated from Kantata: ${campaignsAdded} campaign${campaignsAdded === 1 ? "" : "s"} · ${tasksAdded} task${tasksAdded === 1 ? "" : "s"} — milestones included. Remove anything via “Review import”.`
            : `No Kantata projects matched “${clientName}” yet — use the finder in the banner to link its work.`;
        return {
          ...account,
          ...(campaignsAdded + tasksAdded > 0 ? { autoPopulated: true } : {}),
          notifications: [...account.notifications, { id: newId("n"), text, at: new Date().toISOString() }],
          activity:
            campaignsAdded + tasksAdded > 0
              ? [...account.activity, activityEvent(text, "workspace")]
              : account.activity,
        };
      });
      // The boot mirror is a tenant-wide recency slice — most workspaces'
      // full task trees aren't in it. Deepen those projects in the
      // background and top the workspace up when the complete set lands.
      void deepenWorkspaces(kantataWorkspaceIdsFor(clientName)).then((fetched) => {
        if (fetched === 0) return;
        mutateAccount(id, (cur) => {
          const { account, campaignsAdded, tasksAdded } = populateFromKantata(cur);
          if (campaignsAdded + tasksAdded === 0) return cur;
          const text = `Full Kantata task tree pulled: +${campaignsAdded} campaign${campaignsAdded === 1 ? "" : "s"} · +${tasksAdded} task${tasksAdded === 1 ? "" : "s"}.`;
          return {
            ...account,
            autoPopulated: true,
            notifications: [...account.notifications, { id: newId("n"), text, at: new Date().toISOString() }],
            activity: [...account.activity, activityEvent(text, "workspace")],
          };
        });
      });
      return id;
    },
    [createAccount, mutateAccount],
  );

  /** Pull EVERYTHING Kantata has for this client into the workspace —
   * campaigns, milestones, open tasks — in one action. Idempotent. Deepens
   * first: the boot mirror only carries a recency slice of the task tree,
   * so the client's workspaces get a complete per-project pull before the
   * import runs. */
  const importAllFromKantata = useCallback(
    async (id: string) => {
      const target = stateRef.current.accounts.find((x) => x.id === id);
      if (target) await deepenWorkspaces(kantataWorkspaceIdsFor(target.clientName, target.kantataProjectIds));
      mutateAccount(id, (a) => {
        const { account, campaignsAdded, tasksAdded } = populateFromKantata(a);
        if (campaignsAdded + tasksAdded === 0) return a;
        const text = `Everything imported from Kantata: ${campaignsAdded} campaign${campaignsAdded === 1 ? "" : "s"} · ${tasksAdded} task${tasksAdded === 1 ? "" : "s"}.`;
        return {
          ...account,
          autoPopulated: true,
          notifications: [...account.notifications, { id: newId("n"), text, at: new Date().toISOString() }],
          activity: [...account.activity, activityEvent(text, "workspace")],
        };
      });
    },
    [mutateAccount],
  );

  /**
   * Fired when a live client workspace opens: fill it from Kantata's full
   * task tree ONCE, automatically, no button. Deepens the client's projects
   * (complete per-workspace pull), imports everything, and marks the
   * workspace autoPopulated so it never re-adds work the user later removes.
   * A workspace that matched nothing stays unmarked and retries on a future
   * open (after a redeploy or a hand-link improves the match).
   */
  /**
   * Load the open workspace's COMPLETE Kantata story tree into the mirror —
   * every time it opens, not just on first populate. This is what task→project
   * resolution needs: the milestones (the real projects) and the tasks' parent
   * links. A tenant-wide refresh (the ↻ button) replaces the mirror with a
   * recency-sliced view that drops most milestones, so without re-deepening on
   * open, an already-populated workspace loses its project grouping. Idempotent
   * and import-free — it only enriches the mirror, never adds tasks. Returns the
   * number of stories fetched so the caller can trigger a re-render.
   */
  const ensureDeepened = useCallback(async (id: string): Promise<number> => {
    const target = stateRef.current.accounts.find((x) => x.id === id);
    if (!target || target.archived) return 0;
    return deepenWorkspaces(kantataWorkspaceIdsFor(target.clientName, target.kantataProjectIds));
  }, []);

  const ensureAutoPopulated = useCallback(
    async (id: string) => {
      const target = stateRef.current.accounts.find((x) => x.id === id);
      if (!target || target.archived || target.autoPopulated) return;
      const fetched = await deepenWorkspaces(kantataWorkspaceIdsFor(target.clientName, target.kantataProjectIds));
      mutateAccount(id, (a) => {
        if (a.autoPopulated) return a;
        const { account, campaignsAdded, tasksAdded } = populateFromKantata(a);
        if (campaignsAdded + tasksAdded === 0) {
          // Nothing matched — leave unmarked so a later open can retry, but
          // don't spam an empty notification.
          return a;
        }
        const text = `Populated from Kantata: ${campaignsAdded} campaign${campaignsAdded === 1 ? "" : "s"} · ${tasksAdded} task${tasksAdded === 1 ? "" : "s"} — milestones included${fetched > 0 ? ", full task tree" : ""}. Remove anything via “Review import”.`;
        return {
          ...account,
          autoPopulated: true,
          notifications: [...account.notifications, { id: newId("n"), text, at: new Date().toISOString() }],
          activity: [...account.activity, activityEvent(text, "workspace")],
        };
      });
    },
    [mutateAccount],
  );

  /** Import exactly the campaigns the user selected in the review panel. */
  const importCampaigns = useCallback(
    (id: string, selected: { name: string; status: "active" | "planned" | "complete"; nextMilestone?: string; nextMilestoneDate?: string }[]) => {
      if (selected.length === 0) return;
      mutateAccount(id, (a) => {
        const campaigns = [...a.campaigns];
        for (const imp of selected) {
          const idx = campaigns.findIndex((c) => c.name.toLowerCase() === imp.name.toLowerCase());
          if (idx === -1) campaigns.push({ ...imp, id: newId("cmp"), source: "kantata" as const });
          else campaigns[idx] = { ...campaigns[idx]!, ...imp, id: campaigns[idx]!.id, source: "kantata" as const };
        }
        const summary = `${selected.length} campaign${selected.length === 1 ? "" : "s"} imported from Kantata — your selection.`;
        return {
          ...a,
          campaigns,
          notifications: [...a.notifications, { id: newId("n"), text: summary, at: new Date().toISOString() }],
          activity: [...a.activity, activityEvent(summary, "workspace")],
        };
      });
    },
    [mutateAccount],
  );

  /** Project Finder: a human hand-picked Kantata projects for this client.
   * Links are permanent (beat every name heuristic) and the picked
   * projects' campaigns import immediately — the pick IS the review. */
  /**
   * Set which Kantata projects this workspace covers. `scoped` true means the
   * workspace IS those projects; false returns it to covering the whole client.
   *
   * From Cara's pilot feedback: two projects under one client can have
   * completely different teams, so a workspace usually wants one of them, not
   * all. Re-populating afterwards is deliberate — the campaigns and tasks on
   * screen have to match the new scope, or the workspace silently keeps work
   * that no longer belongs to it.
   */
  const setProjectScope = useCallback(
    (accountId: string, projectIds: readonly string[], scoped: boolean) => {
      mutateAccount(accountId, (a) => {
        const ids = [...new Set(projectIds)];
        const next: ClientAccount = { ...a, kantataProjectIds: ids, scopedToProjects: scoped };
        // Drop auto-populated work that fell outside the new scope, then
        // re-import within it. Anything the user added by hand is untouched.
        const inScope = new Set(
          campaignsFromMirror(loadMirror(), a.clientName, AS_OF_TODAY(), ids, scoped).map((c) => c.name),
        );
        const kept = next.campaigns.filter((c) => c.source !== "kantata" || inScope.has(c.name));
        const { account } = populateFromKantata({ ...next, campaigns: kept });
        return {
          ...account,
          notifications: [
            ...account.notifications,
            {
              id: newId("n"),
              text: scoped
                ? `Workspace scoped to ${ids.length} Kantata project${ids.length === 1 ? "" : "s"}.`
                : `Workspace now covers every ${a.clientName} project.`,
              at: new Date().toISOString(),
            },
          ],
          activity: [...account.activity, activityEvent(scoped ? "Workspace scoped to selected projects" : "Workspace covers the whole client", "workspace")],
        };
      });
    },
    [mutateAccount],
  );

  /** Edit your own discussion post. Cara asked for this directly after
   * posting into the wrong place — without it a misfire is permanent. */
  const editAccountPost = useCallback(
    (accountId: string, messageId: string, body: string) => {
      const text = body.trim();
      if (!text) return;
      mutateAccount(accountId, (a) => ({
        ...a,
        thread: a.thread.map((m) => (m.id === messageId ? { ...m, body: text, editedAt: new Date().toISOString() } : m)),
      }));
    },
    [mutateAccount],
  );

  /** Delete your own discussion post. */
  const deleteAccountPost = useCallback(
    (accountId: string, messageId: string) => {
      mutateAccount(accountId, (a) => ({ ...a, thread: a.thread.filter((m) => m.id !== messageId) }));
    },
    [mutateAccount],
  );

  const linkProjects = useCallback(
    async (id: string, projectIds: string[]) => {
      if (projectIds.length === 0) return;
      // The picked ids ARE Kantata workspace ids — deepen them so the
      // import that follows sees the complete task tree, not the slice.
      await deepenWorkspaces(projectIds);
      mutateAccount(id, (a) => {
        const linked = [...new Set([...(a.kantataProjectIds ?? []), ...projectIds])];
        // Link, then populate EVERYTHING the linked projects carry —
        // campaigns, milestones, open tasks.
        const { account, campaignsAdded, tasksAdded } = populateFromKantata({ ...a, kantataProjectIds: linked });
        const summary = `${projectIds.length} Kantata project${projectIds.length === 1 ? "" : "s"} linked — ${campaignsAdded} campaign${campaignsAdded === 1 ? "" : "s"} · ${tasksAdded} task${tasksAdded === 1 ? "" : "s"} imported.`;
        return {
          ...account,
          notifications: [...account.notifications, { id: newId("n"), text: summary, at: new Date().toISOString() }],
          activity: [...account.activity, activityEvent(summary, "workspace")],
        };
      });
    },
    [mutateAccount],
  );

  /** Relink a workspace to a real CRM client (fixes demo-seeded or
   * misspelled names) — matching, imports, and context follow the new name. */
  const renameAccount = useCallback(
    (id: string, newName: string) => {
      const clean = newName.trim();
      if (!clean) return;
      mutateAccount(id, (a) => ({
        ...a,
        clientName: clean,
        activity: [...a.activity, activityEvent(`Workspace linked to CRM client “${clean}” (was “${a.clientName}”)`, "workspace")],
      }));
    },
    [mutateAccount],
  );

  /** Review-gated Kantata task import — same contract as campaigns: the
   * user picked these in the review panel; merge by title, never duplicate. */
  const importTasks = useCallback(
    (
      id: string,
      selected: {
        title: string;
        status: TaskStatus;
        due?: string;
        kantataStoryId?: string;
        kantataProjectId?: string;
        projectLabel?: string;
        phaseLabel?: string;
        phaseId?: string;
        kantataMilestoneId?: string;
        estimatedHours?: number;
        startDate?: string;
        assignees?: string[];
      }[],
    ) => {
      if (selected.length === 0) return;
      mutateAccount(id, (a) => {
        const tasks = [...a.tasks];
        let added = 0;
        for (const t of selected) {
          // Dedup by Kantata story id when we have it — identical phase names
          // repeat across milestones, so a title-only check would silently
          // drop real tasks. Fall back to title for id-less manual entries.
          const dup = t.kantataStoryId
            ? tasks.some((e) => e.kantataStoryId === t.kantataStoryId)
            : tasks.some((e) => e.title.toLowerCase() === t.title.toLowerCase());
          if (dup) continue;
          tasks.push({
            id: newId("task"),
            title: t.title,
            status: t.status,
            ...(t.due ? { due: t.due } : {}),
            label: "from Kantata",
            source: "manual" as const,
            createdAt: new Date().toISOString(),
            // The story id makes this task writable back to Kantata. Imported
            // tasks are already in sync at the moment they land.
            ...(t.kantataStoryId ? { kantataStoryId: t.kantataStoryId, kantataSyncedAt: new Date().toISOString() } : {}),
            ...(t.kantataProjectId ? { kantataProjectId: t.kantataProjectId } : {}),
            ...(t.projectLabel ? { projectLabel: t.projectLabel } : {}),
            ...(t.phaseLabel ? { phaseLabel: t.phaseLabel } : {}),
            ...(t.phaseId ? { phaseId: t.phaseId } : {}),
            ...(t.kantataMilestoneId ? { kantataMilestoneId: t.kantataMilestoneId } : {}),
            // Scheduled hours + start pulled from Kantata — resourcing shows
            // them without re-entry; a PM edit overrides later.
            ...(t.estimatedHours != null ? { estimatedHours: t.estimatedHours } : {}),
            ...(t.startDate ? { startDate: t.startDate } : {}),
            // The team from Kantata's assignees — seeded so the task card shows
            // everyone and per-person completion works out of the box. Single
            // assignee stays as ownerName only (no split needed).
            ...(t.assignees && t.assignees.length > 1
              ? { assignments: reconcileAssignments([], t.assignees) }
              : t.assignees && t.assignees.length === 1
                ? { ownerName: t.assignees[0]! }
                : {}),
          });
          added += 1;
        }
        if (added === 0) return a;
        const summary = `${added} task${added === 1 ? "" : "s"} imported from Kantata — your selection.`;
        return {
          ...a,
          tasks,
          notifications: [...a.notifications, { id: newId("n"), text: summary, at: new Date().toISOString() }],
          activity: [...a.activity, activityEvent(summary, "task")],
        };
      });
    },
    [mutateAccount],
  );

  /** Remove one campaign (e.g. a wrong import). */
  const removeCampaign = useCallback(
    (id: string, campaignId: string) => {
      mutateAccount(id, (a) => {
        const gone = a.campaigns.find((c) => c.id === campaignId);
        return {
          ...a,
          campaigns: a.campaigns.filter((c) => c.id !== campaignId),
          activity: [...a.activity, activityEvent(`Campaign removed — ${gone?.name ?? campaignId}`, "workspace")],
        };
      });
    },
    [mutateAccount],
  );

  /** Clear every campaign — the undo for a bad bulk import. */
  const clearCampaigns = useCallback(
    (id: string) => {
      mutateAccount(id, (a) => ({
        ...a,
        campaigns: [],
        activity: [...a.activity, activityEvent(`All campaigns removed (${a.campaigns.length}) — re-import from Review import`, "workspace")],
      }));
    },
    [mutateAccount],
  );

  const addAccountTask = useCallback(
    (id: string, title: string, ownerName?: string, due?: string, label?: string) => {
      mutateAccount(id, (a) => ({
        ...a,
        tasks: [
          ...a.tasks,
          {
            id: newId("task"),
            title,
            ...(ownerName ? { ownerName } : {}),
            ...(due ? { due } : {}),
            ...(label ? { label } : {}),
            status: "todo" as const,
            source: "manual" as const,
            createdAt: new Date().toISOString(),
          },
        ],
        activity: [...a.activity, activityEvent(`Task added — "${title}"`, "task")],
      }));
    },
    [mutateAccount],
  );

  /**
   * Record that these tasks were successfully written to Kantata. Called only
   * with the refs the write endpoint reported as APPLIED — a failed intent
   * leaves its task un-stamped so it stays in the review queue.
   *
   * `createdId` arrives when the push CREATED the story; storing it turns a
   * workspace-only task into one that can be updated by id from then on.
   */
  const markTasksSynced = useCallback(
    (id: string, applied: { ref: string; createdId?: string }[]) => {
      if (applied.length === 0) return;
      const at = new Date().toISOString();
      const byRef = new Map(applied.map((a) => [a.ref, a]));
      mutateAccount(id, (a) => {
        const touched = a.tasks.filter((t) => byRef.has(t.id));
        if (touched.length === 0) return a;
        return {
          ...a,
          tasks: a.tasks.map((t) => {
            const hit = byRef.get(t.id);
            if (!hit) return t;
            return { ...t, kantataSyncedAt: at, ...(hit.createdId ? { kantataStoryId: hit.createdId } : {}) };
          }),
          activity: [
            ...a.activity,
            activityEvent(
              `${touched.length} task${touched.length === 1 ? "" : "s"} sent to Kantata — ${touched
                .map((t) => `"${t.title.slice(0, 40)}"`)
                .join(", ")}`,
              "task",
            ),
          ],
        };
      });
    },
    [mutateAccount],
  );

  /**
   * Set the PM's hour estimate on a task — the one number resourcing derives
   * from. This is a VALIDATION action (the account manager confirms the hours
   * are right), never a leveling one; over-allocation is reconciled elsewhere,
   * by design (Cara: PMs put in only the time the work needs). 0/blank clears.
   */
  const setAccountTaskHours = useCallback(
    (id: string, taskId: string, hours: number | undefined) => {
      mutateAccount(id, (a) => {
        const task = a.tasks.find((t) => t.id === taskId);
        if (!task) return a;
        const clean = hours != null && Number.isFinite(hours) && hours > 0 ? Math.round(hours * 10) / 10 : undefined;
        return {
          ...a,
          tasks: a.tasks.map((t) => {
            if (t.id !== taskId) return t;
            const { estimatedHours: _drop, ...rest } = t;
            return clean != null ? { ...rest, estimatedHours: clean } : rest;
          }),
        };
      });
    },
    [mutateAccount],
  );

  const setAccountTaskStatus = useCallback(
    (id: string, taskId: string, status: TaskStatus) => {
      mutateAccount(id, (a) => {
        const task = a.tasks.find((t) => t.id === taskId);
        if (!task) return a;
        return {
          ...a,
          tasks: a.tasks.map((t) => {
            if (t.id !== taskId) return t;
            // Keep the coarse status and the per-person flags in agreement: a
            // task with a team is done only when everyone is, so marking the
            // whole task Done marks every person's part done (and moving it off
            // Done reopens anyone who was auto-completed). Without this, the
            // status button and the per-person model contradict each other.
            if (t.assignments && t.assignments.length > 0) {
              const assignments = t.assignments.map((as) => ({ ...as, done: status === "done" }));
              return { ...t, status, assignments };
            }
            return { ...t, status };
          }),
          activity: [...a.activity, activityEvent(`"${task.title}" → ${status === "done" ? "completed" : status === "doing" ? "in progress" : "to do"}`, "task")],
        };
      });
    },
    [mutateAccount],
  );

  // Set (or clear) the people on a task, preserving hours/done/primary edits
  // for those who stay — the store side of Cara's task card.
  const setAccountTaskAssignments = useCallback(
    (id: string, taskId: string, names: readonly string[]) => {
      mutateAccount(id, (a) => {
        const task = a.tasks.find((t) => t.id === taskId);
        if (!task) return a;
        // Idempotent seed: if the task already carries exactly these people,
        // don't churn state — this lets the task card seed on every open
        // cheaply, persisting only the first time (legacy tasks).
        const have = new Set((task.assignments ?? []).map((x) => x.name));
        const want = new Set(names);
        if (task.assignments && have.size === want.size && [...want].every((n) => have.has(n))) return a;
        return {
          ...a,
          tasks: a.tasks.map((t) => {
            if (t.id !== taskId) return t;
            const next = reconcileAssignments(t.assignments ?? [], names);
            const { assignments: _drop, ...rest } = t;
            return next.length > 0 ? { ...rest, assignments: next } : rest;
          }),
        };
      });
    },
    [mutateAccount],
  );

  // Set one person's hour slice on a task (undefined = back to the even-split
  // default). Only touches that person's row.
  const setAccountAssignmentHours = useCallback(
    (id: string, taskId: string, name: string, hours: number | undefined) => {
      mutateAccount(id, (a) => ({
        ...a,
        tasks: a.tasks.map((t) => {
          if (t.id !== taskId || !t.assignments) return t;
          const clean = hours != null && Number.isFinite(hours) && hours >= 0 ? Math.round(hours * 10) / 10 : undefined;
          return {
            ...t,
            assignments: t.assignments.map((as) => {
              if (as.name !== name) return as;
              const { hours: _drop, ...rest } = as;
              return clean != null ? { ...rest, hours: clean } : rest;
            }),
          };
        }),
      }));
    },
    [mutateAccount],
  );

  // Mark ONE person's part done (or not). The whole task completes only when
  // everyone is done — Kellie's "one click shouldn't complete for everyone".
  const toggleAccountAssignmentDone = useCallback(
    (id: string, taskId: string, name: string, done: boolean) => {
      mutateAccount(id, (a) => {
        const task = a.tasks.find((t) => t.id === taskId);
        if (!task || !task.assignments) return a;
        const { assignments, status } = applyPersonDone(task, name, done);
        const completed = status === "done" && task.status !== "done";
        return {
          ...a,
          tasks: a.tasks.map((t) => (t.id === taskId ? { ...t, assignments, status } : t)),
          ...(completed
            ? { activity: [...a.activity, activityEvent(`"${task.title}" → completed (everyone done)`, "task")] }
            : {}),
        };
      });
    },
    [mutateAccount],
  );

  // Name the single accountable owner — clears primary elsewhere on the task.
  const setAccountAssignmentPrimary = useCallback(
    (id: string, taskId: string, name: string) => {
      mutateAccount(id, (a) => ({
        ...a,
        tasks: a.tasks.map((t) => {
          if (t.id !== taskId || !t.assignments) return t;
          return { ...t, assignments: t.assignments.map((as) => ({ ...as, primary: as.name === name })) as TaskAssignment[] };
        }),
      }));
    },
    [mutateAccount],
  );

  // Set which tasks this one waits on (Cara's dependencies). Ids are validated
  // against the account's own tasks; a task never depends on itself.
  const setAccountTaskDependencies = useCallback(
    (id: string, taskId: string, dependsOn: string[]) => {
      mutateAccount(id, (a) => {
        const valid = new Set(a.tasks.map((t) => t.id));
        const clean = [...new Set(dependsOn)].filter((d) => d !== taskId && valid.has(d));
        return {
          ...a,
          tasks: a.tasks.map((t) => {
            if (t.id !== taskId) return t;
            const { dependsOn: _drop, ...rest } = t;
            return clean.length > 0 ? { ...rest, dependsOn: clean } : rest;
          }),
        };
      });
    },
    [mutateAccount],
  );

  // Reorder the handoff sequence — the order the work passes through people.
  const setAccountAssignmentOrder = useCallback(
    (id: string, taskId: string, orderedNames: string[]) => {
      mutateAccount(id, (a) => ({
        ...a,
        tasks: a.tasks.map((t) => (t.id === taskId && t.assignments ? { ...t, assignments: applyHandoffOrder(t.assignments, orderedNames) } : t)),
      }));
    },
    [mutateAccount],
  );

  const postAccountMessage = useCallback(
    (id: string, body: string, author = "You", topic?: string) => {
      mutateAccount(id, (a) => {
        // @mentions (Collab Hub Must): "@FirstName" in a post raises a Home
        // notification for that person. Teams push notifications ride the
        // M365 layer later; the in-app half works today.
        const people = [...new Set([...a.members.map((m) => m.name), ...a.externals.map((e) => e.name)])];
        const mentioned = people.filter((n) => {
          const first = n.split(" ")[0] ?? n;
          return new RegExp(`@${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(body);
        });
        return {
          ...a,
          thread: [...a.thread, humanMessage(body, author, topic)],
          notifications:
            mentioned.length > 0
              ? [
                  ...a.notifications,
                  {
                    id: newId("n"),
                    text: `${author} mentioned ${mentioned.join(", ")} in Discussions — “${body.length > 90 ? `${body.slice(0, 90)}…` : body}”`,
                    at: new Date().toISOString(),
                  },
                ]
              : a.notifications,
        };
      });
    },
    [mutateAccount],
  );

  /** Apply a service-line template inside a workspace (Collab Hub Must:
   * "apply a template for consistent set up") — a dated task skeleton from
   * the chosen start date. Merge-by-title, so re-applying never duplicates. */
  const applyTemplate = useCallback(
    (id: string, templateKey: string, startDate: string) => {
      const tpl = TEMPLATES.find((t) => t.key === templateKey);
      if (!tpl) return;
      mutateAccount(id, (a) => {
        const tasks = [...a.tasks];
        let added = 0;
        for (const draft of instantiateTemplate(tpl, startDate)) {
          if (tasks.some((e) => e.title.toLowerCase() === draft.title.toLowerCase())) continue;
          tasks.push({
            id: newId("task"),
            title: draft.title,
            due: draft.due,
            label: tpl.name,
            status: "todo" as const,
            source: "manual" as const,
            createdAt: new Date().toISOString(),
          });
          added += 1;
        }
        if (added === 0) return a;
        const summary = `Template applied — ${tpl.name} (${added} dated task${added === 1 ? "" : "s"})`;
        return {
          ...a,
          tasks,
          notifications: [...a.notifications, { id: newId("n"), text: summary, at: new Date().toISOString() }],
          activity: [...a.activity, activityEvent(summary, "task")],
        };
      });
    },
    [mutateAccount],
  );

  /** Archive/restore a client workspace — history retained, hidden from the
   * list (Collab Hub "Archiving": close projects, keep auditability). */
  const setAccountArchived = useCallback(
    (id: string, archived: boolean) => {
      mutateAccount(id, (a) => ({
        ...a,
        archived,
        activity: [
          ...a.activity,
          activityEvent(archived ? "Workspace archived — history retained" : "Workspace restored from archive", "workspace"),
        ],
      }));
    },
    [mutateAccount],
  );

  /** Start-clean: archive every active workspace at once (history retained,
   * each restorable from Archived). Returns how many were archived. */
  const archiveAllAccounts = useCallback((): number => {
    let n = 0;
    setState((s) => ({
      ...s,
      accounts: s.accounts.map((a) => {
        if (a.archived) return a;
        n += 1;
        return { ...a, archived: true, activity: [...a.activity, activityEvent("Workspace archived — bulk clear", "workspace")] };
      }),
    }));
    return n;
  }, []);

  const addAccountLink = useCallback(
    (id: string, name: string, kind: "file" | "doc", url?: string) => {
      mutateAccount(id, (a) => {
        const link: ClientFileLink = { id: newId("f"), name, kind, ...(url ? { url } : {}), addedAt: new Date().toISOString() };
        return {
          ...a,
          files: kind === "file" ? [link, ...a.files] : a.files,
          docs: kind === "doc" ? [...a.docs, link] : a.docs,
          activity: [...a.activity, activityEvent(`${kind === "file" ? "File" : "Document"} linked — ${name}`, "workspace")],
        };
      });
    },
    [mutateAccount],
  );

  /** Attach (or replace) the SharePoint link on an existing file/doc — so the
   * standard-template core docs stop being dead text and become real links. */
  const setAccountLinkUrl = useCallback(
    (id: string, linkId: string, url: string) => {
      const clean = url.trim();
      mutateAccount(id, (a) => {
        const patch = (l: ClientFileLink): ClientFileLink =>
          l.id === linkId ? { ...l, ...(clean ? { url: clean } : {}) } : l;
        const target = [...a.files, ...a.docs].find((l) => l.id === linkId);
        return {
          ...a,
          files: a.files.map(patch),
          docs: a.docs.map(patch),
          activity: target ? [...a.activity, activityEvent(`Link attached — ${target.name}`, "workspace")] : a.activity,
        };
      });
    },
    [mutateAccount],
  );

  /** Delete a file/doc from the workspace (link only — the file in SharePoint
   * is untouched). Logs it so the audit trail shows who removed what. */
  const removeAccountLink = useCallback(
    (id: string, linkId: string) => {
      mutateAccount(id, (a) => {
        const target = [...a.files, ...a.docs].find((l) => l.id === linkId);
        if (!target) return a;
        return {
          ...a,
          files: a.files.filter((l) => l.id !== linkId),
          docs: a.docs.filter((l) => l.id !== linkId),
          activity: [...a.activity, activityEvent(`${target.kind === "file" ? "File" : "Document"} removed — ${target.name}`, "workspace")],
        };
      });
    },
    [mutateAccount],
  );

  // ---- client-facing document sharing & approval (Cara's ask) ----

  /**
   * Share a document into the client space — to read ("fyi") or for a decision
   * ("approval"). Re-sharing a previously decided doc starts a CLEAN request,
   * because that's a new round of review, not a continuation of the old one.
   */
  const shareFileWithClient = useCallback(
    (id: string, linkId: string, purpose: "fyi" | "approval", by = "You") => {
      const at = new Date().toISOString();
      mutateAccount(id, (a) => {
        const target = [...a.files, ...a.docs].find((l) => l.id === linkId);
        if (!target) return a;
        const record = shareRecord(purpose, by, at);
        const patch = (l: ClientFileLink): ClientFileLink => (l.id === linkId ? { ...l, clientShare: record } : l);
        return {
          ...a,
          files: a.files.map(patch),
          docs: a.docs.map(patch),
          activity: [...a.activity, activityEvent(shareSummary(target.name, record), "workspace")],
          notifications: [...a.notifications, { id: newId("n"), text: shareSummary(target.name, record), at }],
        };
      });
    },
    [mutateAccount],
  );

  /** Stop sharing a document with the client. The file itself is untouched. */
  const unshareFileFromClient = useCallback(
    (id: string, linkId: string) => {
      mutateAccount(id, (a) => {
        const target = [...a.files, ...a.docs].find((l) => l.id === linkId);
        if (!target?.clientShare) return a;
        const strip = (l: ClientFileLink): ClientFileLink => {
          if (l.id !== linkId) return l;
          const { clientShare: _drop, ...rest } = l;
          return rest;
        };
        return {
          ...a,
          files: a.files.map(strip),
          docs: a.docs.map(strip),
          activity: [...a.activity, activityEvent(`Stopped sharing with client — ${target.name}`, "workspace")],
        };
      });
    },
    [mutateAccount],
  );

  /**
   * Record the client's decision on a shared document — approve, or ask for
   * changes with a note. Only meaningful on an approval share that's pending.
   */
  const recordClientDecision = useCallback(
    (id: string, linkId: string, decision: "approved" | "changes", by = "Client", note?: string) => {
      const at = new Date().toISOString();
      mutateAccount(id, (a) => {
        const target = [...a.files, ...a.docs].find((l) => l.id === linkId);
        if (!target?.clientShare) return a;
        const updated = decide(target.clientShare, decision, by, at, note);
        const patch = (l: ClientFileLink): ClientFileLink => (l.id === linkId ? { ...l, clientShare: updated } : l);
        return {
          ...a,
          files: a.files.map(patch),
          docs: a.docs.map(patch),
          activity: [...a.activity, activityEvent(decisionSummary(target.name, updated), "workspace")],
          notifications: [...a.notifications, { id: newId("n"), text: decisionSummary(target.name, updated), at }],
        };
      });
    },
    [mutateAccount],
  );

  /** Flag a task as a client-facing deliverable (or hide it again). Only
   * flagged tasks show on the client's dashboard — the "limited view" Kellie
   * asked for, so clients see deliverables, not every internal step. */
  const toggleAccountTaskClientVisible = useCallback(
    (id: string, taskId: string) => {
      mutateAccount(id, (a) => {
        let note = "";
        const tasks = a.tasks.map((t) => {
          if (t.id !== taskId) return t;
          const next = !t.clientVisible;
          note = `“${t.title}” ${next ? "shown to the client" : "hidden from the client"}`;
          return { ...t, clientVisible: next };
        });
        return { ...a, tasks, activity: note ? [...a.activity, activityEvent(`Client view — ${note}`, "task")] : a.activity };
      });
    },
    [mutateAccount],
  );

  /** Nudge the client about a deliverable — queues a reminder now. Auto-nudge
   * on "not opened yet" arrives with the M365 read-receipt layer; the manual
   * reminder works today (in-app; Teams/email once connected). */
  const remindClientDeliverable = useCallback(
    (id: string, taskId: string, author = "You") => {
      mutateAccount(id, (a) => {
        const t = a.tasks.find((x) => x.id === taskId);
        if (!t) return a;
        const due = t.due ? ` (due ${t.due})` : "";
        const text = `Reminder queued for the client — “${t.title}”${due}. Sent via their preferred channel once M365 is connected.`;
        return {
          ...a,
          thread: [...a.thread, humanMessage(`⏰ Reminder sent to the client: “${t.title}”${due}.`, author, t.title)],
          notifications: [...a.notifications, { id: newId("n"), text, at: new Date().toISOString() }],
          activity: [...a.activity, activityEvent(`Client reminder — ${t.title}`, "task")],
        };
      });
    },
    [mutateAccount],
  );

  /** Set how a person on the account prefers to be notified (Teams/email/both). */
  const setNotifyPref = useCallback(
    (id: string, personName: string, pref: "teams" | "email" | "both") => {
      mutateAccount(id, (a) => ({ ...a, notifyPrefs: { ...(a.notifyPrefs ?? {}), [personName]: pref } }));
    },
    [mutateAccount],
  );

  /** Add an AGP teammate to the account — collaborate from anywhere in the
   * client, not just the Contractor Access tab. Idempotent by person. */
  const addAccountMember = useCallback(
    (id: string, personId: string) => {
      const person = rosterById.get(personId) ?? personById(personId);
      if (!person) return;
      mutateAccount(id, (a) => {
        if (a.members.some((m) => m.personId === person.id)) return a;
        return {
          ...a,
          members: [...a.members, { personId: person.id, name: person.name, title: person.title }],
          activity: [...a.activity, activityEvent(`${person.name} (${person.title}) added to the account team`, "team")],
        };
      });
    },
    [mutateAccount, rosterById],
  );

  /** Add a teammate who ISN'T in the Kantata roster yet — by name + title.
   * For contractors/new hires not synced from Kantata. Idempotent by name. */
  const addAccountMemberNamed = useCallback(
    (id: string, name: string, title: string) => {
      const clean = name.trim();
      if (!clean) return;
      mutateAccount(id, (a) => {
        if (a.members.some((m) => m.name.toLowerCase() === clean.toLowerCase())) return a;
        const role = title.trim() || "Team member";
        return {
          ...a,
          members: [...a.members, { personId: `x-${clean.replace(/\s+/g, "-").toLowerCase()}`, name: clean, title: role }],
          activity: [...a.activity, activityEvent(`${clean} (${role}) added to the account team`, "team")],
        };
      });
    },
    [mutateAccount],
  );

  const addExternal = useCallback(
    (id: string, name: string, org: string, role: ExternalMember["role"], access: ExternalMember["access"], invitedBy = "You") => {
      mutateAccount(id, (a) => ({
        ...a,
        externals: [...a.externals, { id: newId("ext"), name, org, role, access, invitedBy, addedAt: new Date().toISOString() }],
        activity: [...a.activity, activityEvent(`${role === "client" ? "Client" : "Contractor"} access granted — ${name} (${org}, ${access}) by ${invitedBy}`, "team")],
      }));
    },
    [mutateAccount],
  );

  // ---- handover: what an outside person was given, and what to revoke ----

  /**
   * Hand items to an outside person. Each becomes a Share stamped with the
   * item's name AT SEND TIME, so the record still reads correctly after the
   * file is renamed or deleted.
   */
  const shareWithPerson = useCallback(
    (id: string, personName: string, items: ShareableItem[], sentBy = "You") => {
      if (items.length === 0) return;
      const at = new Date().toISOString();
      mutateAccount(id, (a) => ({
        ...a,
        shares: [
          ...(a.shares ?? []),
          ...items.map((i) => ({
            id: newId("share"),
            personName,
            itemKind: i.kind,
            itemId: i.itemId,
            itemName: i.itemName,
            sentAt: at,
            sentBy,
          })),
        ],
        activity: [
          ...a.activity,
          activityEvent(
            `${items.length} item${items.length === 1 ? "" : "s"} sent to ${personName} — ${items.map((i) => i.itemName).join(", ")}`,
            "team",
          ),
        ],
      }));
    },
    [mutateAccount],
  );

  /**
   * Record that a share was opened — the FIRST open only, since "when did they
   * get to it" is the question, not how often they revisit.
   *
   * `source` is kept because it is the difference between something we watched
   * happen and something Microsoft told us: an open we never observe must read
   * as unknown, not as "didn't open".
   */
  const recordShareOpened = useCallback(
    (id: string, shareId: string, source: "workspace" | "sharepoint" = "workspace") => {
      const at = new Date().toISOString();
      mutateAccount(id, (a) => {
        const hit = (a.shares ?? []).find((s) => s.id === shareId);
        if (!hit || hit.openedAt || hit.revokedAt) return a;
        return {
          ...a,
          shares: (a.shares ?? []).map((s) => (s.id === shareId ? { ...s, openedAt: at, openSource: source } : s)),
          activity: [...a.activity, activityEvent(`${hit.personName} opened ${hit.itemName}`, "team")],
        };
      });
    },
    [mutateAccount],
  );

  /**
   * The open we can actually observe today: the person who was sent something
   * opened it from inside this workspace. Called from the Files tab on a link
   * click, with whoever is signed in — so it records nothing unless that
   * person genuinely holds a live, unopened share for that item.
   */
  const recordItemOpened = useCallback(
    (id: string, personName: string, itemKind: "file" | "doc" | "task", itemId: string) => {
      const at = new Date().toISOString();
      mutateAccount(id, (a) => {
        const hit = (a.shares ?? []).find(
          (s) => s.itemKind === itemKind && s.itemId === itemId && !s.openedAt && !s.revokedAt && samePerson(s.personName, personName),
        );
        if (!hit) return a;
        return {
          ...a,
          shares: (a.shares ?? []).map((s) => (s.id === hit.id ? { ...s, openedAt: at, openSource: "workspace" as const } : s)),
          activity: [...a.activity, activityEvent(`${hit.personName} opened ${hit.itemName}`, "team")],
        };
      });
    },
    [mutateAccount],
  );

  /** Revoke one share. The row stays, stamped — the audit trail is the point. */
  const revokeShare = useCallback(
    (id: string, shareId: string, revokedBy = "You") => {
      const at = new Date().toISOString();
      mutateAccount(id, (a) => {
        const hit = (a.shares ?? []).find((s) => s.id === shareId);
        if (!hit || hit.revokedAt) return a;
        return {
          ...a,
          shares: (a.shares ?? []).map((s) => (s.id === shareId ? { ...s, revokedAt: at, revokedBy } : s)),
          activity: [...a.activity, activityEvent(`Access revoked — ${hit.itemName} (${hit.personName}) by ${revokedBy}`, "team")],
        };
      });
    },
    [mutateAccount],
  );

  /**
   * Revoke everything still live with one person — the "they're done" button.
   * Their access record and their open tasks are untouched: reassigning work
   * is a decision, not a side effect of withdrawing a file.
   */
  const revokeAllForPerson = useCallback(
    (id: string, personName: string, revokedBy = "You") => {
      const at = new Date().toISOString();
      mutateAccount(id, (a) => {
        const live = (a.shares ?? []).filter((s) => samePerson(s.personName, personName) && !s.revokedAt);
        if (live.length === 0) return a;
        const ids = new Set(live.map((s) => s.id));
        return {
          ...a,
          shares: (a.shares ?? []).map((s) => (ids.has(s.id) ? { ...s, revokedAt: at, revokedBy } : s)),
          activity: [
            ...a.activity,
            activityEvent(
              `All access revoked for ${personName} — ${live.length} item${live.length === 1 ? "" : "s"} (${live
                .map((s) => s.itemName)
                .join(", ")}) by ${revokedBy}`,
              "team",
            ),
          ],
        };
      });
    },
    [mutateAccount],
  );

  /**
   * One-click cross-workspace offboard (Layer 0.5): revoke a person from
   * EVERY client workspace at once, each removal audit-logged. Entra removal
   * rides on this when the identity layer lands.
   */
  const offboardEverywhere = useCallback((personName: string) => {
    setState((s) => ({
      ...s,
      accounts: s.accounts.map((a) => {
        const hits = a.externals.filter((e) => e.name === personName);
        if (hits.length === 0) return a;
        return {
          ...a,
          externals: a.externals.filter((e) => e.name !== personName),
          ...(a.shares
            ? {
                shares: a.shares.map((sh) =>
                  samePerson(sh.personName, personName) && !sh.revokedAt
                    ? { ...sh, revokedAt: new Date().toISOString(), revokedBy: "cross-workspace offboard" }
                    : sh,
                ),
              }
            : {}),
          activity: [...a.activity, activityEvent(`Access revoked immediately (cross-workspace offboard) — ${personName}`, "team")],
        };
      }),
    }));
  }, []);

  /** Offboarding (Must): removal revokes access across the workspace immediately. */
  const removeExternal = useCallback(
    (id: string, externalId: string) => {
      const at = new Date().toISOString();
      mutateAccount(id, (a) => {
        const ext = a.externals.find((e) => e.id === externalId);
        // Removing the person revokes what they hold, but the handover record
        // survives them: "what did we ever send this contractor" must still be
        // answerable after they are off the account.
        const shares = ext
          ? (a.shares ?? []).map((sh) =>
              samePerson(sh.personName, ext.name) && !sh.revokedAt ? { ...sh, revokedAt: at, revokedBy: "access removed" } : sh,
            )
          : (a.shares ?? []);
        return {
          ...a,
          externals: a.externals.filter((e) => e.id !== externalId),
          ...(a.shares ? { shares } : {}),
          activity: [...a.activity, activityEvent(`Access revoked immediately — ${ext?.name ?? externalId} (${ext?.org ?? ""})`, "team")],
        };
      });
    },
    [mutateAccount],
  );

  // ---- zone pairing + shared plan (SPEC Layer 0.1 / 0.3) ----

  /** Pair a build (internal zone) with a client account. Internal-side only. */
  const setClientAccount = useCallback(
    (initiativeId: string, accountId: string | null) => {
      mutate(initiativeId, (i) => {
        const { clientAccountId: _prev, ...rest } = i;
        const next = accountId ? { ...rest, clientAccountId: accountId } : rest;
        return {
          ...next,
          activity: [
            ...i.activity,
            activityEvent(
              accountId
                ? `Linked as the internal zone of client account ${accounts.find((a) => a.id === accountId)?.clientName ?? accountId}`
                : "Unlinked from client account",
              "workspace",
            ),
          ],
        };
      });
    },
    [mutate, accounts],
  );

  /** Flip a task onto / off the client-shared plan. Internal tasks never leak. */
  const toggleTaskClientVisible = useCallback(
    (initiativeId: string, taskId: string) => {
      mutate(initiativeId, (i) => {
        const task = i.tasks.find((t) => t.id === taskId);
        if (!task) return i;
        const next = !task.clientVisible;
        return {
          ...i,
          tasks: i.tasks.map((t) => (t.id === taskId ? { ...t, clientVisible: next } : t)),
          activity: [...i.activity, activityEvent(`"${task.title}" ${next ? "shared to" : "removed from"} the client plan`, "task")],
        };
      });
    },
    [mutate],
  );

  /**
   * The client account's shared plan: its own tasks plus the client-visible
   * subset of every linked build's tasks. One list, no double entry — status
   * changes flow back to the internal task (Kantata ⇄ Planner sync later
   * rides the same shape).
   */
  const sharedTasksFor = useCallback(
    (accountId: string): { task: Task; fromInternal: boolean }[] => {
      const account = accounts.find((a) => a.id === accountId);
      if (!account) return [];
      const own = account.tasks.map((task) => ({ task, fromInternal: false }));
      const mirrored = initiatives
        .filter((i) => i.clientAccountId === accountId)
        .flatMap((i) => i.tasks.filter((t) => t.clientVisible).map((task) => ({ task, fromInternal: true })));
      return [...own, ...mirrored];
    },
    [accounts, initiatives],
  );

  /** Status change from the client view routes to wherever the task lives. */
  const setSharedTaskStatus = useCallback(
    (accountId: string, taskId: string, status: TaskStatus) => {
      const account = accounts.find((a) => a.id === accountId);
      if (account?.tasks.some((t) => t.id === taskId)) {
        setAccountTaskStatus(accountId, taskId, status);
        return;
      }
      const owner = initiatives.find((i) => i.clientAccountId === accountId && i.tasks.some((t) => t.id === taskId));
      if (owner) setTaskStatus(owner.id, taskId, status);
    },
    [accounts, initiatives, setAccountTaskStatus, setTaskStatus],
  );

  // ---- interim team sign-in accounts (email + password) ------------------
  /** Create a sign-in account for a team member. Async: hashes the password.
   * Returns an error string, or null on success. Idempotent by email. */
  const addSignInAccount = useCallback(
    async (name: string, email: string, title: string, password: string): Promise<string | null> => {
      const clean = email.trim().toLowerCase();
      if (!name.trim() || !clean || !password) return "Name, email, and password are required.";
      if (password.length < 6) return "Password must be at least 6 characters.";
      if (stateRef.current.team.some((t) => t.email === clean)) return "That email already has an account.";
      const acct = await makeTeamAccount(newId("user"), name, clean, title, password, new Date().toISOString());
      setState((s) => (s.team.some((t) => t.email === clean) ? s : { ...s, team: [...s.team, acct] }));
      return null;
    },
    [],
  );

  const removeSignInAccount = useCallback((id: string) => {
    setState((s) => ({ ...s, team: s.team.filter((t) => t.id !== id) }));
  }, []);

  /** Verify an email+password against the team accounts. */
  const signInWithPassword = useCallback(
    (email: string, password: string): Promise<LocalIdentity | null> => authenticate(email, password, stateRef.current.team),
    [],
  );

  /** Clear every workspace this browser (or the team, when shared) has built:
   * accounts, ideas, initiatives. Nothing is re-seeded — the app comes back
   * empty and refills from the live Kantata pull. Sign-in accounts survive. */
  const clearWorkspace = useCallback(() => {
    if (
      syncStatus.mode === "shared" &&
      !window.confirm("This clears the SHARED workspace for everyone on the team, back to an empty (live-only) state. Continue?")
    ) {
      return;
    }
    window.localStorage.removeItem(STORAGE_KEY);
    // Sign-in accounts and tour feedback survive: one would lock people out,
    // the other is research nobody can re-collect.
    setState((s) => ({ initiatives: [], ideas: [], accounts: [], team: s.team, feedback: s.feedback }));
  }, [syncStatus.mode]);

  /**
   * Log one page report from the floating feedback button. Unlike a tour
   * answer this APPENDS: the same person on the same screen may well have two
   * separate things to say on two separate days, and silently replacing the
   * first would throw away a report nobody knows was lost. The cost is that
   * one person answering twice counts twice in a page tally — the right trade,
   * since a dropped report is unrecoverable and a skewed percentage is not.
   */
  const addPageFeedback = useCallback((entry: Omit<TourFeedback, "id" | "createdAt">) => {
    setState((s) => ({
      ...s,
      feedback: [...s.feedback, { ...entry, id: newId("fb"), createdAt: new Date().toISOString() }],
    }));
  }, []);

  /**
   * Log one tour answer. Re-answering a step replaces that person's previous
   * response rather than stacking a second one — people go back a step and
   * change their mind, and a tally that counted both would be wrong.
   */
  const recordFeedback = useCallback(
    (entry: Omit<TourFeedback, "id" | "createdAt">) => {
      const who = entry.personEmail.trim().toLowerCase() || entry.personName.trim().toLowerCase();
      setState((s) => ({
        ...s,
        feedback: [
          ...s.feedback.filter(
            (f) => !(f.stepKey === entry.stepKey && (f.personEmail.trim().toLowerCase() || f.personName.trim().toLowerCase()) === who),
          ),
          { ...entry, id: newId("fb"), createdAt: new Date().toISOString() },
        ],
      }));
    },
    [],
  );

  return {
    initiatives,
    ideas,
    accounts,
    createAccount,
    createAccountFromMirror,
    importCampaigns,
    importTasks,
    markTasksSynced,
    importAllFromKantata,
    ensureAutoPopulated,
    ensureDeepened,
    renameAccount,
    linkProjects,
    setProjectScope,
    editAccountPost,
    deleteAccountPost,
    removeCampaign,
    clearCampaigns,
    addAccountTask,
    addAccountMember,
    addAccountMemberNamed,
    setAccountTaskStatus,
    setAccountTaskHours,
    setAccountTaskAssignments,
    setAccountAssignmentHours,
    toggleAccountAssignmentDone,
    setAccountAssignmentPrimary,
    setAccountTaskDependencies,
    setAccountAssignmentOrder,
    postAccountMessage,
    setAccountArchived,
    archiveAllAccounts,
    applyTemplate,
    addAccountLink,
    shareFileWithClient,
    unshareFileFromClient,
    recordClientDecision,
    setAccountLinkUrl,
    removeAccountLink,
    toggleAccountTaskClientVisible,
    remindClientDeliverable,
    setNotifyPref,
    addExternal,
    shareWithPerson,
    recordShareOpened,
    recordItemOpened,
    revokeShare,
    revokeAllForPerson,
    removeExternal,
    offboardEverywhere,
    setClientAccount,
    toggleTaskClientVisible,
    sharedTasksFor,
    setSharedTaskStatus,
    updateFactor,
    postMessage,
    askRoiAnalyst,
    setSummary,
    createInitiative,
    createIdea,
    acceptDraftReview,
    updateIdea,
    removeIdea,
    claimIdea,
    postIdeaMessage,
    askIdeaAnalyst,
    promoteIdea,
    setPackageStatus,
    inviteCopilotIn,
    addTeamMember,
    copilotFlags,
    addTask,
    setTaskStatus,
    setArchived,
    availablePeople: roster,
    team,
    addSignInAccount,
    removeSignInAccount,
    signInWithPassword,
    clearWorkspace,
    feedback: state.feedback,
    recordFeedback,
    addPageFeedback,
    syncStatus,
  };
}

export type { RoiModel };
