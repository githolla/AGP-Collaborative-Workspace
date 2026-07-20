import { applyModel, computeProjectROI, standardFactorTemplate, type RoiModel, type WorkspaceFactor } from "@agp/roi";
import type { Initiative, Snapshot } from "./types.js";
import { roiAnalystMessage } from "./agents.js";
import { draftFromIdea } from "./copilot.js";

/**
 * Demo initiatives. All figures are illustrative fixtures — the point is that
 * each starts from the standard 12-factor template and tightens as evidence
 * lands. One is deliberately untouched to demonstrate the acceptance
 * invariant: $0, grade C, three numbers still to gather.
 */

function snapshotOf(factors: WorkspaceFactor[], at: string): Snapshot {
  const roi = computeProjectROI(factors);
  return {
    at,
    netOneTime: roi.netOneTime,
    netRecurringAnnual: roi.netRecurringAnnual,
    adjustmentMultiplier: roi.adjustmentMultiplier,
    grade: roi.grade,
    hasUnknowns: roi.hasUnknowns,
  };
}

const PROPOSAL_BASIS: RoiModel = {
  summary: "Drafts and assembles RFP / proposal responses from the win-history corpus.",
  comparables: [
    { name: "Loopio", url: "https://www.loopio.com/", annual: 30_000, basis: "RFP software, representative" },
    { name: "Responsive", url: "https://www.responsive.io/", annual: 35_000, basis: "RFP platform, representative" },
  ],
  manual: [{ task: "Team hand-writing proposal responses", hoursPerWeek: 8, people: 2, rate: 90 }],
  buildHours: 200,
  buildRate: 100,
};

const GDNA_BASIS: RoiModel = {
  summary: "AI narrative reporting inside GivingDNA — donor analytics summaries drafted automatically.",
  comparables: [
    { name: "Power BI (report authoring seats)", url: "https://www.microsoft.com/power-platform/products/power-bi/pricing", annual: 6_000, basis: "$10/user/mo × 50 users" },
  ],
  manual: [{ task: "Analysts assembling client donor reports", hoursPerWeek: 6, people: 2, rate: 90 }],
  buildHours: 0, // build not yet scoped — cost stays unknown on purpose
  buildRate: 100,
};

function proposalAssistant(): Initiative {
  let factors = applyModel(standardFactorTemplate(), PROPOSAL_BASIS);
  factors = factors.map((f) => {
    if (f.key === "time_saved_cashable")
      return { ...f, status: "confirmed" as const, confidence: "B" as const, gatherOwner: "S. Whitfield" };
    if (f.key === "license_avoidance" || f.key === "fully_loaded_build_cost" || f.key === "human_in_loop_residual")
      return { ...f, confidence: "B" as const };
    if (f.key === "traditional_build_baseline")
      return { ...f, value: 45_000, status: "estimated" as const, confidence: "B" as const, evidence: "Agency quote, spring 2026" };
    if (f.key === "realism") return { ...f, selectedOption: "Realistic", status: "estimated" as const };
    return f;
  });

  const base: Initiative = {
    id: "proposal-draft-assistant",
    name: "Proposal Draft Assistant",
    type: "new_build",
    summary: PROPOSAL_BASIS.summary,
    factors,
    thread: [
      {
        id: "m1",
        author: "Barry M.",
        kind: "human",
        at: "2026-07-14T15:02:00Z",
        body: "Kicking this off — proposal team spends most of Thursday assembling responses by hand. Can we get the ROI basis cited before Friday's leadership sync?",
      },
      {
        id: "m2",
        author: "S. Whitfield",
        kind: "human",
        at: "2026-07-15T09:40:00Z",
        body: "Confirmed the time-saved line against last quarter's timesheets: 8h/wk × 2 people is real, marked it confirmed at B.",
      },
    ],
    tasks: [],
    activity: [],
    snapshots: [snapshotOf(factors, "2026-07-15T09:41:00Z")],
    createdAt: "2026-07-14T15:00:00Z",
  };
  base.thread.push({
    id: "m3",
    author: "ROI Analyst",
    kind: "agent",
    at: "2026-07-15T09:42:00Z",
    body: roiAnalystMessage(base),
  });
  return base;
}

