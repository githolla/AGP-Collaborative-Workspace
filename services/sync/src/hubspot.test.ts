import { describe, expect, it } from "vitest";
import { HubSpotAdapter } from "./adapters/hubspot.js";
import { InMemoryMirrorStore } from "./store.js";
import { InMemorySyncQueue } from "./queue.js";
import { SyncPipeline } from "./pipeline.js";
import { FixtureHubSpotApi } from "../fixtures/hubspotFixture.js";
import { hubspotSeed } from "../fixtures/seed.js";

function makeStack() {
  const api = new FixtureHubSpotApi(hubspotSeed());
  const adapter = new HubSpotAdapter(api);
  const store = new InMemoryMirrorStore();
  const queue = new InMemorySyncQueue();
  const pipeline = new SyncPipeline(adapter, store, queue, () => new Date("2026-07-19T00:00:00Z"));
  return { api, store, queue, pipeline };
}

describe("HubSpotAdapter (polling fallback — no public app required)", () => {
  it("cold poll mirrors every entity, then advances the watermark", async () => {
    const { api, store, pipeline } = makeStack();
    await pipeline.pollOnce();
    await pipeline.drain();

    expect((await store.list("hubspot", "company")).filter((r) => r.data)).toHaveLength(3);
    expect((await store.list("hubspot", "deal")).filter((r) => r.data)).toHaveLength(2);

    // Nothing changed → second poll finds nothing.
    const quiet = await pipeline.pollOnce();
    expect(quiet.newJobs).toBe(0);

    // One deal moves stage → exactly one job, and the mirror picks it up.
    api.updateEntity("deal", "hs-dl-902", {
      dealstage: "contractsent",
      hs_lastmodifieddate: "2026-07-18T09:00:00Z",
    });
    const poll = await pipeline.pollOnce();
    expect(poll.newJobs).toBe(1);
    await pipeline.drain();
    const deal = await store.get({ source: "hubspot", entityType: "deal", sourceId: "hs-dl-902" });
    expect(deal?.data?.dealstage).toBe("contractsent");
  });

  it("translates webhook deliveries into the same change refs as polling", () => {
    const changes = HubSpotAdapter.changesFromWebhook([
      { subscriptionType: "deal.propertyChange", objectId: 902, occurredAt: 1752915600000 },
      { subscriptionType: "company.creation", objectId: "80", occurredAt: 1752915600000 },
      { subscriptionType: "unknown.thing", objectId: 1, occurredAt: 1752915600000 },
    ]);
    expect(changes).toEqual([
      expect.objectContaining({ source: "hubspot", entityType: "deal", sourceId: "902" }),
      expect.objectContaining({ source: "hubspot", entityType: "company", sourceId: "80" }),
    ]);
  });
});
