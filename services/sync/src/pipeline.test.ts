import { describe, expect, it } from "vitest";
import { KantataAdapter } from "./adapters/kantata.js";
import { InMemoryMirrorStore } from "./store.js";
import { InMemorySyncQueue } from "./queue.js";
import { SyncPipeline } from "./pipeline.js";
import { FixtureKantataApi } from "../fixtures/kantataFixture.js";
import { kantataSeed } from "../fixtures/seed.js";

function makePipeline() {
  const api = new FixtureKantataApi(kantataSeed());
  const store = new InMemoryMirrorStore();
  const queue = new InMemorySyncQueue();
  const pipeline = new SyncPipeline(new KantataAdapter(api), store, queue, () => new Date("2026-07-19T00:00:00Z"));
  return { api, store, queue, pipeline };
}

const wsKey = { source: "kantata" as const, entityType: "workspace", sourceId: "ws-1001" };

describe("SyncPipeline (Kantata subscribed events)", () => {
  it("poll → dirty → hydrate lands current source state in the mirror", async () => {
    const { store, pipeline } = makePipeline();
    const poll = await pipeline.pollOnce();
    expect(poll.newJobs).toBe(3); // seed has 3 events over 3 distinct entities
    await pipeline.drain();

    const row = await store.get(wsKey);
    expect(row?.dirty).toBe(false);
    expect(row?.data?.title).toBe("Harvest Hope Food Bank — Fall Acquisition Mail");
    expect(row?.updatedAtSource).toBe("2026-07-10T09:00:00Z");
  });

  it("is idempotent: polling twice with no new events enqueues nothing", async () => {
    const { pipeline } = makePipeline();
    await pipeline.pollOnce();
    await pipeline.drain();
    const second = await pipeline.pollOnce();
    expect(second.newJobs).toBe(0);
  });

  it("collapses duplicate events (same event redelivered) into zero extra work", async () => {
    const { api, pipeline } = makePipeline();
    await pipeline.pollOnce();
    await pipeline.drain();

    // Kantata redelivers evt-2 verbatim later in the stream.
    api.data.events.push({ ...api.data.events[1]! });
    const poll = await pipeline.pollOnce();
    expect(poll.dedupedEvents).toBe(1);
    expect(poll.newJobs).toBe(0);
  });

  it("collapses duplicate events within a single poll batch into one job", async () => {
    const { api, pipeline, queue } = makePipeline();
    api.data.events.push({ ...api.data.events[0]! }); // dupe of evt-1 in the same batch
    await pipeline.pollOnce();
    // 3 distinct entities → 3 jobs, not 4
    expect(await queue.pendingCount()).toBe(3);
  });

  it("survives out-of-order delivery: mirror always reflects current API state", async () => {
    const { api, store, pipeline } = makePipeline();
    await pipeline.pollOnce();
    await pipeline.drain();

    // The entity is updated twice at the source, but the events arrive reversed.
    api.updateEntitySilently("workspace", "ws-1001", {
      status: "completed",
      updated_at: "2026-07-18T12:00:00Z",
    });
    api.data.events.push(
      {
        id: "evt-late",
        eventType: "workspace:updated",
        subjectType: "workspace",
        subjectId: "ws-1001",
        occurredAt: "2026-07-18T12:00:01Z",
        payload: {},
      },
      {
        id: "evt-early", // the older event arrives after the newer one
        eventType: "workspace:updated",
        subjectType: "workspace",
        subjectId: "ws-1001",
        occurredAt: "2026-07-15T12:00:01Z",
        payload: { status: "stale-value-not-to-be-trusted" },
      },
    );
    await pipeline.pollOnce();
    await pipeline.drain();

    const row = await store.get(wsKey);
    // Content came from hydration (current state), never from event payloads.
    expect(row?.data?.status).toBe("completed");
    expect(row?.updatedAtSource).toBe("2026-07-18T12:00:00Z");
  });

  it("marks entities deleted when hydration finds them gone at the source", async () => {
    const { api, store, pipeline } = makePipeline();
    await pipeline.pollOnce();
    await pipeline.drain();

    api.deleteEntity("story", "st-2002");
    api.data.events.push({
      id: "evt-del",
      eventType: "story:deleted",
      subjectType: "story",
      subjectId: "st-2002",
      occurredAt: "2026-07-18T13:00:00Z",
      payload: {},
    });
    await pipeline.pollOnce();
    const { deleted } = await pipeline.drain();
    expect(deleted).toBe(1);

    const row = await store.get({ source: "kantata", entityType: "story", sourceId: "st-2002" });
    expect(row?.deleted).toBe(true); // archived, never destroyed
  });
});
