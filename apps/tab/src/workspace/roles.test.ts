import { describe, expect, it } from "vitest";
import { canManageWorkspace, isAppAdmin, isWorkspaceAdmin, parseAdminAllowlist, roleFor, viewTierFor, tabVisibleForTier } from "./roles.js";
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

describe("viewTierFor", () => {
  it("unconfigured → fullest tier (today's see-everything behavior preserved)", () => {
    expect(viewTierFor(undefined, "anyone@agency.com", false)).toBe("project_manager");
    expect(viewTierFor({}, "anyone@agency.com", false)).toBe("project_manager");
  });

  it("app admins always get the fullest tier, even under a delivery default", () => {
    expect(viewTierFor({ defaultTier: "delivery" }, "boss@agency.com", true)).toBe("project_manager");
  });

  it("falls back to the configured default when a person has no override", () => {
    expect(viewTierFor({ defaultTier: "delivery" }, "nobody@agency.com", false)).toBe("delivery");
    expect(viewTierFor({ defaultTier: "account_manager" }, "nobody@agency.com", false)).toBe("account_manager");
  });

  it("a per-person override wins over the default (case-insensitive email)", () => {
    const cfg = { defaultTier: "delivery" as const, memberTiers: { "alice@agency.com": "account_manager" as const, "carol@agency.com": "project_manager" as const } };
    expect(viewTierFor(cfg, "Alice@Agency.com", false)).toBe("account_manager");
    expect(viewTierFor(cfg, "carol@agency.com", false)).toBe("project_manager");
    expect(viewTierFor(cfg, "bob@agency.com", false)).toBe("delivery");
  });
});

describe("tabVisibleForTier", () => {
  it("project_manager sees every tab", () => {
    for (const t of ["home", "plan", "resourcing", "dashboard", "files", "discussions", "access"]) {
      expect(tabVisibleForTier("project_manager", t)).toBe(true);
    }
  });

  it("account_manager is client-facing: dashboard yes, resourcing no", () => {
    for (const t of ["home", "plan", "dashboard", "files", "discussions", "access"]) {
      expect(tabVisibleForTier("account_manager", t)).toBe(true);
    }
    expect(tabVisibleForTier("account_manager", "resourcing")).toBe(false);
  });

  it("delivery tier sees only Home, Project Plan, Discussions and Files", () => {
    expect(tabVisibleForTier("delivery", "home")).toBe(true);
    expect(tabVisibleForTier("delivery", "plan")).toBe(true);
    expect(tabVisibleForTier("delivery", "discussions")).toBe(true);
    expect(tabVisibleForTier("delivery", "files")).toBe(true);
    // Hidden for delivery: the client-facing and internal-admin surfaces.
    expect(tabVisibleForTier("delivery", "dashboard")).toBe(false);
    expect(tabVisibleForTier("delivery", "access")).toBe(false);
    expect(tabVisibleForTier("delivery", "resourcing")).toBe(false);
  });
});
