import { describe, expect, it } from "vitest";
import { HANDOFFS, fillHandoff } from "./handoffs.js";

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
});
