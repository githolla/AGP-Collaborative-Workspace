/**
 * POST /api/account/:id/team — `api/account-team.ts`
 * (docs/api-spec-workspace-mutations.md "Provisioning"; teams-provisioning-plan.md
 * B3 steps 1-3: adoptTeam, resolveIds, createChannels). Delegated: every Graph
 * call carries the caller's own token via X-Graph-Token, forwarded, never
 * stored (api/_lib/graph.ts).
 *
 * Combines B3's first three steps into one call rather than three round
 * trips — adopting an EXISTING, admin-created Team is a handful of fast GETs
 * (no `POST /teams`, so no 202/minutes-long creation to poll for), and
 * `createChannels` only ever needs to run once per Team. Step 4
 * (createFolders) is deliberately separate (api/account-folders-sync.ts /
 * api/account-folders.ts) because it is the one step that recurs on every
 * sync, not just at adoption.
 *
 * IDEMPOTENT: re-running with the same Team just re-resolves and re-confirms
 * the same ids (a harmless overwrite), and createChannels only creates a
 * channel whose displayName isn't already present.
 */

import { requireUser } from "./_lib/requireUser.js";
import { withUserContext } from "./_lib/db.js";
import { toApiError } from "./_lib/apiError.js";
import { graphTokenFrom, graphFetch, graphApiError, GraphError } from "./_lib/graph.js";

interface AccountRow {
  id: string;
  ms_team_id: string | null;
  ms_team_name: string | null;
  ms_group_id: string | null;
  ms_site_id: string | null;
  ms_drive_id: string | null;
  ms_web_url: string | null;
  ms_provisioned_at: string | null;
}

function toApi(a: AccountRow) {
  return {
    accountId: a.id,
    msTeamId: a.ms_team_id,
    msTeamName: a.ms_team_name,
    msGroupId: a.ms_group_id,
    msSiteId: a.ms_site_id,
    msDriveId: a.ms_drive_id,
    msWebUrl: a.ms_web_url,
    msProvisionedAt: a.ms_provisioned_at,
  };
}

/** Accepts a raw Team/group GUID, or a Teams deep link carrying `groupId=`
 * in its query string (the form "Copy link to team" produces). For an
 * M365-group-backed Team, the Team id and the Microsoft 365 Group id are the
 * same GUID — this is what lets `GET /teams/{id}` and
 * `GET /groups/{id}/...` both work off one resolved value. */
