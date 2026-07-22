import { describe, expect, it } from "vitest";
import { mentionQueryAt, matchMentions, type MentionPerson } from "./MentionTextarea.js";

const ROSTER: MentionPerson[] = [
  { name: "Dom Spinosa", onAccount: true },
  { name: "Amy Warren", onAccount: false },
  { name: "Aubrey Ranas", onAccount: false },
  { name: "Janine Penner", onAccount: false },
  { name: "Madison Olson", onAccount: false },
];

describe("mentionQueryAt", () => {
  it("detects the @token at the caret", () => {
    expect(mentionQueryAt("@do", 3)).toEqual({ anchor: 0, query: "do" });
    expect(mentionQueryAt("hey @am", 7)).toEqual({ anchor: 4, query: "am" });
    expect(mentionQueryAt("@", 1)).toEqual({ anchor: 0, query: "" });
  });

  it("returns null when not in a mention", () => {
    expect(mentionQueryAt("hello", 5)).toBeNull();
    expect(mentionQueryAt("email@x", 7)).toBeNull(); // '@' not at a word boundary
    expect(mentionQueryAt("@dom ", 5)).toBeNull(); // trailing space closes it
  });
});

describe("matchMentions", () => {
  it("narrows as letters are typed (case-insensitive)", () => {
    expect(matchMentions(ROSTER, "").length).toBe(5);
    expect(matchMentions(ROSTER, "a").map((p) => p.name)).toEqual(
      expect.arrayContaining(["Amy Warren", "Aubrey Ranas", "Janine Penner", "Madison Olson"]),
    );
    expect(matchMentions(ROSTER, "am").map((p) => p.name)).toEqual(["Amy Warren"]);
    expect(matchMentions(ROSTER, "spin").map((p) => p.name)).toEqual(["Dom Spinosa"]);
    expect(matchMentions(ROSTER, "zzz")).toEqual([]);
  });

  it("puts on-account people first, then start-of-name matches", () => {
    // 'do' matches Dom (on-account, starts) and Madison (mid-word 'do'n't).
    const names = matchMentions(ROSTER, "d").map((p) => p.name);
    expect(names[0]).toBe("Dom Spinosa"); // on-account wins
  });
});
