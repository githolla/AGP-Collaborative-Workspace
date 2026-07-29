import { describe, expect, it } from "vitest";
import { feedbackToCsv, respondentCount, tallyByStep } from "./feedback.js";
import type { TourFeedback } from "./types.js";

const entry = (over: Partial<TourFeedback> = {}): TourFeedback => ({
  id: "fb-1",
  createdAt: "2026-07-29T12:00:00.000Z",
  stepKey: "directory",
  stepTitle: "One list, every client",
  prompt: "How easy was it to find your client?",
  choice: "a",
  choiceLabel: "Found it straight away",
  comment: "",
  personName: "Jenna De Beer",
  personEmail: "jenna@example.com",
  ...over,
});

describe("feedbackToCsv", () => {
  it("writes a header row plus one row per response", () => {
    const csv = feedbackToCsv([entry(), entry({ id: "fb-2", createdAt: "2026-07-29T13:00:00.000Z" })]);
    const lines = csv.trim().split("\r\n");

    expect(lines[0]).toContain("Submitted,Person,Email,Step,Question,Choice,Answer,Comment");
    expect(lines).toHaveLength(3);
  });

  it("quotes commas, quotes and newlines so a comment cannot break the columns", () => {
    const csv = feedbackToCsv([
      entry({ comment: 'Tasks, files, and people — but the "Access" tab\nconfused me' }),
    ]);

    expect(csv).toContain('"Tasks, files, and people — but the ""Access"" tab\nconfused me"');
    // The row must still parse as 8 columns: the only bare commas are separators.
    const row = csv.trim().split("\r\n")[1]!;
    expect(row.split('"')[0]!.split(",").filter(Boolean).length).toBeLessThanOrEqual(8);
  });

  it("sorts newest first", () => {
    const csv = feedbackToCsv([
      entry({ id: "old", createdAt: "2026-07-01T09:00:00.000Z", personName: "Older" }),
      entry({ id: "new", createdAt: "2026-07-29T09:00:00.000Z", personName: "Newer" }),
    ]);
    const lines = csv.trim().split("\r\n");

    expect(lines[1]).toContain("Newer");
    expect(lines[2]).toContain("Older");
  });

  it("leads with a BOM so Excel reads it as UTF-8", () => {
    expect(feedbackToCsv([entry({ personName: "Renée" })].slice())).toMatch(/^\uFEFF/);
  });

  it("survives an empty set — headers only, not a crash", () => {
    expect(feedbackToCsv([]).trim().split("\r\n")).toHaveLength(1);
  });
});

describe("tallyByStep", () => {
  it("counts each option and works out percentages", () => {
    const tally = tallyByStep([
      entry({ id: "1", choice: "a", choiceLabel: "Straight away" }),
      entry({ id: "2", choice: "a", choiceLabel: "Straight away" }),
      entry({ id: "3", choice: "b", choiceLabel: "Took a moment" }),
      entry({ id: "4", choice: "c", choiceLabel: "Could not" }),
    ]);

    expect(tally).toHaveLength(1);
    expect(tally[0]!.answered).toBe(4);
    expect(tally[0]!.options.map((o) => [o.choice, o.count, o.percent])).toEqual([
      ["a", 2, 50],
      ["b", 1, 25],
      ["c", 1, 25],
    ]);
  });

  it("keeps a comment-only response without inflating the choice counts", () => {
    const tally = tallyByStep([
      entry({ id: "1", choice: "a" }),
      entry({ id: "2", choice: "", choiceLabel: "", comment: "The navy band is too dark" }),
    ]);

    expect(tally[0]!.answered).toBe(1);
    expect(tally[0]!.comments).toHaveLength(1);
    expect(tally[0]!.comments[0]!.text).toBe("The navy band is too dark");
  });

  it("groups by step and preserves first-seen step order", () => {
    const tally = tallyByStep([
      entry({ id: "1", stepKey: "welcome", stepTitle: "Welcome" }),
      entry({ id: "2", stepKey: "directory", stepTitle: "Directory" }),
      entry({ id: "3", stepKey: "welcome", stepTitle: "Welcome" }),
    ]);

    expect(tally.map((t) => t.stepKey)).toEqual(["welcome", "directory"]);
    expect(tally[0]!.answered).toBe(2);
  });

  it("still tallies answers whose question was later reworded", () => {
    // Options come from the responses, not the current question definition.
    const tally = tallyByStep([entry({ id: "1", choice: "d", choiceLabel: "A retired option" })]);

    expect(tally[0]!.options[0]).toMatchObject({ choice: "d", label: "A retired option", count: 1 });
  });

  it("shows newest comments first", () => {
    const tally = tallyByStep([
      entry({ id: "1", createdAt: "2026-07-01T09:00:00.000Z", comment: "older" }),
      entry({ id: "2", createdAt: "2026-07-29T09:00:00.000Z", comment: "newer" }),
    ]);

    expect(tally[0]!.comments.map((c) => c.text)).toEqual(["newer", "older"]);
  });
});

describe("respondentCount", () => {
  it("counts people, not responses, and ignores email case", () => {
    const count = respondentCount([
      entry({ id: "1", personEmail: "jenna@example.com" }),
      entry({ id: "2", personEmail: "JENNA@example.com" }),
      entry({ id: "3", personEmail: "josh@example.com" }),
    ]);

    expect(count).toBe(2);
  });

  it("falls back to the name when nobody is signed in", () => {
    const count = respondentCount([
      entry({ id: "1", personEmail: "", personName: "Josh Lee" }),
      entry({ id: "2", personEmail: "", personName: "Josh Lee" }),
      entry({ id: "3", personEmail: "", personName: "Suuchi Ramesh" }),
    ]);

    expect(count).toBe(2);
  });
});
