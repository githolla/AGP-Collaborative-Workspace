import { describe, expect, it } from "vitest";
import type { ClientFileLink, ExternalMember, Share, Task } from "./types.js";
import {
  needsAttention,
  offboardChecklist,
  personHandover,
  samePerson,
  shareState,
  shareableItems,
  stateLabel,
  unsharedWith,
} from "./handover.js";

const TODAY = "2026-08-20T00:00:00.000Z";

function share(over: Partial<Share> = {}): Share {
  return {
    id: "sh_1",
    personName: "Dana Reyes",
    itemKind: "doc",
    itemId: "f_1",
    itemName: "Brand guidelines",
    sentAt: "2026-08-18T09:00:00.000Z",
    sentBy: "Josh Lee",
    ...over,
  };
}

function task(over: Partial<Task> = {}): Task {
  return {
    id: "t_1",
    title: "Draft the newsletter",
    status: "todo",
    source: "manual",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

const file = (id: string, name: string): ClientFileLink => ({ id, name, kind: "file", addedAt: "2026-08-01T00:00:00.000Z" });
const external = (name: string): ExternalMember => ({
  id: `ext_${name}`,
  name,
  org: "Freelance",
  role: "contractor",
  access: "files-only",
  addedAt: "2026-08-01T00:00:00.000Z",
});

describe("samePerson", () => {
  it("ignores case and spacing, because names arrive from three systems", () => {
    expect(samePerson("Dana Reyes", "dana  reyes")).toBe(true);
    expect(samePerson("Dana Reyes", "Dana Reyess")).toBe(false);
  });
});

describe("shareState", () => {
  it("is waiting inside the chase window", () => {
    expect(shareState(share({ sentAt: "2026-08-18T09:00:00.000Z" }), TODAY)).toBe("waiting");
  });

  it("becomes a chase once it has sat unopened", () => {
    expect(shareState(share({ sentAt: "2026-08-10T09:00:00.000Z" }), TODAY)).toBe("chase");
  });

  it("an opened share never becomes a chase, however old", () => {
    expect(shareState(share({ sentAt: "2026-01-01T09:00:00.000Z", openedAt: "2026-01-02T09:00:00.000Z" }), TODAY)).toBe("opened");
  });

  it("separates revoked-after-opening from revoked-never-opened", () => {
    expect(shareState(share({ revokedAt: TODAY, openedAt: "2026-08-19T00:00:00.000Z" }), TODAY)).toBe("revoked");
    expect(shareState(share({ revokedAt: TODAY }), TODAY)).toBe("revoked-unopened");
  });
});

describe("stateLabel", () => {
  it("dates an open and a revocation, and says plainly when neither happened", () => {
    const opened = share({ openedAt: "2026-08-19T14:00:00.000Z" });
    expect(stateLabel(shareState(opened, TODAY), opened)).toBe("Opened 2026-08-19");
    const gone = share({ openedAt: "2026-08-19T14:00:00.000Z", revokedAt: "2026-08-20T10:00:00.000Z" });
    expect(stateLabel(shareState(gone, TODAY), gone)).toBe("Revoked 2026-08-20");
    const stale = share({ sentAt: "2026-08-01T09:00:00.000Z" });
    expect(stateLabel(shareState(stale, TODAY), stale)).toBe("Not opened yet");
  });
});

describe("personHandover", () => {
  const account = {
    shares: [
      share({ id: "sh_1", sentAt: "2026-08-01T09:00:00.000Z" }),
      share({ id: "sh_2", itemName: "Copy deck", sentAt: "2026-08-19T09:00:00.000Z", openedAt: "2026-08-19T12:00:00.000Z" }),
      share({ id: "sh_3", itemName: "Old asset pack", sentAt: "2026-07-01T09:00:00.000Z", revokedAt: "2026-07-30T09:00:00.000Z" }),
      share({ id: "sh_4", personName: "Someone Else", itemName: "Not theirs" }),
    ],
    tasks: [task({ ownerName: "Dana Reyes" }), task({ id: "t_2", ownerName: "Dana Reyes", status: "done" }), task({ id: "t_3" })],
  };

  it("returns only this person's shares, newest first", () => {
    const h = personHandover(account, "Dana Reyes", TODAY);
    expect(h.shares.map((s) => s.id)).toEqual(["sh_2", "sh_1", "sh_3"]);
  });

  it("separates live from revoked — a revoked share stays on the record", () => {
    const h = personHandover(account, "Dana Reyes", TODAY);
    expect(h.live.map((s) => s.id)).toEqual(["sh_2", "sh_1"]);
    expect(h.shares).toHaveLength(3);
  });

  it("flags the live share that has sat unopened", () => {
    expect(personHandover(account, "Dana Reyes", TODAY).chase.map((s) => s.id)).toEqual(["sh_1"]);
  });

  it("counts sent and opened", () => {
    const h = personHandover(account, "Dana Reyes", TODAY);
    expect([h.sent, h.opened]).toEqual([3, 1]);
  });

  it("lists their OPEN tasks only", () => {
    expect(personHandover(account, "Dana Reyes", TODAY).openTasks.map((t) => t.id)).toEqual(["t_1"]);
  });

  it("copes with a workspace saved before handover tracking existed", () => {
    expect(personHandover({ tasks: [] }, "Dana Reyes", TODAY).shares).toEqual([]);
  });
});

describe("offboardChecklist", () => {
  it("names what to revoke, what to reassign, and what was never opened", () => {
    const h = personHandover(
      {
        shares: [share({ id: "sh_1", sentAt: "2026-08-01T09:00:00.000Z" })],
        tasks: [task({ ownerName: "Dana Reyes" })],
      },
      "Dana Reyes",
      TODAY,
    );
    const lines = offboardChecklist(h);
    expect(lines[0]).toBe("Revoke 1 live item: Brand guidelines");
    expect(lines[1]).toBe("Reassign 1 open task: Draft the newsletter");
    expect(lines[2]).toBe("1 item was never opened — check they had what they needed");
  });

  it("says so plainly when there is nothing to do", () => {
    const h = personHandover({ shares: [], tasks: [] }, "Dana Reyes", TODAY);
    expect(offboardChecklist(h)).toEqual(["Nothing outstanding — access can be removed cleanly."]);
  });
});

describe("shareableItems / unsharedWith", () => {
  const account = {
    files: [file("f_1", "Brand guidelines")],
    docs: [{ ...file("d_1", "Strategy doc"), kind: "doc" as const }],
    tasks: [task({ id: "t_1" }), task({ id: "t_2", status: "done" })],
  };

  it("offers files, docs and OPEN tasks — work is handed over too", () => {
    expect(shareableItems(account).map((i) => `${i.kind}:${i.itemId}`)).toEqual(["file:f_1", "doc:d_1", "task:t_1"]);
  });

  it("hides what this person already holds, so nothing is sent twice", () => {
    const h = personHandover({ shares: [share({ itemKind: "file", itemId: "f_1" })], tasks: [] }, "Dana Reyes", TODAY);
    expect(unsharedWith(shareableItems(account), h).map((i) => i.itemId)).toEqual(["d_1", "t_1"]);
  });

  it("offers a revoked item again — revocation is not a permanent block", () => {
    const h = personHandover(
      { shares: [share({ itemKind: "file", itemId: "f_1", revokedAt: TODAY })], tasks: [] },
      "Dana Reyes",
      TODAY,
    );
    expect(unsharedWith(shareableItems(account), h).map((i) => i.itemId)).toContain("f_1");
  });
});

describe("needsAttention", () => {
  it("lists only people with something unopened, worst first", () => {
    const account = {
      externals: [external("Dana Reyes"), external("Priya Shah"), external("Quiet Person")],
      tasks: [],
      shares: [
        share({ id: "a", personName: "Dana Reyes", sentAt: "2026-08-01T09:00:00.000Z" }),
        share({ id: "b", personName: "Priya Shah", sentAt: "2026-08-01T09:00:00.000Z" }),
        share({ id: "c", personName: "Priya Shah", itemId: "f_2", sentAt: "2026-08-02T09:00:00.000Z" }),
        share({ id: "d", personName: "Quiet Person", openedAt: "2026-08-19T09:00:00.000Z" }),
      ],
    };
    expect(needsAttention(account, TODAY)).toEqual([
      { personName: "Priya Shah", chase: 2, openTasks: 0 },
      { personName: "Dana Reyes", chase: 1, openTasks: 0 },
    ]);
  });
});
