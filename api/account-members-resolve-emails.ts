/**
 * POST /api/account-members-resolve-emails — backfills `collab.account_member
 * .email` for this account from Kantata's own staff roster
 * (teams-provisioning-plan.md B5). Most members here were seeded from
 * Kantata's delivery-team roster with no email at all (0016's own comment) —
 * this is the missing prerequisite for "add to the Microsoft Team" without
 * anyone typing 668 emails by hand.
 *
 * Matched by NAME ONLY — loose, case/whitespace-insensitive equality, same
 * rule `handover.ts`'s `samePerson` uses client-side and for the same
 * reason: names arrive from Kantata, from typing, and from Microsoft, and
 * do not match exactly. An unresolved name is REPORTED, never guessed
 * (B5's own rule) — no fuzzy/partial matching, no picking the closest name.
 *
 * Only ever fills a member row that currently has NO email — never
 * overwrites one an admin already set by hand (setMemberEmail, PATCH
 * /api/member).
 */

import { requireUser } from "./_lib/requireUser.js";
import { withUserContext } from "./_lib/db.js";
import { toApiError } from "./_lib/apiError.js";
import { pullStaffRoster } from "./_lib/kantataMirror.js";

function samePerson(a: string, b: string): boolean {
  return a.trim().toLowerCase().replace(/\s+/g, " ") === b.trim().toLowerCase().replace(/\s+/g, " ");
}

export default async function handler(
  req: { method?: string; body?: unknown; headers?: Record<string, string | string[] | undefined> },
  res: {
    status: (code: number) => { json: (body: unknown) => void };
    setHeader: (k: string, v: string) => void;
  },
): Promise<void> {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.status(405).json({ error: { code: "validation_failed", message: "POST only" } });
    return;
  }

  const authHeader = typeof req.headers?.authorization === "string" ? req.headers.authorization : undefined;
  const auth = await requireUser(authHeader);
  if (!auth.authorized) {
    res.status(auth.status).json(auth.body);
    return;
  }

  const accountId = typeof (req.body as { accountId?: unknown })?.accountId === "string" ? (req.body as { accountId: string }).accountId : "";
  if (!accountId) {
    res.status(400).json({ error: { code: "validation_failed", message: "accountId is required" } });
    return;
  }
  const kantataToken = process.env.KANTATA_API_TOKEN;
  if (!kantataToken) {
    res.status(500).json({ error: { code: "internal_error", message: "KANTATA_API_TOKEN not set" } });
    return;
  }

  try {
    const result = await withUserContext(auth.userId!, async (tx) => {
      const [access] = await tx<{ ok: boolean }[]>`select collab.is_workspace_admin(${accountId}) as ok`;
      if (!access?.ok) return { kind: "not_found" as const };

      const members = await tx<{ id: string; name: string }[]>`
        select id, name from collab.account_member where account_id = ${accountId} and email is null
      `;
      if (members.length === 0) return { kind: "ok" as const, matched: [] as { memberId: string; name: string; email: string }[], unmatched: [] as string[] };

      const staff = await pullStaffRoster(kantataToken);
      const matched: { memberId: string; name: string; email: string }[] = [];
      const unmatched: string[] = [];
      for (const m of members) {
        const hit = staff.find((s) => s.email && samePerson(s.name, m.name));
        if (!hit) {
          unmatched.push(m.name);
          continue;
        }
        await tx`update collab.account_member set email = ${hit.email.toLowerCase()} where id = ${m.id}`;
        matched.push({ memberId: m.id, name: m.name, email: hit.email.toLowerCase() });
      }
      return { kind: "ok" as const, matched, unmatched };
    });

    if (result.kind === "not_found") {
      res.status(404).json({ error: { code: "not_found", message: "account not found" } });
      return;
    }
    res.status(200).json({ data: { matched: result.matched, unmatched: result.unmatched } });
  } catch (err) {
    const { status, body } = toApiError(err);
    res.status(status).json(body);
  }
}
