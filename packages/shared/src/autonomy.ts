/**
 * Autonomy-tier gate (SPEC Layer 2d). Every action that could write data passes
 * through this gate. Tier assignment lives in config with safe defaults; nothing
 * client-facing or financial may ever be Tier A — enforced here in code, not
 * convention, and covered by tests.
 */

export type AutonomyTier = "A" | "B" | "C";

export interface ActionTypeSpec {
  actionType: string;
  tier: AutonomyTier;
  /** Touches money: budgets, invoices, pricing, allocations with rate impact. */
  financial: boolean;
  /** Visible to a client: emails, reports, anything leaving the org. */
  clientFacing: boolean;
  /** Commits a person's time: staffing, loop-ins, assignments. */
  staffing: boolean;
}

export interface ProposedAction {
  actionType: string;
  /** One-sentence machine-generated "because" (SPEC explainability). */
  explanation: string;
  payload: unknown;
  correlationId: string;
}

export interface GatedAction extends ProposedAction {
  tier: AutonomyTier;
  /** Tier A only: instant at which the undo window closes. */
  undoDeadline?: string;
}

/** Safe defaults for the action types the system starts with (config table overrides). */
export const DEFAULT_ACTION_SPECS: readonly ActionTypeSpec[] = [
  { actionType: "routine_field_sync", tier: "A", financial: false, clientFacing: false, staffing: false },
  { actionType: "post_internal_digest", tier: "A", financial: false, clientFacing: false, staffing: false },
  { actionType: "archive_dead_deal_workspace", tier: "A", financial: false, clientFacing: false, staffing: false },
  { actionType: "curate_feed", tier: "A", financial: false, clientFacing: false, staffing: false },
  { actionType: "send_client_email", tier: "B", financial: false, clientFacing: true, staffing: false },
  { actionType: "write_allocation", tier: "B", financial: true, clientFacing: false, staffing: true },
  { actionType: "create_change_order_draft", tier: "B", financial: true, clientFacing: true, staffing: false },
  { actionType: "loop_in_invite", tier: "B", financial: false, clientFacing: false, staffing: true },
  { actionType: "write_kantata_structure", tier: "B", financial: false, clientFacing: false, staffing: false },
] as const;

export class AutonomyViolationError extends Error {}

const TIER_A_UNDO_WINDOW_MS = 15 * 60 * 1000;

export class AutonomyGate {
  private specs: Map<string, ActionTypeSpec>;

  constructor(specs: readonly ActionTypeSpec[] = DEFAULT_ACTION_SPECS) {
    this.specs = new Map(specs.map((s) => [s.actionType, s]));
    for (const spec of this.specs.values()) {
      AutonomyGate.assertSpecLegal(spec);
    }
  }

  /**
   * The invariant: financial and client-facing actions can never auto-execute.
   * Applied both when specs are loaded (so a bad config row fails fast) and
   * when an action is gated.
   */
  static assertSpecLegal(spec: ActionTypeSpec): void {
    if (spec.tier === "A" && (spec.financial || spec.clientFacing)) {
      throw new AutonomyViolationError(
        `Action type "${spec.actionType}" is ${spec.financial ? "financial" : "client-facing"} and cannot be Tier A.`,
      );
    }
  }

  /** Register or override a spec (admin config). Illegal specs are rejected. */
  register(spec: ActionTypeSpec): void {
    AutonomyGate.assertSpecLegal(spec);
    this.specs.set(spec.actionType, spec);
  }

  /**
   * Gate a proposed action. Unknown action types fall to Tier C (interrupt) —
   * the safe default is to ask, never to act.
   */
  gate(action: ProposedAction, now: Date): GatedAction {
    if (!action.explanation.trim()) {
      throw new AutonomyViolationError(
        `Action "${action.actionType}" has no explanation; every automated action states its "because".`,
      );
    }
    const spec = this.specs.get(action.actionType);
    if (!spec) {
      return { ...action, tier: "C" };
    }
    AutonomyGate.assertSpecLegal(spec);
    if (spec.tier === "A") {
      return {
        ...action,
        tier: "A",
        undoDeadline: new Date(now.getTime() + TIER_A_UNDO_WINDOW_MS).toISOString(),
      };
    }
    return { ...action, tier: spec.tier };
  }
}
