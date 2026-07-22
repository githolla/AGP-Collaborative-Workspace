import { describe, expect, it } from "vitest";
import { HANDOFFS, fillHandoff, personalizeHandoff, suggestHandoff } from "./handoffs.js";

describe("handoffs", () => {
  it("every template carries a non-empty include checklist", () => {
    expect(HANDOFFS.length).toBeGreaterThan(0);
    for (const h of HANDOFFS) {
      expect(h.include.length, `${h.key} should list links to include`).toBeGreaterThan(0);
      expect(h.body.trim().length).toBeGreaterThan(0);
    }
  });

  it("fills the client name and appends the include checklist", () => {
    const t = HANDOFFS.find((h) => h.key === "client-review")!;
    const out = fillHandoff(t, "SPCA of Texas");
    expect(out).toContain("SPCA of Texas");
    expect(out).not.toContain("{client}");
    for (const i of t.include) expect(out).toContain(i);
  });

  it("suggests the right handoff from a task title", () => {
    expect(suggestHandoff("Copy & design review with client")?.key).toBe("client-review");
    expect(suggestHandoff("Copywriting kickoff")?.key).toBe("to-copywriting");
    expect(suggestHandoff("Creative concepts")?.key).toBe("to-design");
    expect(suggestHandoff("Mail day / in-home")?.key).toBe("to-production");
    expect(suggestHandoff("Budget reconciliation")).toBeUndefined();
  });

  it("personalizes a handoff with task, date, and owner", () => {
    const t = HANDOFFS.find((h) => h.key === "to-copywriting")!;
    const out = personalizeHandoff(t, { clientName: "SPCA of Texas", taskTitle: "Ask-string matrix", dueDate: "2026-08-01", ownerName: "Dom Spinosa", project: "FY26 Direct Response" });
    expect(out).toContain("Ask-string matrix");
    expect(out).toContain("FY26 Direct Response");
    expect(out).toContain("Aug 1");
    expect(out).toContain("Dom Spinosa");
    for (const i of t.include) expect(out).toContain(i);
  });
});
