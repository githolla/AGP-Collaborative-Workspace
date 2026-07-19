import { describe, expect, it } from "vitest";
import { KantataAdapter } from "./adapters/kantata.js";
import { InMemoryMirrorStore } from "./store.js";
import { InMemorySyncQueue } from "./queue.js";
import { SyncPipeline } from "./pipeline.js";
import { backfill, reconcile } from "./reconcile.js";
import { FixtureKantataApi } from "../fixtures/kantataFixture.js";
import { kantataSeed } from "../fixtures/seed.js";

function makeStack() {
  const api = new FixtureKantataApi(kantataSeed());
  const adapter = new KantataAdapter(api);
  const store = new InMemoryMirrorStore();
  const queue = new InMemorySyncQueue();
  const pipeline = new SyncPipeline(adapter, store, queue, () => new Date("2026-07-19T00:00:00Z"));
  return { api, adapter, store, queue, pipeline };
}

describe("backfill", () => {
  it("populates the whole mirror from a cold start with zero events", async () => {
    const { api, adapter, store, queue, pipeline } = makeStack();
    api.data.events = []; // no event history at all — backfill must not depend on it
    await backfill(adapter, store, queue);
    await pipeline.drain();

    const seed = kantataSeed().entities;
    expect((await store.list("kantata", "workspace")).filter((r) => r.data)).toHaveLength(seed.workspace!.length);
    expect((await store.list("kantata", "time_entry")).filter((r) => r.data)).toHaveLength(seed.time_entry!.length);
    expect((await store.list("kantata", "expense")).filter((r) => r.data)).toHaveLength(seed.expense!.length);
  });
});

describe("nightly reconcile (never-miss guarantee)", () => {
  it("catches an update whose event was lost — the injected gap", async () => {
    const { api, adapter, store, queue, pipeline } = makeStack();
    await backfill(adapter, store, queue);
    await pipeline.drain();

    // Outage scenario: the source changes but the event expired unseen
    // (Kantata retention is ~9 days). No poll will ever hear about this.
    api.updateEntitySilently("time_entry", "te-3001", {
      time_in_minutes: 480,
      updated_at: "2026-07-19T08:00:00Z",
    });

    const before = await store.get({ source: "kantata", entityType: "time_entry", sourceId: "te-3001" });
    expect(before?.data?.time_in_minutes).toBe(240); // mirror is silently wrong

    const report = await reconcile(adapter, store, queue);
    expect(report.stale).toBe(1);
    await pipeline.drain();

    const after = await store.get({ source: "kantata", entityType: "time_entry", sourceId: "te-3001" });
    expect(after?.data?.time_in_minutes).toBe(480); // gap closed, no manual steps
  });

  it("catches an entity created without an event", async () => {
    const { api, adapter, store, queue, pipeline } = makeStack();
    await backfill(adapter, store, queue);
    await pipeline.drain();

    api.data.entities.workspace!.push({
      id: "ws-9999",
      title: "Appeared during an outage",
      updated_at: "2026-07-19T09:00:00Z",
    });

    const report = await reconcile(adapter, store, queue);
    expect(report.missing).toBe(1);
    await pipeline.drain();

    const row = await store.get({ source: "kantata", entityType: "workspace", sourceId: "ws-9999" });
    expect(row?.data?.title).toBe("Appeared during an outage");
  });

  it("detects deletions on a full pass by set difference", async () => {
    const { api, adapter, store, queue, pipeline } = makeStack();
    await backfill(adapter, store, queue);
    await pipeline.drain();

    api.deleteEntity("allocation", "al-4002");
    const report = await backfill(adapter, store, queue); // full pass
    expect(report.deletedCandidates).toBe(1);
    await pipeline.drain();

    const row = await store.get({ source: "kantata", entityType: "allocation", sourceId: "al-4002" });
    expect(row?.deleted).toBe(true);
  });

  it("is idempotent: reconciling a converged mirror enqueues nothing new", async () => {
    const { adapter, store, queue, pipeline } = makeStack();
    await backfill(adapter, store, queue);
    await pipeline.drain();

    const report = await reconcile(adapter, store, queue);
    // The watermark overlap re-checks recent rows, but none are missing or stale.
    expect(report.missing).toBe(0);
    expect(report.stale).toBe(0);
    expect(await queue.pendingCount()).toBe(0);
  });
});
