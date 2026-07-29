import type { TourFeedback } from "./types.js";

/**
 * Tour feedback: export and roll-up. Kept pure and separate from the React
 * surface so the CSV escaping and the tally are testable — a feedback export
 * that quietly mangles a comment containing a comma is worse than no export,
 * because nobody notices until the analysis is already wrong.
 */

/** Columns in export order. Changing this changes every downstream sheet. */
const COLUMNS = [
  "Submitted",
  "Person",
  "Email",
  "Step",
  "Question",
  "Choice",
  "Answer",
  "Comment",
] as const;

/**
 * RFC 4180 escaping: wrap in quotes when the value contains a comma, a quote,
 * or a newline, and double any embedded quotes. Excel and Sheets both read
 * this correctly, including multi-line comments.
 */
function csvCell(value: string): string {
  const v = value ?? "";
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * Serialize responses to CSV, newest first — the order someone reviewing a
 * testing round actually wants. A leading BOM makes Excel honour UTF-8, so
 * names with accents and curly quotes survive the round trip.
 */
export function feedbackToCsv(entries: readonly TourFeedback[]): string {
  const rows = [...entries]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((e) =>
      [
        e.createdAt,
        e.personName,
        e.personEmail,
        e.stepTitle,
        e.prompt,
        e.choice.toUpperCase(),
        e.choiceLabel,
        e.comment,
      ]
        .map(csvCell)
        .join(","),
    );
  return `\uFEFF${[COLUMNS.join(","), ...rows].join("\r\n")}\r\n`;
}

export interface StepTally {
  stepKey: string;
  stepTitle: string;
  prompt: string;
  /** Every option seen for this step, with how many picked it. */
  options: { choice: string; label: string; count: number; percent: number }[];
  /** Free-text answers, newest first — attributed so you can follow up. */
  comments: { at: string; person: string; text: string }[];
  /** Responses that picked an option (comment-only answers don't count). */
  answered: number;
}

/**
 * Roll responses up per step. Options are discovered from the responses
 * themselves rather than from the question definition, so a tally built after
 * the questions were reworded still shows what people actually answered
 * instead of silently dropping it.
 */
export function tallyByStep(entries: readonly TourFeedback[]): StepTally[] {
  const steps = new Map<string, StepTally>();
  const order: string[] = [];

  for (const e of entries) {
    let step = steps.get(e.stepKey);
    if (!step) {
      step = { stepKey: e.stepKey, stepTitle: e.stepTitle, prompt: e.prompt, options: [], comments: [], answered: 0 };
      steps.set(e.stepKey, step);
      order.push(e.stepKey);
    }
    if (e.choice) {
      step.answered += 1;
      const opt = step.options.find((o) => o.choice === e.choice);
      if (opt) opt.count += 1;
      else step.options.push({ choice: e.choice, label: e.choiceLabel, count: 1, percent: 0 });
    }
    if (e.comment.trim()) {
      step.comments.push({ at: e.createdAt, person: e.personName, text: e.comment.trim() });
    }
  }

  for (const step of steps.values()) {
    step.options.sort((a, b) => a.choice.localeCompare(b.choice));
    for (const o of step.options) {
      o.percent = step.answered > 0 ? Math.round((o.count / step.answered) * 100) : 0;
    }
    step.comments.sort((a, b) => b.at.localeCompare(a.at));
  }

  return order.map((k) => steps.get(k)!);
}

/** Distinct people who answered — "12 responses" means less without it. */
export function respondentCount(entries: readonly TourFeedback[]): number {
  return new Set(entries.map((e) => e.personEmail.trim().toLowerCase() || e.personName.trim().toLowerCase())).size;
}
