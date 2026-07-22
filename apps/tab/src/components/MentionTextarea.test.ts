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
  it("narrows by prefix as letters are typed (case-insensitive)", () => {
    expect(matchMentions(ROSTER, "").length).toBe(5);
    // "a" matches names whose first OR last name starts with "a" — Amy, Aubrey,
    // and Dom *Spinosa*? no. Not everyone-with-an-a (that's the bug we fixed).
    expect(matchMentions(ROSTER, "a").map((p) => p.name).sort()).toEqual(["Amy Warren", "Aubrey Ranas"]);
    expect(matchMentions(ROSTER, "au").map((p) => p.name)).toEqual(["Aubrey Ranas"]);
    expect(matchMentions(ROSTER, "am").map((p) => p.name)).toEqual(["Amy Warren"]);
    expect(matchMentions(ROSTER, "spin").map((p) => p.name)).toEqual(["Dom Spinosa"]); // word-prefix
    expect(matchMentions(ROSTER, "zzz")).toEqual([]);
  });

  it("does not treat a mid-word letter as a match", () => {
    // "o" appears in Dom, Spinosa, Olson, etc. — but starts only "Olson".
    // No name/word starts with "o" except Madison *Olson*.
    expect(matchMentions(ROSTER, "o").map((p) => p.name)).toEqual(["Madison Olson"]);
  });

  it("puts on-account people first", () => {
    // "d" starts Dom (on-account). No fallback substring noise.
    expect(matchMentions(ROSTER, "d").map((p) => p.name)).toEqual(["Dom Spinosa"]);
  });
});