function gdnaReporting(): Initiative {
  let factors = applyModel(standardFactorTemplate(), GDNA_BASIS);
  factors = factors.map((f) => {
    // Build not scoped yet: cost + human-in-loop stay unknown (grade capped at C).
    if (f.key === "fully_loaded_build_cost")
      return { ...f, value: null, status: "unknown" as const, confidence: null, evidence: "Needs scoping session with GivingDNA eng", gatherOwner: "M. Okafor" };
    if (f.key === "human_in_loop_residual")
      return { ...f, value: null, status: "unknown" as const, confidence: null, evidence: "Depends on review workflow design", gatherOwner: "P. Raman" };
    return f;
  });

  const base: Initiative = {
    id: "gdna-ai-reporting",
    name: "AI Reporting inside GivingDNA",
    type: "ai_iteration",
    summary: GDNA_BASIS.summary,
    factors,
    thread: [
      {
        id: "m1",
        author: "Barry M.",
        kind: "human",
        at: "2026-07-16T14:10:00Z",
        body: "Iteration on the existing GivingDNA product — add AI-drafted donor narrative reports. Savings basis looks solid; we still owe a build estimate.",
      },
    ],
    tasks: [],
    activity: [],
    snapshots: [snapshotOf(factors, "2026-07-16T14:11:00Z")],
    createdAt: "2026-07-16T14:00:00Z",
  };
  base.thread.push({
    id: "m2",
    author: "ROI Analyst",
    kind: "agent",
    at: "2026-07-16T14:12:00Z",
    body: roiAnalystMessage(base),
  });
  return base;
}

function dedupeService(): Initiative {
  const factors = standardFactorTemplate();
  return {
    id: "donor-data-dedupe",
    name: "Donor Data Dedupe Service",
    type: "new_build",
    summary: "Candidate: automated donor-record dedupe across client CRMs. Nothing entered yet — numbers to gather.",
    factors,
    thread: [
      {
        id: "m1",
        author: "Barry M.",
        kind: "human",
        at: "2026-07-18T10:30:00Z",
        body: "Parking this idea here so we can size it. Fresh template — note it correctly shows $0 until someone brings evidence.",
      },
    ],
    tasks: [],
    activity: [],
    snapshots: [snapshotOf(factors, "2026-07-18T10:31:00Z")],
    createdAt: "2026-07-18T10:30:00Z",
  };
}

export function seedInitiatives(): Initiative[] {
  return [proposalAssistant(), gdnaReporting(), dedupeService()];
}

/**
 * Client-account seed — deliberately mirrors the manager's sample wireframe
 * ("ABC Foodbank of the Southeast") so the build is checkable against it,
 * with dates shifted into the demo window.
 */
export function seedAccounts(): import("./types.js").ClientAccount[] {
  const t = (id: string, title: string, ownerName: string, due: string, status: "todo" | "doing" | "done", label?: string): import("./types.js").Task => ({
    id,
    title,
    ownerName,
    due,
    ...(label ? { label } : {}),
    status,
    source: "manual",
    createdAt: "2026-07-01T09:00:00Z",
  });
  const f = (id: string, name: string, kind: "file" | "doc"): import("./types.js").ClientFileLink => ({
    id,
    name,
    kind,
    addedAt: "2026-07-10T09:00:00Z",
  });
  return [
    {
      id: "acct-abc-foodbank",
      clientName: "ABC Foodbank of the Southeast",
      members: [
        { personId: "u-503", name: "Priya Raman", title: "Senior Project Manager" },
        { personId: "u-501", name: "Dana Whitfield", title: "Creative Director" },
        { personId: "u-502", name: "Marcus Okafor", title: "Digital Strategist" },
      ],
      externals: [
        { id: "ext-1", name: "Maria Ruiz", org: "ABC Foodbank", role: "client", access: "workspace", invitedBy: "Priya Raman", lastActive: "2026-07-19", addedAt: "2026-06-01T09:00:00Z" },
        { id: "ext-2", name: "R. Delgado", org: "FreelanceCopy Co.", role: "contractor", access: "files-only", invitedBy: "Dana Whitfield", lastActive: "2026-07-14", addedAt: "2026-06-15T09:00:00Z" },
      ],
      clientContacts: 8,
      campaigns: [
        { id: "cmp-1", name: "Fall Acquisition Mail", status: "active", nextMilestone: "In-home date", nextMilestoneDate: "2026-10-12" },
        { id: "cmp-2", name: "Sustainer Email Series", status: "active", nextMilestone: "August send", nextMilestoneDate: "2026-08-05" },
        { id: "cmp-3", name: "GivingTuesday Digital", status: "planned", nextMilestone: "Kickoff", nextMilestoneDate: "2026-09-01" },
        { id: "cmp-4", name: "Annual Appeal", status: "active", nextMilestone: "Copy approval", nextMilestoneDate: "2026-07-28" },
        { id: "cmp-5", name: "Donor Care Journey", status: "active", nextMilestone: "Journey map review", nextMilestoneDate: "2026-08-12" },
      ],
      notifications: [
        { id: "n1", text: "Weekly Marketing Sync on Friday at 10:00 AM. Please be ready with campaign performance updates and upcoming priorities.", at: "2026-07-20T08:00:00Z" },
        { id: "n2", text: "Client Feedback Meeting rescheduled to Thursday at 2:00 PM. We'll review the latest creative concepts.", at: "2026-07-19T16:00:00Z" },
        { id: "n3", text: "Reminder: Submit your time entries by end of day Friday for payroll.", at: "2026-07-19T09:00:00Z" },
      ],
      tasks: [
        t("ct-1", "Develop DM Creative", "Jen M.", "2026-07-24", "todo", "creative"),
        t("ct-2", "Update Donor List", "Eric S.", "2026-07-27", "todo", "data"),
        t("ct-3", "Landing Page A/B Test", "Corrine D.", "2026-07-25", "doing", "digital"),
        t("ct-4", "Email Sequence Draft", "Amy W.", "2026-07-26", "doing", "digital"),
        t("ct-5", "June Campaign Report", "Tom A.", "2026-07-08", "done", "reporting"),
        t("ct-6", "Annual Appeal Launch", "Priya R.", "2026-07-15", "done"),
      ],
      thread: [
        { id: "cm-3", author: "Tim Arnold", kind: "human", at: "2026-07-16T10:00:00Z", body: "New CRM Integration Ideas? — worth a spike on syncing donor care flags before GivingTuesday." },
        { id: "cm-2", author: "Kathi Batr", kind: "human", at: "2026-07-18T14:30:00Z", body: "Copy Approval Needed ASAP! — Annual Appeal letter v3 is with the client; need sign-off before print slot on the 28th." },
        { id: "cm-1", author: "Alyssa Boger", kind: "human", at: "2026-07-19T15:00:00Z", body: "Client Call Recap: Key Actions — 1) refresh donor list before DM drop, 2) A/B the landing page headline, 3) client wants monthly impact one-pager." },
      ],
      files: [
        f("cf-1", "DonateNow_Creative_Final.pptx", "file"),
        f("cf-2", "ARP_Tracking_Report.xlsx", "file"),
        f("cf-3", "ParentsAsTeachers_Brief.docx", "file"),
        f("cf-4", "Core (Planner)", "file"),
      ],
      docs: [
        f("cd-1", "Project Brief & Strategy", "doc"),
        f("cd-2", "Creative Guidelines", "doc"),
        f("cd-3", "Client Intake Form", "doc"),
        f("cd-4", "Team Contact List", "doc"),
      ],
      activity: [
        { id: "ca-1", at: "2026-07-19T15:01:00Z", text: "Client call recap posted — three follow-ups captured as tasks", kind: "workspace" },
      ],
      createdAt: "2026-06-01T09:00:00Z",
    },
  ];
}

