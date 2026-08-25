import { msApiCall, msApiCallPlain } from "./msApiFetch.js";

/**
 * Client-side provisioning actions (teams-provisioning-plan.md B3
 * "Provisioning", B4 "The folder tree", B5 "Internal membership"). Thin
 * wrappers over api/account-team.ts / api/account-folders-sync.ts /
 * api/account-folders.ts / api/account-team-members.ts — the actual Graph
 * orchestration (Retry-After handling, get-by-path-then-create,
 * channel/member dedup) runs server-side, forwarding this module's acquired
 * token as X-Graph-Token (see msApiFetch.ts's own header for why: the
 * api-spec's rule 2 has the server, not the browser, holding the forwarded
 * token for the duration of one call).
 *
 * "Resumable" (B3's own word) falls out of this shape for free: every step
 * below is independently callable and safe to re-call — adoptTeam just
 * re-resolves the same ids, syncProjectFolders/createMilestoneFolders
 * get-by-path before creating, syncTeamMembers checks the Team's current
 * roster first. There is no separate job record because none of these steps
 * needs one.
 */

export interface AdoptTeamResult {
  accountId: string;
  msTeamId: string | null;
  msGroupId: string | null;
  msSiteId: string | null;
  msDriveId: string | null;
  msWebUrl: string | null;
  msProvisionedAt: string | null;
  channelsCreated: string[];
  channelsSkipped: string[];
  channelsFailed: { name: string; detail: string }[];
}

/** B3 steps 1-3: adopt the admin-created Team, resolve its site/drive, and
 * create any of `channelNames` that don't already exist by that name. */
export async function adoptTeam(accountId: string, teamUrlOrId: string, channelNames: string[] = [], loginHintEmail?: string | undefined): Promise<AdoptTeamResult> {
  const result = await msApiCall<AdoptTeamResult>("/api/account-team", { body: { accountId, teamUrlOrId, channelNames }, loginHintEmail });
  // Best-effort: connecting a Team also turns on two-way sync (a reply typed in
  // the Teams channel flows back into the Discussion). No-ops when the server
  // isn't configured for it (GRAPH_APP_* / TEAMS_WEBHOOK_URL unset); never fails
  // the connect. Re-connecting refreshes the subscription (also the renewal path).
  try { await subscribeTeamsSync(accountId); } catch { /* two-way sync unavailable — fine */ }
  return result;
}

/** Enable (or renew) two-way Teams sync for an account — creates the Graph
 * change-notification subscription server-side. Member-gated; no Graph token
 * needed from the client (the server uses its application credential). */
export async function subscribeTeamsSync(accountId: string): Promise<void> {
  await msApiCallPlain<{ data: { subscribed: boolean; expiresAt: string } }>("/api/teams-subscribe", { body: { accountId } });
}

export interface FolderSyncResult {
  created: { kantataId: string; name: string }[];
  renamed: { kantataId: string; name: string }[];
  goneFromKantata: { kantataId: string; name: string; level: string }[];
}

/** B4 §4: project-level folder create/rename, diffed server-side against
 * the live Kantata mirror. Never touches milestone/phase/task folders. */
export async function syncProjectFolders(accountId: string, loginHintEmail?: string | undefined): Promise<FolderSyncResult> {
  return msApiCall<FolderSyncResult>("/api/account-folders-sync", { body: { accountId }, loginHintEmail });
}

export interface CreateFoldersResult {
  created: { kantataId: string; name: string }[];
  alreadyHadFolder: string[];
  invalid?: { kantataId: string; reason: string }[];
}

/** B4 §5: the milestone picker's "Create folders" action — only the ticked
 * top-level milestone ids. */
export async function createMilestoneFolders(accountId: string, kantataIds: string[], loginHintEmail?: string | undefined): Promise<CreateFoldersResult> {
  return msApiCall<CreateFoldersResult>("/api/account-folders", { body: { accountId, kantataIds }, loginHintEmail });
}

export interface SyncTeamMembersResult {
  added: { memberId: string; name: string }[];
  alreadyOnTeam: { memberId: string; name: string }[];
  unresolved?: { memberId: string; name: string; reason: string }[];
}

/** B5: resolve each ticked `memberIds` row's email to a Graph user and add
 * them to the Team. Only the ticked rows — review-gated, per B5's own rule. */
export async function syncTeamMembers(accountId: string, memberIds: string[], loginHintEmail?: string | undefined): Promise<SyncTeamMembersResult> {
  return msApiCall<SyncTeamMembersResult>("/api/account-team-members", { body: { accountId, memberIds }, loginHintEmail });
}
