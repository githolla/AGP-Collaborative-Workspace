/**
 * Handoff templates (client call — Kellie): when a job moves from one phase
 * or person to the next, the same email goes out every time with the same
 * links attached (strategy doc, copy framework, assets). Standardizing them
 * removes the "hope everyone remembers what to include" problem and makes the
 * handoff a one-click, consistent post to the project's discussion.
 *
 * Pure data + a pure fill function: client-safe (no financials), testable,
 * shared by the store and the UI.
 */

export interface HandoffTemplate {
  key: string;
  /** The moment this handoff happens. */
  name: string;
  /** One-line context shown under the name. */
  when: string;
  /** The message body. `{client}` is substituted; leave a blank line for notes. */
  body: string;
  /** The links/attachments this handoff should always carry. */
  include: string[];
}

export const HANDOFFS: HandoffTemplate[] = [
  {
    key: "to-copywriting",
    name: "Ready for copywriting",
    when: "Strategy approved → hand to the copywriter",
    body:
      "This job is ready to move into copywriting. The strategy is approved and the framework is set — everything you need is linked below.\n\nPlease confirm receipt and your target date for first draft.",
    include: ["Copy document framework", "Strategy document", "Assets / research folder"],
  },
  {
    key: "to-design",
    name: "Ready for design",
    when: "Copy approved → hand to design",
    body:
      "Copy is approved and ready for design. Links to the approved copy and brand assets are below.\n\nFlag any questions on layout or length before you start.",
    include: ["Approved copy document", "Brand / style guidelines", "Assets folder"],
  },
  {
    key: "client-review",
    name: "Client review requested",
    when: "Draft ready → send to the client for feedback",
    body:
      "A draft is ready for {client}'s review. Please take a look at the linked document and share feedback by the due date noted in the plan.\n\nWe'll incorporate your notes and confirm next steps.",
    include: ["Document for review", "Where to leave feedback", "Feedback due date"],
  },
  {
    key: "to-production",
    name: "Ready for production / mail day",
    when: "Final approval → into production",
    body:
      "Final files are approved and this is moving into production. Production details and the approved files are linked below.\n\nConfirm the in-home / drop date and any quantities.",
    include: ["Approved final files", "Production specs", "Drop / in-home date"],
  },
];

/** Fill a template for a client — substitute {client} and append the include
 * checklist as a reminder of what to attach before posting. */
export function fillHandoff(t: HandoffTemplate, clientName: string): string {
  const body = t.body.replace(/\{client\}/g, clientName);
  const links = t.include.map((i) => `• ${i}: [ paste link ]`).join("\n");
  return `${body}\n\nInclude:\n${links}`;
}

/** The project context that personalizes a handoff to a specific piece of work. */
export interface HandoffContext {
  clientName: string;
  /** The project/campaign the handoff is about. */
  project?: string;
  /** The task the handoff is triggered from. */
  taskTitle?: string;
  /** ISO due date, if any. */
  dueDate?: string;
  /** The task/handoff owner. */
  ownerName?: string;
}

/** Suggest the handoff that fits a task, by its title — so the right template
 * pops on the task itself (e.g. a "Copy review" task → the copywriting handoff). */
export function suggestHandoff(taskTitle: string): HandoffTemplate | undefined {
  const t = taskTitle.toLowerCase();
  // Review wins over the raw word "copy"/"design" — a "copy review" is a review.
  if (/review|feedback|approv|client sign|proof/.test(t)) return HANDOFFS.find((h) => h.key === "client-review");
  if (/print|\bmail\b|production|drop|in-home|deploy|launch|fulfill/.test(t)) return HANDOFFS.find((h) => h.key === "to-production");
  if (/copywrit|\bcopy\b|messaging|content/.test(t)) return HANDOFFS.find((h) => h.key === "to-copywriting");
  if (/design|creative|layout|\bart\b|graphic/.test(t)) return HANDOFFS.find((h) => h.key === "to-design");
  return undefined;
}

function shortDate(iso?: string): string {
  if (!iso) return "";
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * Personalize a handoff to the specific project/task — names the work, the
 * date, and the owner, so it reads like a real message about *this* job rather
 * than a generic template. (When the server AI key is set, this becomes the
 * grounding context for an LLM rewrite; until then it's the deterministic,
 * always-correct fill.)
 */
export function personalizeHandoff(t: HandoffTemplate, ctx: HandoffContext): string {
  const parts: string[] = [t.body.replace(/\{client\}/g, ctx.clientName)];
  const specifics: string[] = [];
  if (ctx.taskTitle) specifics.push(`This is for “${ctx.taskTitle}”${ctx.project ? ` on ${ctx.project}` : ""}.`);
  else if (ctx.project) specifics.push(`This is for ${ctx.project}.`);
  const due = shortDate(ctx.dueDate);
  if (due) specifics.push(`Target date: ${due}.`);
  if (ctx.ownerName) specifics.push(`Owner: ${ctx.ownerName}.`);
  if (specifics.length > 0) parts.push(specifics.join(" "));
  parts.push(`Include:\n${t.include.map((i) => `• ${i}: [ paste link ]`).join("\n")}`);
  return parts.join("\n\n");
}
