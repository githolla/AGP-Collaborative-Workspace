import type { ClientTab } from "../components/ClientWorkspace.js";

/**
 * What the feedback button is looking at.
 *
 * A generic "send feedback" box gets generic feedback — "it's fine", "bit
 * confusing" — which tells you nothing you can act on. So the button reads the
 * surface the person is actually on and asks about *that*, with the client's
 * name in the prompt where there is one. The answer arrives already labelled
 * with where it came from, which is the part that usually goes missing when
 * feedback is collected by email.
 */

export interface PageQuestion {
  /** Stable id, stored as the feedback's stepKey. `page:` distinguishes these
   * from tour answers (`welcome`, `directory`, …) in the same table. */
  key: string;
  /** Human label — what the admin roll-up and the CSV's Step column show. */
  label: string;
  prompt: string;
  options: { key: string; label: string }[];
  placeholder: string;
}

export interface PageLocation {
  view: "clients" | "account" | "initiative" | "idea" | "admin" | "teams-config";
  /** Active tab when the view is a client workspace. */
  tab?: ClientTab;
  /** Client or initiative name, woven into the prompt when known. */
  subject?: string;
}

const YES_NO = (yes: string, mid: string, no: string) => [
  { key: "a", label: yes },
  { key: "b", label: mid },
  { key: "c", label: no },
];

/** Per-tab questions for a client workspace — the bulk of the surface area. */
const ACCOUNT: Record<ClientTab, Omit<PageQuestion, "key" | "prompt"> & { prompt: (who: string) => string }> = {
  home: {
    label: "Client workspace · Home",
    prompt: (who) => `Opening ${who}, is this what you need to see first?`,
    options: YES_NO("Yes — this is the right landing", "Close, but I'd reorder it", "No — I'd want something else here"),
    placeholder: "What would you put front and centre instead?",
  },
  plan: {
    label: "Client workspace · Plan",
    prompt: (who) => `Does this plan match how ${who} actually runs?`,
    options: YES_NO("Yes — that's the work", "Roughly, with gaps", "No — this isn't the real plan"),
    placeholder: "What's missing, wrong, or in the wrong order?",
  },
  resourcing: {
    label: "Client workspace · Resourcing",
    prompt: () => "Would this keep your weekly resourcing current as timelines shift?",
    options: YES_NO("Yes — this saves the weekly redo", "Partly — I'd still tweak a lot", "No — this doesn't fit how we resource"),
    placeholder: "What would have to be true to trust these numbers into Kantata?",
  },
  dashboard: {
    label: "Client workspace · Client dashboard",
    prompt: (who) => `Would you be comfortable showing this view to ${who}?`,
    options: YES_NO("Yes — I'd share it as is", "Only after trimming something", "No — not client-ready"),
    placeholder: "What would you have to remove or add first?",
  },
  files: {
    label: "Client workspace · Files",
    prompt: () => "Is this how you'd want to share documents with clients and contractors?",
    options: YES_NO("Yes — this would replace what I do now", "Partly — I'd still use something else", "No — this doesn't fit how we share"),
    placeholder: "What do you do today that this doesn't cover?",
  },
  discussions: {
    label: "Client workspace · Discussions",
    prompt: () => "Would conversations here be better than the email thread they'd replace?",
    options: YES_NO("Yes — I'd move them here", "For some things, not all", "No — email still wins"),
    placeholder: "What would have to be true for you to move a real thread here?",
  },
  sandbox: {
    label: "Client workspace · Sandbox",
    prompt: (who) => `Is this a useful place to shape an idea for ${who}?`,
    options: YES_NO("Yes — I'd draft here", "Maybe, with changes", "No — I'd work it out elsewhere"),
    placeholder: "What would make this worth opening?",
  },
  access: {
    label: "Client workspace · Access",
    prompt: (who) => `Is there enough control here to let someone outside AGP into ${who}?`,
    options: YES_NO("Yes — I'd invite someone today", "Nearly — one more safeguard", "No — I wouldn't risk it"),
    placeholder: "What would you need to see before inviting a client or contractor?",
  },
};

const CLIENTS: PageQuestion = {
  key: "page:clients",
  label: "Client directory",
  prompt: "Is this list what you'd expect your book of business to look like?",
  options: YES_NO("Yes — that's the book", "Mostly, with things wrong or missing", "No — this doesn't look right"),
  placeholder: "Which clients are wrong, missing, or duplicated?",
};

const INITIATIVE: PageQuestion = {
  key: "page:initiative",
  label: "Initiative · ROI workspace",
  prompt: "Would these numbers stand up if you put them in front of a decision-maker?",
  options: YES_NO("Yes — I'd present this", "Not without checking some inputs", "No — the numbers don't convince me"),
  placeholder: "Which number would you challenge first, and why?",
};

const IDEA: PageQuestion = {
  key: "page:idea",
  label: "Sandbox · Idea draft",
  prompt: "Did the draft capture what you actually meant?",
  options: YES_NO("Yes — close to what I had in mind", "Partly — I had to correct it", "No — it missed the point"),
  placeholder: "What did it get wrong?",
};

/**
 * The question for wherever the person currently is. Returns null on surfaces
 * where asking makes no sense — the admin page is reading feedback, not
 * giving it.
 */
export function questionFor(loc: PageLocation): PageQuestion | null {
  // No prompt where asking makes no sense: the admin page is for reading
  // feedback, and the Teams config screen belongs to Teams' own dialog.
  if (loc.view === "admin" || loc.view === "teams-config") return null;
  if (loc.view === "clients") return CLIENTS;
  if (loc.view === "initiative") return INITIATIVE;
  if (loc.view === "idea") return IDEA;

  const tab = loc.tab ?? "home";
  const spec = ACCOUNT[tab];
  // "this client" keeps the prompt readable when the name hasn't loaded yet.
  const who = loc.subject?.trim() || "this client";
  return {
    key: `page:account.${tab}`,
    label: spec.label,
    prompt: spec.prompt(who),
    options: spec.options,
    placeholder: spec.placeholder,
  };
}

/** Where the answer came from, shown on the panel so people can see what
 * they're commenting on before they write. */
export function locationLabel(loc: PageLocation, question: PageQuestion): string {
  return loc.view === "account" && loc.subject ? `${question.label} — ${loc.subject}` : question.label;
}
