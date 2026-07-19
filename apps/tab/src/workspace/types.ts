import type { Grade, WorkspaceFactor } from "@agp/roi";

export type InitiativeType = "new_build" | "ai_iteration";

export interface ThreadMessage {
  id: string;
  author: string;
  kind: "human" | "agent";
  at: string; // ISO
  body: string;
}

/** Audit-trail snapshot (roi-calculator-spec §10) written on every factor change. */
export interface Snapshot {
  at: string;
  netOneTime: number;
  netRecurringAnnual: number;
  adjustmentMultiplier: number;
  grade: Grade;
  hasUnknowns: boolean;
}

export interface Initiative {
  id: string;
  name: string;
  type: InitiativeType;
  summary: string;
  factors: WorkspaceFactor[];
  thread: ThreadMessage[];
  snapshots: Snapshot[];
  createdAt: string;
}

export const TYPE_LABEL: Record<InitiativeType, string> = {
  new_build: "New build",
  ai_iteration: "AI added to existing product",
};

/**
 * A sandbox idea: not tied to any product or initiative. A manager captures
 * the idea, roughs out what it would replace (the ROI basis), sees a
 * back-of-napkin number, and promotes it into a real build when it earns it.
 */
export interface CastMember {
  personId: string;
  name: string;
  title: string;
  role: string;
  /** One-sentence "because" — every suggestion explains itself. */
  why: string;
  /** Dispatch-managed teams are routed via their manager, never invited directly. */
  viaManager?: string;
}

export interface IdeaClassification {
  serviceLine?: string;
  vertical?: string;
  clientNames: string[];
}

export interface RelatedItem {
  title: string;
  why: string;
}

export interface SandboxIdea {
  id: string;
  title: string;
  /** The idea in the manager's own words. */
  pitch: string;
  basis: import("@agp/roi").RoiModel;
  /** Copilot-drafted cast (approval-by-exception: remove what's wrong). */
  team: CastMember[];
  classification: IdeaClassification;
  relatedProjects: RelatedItem[];
  relatedCampaigns: RelatedItem[];
  thread: ThreadMessage[];
  status: "exploring" | "promoted";
  promotedInitiativeId?: string;
  createdAt: string;
}
