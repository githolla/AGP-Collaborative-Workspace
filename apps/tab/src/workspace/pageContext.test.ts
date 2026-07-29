import { describe, expect, it } from "vitest";
import { locationLabel, questionFor } from "./pageContext.js";
import type { ClientTab } from "../components/ClientWorkspace.js";

const TABS: ClientTab[] = ["home", "plan", "dashboard", "files", "discussions", "sandbox", "access"];

describe("questionFor", () => {
  it("asks about the directory on the clients list", () => {
    const q = questionFor({ view: "clients" })!;
    expect(q.key).toBe("page:clients");
    expect(q.prompt).toMatch(/book of business/i);
  });

  it("asks a different question per client-workspace tab", () => {
    const keys = TABS.map((tab) => questionFor({ view: "account", tab })!.key);
    expect(new Set(keys).size).toBe(TABS.length);

    const prompts = TABS.map((tab) => questionFor({ view: "account", tab })!.prompt);
    expect(new Set(prompts).size).toBe(TABS.length);
  });

  it("names the client in the prompt when one is known", () => {
    const q = questionFor({ view: "account", tab: "access", subject: "SPCA of Texas" })!;
    expect(q.prompt).toContain("SPCA of Texas");
  });

  it("stays readable before the client name is available", () => {
    const q = questionFor({ view: "account", tab: "home" })!;
    expect(q.prompt).toContain("this client");
    expect(q.prompt).not.toContain("undefined");
  });

  it("falls back to Home when no tab has been reported yet", () => {
    expect(questionFor({ view: "account" })!.key).toBe("page:account.home");
  });

  it("stays silent on the admin page — you don't review feedback and give it at once", () => {
    expect(questionFor({ view: "admin" })).toBeNull();
  });

  it("namespaces every key so page reports never collide with tour answers", () => {
    const views = [
      questionFor({ view: "clients" })!,
      questionFor({ view: "initiative" })!,
      questionFor({ view: "idea" })!,
      ...TABS.map((tab) => questionFor({ view: "account", tab })!),
    ];
    expect(views.every((q) => q.key.startsWith("page:"))).toBe(true);
  });

  it("always offers three options and a prompt for the free text", () => {
    for (const tab of TABS) {
      const q = questionFor({ view: "account", tab })!;
      expect(q.options.map((o) => o.key)).toEqual(["a", "b", "c"]);
      expect(q.placeholder.length).toBeGreaterThan(0);
    }
  });
});

describe("locationLabel", () => {
  it("appends the client so an exported row says which one", () => {
    const loc = { view: "account", tab: "files", subject: "SPCA of Texas" } as const;
    expect(locationLabel(loc, questionFor(loc)!)).toBe("Client workspace · Files — SPCA of Texas");
  });

  it("leaves non-client surfaces unadorned", () => {
    const loc = { view: "clients" } as const;
    expect(locationLabel(loc, questionFor(loc)!)).toBe("Client directory");
  });
});
