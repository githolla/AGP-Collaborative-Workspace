import { describe, expect, it } from "vitest";
import { keepLocallyCreated } from "./store.js";

/**
 * The shared workspace is one document, so adopting a teammate's save used to
 * replace local state wholesale — which ate any workspace created in the
 * moments before a boot fetch, a poll, or a 409 landed. The symptom was
 * clicking into a workspace you had just made and getting "Client workspace
 * not found". These pin the merge rule that fixes it without resurrecting
 * things people deleted on purpose.
 */

const item = (id: string, createdAt: string) => ({ id, createdAt });
const SAVED_AT = "2026-07-29T12:00:00.000Z";

describe("keepLocallyCreated", () => {
  it("carries over a workspace created after the remote save — the reported bug", () => {
    const remote = [item("acct-1", "2026-07-29T11:00:00.000Z")];
    const local = [remote[0]!, item("acct-2", "2026-07-29T12:00:05.000Z")];

    const merged = keepLocallyCreated(remote, local, SAVED_AT);

    expect(merged.map((a) => a.id)).toEqual(["acct-1", "acct-2"]);
  });

  it("does NOT resurrect an item the remote dropped — deletions still propagate", () => {
    // Older than the remote snapshot and missing from it => deleted on purpose.
    const remote = [item("acct-1", "2026-07-29T11:00:00.000Z")];
    const local = [remote[0]!, item("acct-deleted", "2026-07-29T09:00:00.000Z")];

    expect(keepLocallyCreated(remote, local, SAVED_AT).map((a) => a.id)).toEqual(["acct-1"]);
  });

  it("lets the remote copy win for anything present on both sides", () => {
    const remote = [{ id: "acct-1", createdAt: "2026-07-29T11:00:00.000Z", name: "theirs" }];
    const local = [{ id: "acct-1", createdAt: "2026-07-29T11:00:00.000Z", name: "ours" }];

    const merged = keepLocallyCreated(remote, local, SAVED_AT);

    expect(merged).toHaveLength(1);
    expect(merged[0]!.name).toBe("theirs");
  });

  it("returns the remote document unchanged when there is nothing local to carry", () => {
    const remote = [item("acct-1", "2026-07-29T11:00:00.000Z")];

    expect(keepLocallyCreated(remote, [], SAVED_AT)).toEqual(remote);
  });

  it("treats an item created exactly at savedAt as already uploaded", () => {
    // Boundary: `>` not `>=`, so a save that stamped this item doesn't
    // duplicate it back in if the remote legitimately dropped it later.
    const local = [item("acct-edge", SAVED_AT)];

    expect(keepLocallyCreated([], local, SAVED_AT)).toEqual([]);
  });

  it("never mutates either input", () => {
    const remote = [item("acct-1", "2026-07-29T11:00:00.000Z")];
    const local = [item("acct-2", "2026-07-29T12:00:05.000Z")];

    keepLocallyCreated(remote, local, SAVED_AT);

    expect(remote).toHaveLength(1);
    expect(local).toHaveLength(1);
  });
});
