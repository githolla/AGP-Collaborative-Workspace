import { describe, expect, it } from "vitest";
import { contractorFiles, contractorMessages, contractorTasks, contractorUploadTargets } from "./contractorScope.js";
import type { ClientFileLink, Task, ThreadMessage } from "./types.js";

const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id,
  title: `Task ${id}`,
  status: "todo",
  source: "plan",
  createdAt: "2026-01-01",
  ...extra,
});
const file = (id: string, kind: "file" | "doc", extra: Partial<ClientFileLink> = {}): ClientFileLink => ({
  id,
  name: `File ${id}`,
  kind,
  addedAt: "2026-01-01",
  ...extra,
});
const msg = (id: string, extra: Partial<ThreadMessage> = {}): ThreadMessage => ({
  id,
  author: "You",
  kind: "human",
  at: "2026-01-01T00:00:00Z",
  body: `Message ${id}`,
  ...extra,
});

describe("contractorScope — the contractor's scoped view (spec 5.5)", () => {
  it("shows only tasks explicitly shared to the contractor plan", () => {
    const tasks = [task("a", { contractorVisible: true }), task("b"), task("c", { contractorVisible: true })];
    expect(contractorTasks(tasks).map((t) => t.id)).toEqual(["a", "c"]);
  });

  it("shows no tasks when nothing is shared — never the full internal plan by default", () => {
    expect(contractorTasks([task("a"), task("b")])).toEqual([]);
  });

  it("shows only granted files/docs, across both files and docs", () => {
    const account = {
      files: [file("f1", "file", { contractorAccessible: true }), file("f2", "file")],
      docs: [file("d1", "doc"), file("d2", "doc", { contractorAccessible: true })],
    };
    expect(contractorFiles(account).map((f) => f.id).sort()).toEqual(["d2", "f1"]);
  });

  it("upload targets are the writable subset of granted files", () => {
    const account = {
      files: [
        file("read", "file", { contractorAccessible: true }),
        file("drop", "file", { contractorAccessible: true, contractorWritable: true }),
      ],
      docs: [],
    };
    expect(contractorUploadTargets(account).map((f) => f.id)).toEqual(["drop"]);
  });

  it("shows only the contractor-visible slice of the thread", () => {
    const thread = [msg("1"), msg("2", { contractorVisible: true }), msg("3")];
    expect(contractorMessages(thread).map((m) => m.id)).toEqual(["2"]);
  });

  it("flow-back (spec 5.4): the projection never mutates or removes internal messages", () => {
    const thread = [msg("1"), msg("2", { contractorVisible: true }), msg("3")];
    const before = JSON.stringify(thread);
    contractorMessages(thread);
    // The full internal thread is untouched — contractor visibility is a filter,
    // not a move, so history stays complete.
    expect(JSON.stringify(thread)).toEqual(before);
    expect(thread).toHaveLength(3);
  });
});