function extractTeamId(teamUrlOrId: string): string | null {
  const trimmed = teamUrlOrId.trim();
  const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (guid.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    const groupId = url.searchParams.get("groupId");
    if (groupId && guid.test(groupId)) return groupId;
  } catch {
    // not a URL — fall through
  }
  return null;
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

  const b = req.body as { accountId?: unknown; teamUrlOrId?: unknown; channelNames?: unknown };
  const accountId = typeof b.accountId === "string" ? b.accountId : "";
  const teamUrlOrId = typeof b.teamUrlOrId === "string" ? b.teamUrlOrId.trim() : "";
  if (!accountId || !teamUrlOrId) {
    res.status(400).json({ error: { code: "validation_failed", message: "accountId and teamUrlOrId are required" } });
    return;
  }
  const channelNames = Array.isArray(b.channelNames) ? b.channelNames.filter((c): c is string => typeof c === "string" && c.trim().length > 0) : [];

  const teamId = extractTeamId(teamUrlOrId);
  if (!teamId) {
    res.status(400).json({ error: { code: "validation_failed", message: "teamUrlOrId is not a recognizable Team id or Teams link" } });
    return;
  }

  const token = graphTokenFrom(req.headers);
  if (!token) {
    res.status(400).json({ error: { code: "graph_token_required", message: "X-Graph-Token header is required" } });
    return;
  }

  try {
    // Checked explicitly, before any Graph call: client_account_update's
    // policy would deny a non-admin's UPDATE at the end anyway, but only
    // after real Graph calls (and possibly channel creation) had already
    // run via the forwarded token — a side effect a plain member must never
    // be able to trigger, not just a DB write to block after the fact.
    const [access] = await withUserContext(auth.userId!, async (tx) => tx<{ ok: boolean }[]>`select collab.is_workspace_admin(${accountId}) as ok`);
    if (!access?.ok) {
      res.status(404).json({ error: { code: "not_found", message: "account not found" } });
      return;
    }

    // Step 1 — adoptTeam: confirm the admin-created Team exists. Also
    // captures displayName — previously fetched and discarded, which is
    // why the panel had nothing to show but the raw GUID.
    const team = (await graphFetch(token, `/teams/${teamId}`)) as { displayName?: string };

    // Step 2 — resolveIds: site + drive off the same group id.
    const site = (await graphFetch(token, `/groups/${teamId}/sites/root`)) as { id: string };
    const drive = (await graphFetch(token, `/groups/${teamId}/drive`)) as { id: string; webUrl: string };

    // Persisted here, before createChannels below — steps 1-2 fully
    // succeeded and are independently idempotent, so a later channel
    // hiccup (e.g. a name Graph still considers taken from a recently
    // deleted channel, which won't appear in the "existing channels" list
    // below) must not cost the caller a real, completed adoption. Caught
    // live: a NameAlreadyExists on one channel used to throw before this
    // update ran at all, silently discarding a Team/site/drive resolution
    // that had already succeeded.
    const [updated] = await withUserContext(auth.userId!, async (tx) => {
      return tx<AccountRow[]>`
        update collab.client_account
        set ms_team_id = ${teamId},
            ms_team_name = ${team.displayName ?? null},
            ms_group_id = ${teamId},
            ms_site_id = ${site.id},
            ms_drive_id = ${drive.id},
            ms_web_url = ${drive.webUrl},
            ms_provisioned_at = now()
        where id = ${accountId}
        returning id, ms_team_id, ms_team_name, ms_group_id, ms_site_id, ms_drive_id, ms_web_url, ms_provisioned_at
      `;
    });
    if (!updated) {
      res.status(404).json({ error: { code: "not_found", message: "account not found" } });
      return;
    }

    // Step 3 — createChannels: a small hand-picked set, created only if
    // missing (checked by displayName — Graph has no other stable identity
    // to dedupe on before creation). Each name is attempted independently
    // — one Graph rejection (e.g. NameAlreadyExists for a name Graph still
    // reserves from a recently deleted channel, which a plain "list
    // channels" call won't surface) is reported per-name rather than
    // aborting the rest of the batch.
    const created: string[] = [];
    const skipped: string[] = [];
    const failed: { name: string; detail: string }[] = [];
    if (channelNames.length > 0) {
      const existing = (await graphFetch(token, `/teams/${teamId}/channels`)) as { value: { displayName: string }[] };
      const existingNames = new Set(existing.value.map((c) => c.displayName.toLowerCase()));
      for (const name of channelNames) {
        if (existingNames.has(name.toLowerCase())) {
          skipped.push(name);
          continue;
        }
        try {
          await graphFetch(token, `/teams/${teamId}/channels`, { method: "POST", body: { displayName: name, membershipType: "standard" } });
          created.push(name);
        } catch (err) {
          // NameAlreadyExists means exactly what `skipped` already means —
          // Graph considers the name taken (including, e.g., one still
          // reserved from a channel deleted recently enough that the
          // "existing channels" list above no longer shows it) — so this
          // is a benign skip, not a real failure, regardless of why the
          // pre-check above missed it.
          if (err instanceof GraphError && /NameAlreadyExists/i.test(err.detail)) {
            skipped.push(name);
            continue;
          }
          const { body } = graphApiError(err);
          failed.push({ name, detail: body.error.detail ?? body.error.message });
        }
      }
    }

    res.status(200).json({ data: { ...toApi(updated), channelsCreated: created, channelsSkipped: skipped, channelsFailed: failed } });
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
