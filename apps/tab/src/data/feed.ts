import { formatUsd } from "@agp/shared";
import { AS_OF, daysUntil, type ProjectView } from "./model.js";
import type { Severity } from "../theme.js";

/**
 * Needs-You feed, M2 demo edition (SPEC Layer 2b): derived deterministically
 * from the fixture mirror, ranked by severity then dollar impact, capped at 5.
 * Every item carries its one-sentence "because" and a provenance label.
 * The real engine (M5) computes these server-side against learned baselines
 * and reweights per user from dismissal behavior.
 */

export interface FeedItem {
  id: string;
  severity: Severity;
  projectId: string | null;
  title: string;
  because: string;
  source: string;
  actions: string[];
  impactCents: number;
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, serious: 1, warning: 2, info: 3, good: 4 };

/** Vendor lead-time chain for direct mail: print + list + postage logistics. */
const MAIL_LEAD_TIME_DAYS = 56;
const STALE_COMMS_DAYS = 21;

export function buildFeed(projects: ProjectView[]): FeedItem[] {
  const items: FeedItem[] = [];

  for (const p of projects) {
    const f = p.finance;

    if (f.status === "over" || f.status === "watch") {
      const overrunCents = Math.round(f.feesBurnedCents - f.expectedFraction * f.feeBudget);
      items.push({
        id: `burn-${p.id}`,
        severity: f.status === "over" ? "serious" : "warning",
        projectId: p.id,
        title: `${p.client.name}: fees burning ${f.status === "over" ? "well " : ""}ahead of plan — change order drafted`,
        because: `Because ${Math.round(f.actualFraction * 100)}% of the fee ${p.model === "retainer" ? "envelope" : "budget"} is burned at ${Math.round(f.expectedFraction * 100)}% of the ${p.model === "retainer" ? "month" : "timeline"} (${formatUsd(overrunCents)} ahead).`,
        source: f.provenance,
        actions: ["Review draft", "Dismiss"],
        impactCents: Math.abs(overrunCents),
      });
    }

    if (f.status === "under") {
      items.push({
        id: `underburn-${p.id}`,
        severity: "warning",
        projectId: p.id,
        title: `${p.client.name}: burning under plan — delivery risk check`,
        because: `Because only ${Math.round(f.actualFraction * 100)}% of fees are burned at ${Math.round(f.expectedFraction * 100)}% of the timeline; staffing may be short.`,
        source: f.provenance,
        actions: ["Open planner", "Dismiss"],
        impactCents: Math.round(f.expectedFraction * f.feeBudget - f.feesBurnedCents),
      });
    }

    for (const m of p.milestones.filter((m) => m.hard && m.state !== "completed")) {
      const days = daysUntil(m.due);
      const safeStartDays = days - MAIL_LEAD_TIME_DAYS;
      if (days > 0 && safeStartDays <= 45) {
        items.push({
          id: `hard-${m.id}`,
          severity: safeStartDays <= 14 ? "serious" : "warning",
          projectId: p.id,
          title: `${p.client.name}: “${m.title}” is immovable — ${days} days out`,
          because: `Because the vendor lead-time chain (print, list, postage) needs ${MAIL_LEAD_TIME_DAYS} days, latest safe start is ${safeStartDays} days away.`,
          source: `story ${m.id} · Kantata (fixture)`,
          actions: ["Open timeline", "Dismiss"],
          impactCents: p.budgetCents,
        });
      }
    }

    const lastTouch = p.engagements[0];
    if (lastTouch) {
      const silentDays = daysUntil(AS_OF, lastTouch.occurredAt.slice(0, 10));
      if (silentDays >= STALE_COMMS_DAYS) {
        items.push({
          id: `stale-${p.id}`,
          severity: "warning",
          projectId: p.id,
          title: `${p.client.name} hasn’t heard from us in ${silentDays} days — update email drafted`,
          because: `Because the last client touch was “${lastTouch.subject}” on ${lastTouch.occurredAt.slice(0, 10)}.`,
          source: "HubSpot engagements (fixture)",
          actions: ["Review draft", "Dismiss"],
          impactCents: Math.round(p.budgetCents / 10),
        });
      }
    }

    const a11y = p.engagements.find((e) => /accessib/i.test(e.body));
    if (a11y) {
      items.push({
        id: `loopin-${p.id}`,
        severity: "info",
        projectId: p.id,
        title: `${p.client.name} asked about accessibility — loop-in proposed`,
        because: `Because the client email “${a11y.subject}” matches the accessibility capability; the owner gets a one-tap invite with a 60-second brief.`,
        source: "HubSpot engagement + capability registry (fixture)",
        actions: ["Propose loop-in", "Dismiss"],
        impactCents: 0,
      });
    }
  }

  return items
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.impactCents - a.impactCents)
    .slice(0, 5);
}
