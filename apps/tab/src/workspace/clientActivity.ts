/**
 * Is a client still live work, or history?
 *
 * The directory derives clients from every project the Kantata pull returns,
 * which includes work that finished two years ago — so it reads ~165 against
 * AGP's active book of ~128. Nothing about that is wrong, it just answers
 * "everyone we have ever worked with" when the question people are asking is
 * "who are we working with now".
 *
 * AGP encodes the cycle in the project title, consistently, so the title is
 * the strongest signal available and needs no extra API call. Dates back it up
 * where a title carries no year.
 */

/**
 * AGP's fiscal year runs July–June, and is named for the calendar year it
 * ENDS in: "Howard: FY27 (Jul26-Jun27)", "EWTN FY26 (Jul25)". So July 2026
 * onwards is FY27.
 */
export function fiscalYearOn(isoDate: string): number {
  const y = Number(isoDate.slice(0, 4));
  const m = Number(isoDate.slice(5, 7));
  if (!Number.isFinite(y) || !Number.isFinite(m)) return 0;
  return m >= 7 ? y + 1 : y;
}

const two = (s: string): number => {
  const n = Number(s);
  return n >= 70 ? 1900 + n : 2000 + n;
};

/**
 * The LATEST year a project title implies, as a fiscal year. Handles the forms
 * that actually occur in the tenant:
 *   FY26 · FY26/27 · FY26-27 · '25-'26 · 2025-27 · 2026 · (Jul26-Jun27)
 * Returns undefined when the title carries no year at all — an "Ongoing
 * Support" title is dated by its records, not its name.
 */
export function titleFiscalYear(title: string): number | undefined {
  const t = title.toLowerCase();
  let best = 0;

  // FY26, FY26/27, FY26-27, FY2026 — take the highest year mentioned.
  for (const m of t.matchAll(/fy\s?'?(\d{2,4})(?:\s?[-/–]\s?'?(\d{2,4}))?/g)) {
    for (const raw of [m[1], m[2]]) {
      if (!raw) continue;
      best = Math.max(best, raw.length <= 2 ? two(raw) : Number(raw));
    }
  }
  // Bare calendar years: "2026 Ongoing Services", "2025-27 Ongoing Support".
  for (const m of t.matchAll(/\b((?:19|20)\d{2})\s?(?:[-/–]\s?((?:19|20)?\d{2}))?/g)) {
    const a = Number(m[1]);
    // A calendar year is not a fiscal year, but a project running through
    // calendar 2026 is live in FY26 or FY27 — treat it as FY(year+1) so a
    // "2026 Ongoing" project isn't mistaken for history.
    best = Math.max(best, a + 1);
    if (m[2]) best = Math.max(best, (m[2].length <= 2 ? two(m[2]) : Number(m[2])) + 1);
  }
  // Month-year spans: "(Jul26-Jun27)", "(Sep26-Aug27)", "(Aug25-Jul26)".
  // The later calendar year in the span IS the fiscal year — no offset. Not
  // every client's cycle is Jul–Jun (IdahoPTV runs Sep–Aug), so mapping each
  // month to a fiscal year individually would put "Sep26-Aug27" in FY28.
  for (const m of t.matchAll(/\b[a-z]{3}\s?'?(\d{2})\b/g)) {
    if (m[1]) best = Math.max(best, two(m[1]));
  }
  return best > 0 ? best : undefined;
}

/** Per-client activity evidence, accumulated as projects are classified. */
export interface ActivityEvidence {
  /** Highest fiscal year seen across this client's project titles. */
  latestFiscalYear?: number;
  /** Latest due/start date seen, ISO. */
  latestDate?: string;
}

export function noteActivity(prev: ActivityEvidence, title: string, dates: (string | undefined)[]): ActivityEvidence {
  const next: ActivityEvidence = { ...prev };
  const fy = titleFiscalYear(title);
  if (fy && fy > (next.latestFiscalYear ?? 0)) next.latestFiscalYear = fy;
  for (const d of dates) {
    if (d && d.length >= 10 && d > (next.latestDate ?? "")) next.latestDate = d.slice(0, 10);
  }
  return next;
}

/**
 * Active = work in the current fiscal year or the one just gone. The prior
 * year is included deliberately: an annual client whose FY27 work hasn't been
 * booked yet is dormant on paper for a few weeks every summer, and dropping
 * them out of the directory in that window would be wrong.
 *
 * A client with no year evidence at all counts as active — silence is not
 * proof of inactivity, and hiding a real client is a worse error than showing
 * a stale one.
 */
export function isActiveClient(ev: ActivityEvidence, today: string): boolean {
  const currentFY = fiscalYearOn(today);
  if (ev.latestFiscalYear != null) return ev.latestFiscalYear >= currentFY - 1;
  if (ev.latestDate) return fiscalYearOn(ev.latestDate) >= currentFY - 1;
  return true;
}
