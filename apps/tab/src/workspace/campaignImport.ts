import type { AgpMirror } from "./agpKnowledge.js";

/**
 * Campaign derivation from the live mirror — the bridge from Kantata &
 * HubSpot into Cara's client workspace. Pure so create-and-sync share one
 * behavior and it's testable:
 *
 * - Every Kantata project matching the client becomes an ACTIVE campaign
 *   carrying its nearest upcoming milestone (real title + date) — that's
 *   what fills "Upcoming milestones" on her Home and the dashboard table.
 *   Fallback when a project has no upcoming milestone: its due date.
 * - HubSpot deals become active (won) or planned (open) campaigns; open
 *   deals carry their close date as the next milestone. Lost deals skipped.
 * - Deduped by name — the Kantata project wins over the deal that sold it,
 *   because the project is where delivery dates live.
 */

export interface ImportedCampaign {
  name: string;
  status: "active" | "planned" | "complete";
  nextMilestone?: string;
  nextMilestoneDate?: string;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function campaignsFromMirror(mirror: AgpMirror, clientName: string, today: string): ImportedCampaign[] {
  const firstWord = clientName.toLowerCase().split(/\s+/)[0] ?? "~";

  const fromProjects: ImportedCampaign[] = mirror.projects
    .filter((p) => p.title.toLowerCase().includes(firstWord))
    .map((p) => {
      const upcoming = mirror.milestones
        .filter((m) => m.projectId === p.id && m.state !== "completed" && m.dueDate >= today)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
      const milestone = upcoming
        ? { nextMilestone: upcoming.title, nextMilestoneDate: upcoming.dueDate }
        : p.dueDate && p.dueDate >= today
          ? { nextMilestone: "Delivery due", nextMilestoneDate: p.dueDate }
          : {};
      return {
        // Kantata titles often lead with the client name — trim it.
        name: p.title.replace(new RegExp(`^${escapeRe(clientName)}\\s*[—-]\\s*`, "i"), ""),
        status: "active" as const,
        ...milestone,
      };
    });

  const fromDeals: ImportedCampaign[] = mirror.campaigns
    .filter((c) => c.kind === "deal" && c.clientName === clientName && c.stage !== "closedlost")
    .map((c) => ({
      name: c.title,
      status: c.stage === "closedwon" ? ("active" as const) : ("planned" as const),
      ...(c.stage !== "closedwon" && c.closeDate && c.closeDate >= today
        ? { nextMilestone: "Close date", nextMilestoneDate: c.closeDate.slice(0, 10) }
        : {}),
    }));

  return [...fromProjects, ...fromDeals].filter(
    (c, i, all) => all.findIndex((x) => x.name.toLowerCase() === c.name.toLowerCase()) === i,
  );
}
