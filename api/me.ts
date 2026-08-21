/**
 * GET /api/me — real, server-side identity classification
 * (teams-provisioning-plan.md C1: "Identity class decides the shell after
 * authentication... resolved from app_user and external_link, not from the
 * account's domain").
 *
 * `collab.app_user.kind` is set once, server-side, by the auth trigger
 * (0007: '@teamallegiance.com' → 'internal', else 'external' — an app admin
 * can correct it later) — a real classification made at sign-up time, not a
 * client-side domain regex re-guessed on every render (App.tsx's
 * `viewerIsInternal` today). This is the endpoint the client asks instead.
 *
 * `external`'s `accounts` are every `external_link` row for this person,
 * each with the role that link carries (a person can be a client on one
 * account and a vendor on another — C2's own point). `internal` gets none:
 * they use the existing account list/`ws.accounts`, not this payload.
 */

import { requireUser } from "./_lib/requireUser.js";
import { withUserContext } from "./_lib/db.js";

interface AppUserRow {
  kind: string;
  display_name: string;
}

interface ExternalLinkRow {
  account_id: string;
  role: string;
  client_name: string;
}

export default async function handler(
  req: { method?: string; headers?: Record<string, string | string[] | undefined> },
  res: {
    status: (code: number) => { json: (body: unknown) => void };
    setHeader: (k: string, v: string) => void;
  },
): Promise<void> {
  res.setHeader("Cache-Control", "no-store");

  if (req.method && req.method !== "GET") {
    res.status(405).json({ error: { code: "validation_failed", message: "GET only" } });
    return;
  }

  const authHeader = typeof req.headers?.authorization === "string" ? req.headers.authorization : undefined;
  const auth = await requireUser(authHeader);
  if (!auth.authorized) {
    res.status(auth.status).json(auth.body);
    return;
  }

  const userId = auth.userId!;

  try {
    const result = await withUserContext(userId, async (tx) => {
      const [me] = await tx<AppUserRow[]>`select kind, display_name from collab.app_user where id = ${userId}`;
      if (!me) return null;
      if (me.kind !== "external") return { kind: me.kind, displayName: me.display_name, accounts: [] as ExternalLinkRow[] };

      const links = await tx<ExternalLinkRow[]>`
        select el.account_id, el.role, ca.client_name
        from collab.external_link el
        join collab.client_account ca on ca.id = el.account_id
        where el.user_id = ${userId}
      `;
      return { kind: me.kind, displayName: me.display_name, accounts: links };
    });

    if (!result) {
      // No collab.app_user row at all — either the auth trigger hasn't run
      // yet (fresh signup, race) or this environment has no collab schema
      // applied. Either way, there is nothing to classify as external, so
      // the caller's existing "assume internal" fallback is the correct
      // default here, not an error.
      res.status(200).json({ data: { kind: "unknown", accounts: [] } });
      return;
    }

    res.status(200).json({
      data: {
        kind: result.kind,
        displayName: result.displayName,
        accounts: result.accounts.map((a) => ({ accountId: a.account_id, clientName: a.client_name, role: a.role })),
      },
    });
  } catch (err) {
    res.status(500).json({ error: { code: "internal_error", message: err instanceof Error ? err.message : "query failed" } });
  }
}
