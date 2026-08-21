/**
 * postgres.js parses a Postgres `date` column into a JS `Date` object (its
 * default type parser for OID 1082), not a string. That's invisible when a
 * value only ever crosses a JSON boundary (`JSON.stringify` calls a Date's
 * `toJSON()`, producing a full ISO timestamp automatically) but breaks the
 * moment a value is used directly in a template literal or string
 * concatenation — that calls `toString()` instead, which is a full
 * human-readable local-time date-and-time string ("Mon Aug 31 2026
 * 20:00:00 GMT-0400..."), not the plain date. And even the JSON path is
 * subtly wrong for a genuine DATE column: a spurious "T00:00:00.000Z" implies
 * a time-of-day that was never stored. This normalizes either case to the
 * plain "YYYY-MM-DD" every `due`/`startDate` field elsewhere in this API
 * (and the client's own Task type) already expects.
 */
export function toDateOnly(value: Date | string | null): string | null {
  if (value === null) return null;
  return (value instanceof Date ? value.toISOString() : value).slice(0, 10);
}
