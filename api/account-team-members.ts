/**
 * POST /api/account/:id/team-members — `api/account-team-members.ts`
 * (teams-provisioning-plan.md B5 "Internal membership"). Not in the api-spec
 * doc's literal route list (which only covers `POST /api/account/:id/members`
 * — the account_member roster row, api/member.ts) — this is the separate
 * Graph action B5 actually describes: resolve each ticked member's email to a
 * Graph user id (`GET /users?$filter=mail eq '{email}'`, `User.ReadBasic.All`)
 * and add them to the Microsoft Team (`POST /teams/{teamId}/members`).
 *
 * Body: `{ accountId, memberIds: string[] }` — review-gated (B5: "a from → to
 * list, only ticked rows sent"), so this only ever touches ids the caller
 * explicitly ticked, never "every member".
 *
 * An email that resolves to no Microsoft user is REPORTED, never skipped or
 * approximated (B5's own rule, same spirit as handover.ts's `samePerson`
 * guarding against exactly this kind of guess). A member with no email on
 * file at all (account_member.email, added in 0016) is reported the same way
 * — "unresolved" either way, from the caller's point of view.
 *
 * Externals are never reachable through this endpoint by construction, not by
 * a runtime check: `memberIds` are `collab.account_member` ids, and
 * externals live in the disjoint `collab.external_link` table — an
 * external's id simply matches no row here (B5: "the member panel must not
 * list externals as candidates... refused if one is submitted directly").
 *
 * IDEMPOTENT (B5's test: "a re-run adding nobody twice"): checks the Team's
 * current membership by user id before POSTing, rather than trusting a
 * repeat request to no-op safely on Graph's side.
 */

import { requireUser } from "./_lib/requireUser.js";
import { withUserContext } from "./_lib/db.js";
import { toApiError } from "./_lib/apiError.js";
import { graphTokenFrom, graphFetch, graphApiError } from "./_lib/graph.js";

interface MemberRow {
  id: string;
  name: string;
  email: string | null;
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

  const b = req.body as { accountId?: unknown; memberIds?: unknown };
  const accountId = typeof b.accountId === "string" ? b.accountId : "";
  const memberIds = Array.isArray(b.memberIds) ? b.memberIds.filter((m): m is string => typeof m === "string" && m.length > 0) : [];
  if (!accountId || memberIds.length === 0) {
    res.status(400).json({ error: { code: "validation_failed", message: "accountId and a non-empty memberIds are required" } });
    return;
  }

  const token = graphTokenFrom(req.headers);
  if (!token) {
    res.status(400).json({ error: { code: "graph_token_required", message: "X-Graph-Token header is required" } });
    return;
  }

  try {
    const result = await withUserContext(auth.userId!, async (tx) => {
      const [account] = await tx<{ ms_team_id: string | null }[]>`select ms_team_id from collab.client_account where id = ${accountId}`;
      if (!account) return { kind: "not_found" as const };

      const [access] = await tx<{ ok: boolean }[]>`select collab.is_workspace_admin(${accountId}) as ok`;
      if (!access?.ok) return { kind: "not_found" as const };
      if (!account.ms_team_id) return { kind: "not_provisioned" as const };

      const members = await tx<MemberRow[]>`select id, name, email from collab.account_member where account_id = ${accountId} and id = any(${memberIds})`;
      return { kind: "ok" as const, teamId: account.ms_team_id, members };
    });

    if (result.kind === "not_found") {
      res.status(404).json({ error: { code: "not_found", message: "account not found" } });
      return;
    }
    if (result.kind === "not_provisioned") {
      res.status(409).json({ error: { code: "conflict", message: "account has no adopted Team yet — call POST /api/account/:id/team first" } });
      return;
    }

    const existingMembers = (await graphFetch(token, `/teams/${result.teamId}/members`)) as { value: { userId?: string }[] };
    const existingUserIds = new Set(existingMembers.value.map((m) => m.userId).filter(Boolean));

    const added: { memberId: string; name: string }[] = [];
    const unresolved: { memberId: string; name: string; reason: string }[] = [];
    const alreadyOnTeam: { memberId: string; name: string }[] = [];

    for (const member of result.members) {
      if (!member.email) {
        unresolved.push({ memberId: member.id, name: member.name, reason: "no email on file for this member" });
        continue;
      }

      const found = (await graphFetch(token, `/users?$filter=${encodeURIComponent(`mail eq '${member.email.replace(/'/g, "''")}'`)}`)) as { value: { id: string }[] };
      const user = found.value?.[0];
      if (!user) {
        unresolved.push({ memberId: member.id, name: member.name, reason: `no Microsoft user found for ${member.email}` });
        continue;
      }

      if (existingUserIds.has(user.id)) {
        alreadyOnTeam.push({ memberId: member.id, name: member.name });
        continue;
      }

      await graphFetch(token, `/teams/${result.teamId}/members`, {
        method: "POST",
        body: {
          "@odata.type": "#microsoft.graph.aadUserConversationMember",
          roles: [],
          "user@odata.bind": `https://graph.microsoft.com/v1.0/users('${user.id}')`,
        },
      });
      added.push({ memberId: member.id, name: member.name });
    }

    res.status(200).json({ data: { added, alreadyOnTeam, ...(unresolved.length > 0 ? { unresolved } : {}) } });
  } catch (err) {
    try {
      const { status, body } = graphApiError(err);
      res.status(status).json(body);
    } catch {
      const { status, body } = toApiError(err);
      res.status(status).json(body);
    }
  }
}
