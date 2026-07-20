import { computeProjectROI } from "@agp/roi";
import { AS_OF_TODAY } from "./format.js";
import { copilotFlags } from "./copilot.js";
import type { ClientAccount, Initiative, SandboxIdea } from "./types.js";

/**
 * The Home "Needs you" list: everything actionable across every workspace,
 * ranked, capped at five, each one tap from its fix. Deterministic and
 * explainable — the same philosophy as the copilot: an empty list is a
 * success state, not a failure to find something.
 */

export interface NavTarget {
  view: "initiative" | "idea" | "account";
  id: string;
}

export type NeedSeverity = "critical" | "warning" | "info";

export interface NeedsYouItem {
  id: string;
  severity: NeedSeverity;
  icon: string;
  /** What needs doing, in one sentence. */
  text: string;
  /** Where it happens. */
  where: string;
  actionLabel: string;
  target: NavTarget;
}

const RANK: Record<NeedSeverity, number> = { critical: 0, warning: 1, info: 2 };

export function buildNeedsYou(
  accounts: ClientAccount[],
  initiatives: Initiative[],
  ideas: SandboxIdea[],
): NeedsYouItem[] {
  const today = AS_OF_TODAY();
  const weekOut = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const items: NeedsYouItem[] = [];

  // 1. Overdue tasks — client accounts first (client-facing pain).
  for (const a of accounts.filter((x) => !x.archived)) {
    const overdue = a.tasks.filter((t) => t.status !== "done" && t.due && t.due < today);
    for (const t of overdue.slice(0, 2)) {
      items.push({
        id: `overdue-${a.id}-${t.id}`,
        severity: "critical",
        icon: "⚠",
        text: `“${t.title}” is overdue (was due ${t.due?.slice(5)})${t.ownerName ? ` — ${t.ownerName}` : ""}`,
        where: a.clientName,
        actionLabel: "Open plan",
        target: { view: "account", id: a.id },
      });
    }

    // 2. Hard client milestones inside a week.
    for (const c of a.campaigns) {
      if (c.nextMilestoneDate && c.nextMilestoneDate >= today && c.nextMilestoneDate <= weekOut) {
        items.push({
          id: `milestone-${a.id}-${c.id}`,
          severity: "warning",
          icon: "◆",
          text: `${c.nextMilestone} for ${c.name} lands ${c.nextMilestoneDate.slice(5)}`,
          where: a.clientName,
          actionLabel: "Open dashboard",
          target: { view: "account", id: a.id },
        });
      }
    }
  }

  for (const i of initiatives.filter((x) => !x.archived)) {
    const overdue = i.tasks.filter((t) => t.status !== "done" && t.due && t.due < today);
    for (const t of overdue.slice(0, 1)) {
      items.push({
        id: `overdue-${i.id}-${t.id}`,
        severity: "critical",
        icon: "⚠",
        text: `“${t.title}” is overdue (was due ${t.due?.slice(5)})${t.ownerName ? ` — ${t.ownerName}` : ""}`,
        where: i.name,
        actionLabel: "Open tasks",
        target: { view: "initiative", id: i.id },
      });
    }

    // 3. Required numbers still missing — the grade is capped until they land.
    const roi = computeProjectROI(i.factors);
    if (roi.hasUnknowns) {
      const owners = i.factors
        .filter((f) => roi.unknownRequiredKeys.includes(f.key) && f.gatherOwner)
        .map((f) => f.gatherOwner)
        .filter(Boolean);
      items.push({
        id: `numbers-${i.id}`,
        severity: "warning",
        icon: "#",
        text: `${roi.unknownRequiredKeys.length} required number${roi.unknownRequiredKeys.length > 1 ? "s" : ""} still to gather${owners.length > 0 ? ` (owner: ${[...new Set(owners)].join(", ")})` : ""} — grade capped at ${roi.grade}`,
        where: i.name,
        actionLabel: "Open numbers",
        target: { view: "initiative", id: i.id },
      });
    }

    // 4. Drafted people who were never invited — the plan is waiting on you.
    const uninvited = i.plan?.packages.filter((p) => p.status === "proposed") ?? [];
    if (uninvited.length > 0) {
      items.push({
        id: `invites-${i.id}`,
        severity: "info",
        icon: "✉",
        text: `${uninvited.length} ${uninvited.length === 1 ? "person is" : "people are"} drafted but not invited yet (${uninvited.map((p) => p.name.split(" ")[0]).join(", ")})`,
        where: i.name,
        actionLabel: "Send invites",
        target: { view: "initiative", id: i.id },
      });
    }
  }

  // 5. Ideas: unreviewed Copilot drafts, or an observing copilot with flags.
  for (const s of ideas.filter((x) => x.status === "exploring")) {
    if (s.aiMode === "copilot" && s.reviewed === false) {
      items.push({
        id: `review-${s.id}`,
        severity: "warning",
        icon: "◎",
        text: `The Copilot built a draft for “${s.title}” — review what it claims, who it cast, and the plan`,
        where: s.title,
        actionLabel: "Review draft",
        target: { view: "idea", id: s.id },
      });
    }
    const flags = copilotFlags(s);
    if (s.aiMode === "observer" && flags.length > 0) {
      items.push({
        id: `flags-${s.id}`,
        severity: "info",
        icon: "⚑",
        text: `The Copilot is observing with ${flags.length} flag${flags.length > 1 ? "s" : ""} and suggestions ready — invite it in when you want them`,
        where: s.title,
        actionLabel: "Open idea",
        target: { view: "idea", id: s.id },
      });
    }
  }

  return items.sort((a, b) => RANK[a.severity] - RANK[b.severity]).slice(0, 5);
}

