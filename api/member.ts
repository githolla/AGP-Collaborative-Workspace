/**
 * POST /api/member — `POST /api/account/:id/members`; PATCH /api/member —
 * setting an existing member's email (docs/api-spec-workspace-mutations.md),
 * replacing `addAccountMember` and `addAccountMemberNamed` (NOT
 * `addTeamMember` — despite appearing in the spec's own "Replaces" column,
 * that function operates on an Idea's ROI team, not a client workspace; see
 * `apps/tab/src/workspace/store.ts`'s real definition. Same category of
 * spec/code mismatch as `setClientAccount`, fixed earlier in this doc).
 *
 * The client's `addAccountMember` resolves a Kantata roster id to a
 * name/title client-side (it already holds the live mirror in the browser
 * via /api/mirror). This endpoint does not re-resolve `personId` itself —
 * doing so would need a server-side Kantata roster call, the same category
 * of dependency deferred with the rest of Kantata import — so `name` is
 * always required from the caller; `personId` is accepted when the caller
 * already has a real Kantata id to record, and is generated the same way
 * `addAccountMemberNamed` does (`x-<slugified-name>`) when it isn't given.
 *
 * `email` is optional beyond the spec's literal body shape, added for B5
 * (teams-provisioning-plan.md): resolving someone to a Graph user id and
 * adding them to the Microsoft Team needs an email, and most Kantata-seeded
 * members (0016) never had one recorded at all. PATCH lets an admin add or
 * correct one after the fact — the only field this endpoint permits, since
 * everything else here is Kantata-derived and not this record's to rewrite.
 *
 * IDEMPOTENT BY DESIGN (api-spec rule 5), matching both client functions'
 * own behavior exactly: adding someone already on the team is a no-op
 * success (the existing row comes back with a `note`), never a conflict —
 * checked by personId when given, else by name case-insensitively.
 *
 * RETURNING is safe: account_member_insert's policy is workspace_admin, and
 * account_member_read's policy (can_read_account) always accepts an admin —
 * no bootstrap gap.
 */

import { requireUser } from "./_lib/requireUser.js";
import { withUserContext } from "./_lib/db.js";
import { toApiError } from "./_lib/apiError.js";
import { logActivity } from "./_lib/activity.js";

interface MemberRow {
  id: string;
  account_id: string;
  person_id: string;
  name: string;
  title: string | null;
  email: string | null;
  created_at: string;
}

function toApi(m: MemberRow) {
  return {
    id: m.id,
    accountId: m.account_id,
    personId: m.person_id,
    name: m.name,
    ...(m.title ? { title: m.title } : {}),
    ...(m.email ? { email: m.email } : {}),
    createdAt: m.created_at,
  };
}

function slugify(name: string): string {
  return `x-${name.trim().replace(/\s+/g, "-").toLowerCase()}`;
}

async function handleUpdateEmail(
  body: unknown,
  userId: string,
  res: { status: (code: number) => { json: (body: unknown) => void } },
): Promise<void> {
  const b = body as { memberId?: unknown; email?: unknown };
  const memberId = typeof b.memberId === "string" ? b.memberId : "";
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  if (!memberId || !email) {
    res.status(400).json({ error: { code: "validation_failed", message: "memberId and email are required" } });
    return;
  }

  try {
    const [updated] = await withUserContext(userId, async (tx) => {
      return tx<MemberRow[]>`
        update collab.account_member set email = ${email}
        where id = ${memberId}
        returning id, account_id, person_id, name, title, email, created_at
      `;
    });
    if (!updated) {
      res.status(404).json({ error: { code: "not_found", message: "member not found" } });
      return;
    }
    res.status(200).json({ data: toApi(updated) });
  } catch (err) {
    const { status, body: errBody } = toApiError(err);
    res.status(status).json(errBody);
  }
}

export default async function handler(
  req: { method?: string; body?: unknown; headers?: Record<string, string | string[] | undefined> },
  res: {
    status: (code: number) => { json: (body: unknown) => void };
    setHeader: (k: string, v: string) => void;
  },
): Promise<void> {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST" && req.method !== "PATCH") {
    res.status(405).json({ error: { code: "validation_failed", message: "POST or PATCH" } });
    return;
  }

  const authHeader = typeof req.headers?.authorization === "string" ? req.headers.authorization : undefined;
  const auth = await requireUser(authHeader);
  if (!auth.authorized) {
    res.status(auth.status).json(auth.body);
    return;
  }

  if (req.method === "PATCH") {
    await handleUpdateEmail(req.body, auth.userId!, res);
    return;
  }

  const b = req.body as { accountId?: unknown; personId?: unknown; name?: unknown; title?: unknown; email?: unknown };
  const accountId = typeof b.accountId === "string" ? b.accountId : "";
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!accountId || !name) {
    res.status(400).json({ error: { code: "validation_failed", message: "accountId and name are required" } });
    return;
  }
  const givenPersonId = typeof b.personId === "string" && b.personId.trim() ? b.personId.trim() : null;
  const title = typeof b.title === "string" && b.title.trim() ? b.title.trim() : "Team member";
  const email = typeof b.email === "string" && b.email.trim() ? b.email.trim().toLowerCase() : null;
  const personId = givenPersonId ?? slugify(name);

  try {
    const result = await withUserContext(auth.userId!, async (tx) => {
      const [existing] = givenPersonId
        ? await tx<MemberRow[]>`select id, account_id, person_id, name, title, email, created_at from collab.account_member where account_id = ${accountId} and person_id = ${givenPersonId}`
        : await tx<MemberRow[]>`select id, account_id, person_id, name, title, email, created_at from collab.account_member where account_id = ${accountId} and lower(name) = ${name.toLowerCase()}`;
      if (existing) return { kind: "existing" as const, row: existing };

      const [created] = await tx<MemberRow[]>`
        insert into collab.account_member (account_id, person_id, name, title, email)
        values (${accountId}, ${personId}, ${name}, ${title}, ${email})
        returning id, account_id, person_id, name, title, email, created_at
      `;
      if (!created) throw new Error("insert returned no row");
      await logActivity(tx, accountId, `${name}${title ? ` (${title})` : ""} added to the account team`, "team");
      return { kind: "created" as const, row: created };
    });

    res.status(200).json({
      data: {
        ...toApi(result.row),
        ...(result.kind === "existing" ? { note: "already a member — no change made" } : {}),
      },
    });
  } catch (err) {
    const { status, body } = toApiError(err);
    res.status(status).json(body);
  }
}
