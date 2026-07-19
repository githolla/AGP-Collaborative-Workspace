import { useCallback, useEffect, useState } from "react";
import { computeProjectROI, type WorkspaceFactor } from "@agp/roi";
import { standardFactorTemplate } from "@agp/roi";
import type { Initiative, InitiativeType, ThreadMessage } from "./types.js";
import { seedInitiatives } from "./seed.js";
import { roiAnalystMessage } from "./agents.js";

/**
 * Client-side workspace store, persisted to localStorage. This is the M-pivot
 * increment's persistence; the Supabase-backed store (projects / factors /
 * roi_snapshots tables per roi-calculator-spec §10) replaces it when the
 * backend lands. On every factor change: recompute → append a snapshot —
 * the audit trail when numbers go in front of finance.
 */

const STORAGE_KEY = "agp-collab-workspace-v1";
const MAX_SNAPSHOTS = 100;

function load(): Initiative[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { initiatives: Initiative[] };
      if (Array.isArray(parsed.initiatives) && parsed.initiatives.length > 0) return parsed.initiatives;
    }
  } catch {
    // corrupted storage falls through to seed
  }
  return seedInitiatives();
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

export function useWorkspace() {
  const [initiatives, setInitiatives] = useState<Initiative[]>(load);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ initiatives }));
    } catch {
      // storage full/unavailable — the session still works in memory
    }
  }, [initiatives]);

  const mutate = useCallback((id: string, fn: (i: Initiative) => Initiative) => {
    setInitiatives((all) => all.map((i) => (i.id === id ? fn(i) : i)));
  }, []);

  const updateFactor = useCallback(
    (id: string, key: string, patch: Partial<WorkspaceFactor>) => {
      mutate(id, (i) =>
        withSnapshot({
          ...i,
          factors: i.factors.map((f) => (f.key === key ? { ...f, ...patch } : f)),
        }),
      );
    },
    [mutate],
  );

  const postMessage = useCallback(
    (id: string, body: string, author = "You") => {
      const message: ThreadMessage = { id: newId("msg"), author, kind: "human", at: new Date().toISOString(), body };
      mutate(id, (i) => ({ ...i, thread: [...i.thread, message] }));
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

  const setSummary = useCallback(
    (id: string, summary: string) => mutate(id, (i) => ({ ...i, summary })),
    [mutate],
  );

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
    setInitiatives((all) => [...all, withSnapshot(initiative)]);
    return id;
  }, []);

  const resetDemo = useCallback(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    setInitiatives(seedInitiatives());
  }, []);

  return { initiatives, updateFactor, postMessage, askRoiAnalyst, setSummary, createInitiative, resetDemo };
}