/** Most recently touched workspaces, across all three types. */
export interface RecentItem {
  target: NavTarget;
  kind: "Client" | "Build" | "Idea";
  name: string;
  line: string;
  at: string;
}

function lastTouch(thread: { at: string }[], activity: { at: string }[], createdAt: string): string {
  const times = [...thread.map((t) => t.at), ...activity.map((a) => a.at), createdAt];
  return times.sort().pop() ?? createdAt;
}

export function buildRecents(
  accounts: ClientAccount[],
  initiatives: Initiative[],
  ideas: SandboxIdea[],
): RecentItem[] {
  const today = AS_OF_TODAY();
  const items: RecentItem[] = [];

  for (const a of accounts.filter((x) => !x.archived)) {
    const open = a.tasks.filter((t) => t.status !== "done").length;
    const overdue = a.tasks.filter((t) => t.status !== "done" && t.due && t.due < today).length;
    items.push({
      target: { view: "account", id: a.id },
      kind: "Client",
      name: a.clientName,
      line: `${a.campaigns.filter((c) => c.status === "active").length} active campaigns · ${open} open task${open === 1 ? "" : "s"}${overdue > 0 ? ` · ${overdue} overdue` : ""}`,
      at: lastTouch(a.thread, a.activity, a.createdAt),
    });
  }
  for (const i of initiatives.filter((x) => !x.archived)) {
    const roi = computeProjectROI(i.factors);
    items.push({
      target: { view: "initiative", id: i.id },
      kind: "Build",
      name: i.name,
      line: `grade ${roi.grade} · ${i.tasks.filter((t) => t.status !== "done").length} open tasks`,
      at: lastTouch(i.thread, i.activity, i.createdAt),
    });
  }
  for (const s of ideas.filter((x) => x.status === "exploring")) {
    items.push({
      target: { view: "idea", id: s.id },
      kind: "Idea",
      name: s.title,
      line: s.aiMode === "observer" ? "blank collaboration — Copilot observing" : "Copilot-drafted — refine by talking",
      at: lastTouch(s.thread, [], s.createdAt),
    });
  }

  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 4);
}