export function seedIdeas(): import("./types.js").SandboxIdea[] {
  const title = "Grant Report Generator";
  const pitch =
    "Program teams at our nonprofit clients spend days assembling grant compliance reports by hand. What if we drafted them automatically from campaign outcomes and GivingDNA donor analytics data? Not tied to any current product — just an idea.";
  // The copilot drafts the idea exactly as it would live — the seed IS the demo.
  const draft = draftFromIdea(title, pitch, "2026-07-20");
  return [
    {
      id: "idea-grant-report",
      title,
      aiMode: "copilot",
      pitch,
      basis: draft.basis,
      plan: draft.plan,
      team: draft.team,
      classification: draft.classification,
      relatedProjects: draft.relatedProjects,
      relatedCampaigns: draft.relatedCampaigns,
      thread: [
        {
          id: "m1",
          author: "Barry M.",
          kind: "human",
          at: "2026-07-17T11:00:00Z",
          body: "Dropping this in the sandbox after the Riverside call — their program officer said reporting eats a week per grant cycle. Worth sizing?",
        },
        {
          id: "m2",
          author: "AGP Copilot",
          kind: "agent",
          at: "2026-07-17T11:00:05Z",
          body: draft.briefing,
        },
      ],
      status: "exploring",
      // Unreviewed on purpose — the seed demos the draft-review panel.
      reviewed: false,
      createdAt: "2026-07-17T11:00:00Z",
    },
    {
      id: "idea-client-portal",
      title: "Client Portal Refresh",
      aiMode: "observer",
      pitch: "Rethink how clients see campaign status — working this one out ourselves first.",
      basis: { summary: "Rethink how clients see campaign status.", comparables: [], manual: [], buildHours: 0, buildRate: 100 },
      team: [],
      classification: { clientNames: [] },
      relatedProjects: [],
      relatedCampaigns: [],
      thread: [
        {
          id: "m1",
          author: "Barry M.",
          kind: "human",
          at: "2026-07-18T09:00:00Z",
          body: "Starting this one blank — I want us to shape it before any drafting happens. Dana, what's the smallest version clients would love?",
        },
        {
          id: "m2",
          author: "Dana W.",
          kind: "human",
          at: "2026-07-18T09:25:00Z",
          body: "A single page per campaign: status, next milestone, and one number that matters. No logins to hunt through.",
        },
      ],
      status: "exploring",
      reviewed: true,
      createdAt: "2026-07-18T09:00:00Z",
    },
  ];
}
