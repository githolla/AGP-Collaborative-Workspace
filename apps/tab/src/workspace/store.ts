import { useCallback, useEffect, useState } from "react";
import { computeProjectROI, standardFactorTemplate, type RoiModel, type WorkspaceFactor } from "@agp/roi";
import type { Initiative, InitiativeType, SandboxIdea, ThreadMessage } from "./types.js";
import { seedAccounts, seedIdeas, seedInitiatives } from "./seed.js";
import type { ClientAccount, ClientFileLink, ExternalMember } from "./types.js";
import { roiAnalystMessage, sandboxAnalystMessage } from "./agents.js";
import { factorsFromBasis } from "./basis.js";
import { DEPARTMENTS, copilotFlags, draftFromIdea, inviteCopilot, observeIdea, refineIdea, replanPreservingStatus, type DraftOverrides } from "./copilot.js";
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
  accounts: ClientAccount[];
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

function load(): PersistedState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      if (Array.isArray(parsed.initiatives) && parsed.initiatives.length > 0) {
        return {
          initiatives: parsed.initiatives.map(migrateInitiative),
          // ideas/accounts were added after the first release — backfill
          ideas: Array.isArray(parsed.ideas) ? parsed.ideas.map(migrateIdea) : seedIdeas(),
          accounts: Array.isArray(parsed.accounts) ? parsed.accounts : seedAccounts(),
        };
      }
    }
  } catch {
    // corrupted storage falls through to seed
  }
  return { initiatives: seedInitiatives().map(migrateInitiative), ideas: seedIdeas(), accounts: seedAccounts() };
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
  const { initiatives, ideas, accounts } = state;

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

  const createIdea = useCallback((title: string, pitch: string, aiMode: AiMode = "copilot", overrides?: DraftOverrides): string => {
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
    setState((s) => ({ ...s, ideas: [...s.ideas, idea] }));
    return id;
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
    const pm = AGP_PEOPLE.find((p) => p.fn === "project_management");
    const account: ClientAccount = {
      id,
      clientName,
      members: pm ? [{ personId: pm.id, name: pm.name, title: pm.title }] : [],
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

  const setAccountTaskStatus = useCallback(
    (id: string, taskId: string, status: TaskStatus) => {
      mutateAccount(id, (a) => {
        const task = a.tasks.find((t) => t.id === taskId);
        if (!task) return a;
        return {
          ...a,
          tasks: a.tasks.map((t) => (t.id === taskId ? { ...t, status } : t)),
          activity: [...a.activity, activityEvent(`"${task.title}" → ${status === "done" ? "completed" : status === "doing" ? "in progress" : "to do"}`, "task")],
        };
      });
    },
    [mutateAccount],
  );

  const postAccountMessage = useCallback(
    (id: string, body: string, author = "You") => {
      mutateAccount(id, (a) => ({ ...a, thread: [...a.thread, humanMessage(body, author)] }));
    },
    [mutateAccount],
  );

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
          activity: [...a.activity, activityEvent(`Access revoked immediately (cross-workspace offboard) — ${personName}`, "team")],
        };
      }),
    }));
  }, []);

  /** Offboarding (Must): removal revokes access across the workspace immediately. */
  const removeExternal = useCallback(
    (id: string, externalId: string) => {
      mutateAccount(id, (a) => {
        const ext = a.externals.find((e) => e.id === externalId);
        return {
          ...a,
          externals: a.externals.filter((e) => e.id !== externalId),
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

  const resetDemo = useCallback(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    setState({ initiatives: seedInitiatives(), ideas: seedIdeas(), accounts: seedAccounts() });
  }, []);

  return {
    initiatives,
    ideas,
    accounts,
    createAccount,
    addAccountTask,
    setAccountTaskStatus,
    postAccountMessage,
    addAccountLink,
    addExternal,
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
