import type { ClientAccount, Task } from "./types.js";

/**
 * The weekly client digest — the highest-ROI AI feature across every
 * platform surveyed (docs/research-best-practices.md): an AI-drafted status
 * update the account manager EDITS AND APPROVES before it reaches the
 * client. Format per agency-reporting best practice: headline first, then
 * campaign status, done, coming up, needs-attention, one recommendation.
 *
 * Deterministic and client-safe by construction: composed ONLY from the
 * account's own data (campaigns, shared tasks, files) — this module is
 * reachable from guest surfaces and must never import internal modules.
 */

function fmtDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function composeClientDigest(account: ClientAccount, tasks: Task[], today: string): string {
  const weekAgo = new Date(new Date(`${today}T00:00:00Z`).getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
  const twoWeeksOut = new Date(new Date(`${today}T00:00:00Z`).getTime() + 14 * 86_400_000).toISOString().slice(0, 10);

  const active = account.campaigns.filter((c) => c.status === "active");
  const doneThisWeek = tasks.filter((t) => t.status === "done" && t.createdAt.slice(0, 10) >= weekAgo);
  const comingUp = tasks
    .filter((t) => t.status !== "done" && t.due && t.due >= today && t.due <= twoWeeksOut)
    .sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""));
  const overdue = tasks.filter((t) => t.status !== "done" && t.due && t.due < today);
  const nextMilestone = account.campaigns
    .filter((c) => c.nextMilestone && c.nextMilestoneDate && c.nextMilestoneDate >= today)
    .sort((a, b) => (a.nextMilestoneDate ?? "").localeCompare(b.nextMilestoneDate ?? ""))[0];

  const lines: string[] = [];
  lines.push(`Weekly update — ${account.clientName} — week of ${fmtDay(today)}`);
  lines.push("");

  // The headline: what it means, before any data.
  const headlineBits = [
    `${active.length} campaign${active.length === 1 ? "" : "s"} in flight`,
    doneThisWeek.length > 0 ? `${doneThisWeek.length} task${doneThisWeek.length === 1 ? "" : "s"} completed this week` : null,
    nextMilestone ? `next up: ${nextMilestone.nextMilestone} for ${nextMilestone.name} on ${fmtDay(nextMilestone.nextMilestoneDate!)}` : null,
  ].filter(Boolean);
  lines.push(`THE HEADLINE: ${headlineBits.join(" · ")}. ${overdue.length === 0 ? "We're on track." : `${overdue.length} item${overdue.length === 1 ? " needs" : "s need"} attention (below).`}`);
  lines.push("");

  if (account.campaigns.length > 0) {
    lines.push("CAMPAIGN STATUS:");
    for (const c of account.campaigns) {
      lines.push(
        `• ${c.name} — ${c.status}${c.nextMilestone && c.nextMilestoneDate ? ` · next: ${c.nextMilestone} (${fmtDay(c.nextMilestoneDate)})` : ""}`,
      );
    }
    lines.push("");
  }

  if (doneThisWeek.length > 0) {
    lines.push("DONE THIS WEEK:");
    for (const t of doneThisWeek.slice(0, 5)) lines.push(`• ${t.title}`);
    lines.push("");
  }

  if (comingUp.length > 0) {
    lines.push("COMING UP (next two weeks):");
    for (const t of comingUp.slice(0, 5)) {
      lines.push(`• ${t.title}${t.ownerName ? ` — ${t.ownerName}` : ""} · due ${t.due ? fmtDay(t.due) : ""}`);
    }
    lines.push("");
  }

  lines.push("NEEDS YOUR ATTENTION:");
  if (overdue.length > 0) {
    for (const t of overdue.slice(0, 3)) {
      lines.push(`• ${t.title} slipped past ${t.due ? fmtDay(t.due) : "its date"} — we're on it; flag anything blocking on your side.`);
    }
  } else {
    lines.push("• Nothing — every task is on schedule.");
  }
  lines.push("");

  // One specific recommendation, not a vague sign-off.
  const rec = nextMilestone
    ? `RECOMMENDED FOCUS: ${nextMilestone.nextMilestone} for ${nextMilestone.name} lands ${fmtDay(nextMilestone.nextMilestoneDate!)} — let's confirm approvals and assets are locked the week before.`
    : comingUp[0]
      ? `RECOMMENDED FOCUS: "${comingUp[0].title}" is the next deliverable — a quick review this week keeps it on schedule.`
      : `RECOMMENDED FOCUS: no dated work in the next two weeks — a good moment to plan the next campaign push.`;
  lines.push(rec);

  return lines.join("\n");
}
