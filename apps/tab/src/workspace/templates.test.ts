import { describe, expect, it } from "vitest";
import { TEMPLATES, instantiateTemplate } from "./templates.js";

describe("workspace templates", () => {
  it("instantiates dated tasks from a start date", () => {
    const tpl = TEMPLATES.find((t) => t.key === "direct-mail")!;
    const tasks = instantiateTemplate(tpl, "2026-08-01");
    expect(tasks[0]).toEqual({ title: "Kickoff & campaign brief", due: "2026-08-01" });
    // In-home lands 56 days out.
    expect(tasks.find((t) => t.title.includes("in-home"))?.due).toBe("2026-09-26");
    expect(tasks).toHaveLength(tpl.tasks.length);
  });

  it("every template is well-formed: unique titles, ordered offsets, real size", () => {
    for (const tpl of TEMPLATES) {
      const titles = tpl.tasks.map((t) => t.title.toLowerCase());
      expect(new Set(titles).size, tpl.key).toBe(titles.length);
      expect(tpl.tasks.length, tpl.key).toBeGreaterThanOrEqual(4);
      for (let i = 1; i < tpl.tasks.length; i += 1) {
        expect(tpl.tasks[i]!.offsetDays, `${tpl.key} ordering`).toBeGreaterThanOrEqual(tpl.tasks[i - 1]!.offsetDays);
      }
      expect(tpl.tasks[0]!.offsetDays, tpl.key).toBe(0);
    }
  });

  it("template keys are unique", () => {
    expect(new Set(TEMPLATES.map((t) => t.key)).size).toBe(TEMPLATES.length);
  });
});
