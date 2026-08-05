/**
 * Workspace templates (Collab Hub Must: "ability to apply a template …
 * for consistent set up"). The workspace ITSELF comes from the standard
 * template at creation; these are the service-line playbooks an account
 * lead applies inside it — a dated task skeleton for how AGP actually runs
 * each kind of engagement, so no plan starts from a blank page.
 *
 * Pure data + a pure instantiation function: client-safe (no financials),
 * testable, and shared by the store and the UI.
 */

export interface TemplateTask {
  title: string;
  /** Days after the chosen start date. */
  offsetDays: number;
}

export interface WorkspaceTemplate {
  key: string;
  name: string;
  /** Which AGP service line this playbook mirrors. */
  serviceLine: string;
  description: string;
  tasks: TemplateTask[];
}

export const TEMPLATES: WorkspaceTemplate[] = [
  {
    key: "direct-mail",
    name: "Direct Mail Campaign",
    serviceLine: "Direct Mail",
    description: "Kickoff → data → creative → proofs → print window → in-home → results.",
    tasks: [
      { title: "Kickoff & campaign brief", offsetDays: 0 },
      { title: "Data pull & donor segmentation", offsetDays: 7 },
      { title: "Ask-string matrix", offsetDays: 10 },
      { title: "Creative concepts", offsetDays: 14 },
      { title: "Copy & design review with client", offsetDays: 21 },
      { title: "Variable-data programming", offsetDays: 28 },
      { title: "Proofs approved by client", offsetDays: 35 },
      { title: "Print production window", offsetDays: 42 },
      { title: "Mail drop — in-home date", offsetDays: 56 },
      { title: "Results readout", offsetDays: 84 },
    ],
  },
  {
    key: "digital-fundraising",
    name: "Digital Fundraising Program",
    serviceLine: "Digital Fundraising",
    description: "Audience mapping → email series → landing pages → launch → readout.",
    tasks: [
      { title: "Kickoff & goals alignment", offsetDays: 0 },
      { title: "Audience & journey mapping", offsetDays: 5 },
      { title: "Email series drafts", offsetDays: 12 },
      { title: "Landing page build", offsetDays: 14 },
      { title: "A/B test plan", offsetDays: 18 },
      { title: "Program launch", offsetDays: 25 },
      { title: "First performance readout", offsetDays: 55 },
    ],
  },
  {
    key: "givingdna-onboarding",
    name: "GivingDNA Onboarding",
    serviceLine: "GivingDNA",
    description: "Access → data mapping → records load → screening model → training → insights.",
    tasks: [
      { title: "Kickoff & platform access", offsetDays: 0 },
      { title: "Data mapping workshop", offsetDays: 7 },
      { title: "Constituent records load", offsetDays: 14 },
      { title: "Screening model v1", offsetDays: 28 },
      { title: "Client team training", offsetDays: 35 },
      { title: "First insights readout", offsetDays: 42 },
    ],
  },
  {
    key: "web-development",
    name: "Website Design & Development",
    serviceLine: "Web Development",
    description: "Discovery → IA & design → build → content → QA & accessibility → UAT → launch → hypercare.",
    tasks: [
      // Cara flagged web-dev as the one engagement the standard playbooks don't
      // fit — a design/build lifecycle with client sign-off gates, not a
      // mail/campaign cadence. The dates are the typical AGP mid-size build.
      { title: "Kickoff, goals & success metrics", offsetDays: 0 },
      { title: "Discovery & requirements workshop", offsetDays: 7 },
      { title: "Information architecture & sitemap — client sign-off", offsetDays: 18 },
      { title: "Wireframes — client review", offsetDays: 28 },
      { title: "Visual design comps — client sign-off", offsetDays: 42 },
      { title: "Front-end build & CMS setup", offsetDays: 63 },
      { title: "Content migration & entry", offsetDays: 77 },
      { title: "QA, cross-browser & accessibility (WCAG) audit", offsetDays: 84 },
      { title: "Client UAT & revisions", offsetDays: 91 },
      { title: "Launch & DNS cutover", offsetDays: 98 },
      { title: "Post-launch hypercare & handoff", offsetDays: 112 },
    ],
  },
  {
    key: "mid-major-gifts",
    name: "Mid-Major Gifts Sprint",
    serviceLine: "Mid-Major Gifts",
    description: "Discovery → screening → portfolio → officer toolkit → pilot outreach → demo.",
    tasks: [
      { title: "Discovery sprint & data mapping", offsetDays: 0 },
      { title: "Wealth screening alignment", offsetDays: 10 },
      { title: "Portfolio build", offsetDays: 21 },
      { title: "Gift officer toolkit", offsetDays: 28 },
      { title: "Pilot outreach wave", offsetDays: 35 },
      { title: "Sprint demo & next-phase decision", offsetDays: 42 },
    ],
  },
];

/** Template + start date → dated task drafts (ISO due dates). */
export function instantiateTemplate(
  template: WorkspaceTemplate,
  startDate: string,
): { title: string; due: string }[] {
  const base = new Date(`${startDate}T00:00:00Z`).getTime();
  return template.tasks.map((t) => ({
    title: t.title,
    due: new Date(base + t.offsetDays * 86_400_000).toISOString().slice(0, 10),
  }));
}
