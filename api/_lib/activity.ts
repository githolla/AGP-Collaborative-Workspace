/**
 * `collab.activity` — the internal "what's new" feed (Home's WhatsNew card),
 * migrated off the old model's inline `activityEvent()` helper (store.ts),
 * which pushed one entry onto `account.activity` inside nearly every
 * mutator. This is the same idea, one insert per call, done from inside the
 * SAME transaction as the mutation it describes — never a separate round
 * trip, so a failed mutation can never leave an orphaned activity row.
 *
 * Append-only, like `collab.share` — no update/delete policy exists on this
 * table (0008), matching the old model's own "never rewrite history" rule.
 */
import type postgres from "postgres";

export async function logActivity(
  tx: postgres.TransactionSql,
  accountId: string,
  text: string,
  kind: "task" | "roi" | "team" | "workspace",
): Promise<void> {
  await tx`insert into collab.activity (account_id, text, kind) values (${accountId}, ${text}, ${kind})`;
}
