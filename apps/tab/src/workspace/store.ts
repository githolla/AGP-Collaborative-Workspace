import { useCallback, useEffect, useState } from "react";
import { computeProjectROI, standardFactorTemplate, type RoiModel, type WorkspaceFactor } from "@agp/roi";
import type { Initiative, InitiativeType, SandboxIdea, ThreadMessage } from "./types.js";
import { seedIdeas, seedInitiatives } from "./seed.js";
import { roiAnalystMessage, sandboxAnalystMessage } from "./agents.js";
import { factorsFromBasis } from "./basis.js";
import { copilotFlags, draftFromIdea, inviteCopilot, observeIdea, refineIdea, replanPreservingStatus } from "./copilot.js";
import { AGP_PEOPLE, FUNCTION_NOTES, personById, type AgpFunction } from "./agpKnowledge.js";
import { tasksFromPlan } from "./planner.js";
import type { ActivityEvent, AiMode, Task, TaskStatus, WorkPackage } from "./types.js";

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
}

/** Older stored ideas predate newer fields — backfill them by re-drafting. */
function migrateIdea(idea: SandboxIdea): SandboxIdea {
  if (Array.isArray(idea.team) && idea.classification && idea.plan && idea.aiMode) return idea;
  const draft = draftFromIdea(idea.title, idea.pitch);
  return {
    ...idea,
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

function load(): PersistedState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      if (Array.isArray(parsed.initiatives) && parsed.initiatives.length > 0) {
        return {
          initiatives: parsed.initiatives.map(migrateInitiative),
          // ideas were added after the first release — older storage lacks them
          ideas: Array.isArray(parsed.ideas) ? parsed.ideas.map(migrateIdea) : seedIdeas(),
        };
      }
    }
  } catch {
    // corrupted storage falls through to seed
  }
  return { initiatives: seedInitiatives().map(migrateInitiative), ideas: seedIdeas() };
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

function humanMessage(body: string, author: string): ThreadMessage {
  return { id: newId("msg"), author, kind: "human", at: new Date().toISOString(), body };
}

export function useWorkspace() {
  const [state, setState] = useState<PersistedState>(load);
  const { initiatives, ideas } = state;

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // storage full/unavailable — the session still works in memory
    }
  }, [state]);

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
    (id: string, title: string, ownerName?: string, due?: string) => {
      const task: Task = {
        id: newId("task"),
        title,
        ...(ownerName ? { ownerName } : {}),
        ...(due ? { due } : {}),
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

  const createIdea = useCallback((title: string, pitch: string, aiMode: AiMode = "copilot"): string => {
    const id = newId("idea");
    let idea: SandboxIdea;
    if (aiMode === "copilot") {
      // The copilot drafts everything from the pitch — never a blank page.
      const draft = draftFromIdea(title, pitch);
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
        createdAt: new Date().toISOString(),
      };
    } else {
      // Blank collaboration: humans work; the Copilot observes silently and
      // joins only when invited. It still classifies quietly so context chips
      // and its eventual arrival are informed.
      const observed = observeIdea(title, pitch);
      idea = {
        id,
        title,
        aiMode,
        pitch,
        basis: { summary: pitch, comparables: [], manual: [], buildHours: 0, buildRate: 100 },
        team: [],
        classification: observed.classification,
        relatedProjects: observed.relatedProjects,
        relatedCampaigns: observed.relatedCampaigns,
        thread: [],
        status: "exploring",
        createdAt: new Date().toISOString(),
      };
    }
    setState((s) => ({ ...s, ideas: [...s.ideas, idea] }));
    return id;
  }, []);

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
    (id: string, type: InitiativeType): string | null => {
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
            "You",
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

  const resetDemo = useCallback(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    setState({ initiatives: seedInitiatives(), ideas: seedIdeas() });
  }, []);

  return {
    initiatives,
    ideas,
    updateFactor,
    postMessage,
    askRoiAnalyst,
    setSummary,
    createInitiative,
    createIdea,
    updateIdea,
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
    availablePeople: AGP_PEOPLE,
    resetDemo,
  };
}

export type { RoiModel };
