import { describe, expect, it } from "vitest";
import { fiscalYearOn, isActiveClient, noteActivity, titleFiscalYear } from "./clientActivity.js";

/** The pilot runs on 2026-07-29, which is FY27 (AGP's year runs Jul–Jun). */
const TODAY = "2026-07-29";

describe("fiscalYearOn", () => {
  it("names the year the fiscal year ends in", () => {
    // "Howard: FY27 (Jul26-Jun27)" pins this: July 2026 is already FY27.
    expect(fiscalYearOn("2026-07-01")).toBe(2027);
    expect(fiscalYearOn("2026-06-30")).toBe(2026);
    expect(fiscalYearOn("2026-12-31")).toBe(2027);
    expect(fiscalYearOn("2027-01-01")).toBe(2027);
  });
});

describe("titleFiscalYear", () => {
  it("reads the plain forms", () => {
    expect(titleFiscalYear("COH: FY26 DM#1")).toBe(2026);
    expect(titleFiscalYear("NAACPLDF: FY27 Direct Response")).toBe(2027);
    expect(titleFiscalYear("APT: FY24 Direct Response")).toBe(2024);
  });

  it("takes the later year from a span", () => {
    expect(titleFiscalYear("SHCG: FY26/27 - Direct Response Jan-Dec")).toBe(2027);
    expect(titleFiscalYear("WLRH: FY25/26 Direct Response")).toBe(2026);
    expect(titleFiscalYear("Upenn: FY27/FY28 OncoLink Ongoing Support")).toBe(2028);
  });

  it("reads month-year spans in parentheses", () => {
    expect(titleFiscalYear("Howard:  FY27 (Jul26-Jun27)")).toBe(2027);
    expect(titleFiscalYear("IdahoPTV: FY27 Direct Response (Sep26-Aug27)")).toBe(2027);
    expect(titleFiscalYear("ARMS: Support 25-26 (Aug25-Jul26)")).toBe(2026);
  });

  it("treats a calendar year as running into the next fiscal year", () => {
    // "2026 Ongoing Services" is live work now — not history.
    expect(titleFiscalYear("ARF: 2026 Ongoing Services")).toBe(2027);
    expect(titleFiscalYear("Mayo: 2026 Web/Tech Audit")).toBe(2027);
    expect(titleFiscalYear("ITRC: 2025-27 Ongoing Support")).toBe(2028);
  });

  it("returns nothing when the title carries no year", () => {
    expect(titleFiscalYear("PATNC: Ongoing Support")).toBeUndefined();
    expect(titleFiscalYear("APIC: Ongoing")).toBeUndefined();
    expect(titleFiscalYear("IgAN: App Phase 3")).toBeUndefined();
  });
});

describe("noteActivity", () => {
  it("keeps the highest year across a client's projects", () => {
    let ev = noteActivity({}, "HASK: FY24", []);
    ev = noteActivity(ev, "HASK: FY25", []);
    ev = noteActivity(ev, "HASK: FY26", []);
    expect(ev.latestFiscalYear).toBe(2026);
  });

  it("never moves a year backwards", () => {
    let ev = noteActivity({}, "COH: FY27 DM#1", []);
    ev = noteActivity(ev, "COH - FY24 Branding Projects", []);
    expect(ev.latestFiscalYear).toBe(2027);
  });

  it("records the latest date it sees", () => {
    const ev = noteActivity({}, "PATNC: Ongoing Support", ["2026-01-05", "2026-09-30", undefined]);
    expect(ev.latestDate).toBe("2026-09-30");
  });
});

describe("isActiveClient", () => {
  it("counts the current fiscal year as current", () => {
    expect(isActiveClient({ latestFiscalYear: 2027 }, TODAY)).toBe(true);
  });

  it("drops a client whose newest work was last fiscal year", () => {
    // "Current clients", not "recent" — FY26 finished in June.
    expect(isActiveClient({ latestFiscalYear: 2026 }, TODAY)).toBe(false);
    expect(isActiveClient({ latestFiscalYear: 2025 }, TODAY)).toBe(false);
  });

  it("keeps a last-year engagement that is still running", () => {
    // The clause that makes the strict year test safe: an FY26 project booked
    // to finish in September is live work, whatever its title says.
    expect(isActiveClient({ latestFiscalYear: 2026, latestDate: "2026-09-30" }, TODAY)).toBe(true);
  });

  it("drops a last-year engagement that has already ended", () => {
    expect(isActiveClient({ latestFiscalYear: 2026, latestDate: "2026-06-30" }, TODAY)).toBe(false);
  });

  it("falls back to dates when no title carried a year", () => {
    expect(isActiveClient({ latestDate: "2026-09-30" }, TODAY)).toBe(true);
    expect(isActiveClient({ latestDate: "2024-03-01" }, TODAY)).toBe(false);
  });

  it("keeps a client with no evidence at all — silence isn't proof", () => {
    // Hiding a real client is a worse error than showing a stale one.
    expect(isActiveClient({}, TODAY)).toBe(true);
  });
});
