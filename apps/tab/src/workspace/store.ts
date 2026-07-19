import { useCallback, useEffect, useState } from "react";
import { computeProjectROI, standardFactorTemplate, type RoiModel, type WorkspaceFactor } from "@agp/roi";
import type { Initiative, InitiativeType, SandboxIdea, ThreadMessage } from "./types.js";
import { seedIdeas, seedInitiatives } from "./seed.js";
import { roiAnalystMessage, sandboxAnalystMessage } from "./agents.js";
import { factorsFromBasis } from "./basis.js";

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

function load(): PersistedState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      if (Array.isArray(parsed.initiatives) && parsed.initiatives.length > 0) {
        return {
          initiatives: parsed.initiatives,
          // ideas were added after the first release — older storage lacks them
          ideas: Array.isArray(parsed.ideas) ? parsed.ideas : seedIdeas(),
        };
      }
    }
  } catch {
    // corrupted storage falls through to seed
  }
  return { initiatives: seedInitiatives(), ideas: seedIdeas() };
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
      mutate(id, (i) =>
        withSnapshot({ ...i, factors: i.factors.map((f) => (f.key === key ? { ...f, ...patch } : f)) }),
      );
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
      thread: [],
      snapshots: [],
      createdAt: new Date().toISOString(),
    };
    setState((s) => ({ ...s, initiatives: [...s.initiatives, withSnapshot(initiative)] }));
    return id;
  }, []);

  // ---- sandbox ideas ----

  const createIdea = useCallback((title: string, pitch: string): string => {
    const id = newId("idea");
    const idea: SandboxIdea = {
      id,
      title,
      pitch,
      basis: { summary: "", comparables: [], manual: [], buildHours: 0, buildRate: 100 },
      thread: [],
      status: "exploring",
      createdAt: new Date().toISOString(),
    };
    setState((s) => ({ ...s, ideas: [...s.ideas, idea] }));
    return id;
  }, []);

  const updateIdea = useCallback(
    (id: string, patch: Partial<Pick<SandboxIdea, "title" | "pitch" | "basis">>) => {
      mutateIdea(id, (i) => ({ ...i, ...patch }));
    },
    [mutateIdea],
  );

  const postIdeaMessage = useCallback(
    (id: string, body: string, author = "You") => {
      mutateIdea(id, (i) => ({ ...i, thread: [...i.thread, humanMessage(body, author)] }));
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
      const initiative: Initiative = {
        id: initiativeId,
        name: idea.title,
        type,
        summary: idea.pitch,
        factors: factorsFromBasis(idea.basis),
        thread: [
          ...idea.thread,
          humanMessage(`Promoted from the sandbox — napkin basis carried over. Time to harden the numbers.`, "You"),
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
    resetDemo,
  };
}

export type { RoiModel };
