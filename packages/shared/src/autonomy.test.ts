import { describe, expect, it } from "vitest";
import {
  AutonomyGate,
  AutonomyViolationError,
  DEFAULT_ACTION_SPECS,
} from "./autonomy.js";

const NOW = new Date("2026-07-19T12:00:00Z");

describe("AutonomyGate", () => {
  it("executes Tier A with an undo window", () => {
    const gate = new AutonomyGate();
    const gated = gate.gate(
      {
        actionType: "post_internal_digest",
        explanation: "Daily digest is due for the Riverside team.",
        payload: {},
        correlationId: "c-1",
      },
      NOW,
    );
    expect(gated.tier).toBe("A");
    expect(gated.undoDeadline).toBe("2026-07-19T12:15:00.000Z");
  });

  it("routes financial and client-facing actions to Tier B", () => {
    const gate = new AutonomyGate();
    for (const actionType of ["write_allocation", "send_client_email", "create_change_order_draft"]) {
      const gated = gate.gate(
        { actionType, explanation: "Reason.", payload: {}, correlationId: "c-2" },
        NOW,
      );
      expect(gated.tier).toBe("B");
      expect(gated.undoDeadline).toBeUndefined();
    }
  });

  it("REJECTS any config that puts a financial or client-facing action at Tier A", () => {
    const gate = new AutonomyGate();
    expect(() =>
      gate.register({
        actionType: "write_allocation",
        tier: "A",
        financial: true,
        clientFacing: false,
        staffing: true,
      }),
    ).toThrow(AutonomyViolationError);
    expect(() =>
      gate.register({
        actionType: "send_client_email",
        tier: "A",
        financial: false,
        clientFacing: true,
        staffing: false,
      }),
    ).toThrow(AutonomyViolationError);
    // and constructing a gate from a poisoned config table fails fast
    expect(
      () =>
        new AutonomyGate([
          { actionType: "sneaky", tier: "A", financial: true, clientFacing: false, staffing: false },
        ]),
    ).toThrow(AutonomyViolationError);
  });

  it("falls back to Tier C for unknown action types", () => {
    const gate = new AutonomyGate();
    const gated = gate.gate(
      { actionType: "never_seen_before", explanation: "Reason.", payload: {}, correlationId: "c-3" },
      NOW,
    );
    expect(gated.tier).toBe("C");
  });

  it("refuses actions without an explanation", () => {
    const gate = new AutonomyGate();
    expect(() =>
      gate.gate(
        { actionType: "curate_feed", explanation: "  ", payload: {}, correlationId: "c-4" },
        NOW,
      ),
    ).toThrow(AutonomyViolationError);
  });

  it("ships no default spec that violates the invariant", () => {
    for (const spec of DEFAULT_ACTION_SPECS) {
      expect(() => AutonomyGate.assertSpecLegal(spec)).not.toThrow();
    }
  });
});
