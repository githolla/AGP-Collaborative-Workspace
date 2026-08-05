import { describe, expect, it } from "vitest";
import type { ClientAccount, Task } from "./types.js";
import { composeClientDigest } from "./clientDigest.js";

// Minimal account shell — the digest only reads campaigns + clientName.
const account = (over: Partial<ClientAccount> = {}): ClientAccount => ({
  id: "a", clientName: "Acme", members: [], externals: [], clientContacts: 0,
  campaigns: [], tasks: [], files: [], docs: [], thread: [], notifications: [], activity: [], snapshots: [],
  ...over,
} as ClientAccount);

const task = (over: Partial<Task> = {}): Task => ({
  id: "t", title: "Draft", status: "done", source: "manual", createdAt: "2026-01-01", ...over,
});

describe("composeClientDigest — DONE THIS WEEK uses completion date, not creation", () => {
  const today = "2026-08-05";

  it("counts a task COMPLETED this week even if it was created long ago", () => {
    const out = composeClientDigest(account({ tasks: [task({ title: "Old task, just finished", createdAt: "2026-01-01", completedAt: "2026-08-04" })] }), [task({ title: "Old task, just finished", createdAt: "2026-01-01", completedAt: "2026-08-04" })], today);
    expect(out).toContain("DONE THIS WEEK");
    expect(out).toContain("Old task, just finished");
  });

  it("does NOT count a task created this week but completed earlier", () => {
    const t = task({ title: "Finished in June", createdAt: "2026-08-04", completedAt: "2026-06-01" });
    const out = composeClientDigest(account({ tasks: [t] }), [t], today);
    expect(out).not.toContain("Finished in June");
  });

  it("falls back to createdAt for legacy tasks with no completedAt", () => {
    const t = task({ title: "Legacy done", createdAt: "2026-08-04" });
    const out = composeClientDigest(account({ tasks: [t] }), [t], today);
    expect(out).toContain("Legacy done");
  });
});
