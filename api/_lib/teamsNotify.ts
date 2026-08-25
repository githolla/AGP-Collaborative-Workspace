/**
 * Best-effort Teams notification for @mentions in a workspace Discussion post.
 *
 * When someone posts a message that @mentions a workspace member, we mirror it
 * into the account's Microsoft Team channel with a REAL Teams mention — which is
 * what makes Teams natively notify that person. Reuses the same delegated-token
 * Graph plumbing as the rest of the provisioning layer (graph.ts): the caller's
 * own token, forwarded from the client, does the send.
 *
 * STRICTLY best-effort. Every path returns a result instead of throwing, and
 * the caller ignores failures — a Graph hiccup, a missing Team, an unresolvable
 * email, or a missing ChannelMessage.Send consent must NEVER fail the post
 * itself. The message is already saved in Postgres before this runs.
 *
 * Requires the delegated Graph scope `ChannelMessage.Send` (admin-consented).
 * Without it the channel POST 403s and this simply reports { sent: false }.
 */

import { graphFetch } from "./graph.js";

/**
 * Signature embedded in every message this app posts INTO Teams. The inbound
 * webhook (two-way sync) skips any channel message carrying it, so the app's
 * own outbound notifications never echo back into the Discussion as if a person
 * had typed them in Teams.
 */
export const WORKSPACE_POST_MARKER = "in the workspace Discussion:";

const ESCAPE: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPE[c] ?? c);
}

export interface TeamsMention {
  name: string;
  email: string;
}

export interface TeamsNotifyResult {
  sent: boolean;
  reason?: string;
  /** How many mentioned members resolved to a Microsoft user. */
  notified?: number;
}

/**
 * Post the discussion message into the team's primary channel, @mentioning
 * every resolvable member so Teams notifies them. Never throws.
 */
export async function notifyTeamsMentions(opts: {
  token: string;
  teamId: string;
  authorName: string;
  body: string;
  mentions: readonly TeamsMention[];
}): Promise<TeamsNotifyResult> {
  const { token, teamId, authorName, body, mentions } = opts;
  if (mentions.length === 0) return { sent: false, reason: "no mentions" };

  try {
    // Resolve each mentioned member's email to a Microsoft (Entra) user id —
    // the same lookup account-team-members.ts uses to add people to a Team.
    const resolved: { name: string; id: string }[] = [];
    const seen = new Set<string>();
    for (const m of mentions) {
      if (!m.email || seen.has(m.email.toLowerCase())) continue;
      seen.add(m.email.toLowerCase());
      try {
        const found = (await graphFetch(
          token,
          `/users?$filter=${encodeURIComponent(`mail eq '${m.email.replace(/'/g, "''")}'`)}&$select=id`,
        )) as { value?: { id: string }[] };
        const id = found?.value?.[0]?.id;
        if (id) resolved.push({ name: m.name, id });
      } catch {
        // One unresolvable mention shouldn't sink the rest.
      }
    }
    if (resolved.length === 0) return { sent: false, reason: "no mentions resolved to Microsoft users" };

    const channel = (await graphFetch(token, `/teams/${teamId}/primaryChannel?$select=id`)) as { id?: string };
    if (!channel?.id) return { sent: false, reason: "team has no primary channel" };

    // Real Teams mention entities — the <at id="n"> tags in the body must line
    // up with the mentions array by id for Teams to render + notify them.
    const atTags = resolved.map((r, i) => `<at id="${i}">${escapeHtml(r.name)}</at>`).join(" ");
    const content = `${atTags} — <b>${escapeHtml(authorName)}</b> ${WORKSPACE_POST_MARKER} ${escapeHtml(body)}`;
    const graphMentions = resolved.map((r, i) => ({
      id: i,
      mentionText: r.name,
      mentioned: { user: { id: r.id, displayName: r.name, userIdentityType: "aadUser" } },
    }));

    await graphFetch(token, `/teams/${teamId}/channels/${channel.id}/messages`, {
      method: "POST",
      body: { body: { contentType: "html", content }, mentions: graphMentions },
    });
    return { sent: true, notified: resolved.length };
  } catch (e) {
    // GraphError or anything else — swallow, report, never rethrow.
    return { sent: false, reason: e instanceof Error ? e.message.slice(0, 120) : "graph send failed" };
  }
}

/**
 * Which account members a message @mentions. Matches "@FirstName" or the full
 * "@First Last" (case-insensitive, on a word boundary) — the same @FirstName
 * convention the in-app notifier uses. Only members WITH an email are
 * candidates, since a Teams notification needs a resolvable identity.
 */
export function matchedMentions(body: string, roster: readonly TeamsMention[]): TeamsMention[] {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const out: TeamsMention[] = [];
  const seen = new Set<string>();
  for (const m of roster) {
    if (!m.email) continue;
    const first = m.name.split(/\s+/)[0] ?? m.name;
    const re = new RegExp(`@(?:${esc(m.name)}|${esc(first)})\\b`, "i");
    if (re.test(body) && !seen.has(m.email.toLowerCase())) {
      seen.add(m.email.toLowerCase());
      out.push(m);
    }
  }
  return out;
}
