import { describe, expect, it } from "vitest";
import type { ClientFileLink, ClientShare } from "./types.js";
import {
  approvalLabel,
  approvalState,
  clientDocuments,
  decide,
  decisionSummary,
  isAwaitingApproval,
  partitionForClient,
  shareRecord,
  shareSummary,
} from "./clientApproval.js";

const AT = "2026-08-05T12:00:00.000Z";

function file(over: Partial<ClientFileLink> = {}): ClientFileLink {
  return { id: "f1", name: "Strategy.docx", kind: "doc", addedAt: "2026-08-01T00:00:00.000Z", ...over };
}
const share = (over: Partial<ClientShare> = {}): ClientShare => ({ purpose: "approval", sharedAt: AT, sharedBy: "Josh", ...over });

describe("approvalState", () => {
  it("is fyi for a read-only share, regardless of any stray decision", () => {
    expect(approvalState(share({ purpose: "fyi" }))).toBe("fyi");
  });
  it("is pending until the client decides", () => {
    expect(approvalState(share())).toBe("pending");
  });
  it("reflects the decision once made", () => {
    expect(approvalState(share({ decision: "approved" }))).toBe("approved");
    expect(approvalState(share({ decision: "changes" }))).toBe("changes");
  });
});

describe("approvalLabel", () => {
  it("reads in the client's words", () => {
    expect(approvalLabel(share({ purpose: "fyi" }))).toBe("Shared to review");
    expect(approvalLabel(share())).toBe("Awaiting your approval");
    expect(approvalLabel(share({ decision: "approved", decidedAt: "2026-08-06T09:00:00Z" }))).toBe("Approved 2026-08-06");
    expect(approvalLabel(share({ decision: "changes" }))).toBe("Changes requested");
  });
});

describe("isAwaitingApproval", () => {
  it("is true only for an undecided approval request", () => {
    expect(isAwaitingApproval(share())).toBe(true);
    expect(isAwaitingApproval(share({ purpose: "fyi" }))).toBe(false);
    expect(isAwaitingApproval(share({ decision: "approved" }))).toBe(false);
  });
});

describe("clientDocuments / partitionForClient", () => {
  const files = [
    file({ id: "internal", name: "Internal notes" }), // never shared
    file({ id: "fyi", name: "Living strategy", clientShare: share({ purpose: "fyi" }) }),
    file({ id: "await", name: "Fall creative", clientShare: share() }),
    file({ id: "done", name: "Approved brief", clientShare: share({ decision: "approved" }) }),
  ];

  it("shows the client only what was shared with them", () => {
    expect(clientDocuments(files).map((f) => f.id)).toEqual(["fyi", "await", "done"]);
  });

  it("separates what needs a decision from the rest", () => {
    const { awaiting, shared } = partitionForClient(files);
    expect(awaiting.map((f) => f.id)).toEqual(["await"]);
    expect(shared.map((f) => f.id)).toEqual(["fyi", "await", "done"]);
  });
});

describe("shareRecord", () => {
  it("starts a clean request, carrying no stale decision", () => {
    const rec = shareRecord("approval", "Josh", AT);
    expect(rec).toEqual({ purpose: "approval", sharedAt: AT, sharedBy: "Josh" });
    expect(rec.decision).toBeUndefined();
  });
});

describe("decide", () => {
  it("stamps who and when, and keeps a change note", () => {
    const rec = decide(share(), "changes", "Cara", "2026-08-06T10:00:00Z", "  Tighten the CTA  ");
    expect(rec).toMatchObject({ decision: "changes", decidedBy: "Cara", decidedAt: "2026-08-06T10:00:00Z", note: "Tighten the CTA" });
  });
  it("omits an empty note", () => {
    expect(decide(share(), "approved", "Cara", AT, "   ").note).toBeUndefined();
  });
  it("does not mutate the input", () => {
    const original = share();
    decide(original, "approved", "Cara", AT);
    expect(original.decision).toBeUndefined();
  });
});

describe("summaries", () => {
  it("distinguishes an approval request from an FYI share", () => {
    expect(shareSummary("Brief.docx", share())).toBe("Sent to client for approval — Brief.docx");
    expect(shareSummary("Brief.docx", share({ purpose: "fyi" }))).toBe("Shared with client — Brief.docx");
  });
  it("spells out a change request with its note", () => {
    expect(decisionSummary("Brief.docx", share({ decision: "changes", note: "Fix the logo" }))).toBe(
      'Client requested changes — Brief.docx: "Fix the logo"',
    );
    expect(decisionSummary("Brief.docx", share({ decision: "approved" }))).toBe("Client approved — Brief.docx");
  });
});
