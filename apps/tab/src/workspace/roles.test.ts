import { describe, expect, it } from "vitest";
import { canManageWorkspace, isAppAdmin, isWorkspaceAdmin, parseAdminAllowlist, roleFor } from "./roles.js";
import type { ClientAccount } from "./types.js";

function account(members: ClientAccount["members"]): Pick<ClientAccount, "members"> {
  return { members };
}

describe("parseAdminAllowlist", () => {
  it("splits, trims, and lowercases", () => {
    expect(parseAdminAllowlist(" Alice@Agency.com, bob@agency.com ,  ")).toEqual(["alice@agency.com", "bob@agency.com"]);
  });

  it("returns an empty list for undefined or blank", () => {
    expect(parseAdminAllowlist(undefined)).toEqual([]);
    expect(parseAdminAllowlist("")).toEqual([]);
    expect(parseAdminAllowlist("   ")).toEqual([]);
  });
});

describe("isAppAdmin", () => {
  it("matches case- and whitespace-insensitively", () => {
    expect(isAppAdmin("Alice@Agency.com", ["alice@agency.com"])).toBe(true);
    expect(isAppAdmin(" alice@agency.com ", ["alice@agency.com"])).toBe(true);
  });

  it("is false for an email not on the list, or no email at all", () => {
    expect(isAppAdmin("bob@agency.com", ["alice@agency.com"])).toBe(false);
    expect(isAppAdmin(undefined, ["alice@agency.com"])).toBe(false);
  });
});

describe("isWorkspaceAdmin", () => {
  const acct = account([
    { personId: "p1", name: "Alice", title: "PM", email: "alice@agency.com", role: "admin" },
    { personId: "p2", name: "Bob", title: "Strategist", email: "bob@agency.com", role: "member" },
    { personId: "p3", name: "Carol", title: "Strategist" }, // no email/role — pre-existing member
  ]);

  it("is true only for a member row marked admin, matched by email", () => {
    expect(isWorkspaceAdmin(acct, "alice@agency.com")).toBe(true);
    expect(isWorkspaceAdmin(acct, "Alice@Agency.com")).toBe(true);
  });

  it("is false for a member row that is not marked admin", () => {
    expect(isWorkspaceAdmin(acct, "bob@agency.com")).toBe(false);
  });

  it("is false for a member with no email on record, even if named", () => {
    expect(isWorkspaceAdmin(acct, undefined)).toBe(false);
  });

  it("is false for an account this person is not a member of, and never guesses", () => {
    expect(isWorkspaceAdmin(acct, "dave@agency.com")).toBe(false);
  });

  it("is false with no account at all", () => {
    expect(isWorkspaceAdmin(undefined, "alice@agency.com")).toBe(false);
  });
});

describe("canManageWorkspace", () => {
  const acct = account([{ personId: "p1", name: "Alice", title: "PM", email: "alice@agency.com", role: "admin" }]);

  it("is true for an app admin regardless of account membership", () => {
    expect(canManageWorkspace(acct, "admin@agency.com", ["admin@agency.com"])).toBe(true);
  });

  it("is true for a workspace admin of this account, even without the app-admin allowlist", () => {
    expect(canManageWorkspace(acct, "alice@agency.com", [])).toBe(true);
  });

  it("is false for a plain member and for an external", () => {
    const withMember = account([...acct.members, { personId: "p2", name: "Bob", title: "Strategist", email: "bob@agency.com", role: "member" }]);
    expect(canManageWorkspace(withMember, "bob@agency.com", [])).toBe(false);
    expect(canManageWorkspace(acct, "outsider@client.com", [])).toBe(false);
  });
});

describe("roleFor", () => {
  it("reports app_admin over workspace_admin when both apply", () => {
    const acct = account([{ personId: "p1", name: "Alice", title: "PM", email: "alice@agency.com", role: "admin" }]);
    expect(roleFor(acct, "alice@agency.com", ["alice@agency.com"])).toBe("app_admin");
  });

  it("reports workspace_admin, then falls back to member", () => {
    const acct = account([
      { personId: "p1", name: "Alice", title: "PM", email: "alice@agency.com", role: "admin" },
      { personId: "p2", name: "Bob", title: "Strategist", email: "bob@agency.com", role: "member" },
    ]);
    expect(roleFor(acct, "alice@agency.com", [])).toBe("workspace_admin");
    expect(roleFor(acct, "bob@agency.com", [])).toBe("member");
  });
});
