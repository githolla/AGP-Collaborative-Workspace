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

/** Fill a template for a client — substitute {client} and prepend the include
 * checklist as a reminder of what to attach before posting. */
export function fillHandoff(t: HandoffTemplate, clientName: string): string {
  const body = t.body.replace(/\{client\}/g, clientName);
  const links = t.include.map((i) => `• ${i}: [ paste link ]`).join("\n");
  return `${body}\n\nInclude:\n${links}`;
}
