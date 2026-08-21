/**
 * Maps a caught error from a `withUserContext` block to an API response.
 *
 * Postgres raises SQLSTATE 42501 (insufficient_privilege) when a `WITH CHECK`
 * clause rejects an INSERT/UPDATE — this is genuinely an RLS access refusal,
 * not a server fault, so it maps to 403 forbidden rather than the generic 500
 * every other unexpected error gets. This only matters for writes: SELECT and
 * UPDATE row-visibility denials never throw at all (they silently return zero
 * rows), which is why every endpoint's read/update-miss path already returns
 * 404 on its own — this helper exists for the cases Postgres does throw for:
 * an INSERT (or an UPDATE's RETURNING-vs-SELECT-policy check) that WITH CHECK
 * actively refuses, and the schema's own CHECK/UNIQUE/FK constraints, which
 * are real, named validation rules — not infrastructure failures — so a
 * caller sending a bad enum value or a duplicate grant deserves a clean 4xx,
 * not the same internal_error a dropped connection would produce.
 *
 * P0002 (no_data_found) is not a Postgres-native error — it's raised
 * deliberately by collab.set_message_visibility() (0011) for "no such
 * message", the one write path in this schema that goes through a plpgsql
 * function instead of a plain INSERT/UPDATE/DELETE and so can't rely on
 * RETURNING's implicit row count the way every other endpoint's not_found
 * path does.
 */
const PG_CODE = {
  insufficientPrivilege: "42501",
  uniqueViolation: "23505",
  foreignKeyViolation: "23503",
  checkViolation: "23514",
  noDataFound: "P0002",
} as const;

export function toApiError(err: unknown): { status: number; body: { error: { code: string; message: string } } } {
  const code = err instanceof Error && "code" in err ? (err as { code?: unknown }).code : undefined;
  const message = err instanceof Error ? err.message : "unexpected error";

  switch (code) {
    case PG_CODE.insufficientPrivilege:
      return { status: 403, body: { error: { code: "forbidden", message: "not allowed to perform this action" } } };
    case PG_CODE.uniqueViolation:
      return { status: 409, body: { error: { code: "conflict", message: "already exists" } } };
    case PG_CODE.foreignKeyViolation:
      return { status: 400, body: { error: { code: "validation_failed", message: "referenced id does not exist" } } };
    case PG_CODE.checkViolation:
      return { status: 400, body: { error: { code: "validation_failed", message } } };
    case PG_CODE.noDataFound:
      return { status: 404, body: { error: { code: "not_found", message } } };
    default:
      return { status: 500, body: { error: { code: "internal_error", message } } };
  }
}
