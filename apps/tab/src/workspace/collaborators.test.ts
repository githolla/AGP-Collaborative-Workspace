import { describe, expect, it } from "vitest";
import { activeWorkerNames, resolveOwner, workingPicture, type WorkspaceMember } from "./collaborators.js";
import type { Task } from "./types.js";

const member = (name: string): WorkspaceMember => ({ personId: `k-${name}`, name, title: "AGP team" });
const task = (extra: Partial<Task> = {}): Task => ({
  id: Math.random().toString(36).slice(2),
  title: "T",
  status: "todo",
  source: "manual",
  createdAt: "2026-01-01",
  ...extra,
});

describe("collaborators — the working picture (Cara/Kellie pilot feedback)", () => {
  it("counts open-task owners and assignees as active workers, ignoring done work", () => {
    const tasks = [
      task({ ownerName: "Kellie", status: "doing" }),
      task({ assignments: [{ name: "Dev A" }, { name: "Dev B" }], status: "todo" }),
      task({ ownerName: "Only On Done", status: "done" }),
    ];
    const names = activeWorkerNames(tasks);
    expect(names).toEqual(new Set(["Kellie", "Dev A", "Dev B"]));
    expect(names.has("Only On Done")).toBe(false);
  });

  it("splits the FY roster into who's working now vs. everyone else on the contract", () => {
    const members = [member("Kellie"), member("Dev A"), member("Invoicing"), member("Admin Person")];
    const tasks = [task({ ownerName: "Kellie", status: "doing" }), task({ assignments: [{ name: "Dev A" }] })];
    const { active, contract, hidden } = workingPicture(members, tasks);
    expect(active.map((m) => m.name)).toEqual(["Kellie", "Dev A"]);
    expect(contract.map((m) => m.name)).toEqual(["Invoicing", "Admin Person"]);
    expect(hidden).toEqual([]);
  });

  it("keeps the owner active even when they carry no open task", () => {
    const members = [member("Cara"), member("Dev A")];
    const { active, contract } = workingPicture(members, [task({ ownerName: "Dev A" })], "Cara");
    expect(active.map((m) => m.name)).toEqual(["Cara", "Dev A"]);
    expect(contract).toEqual([]);
  });

  it("hides muted members without deleting them from the roster", () => {
    const members = [member("Kellie"), member("Invoicing")];
    const { active, contract, hidden } = workingPicture(members, [task({ ownerName: "Kellie" })], undefined, ["Invoicing"]);
    expect(active.map((m) => m.name)).toEqual(["Kellie"]);
    expect(contract).toEqual([]);
    expect(hidden.map((m) => m.name)).toEqual(["Invoicing"]);
  });

  it("mutes a person even if they are on an open task — the owner's call wins", () => {
    const members = [member("Kellie"), member("Contractor X")];
    const { active, hidden } = workingPicture(members, [task({ ownerName: "Contractor X" })], "Kellie", ["Contractor X"]);
    expect(active.map((m) => m.name)).toEqual(["Kellie"]);
    expect(hidden.map((m) => m.name)).toEqual(["Contractor X"]);
  });

  it("resolves an owner only while they remain on the account", () => {
    expect(resolveOwner({ ownerName: "Kellie", members: [{ personId: "1", name: "Kellie", title: "PM" }] })).toBe("Kellie");
    expect(resolveOwner({ ownerName: "Departed", members: [{ personId: "1", name: "Kellie", title: "PM" }] })).toBeUndefined();
    expect(resolveOwner({ members: [] })).toBeUndefined();
  });
});
