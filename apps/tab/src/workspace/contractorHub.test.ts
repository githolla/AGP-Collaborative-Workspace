import { describe, expect, it } from "vitest";
import { buildContractorRows, contractorKpis, mentions, humanDuration } from "./contractorHub.js";
import type { MsAccountExternal, MsAccountGrant, MsAccountShare, MsAccountMessage, MsAccountFileApproval } from "./msAccountData.js";

// A fixed "now" so week-bucketing and status windows are deterministic.
const NOW = new Date("2026-08-31T12:00:00Z").getTime();
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

const ext = (over: Partial<MsAccountExternal>): MsAccountExternal => ({
  id: "e1", name: "Dana Reyes", org: "Studio", role: "contractor", entraStatus: "active", ...over,
});
const share = (over: Partial<MsAccountShare>): MsAccountShare => ({
  id: "s" + Math.random(), personName: "Dana Reyes", itemKind: "file", itemId: "i", itemName: "brand.pdf",
  sentAt: daysAgo(3), sentBy: "You", ...over,
});
const msg = (over: Partial<MsAccountMessage>): MsAccountMessage => ({
  id: "m" + Math.random(), author: "Dana Reyes", kind: "human", body: "hi", clientVisible: false, contractorVisible: true,
  createdAt: daysAgo(1), updatedAt: daysAgo(1), ...over,
});

describe("mentions", () => {
  it("matches first name and full name on a word boundary", () => {
    expect(mentions("hey @Dana can you look", "Dana Reyes")).toBe(true);
    expect(mentions("cc @Dana Reyes here", "Dana Reyes")).toBe(true);
    expect(mentions("Danae is unrelated", "Dana Reyes")).toBe(false);
    expect(mentions("no mention here", "Dana Reyes")).toBe(false);
  });
});

describe("buildContractorRows", () => {
  it("counts shares, opens, and not-opened per contractor", () => {
    const shares = [
      share({ itemName: "a.pdf", openedAt: daysAgo(2) }),
      share({ itemName: "b.pdf", openedAt: daysAgo(1) }),
      share({ itemName: "c.pdf" }), // never opened
    ];
    const [row] = buildContractorRows([ext({})], [], shares, [], [], NOW);
    expect(row!.sharedCount).toBe(3);
    expect(row!.openedCount).toBe(2);
    expect(row!.notOpenedCount).toBe(1);
  });

  it("ignores revoked shares", () => {
    const shares = [share({ itemName: "a.pdf", openedAt: daysAgo(1) }), share({ itemName: "gone.pdf", revokedAt: daysAgo(1) })];
    const [row] = buildContractorRows([ext({})], [], shares, [], [], NOW);
    expect(row!.sharedCount).toBe(1);
  });

  it("matches shares by recipientUserId as well as name", () => {
    const e = ext({ userId: "u1", name: "Dana Reyes" });
    const shares = [share({ personName: "someone else", recipientUserId: "u1", openedAt: daysAgo(1) })];
    const [row] = buildContractorRows([e], [], shares, [], [], NOW);
    expect(row!.openedCount).toBe(1);
  });

  it("counts folders granted by userId or externalLinkId", () => {
    const e = ext({ id: "e1", userId: "u1" });
    const grants: MsAccountGrant[] = [
      { id: "g1", userId: "u1", externalLinkId: null, kantataId: "k", level: "folder", role: "read", msPermissionId: null },
      { id: "g2", userId: null, externalLinkId: "e1", kantataId: "k2", level: "milestone", role: "read", msPermissionId: null },
      { id: "g3", userId: "other", externalLinkId: "other", kantataId: "k3", level: "folder", role: "read", msPermissionId: null },
    ];
    const [row] = buildContractorRows([e], grants, [], [], [], NOW);
    expect(row!.folderCount).toBe(2);
  });

  it("builds the discussion slice from authored + @mentioned messages", () => {
    const thread = [
      msg({ author: "Dana Reyes", body: "on it" }),
      msg({ author: "Kellie B.", body: "thanks @Dana" }),
      msg({ author: "Kellie B.", body: "unrelated note" }),
    ];
    const [row] = buildContractorRows([ext({})], [], [], thread, [], NOW);
    expect(row!.messages).toHaveLength(2);
    expect(row!.messages[0]!.who).toBe("them");
    expect(row!.messages[1]!.who).toBe("agp");
  });

  it("computes average time-to-open only over opened shares", () => {
    const shares = [
      share({ itemName: "a.pdf", sentAt: daysAgo(3), openedAt: daysAgo(2) }), // ~1 day
      share({ itemName: "b.pdf", sentAt: daysAgo(3), openedAt: daysAgo(1) }), // ~2 days
      share({ itemName: "c.pdf" }), // unopened, excluded
    ];
    const [row] = buildContractorRows([ext({})], [], shares, [], [], NOW);
    // avg of 1 and 2 days = 1.5 days
    expect(Math.round((row!.avgTimeToOpenMs ?? 0) / 3_600_000)).toBe(36);
  });

  it("marks status pending when invited and never active", () => {
    const [row] = buildContractorRows([ext({ entraStatus: "invited" })], [], [], [], [], NOW);
    expect(row!.status).toBe("pending");
  });

  it("marks status idle when last active beyond a week", () => {
    const shares = [share({ openedAt: daysAgo(20) })];
    const [row] = buildContractorRows([ext({})], [], shares, [], [], NOW);
    expect(row!.status).toBe("idle");
  });

  it("marks status active when opened within the week", () => {
    const shares = [share({ openedAt: daysAgo(2) })];
    const [row] = buildContractorRows([ext({})], [], shares, [], [], NOW);
    expect(row!.status).toBe("active");
  });

  it("emits share + open activity events sorted newest first", () => {
    const shares = [share({ itemName: "a.pdf", sentAt: daysAgo(5), openedAt: daysAgo(2) })];
    const [row] = buildContractorRows([ext({})], [], shares, [], [], NOW);
    expect(row!.events).toHaveLength(2);
    expect(row!.events[0]!.kind).toBe("open"); // most recent
    expect(row!.events[1]!.kind).toBe("share");
  });

  it("buckets opens into the weekly spark, newest week last", () => {
    const shares = [share({ openedAt: daysAgo(1) }), share({ openedAt: daysAgo(2) }), share({ openedAt: daysAgo(10) })];
    const [row] = buildContractorRows([ext({})], [], shares, [], [], NOW);
    expect(row!.spark).toHaveLength(7);
    expect(row!.spark[6]).toBe(2); // this week
    expect(row!.spark[5]).toBe(1); // last week
  });
});

describe("contractorKpis", () => {
  it("rolls up counts and this-week opens", () => {
    const shares = [share({ openedAt: daysAgo(1) }), share({ itemName: "b.pdf" })];
    const rows = buildContractorRows([ext({})], [], shares, [], [], NOW);
    const approvals: MsAccountFileApproval[] = [
      { id: "a1", msItemId: "m", name: "x", purpose: "approval", sharedAt: daysAgo(3), sharedBy: "You", decision: null, decidedAt: null, note: null },
    ];
    const k = contractorKpis(rows, approvals, NOW);
    expect(k.contractors).toBe(1);
    expect(k.filesShared).toBe(2);
    expect(k.opensThisWeek).toBe(1);
    expect(k.awaitingApproval).toBe(1);
  });
});

describe("humanDuration", () => {
  it("formats minutes, hours, and days", () => {
    expect(humanDuration(30 * 60000)).toBe("30 m");
    expect(humanDuration(90 * 60000)).toBe("1.5 h");
    expect(humanDuration(3 * 86_400_000)).toBe("3 d");
  });
});
