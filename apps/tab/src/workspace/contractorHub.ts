/**
 * Contractor Hub — pure aggregation over the account payload
 * (fetchAccountCollabData) into a per-contractor view: access, files shared,
 * opens, the discussion slice, and a rolled-up activity timeline.
 *
 * Kept as pure functions (a `now` seam instead of a live clock) so the
 * bucketing and status rules are unit-tested, and the component stays a thin
 * renderer. Nothing here fetches — it takes the same `WorkspaceAccountPayload`
 * pieces the Admin tab already loads.
 */

import { msApiCallPlain } from "./msApiFetch.js";
import type {
  MsAccountExternal,
  MsAccountGrant,
  MsAccountShare,
  MsAccountMessage,
  MsAccountFileApproval,
} from "./msAccountData.js";

const WEEK_MS = 7 * 24 * 3600 * 1000;
const ACTIVE_WINDOW_MS = 7 * WEEK_MS / 7; // 7 days
const SPARK_WEEKS = 7;

export type ContractorStatus = "active" | "idle" | "pending";

export interface ContractorEvent {
  kind: "share" | "open" | "approve";
  at: string;
  file: string;
  detail: string;
  /** unopened / SharePoint / workspace — a short tag shown on the row */
  tag?: string;
}

export interface DiscussionMsg {
  who: "them" | "agp";
  author: string;
  at: string;
  body: string;
}

export interface ContractorRow {
  id: string;
  userId?: string;
  name: string;
  org: string;
  role: "client" | "contractor";
  email?: string;
  entraStatus: MsAccountExternal["entraStatus"];
  status: ContractorStatus;
  folderCount: number;
  sharedCount: number;
  openedCount: number;
  notOpenedCount: number;
  approvals: number;
  lastActiveAt?: string;
  /** average ms between a file being shared and first opened, over opened shares */
  avgTimeToOpenMs?: number;
  /** opens per week, oldest→newest, length SPARK_WEEKS */
  spark: number[];
  events: ContractorEvent[];
  messages: DiscussionMsg[];
}

/** Does `body` @mention this person (first name or full name, word-boundary)? */
export function mentions(body: string, name: string): boolean {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const first = name.split(/\s+/)[0] ?? name;
  return new RegExp(`@(?:${esc(name)}|${esc(first)})\\b`, "i").test(body);
}

function statusOf(entraStatus: string, lastActiveAt: string | undefined, hasActivity: boolean, now: number): ContractorStatus {
  if (!hasActivity && entraStatus !== "active") return "pending";
  if (!lastActiveAt) return entraStatus === "active" ? "idle" : "pending";
  return now - new Date(lastActiveAt).getTime() <= ACTIVE_WINDOW_MS ? "active" : "idle";
}

function sparkFromOpens(openDates: string[], now: number): number[] {
  const buckets = new Array<number>(SPARK_WEEKS).fill(0);
  for (const iso of openDates) {
    const weeksAgo = Math.floor((now - new Date(iso).getTime()) / WEEK_MS);
    if (weeksAgo >= 0 && weeksAgo < SPARK_WEEKS) buckets[SPARK_WEEKS - 1 - weeksAgo]! += 1;
  }
  return buckets;
}

/** Build one ContractorRow per external collaborator. */
export function buildContractorRows(
  externals: MsAccountExternal[],
  grants: MsAccountGrant[],
  shares: MsAccountShare[],
  thread: MsAccountMessage[],
  approvals: MsAccountFileApproval[],
  now: number = Date.now(),
): ContractorRow[] {
  return externals
    .map((ext): ContractorRow => {
      const folderCount = grants.filter((g) => (ext.userId && g.userId === ext.userId) || g.externalLinkId === ext.id).length;
      const theirShares = shares.filter((s) => !s.revokedAt && (s.personName === ext.name || (ext.userId && s.recipientUserId === ext.userId)));
      const opened = theirShares.filter((s) => s.openedAt);
      const openDates = opened.map((s) => s.openedAt!).filter(Boolean);

      // Discussion slice: messages they authored, or that @mention them.
      const theirMsgs: DiscussionMsg[] = thread
        .filter((m) => m.author === ext.name || (ext.userId && m.authorUserId === ext.userId) || mentions(m.body, ext.name))
        .map((m) => ({
          who: (m.author === ext.name || (ext.userId && m.authorUserId === ext.userId)) ? "them" as const : "agp" as const,
          author: m.author,
          at: m.createdAt,
          body: m.body,
        }));

      // Their approvals: file_approval has no recipient key, so attribute only
      // when the shared item name also appears in one of their opened shares.
      const theirFileNames = new Set(theirShares.map((s) => s.itemName));
      const theirApprovals = approvals.filter((a) => a.decision && theirFileNames.has(a.name));

      // Activity timeline: a share event per file, an open event per opened file.
      const events: ContractorEvent[] = [];
      for (const s of theirShares) {
        events.push({
          kind: "share",
          at: s.sentAt,
          file: s.itemName,
          detail: "Shared by AGP",
          ...(s.openedAt ? {} : { tag: "not opened" }),
        });
        if (s.openedAt) {
          events.push({
            kind: "open",
            at: s.openedAt,
            file: s.itemName,
            detail: s.openSource === "sharepoint" ? "Opened in SharePoint" : "Opened in the workspace",
            ...(s.openSource ? { tag: s.openSource } : {}),
          });
        }
      }
      for (const a of theirApprovals) {
        if (a.decidedAt) events.push({ kind: "approve", at: a.decidedAt, file: a.name, detail: a.decision === "approved" ? "Approved" : "Requested changes" });
      }
      events.sort((x, y) => y.at.localeCompare(x.at));

      const lastCandidates = [...openDates, ...theirMsgs.map((m) => m.at)].sort();
      const lastActiveAt = lastCandidates[lastCandidates.length - 1];
      const hasActivity = openDates.length > 0 || theirMsgs.length > 0;

      let avgTimeToOpenMs: number | undefined;
      if (opened.length) {
        const spans = opened.map((s) => new Date(s.openedAt!).getTime() - new Date(s.sentAt).getTime()).filter((n) => n >= 0);
        if (spans.length) avgTimeToOpenMs = spans.reduce((a, b) => a + b, 0) / spans.length;
      }

      return {
        id: ext.id,
        ...(ext.userId ? { userId: ext.userId } : {}),
        name: ext.name,
        org: ext.org,
        role: ext.role,
        ...(ext.email ? { email: ext.email } : {}),
        entraStatus: ext.entraStatus,
        status: statusOf(ext.entraStatus, lastActiveAt, hasActivity, now),
        folderCount,
        sharedCount: theirShares.length,
        openedCount: opened.length,
        notOpenedCount: theirShares.length - opened.length,
        approvals: theirApprovals.length,
        ...(lastActiveAt ? { lastActiveAt } : {}),
        ...(avgTimeToOpenMs !== undefined ? { avgTimeToOpenMs } : {}),
        spark: sparkFromOpens(openDates, now),
        events,
        messages: theirMsgs,
      };
    })
    .sort((a, b) => {
      // Contractors first, then most-recently-active, pending last.
      const rank = (r: ContractorRow) => (r.status === "active" ? 0 : r.status === "idle" ? 1 : 2);
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      return (b.lastActiveAt ?? "").localeCompare(a.lastActiveAt ?? "");
    });
}

export interface ContractorKpis {
  contractors: number;
  activeThisWeek: number;
  filesShared: number;
  opensThisWeek: number;
  awaitingApproval: number;
}

export function contractorKpis(rows: ContractorRow[], approvals: MsAccountFileApproval[], now: number = Date.now()): ContractorKpis {
  const opensThisWeek = rows.reduce((sum, r) => sum + r.events.filter((e) => e.kind === "open" && now - new Date(e.at).getTime() <= WEEK_MS).length, 0);
  return {
    contractors: rows.length,
    activeThisWeek: rows.filter((r) => r.status === "active").length,
    filesShared: rows.reduce((s, r) => s + r.sharedCount, 0),
    opensThisWeek,
    awaitingApproval: approvals.filter((a) => a.purpose === "approval" && !a.decision).length,
  };
}

/** Format an ms duration as a short "1.4 h" / "3 d" / "12 m". */
export function humanDuration(ms: number): string {
  const mins = ms / 60000;
  if (mins < 60) return `${Math.max(1, Math.round(mins))} m`;
  const hours = mins / 60;
  if (hours < 48) return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)} h`;
  return `${Math.round(hours / 24)} d`;
}

// ---- invite message ---------------------------------------------------------

/**
 * A ready-to-paste invite an AGP person can drop into an email or Teams/Slack
 * message. The link is just the app origin — a contractor who signs in with the
 * email on their record auto-lands in their OWN scoped external workspace (RLS
 * shows only what's been shared with them), so no per-link token is needed and
 * nothing leaks. The wording is different when they don't have access yet, so a
 * hollow "sign in" that can't work isn't sent by accident.
 */
export function buildInviteMessage(input: {
  name: string;
  email?: string;
  clientName: string;
  folderCount: number;
  appUrl: string;
  fromName?: string;
}): string {
  const first = input.name.split(/\s+/)[0] || input.name;
  const url = input.appUrl.replace(/\/+$/, "");
  const signIn = input.email ? ` with your email (${input.email})` : "";
  const from = input.fromName ? `\n\n— ${input.fromName}` : "";

  if (input.folderCount === 0) {
    // No access granted yet — say so honestly rather than sending a dead link.
    return [
      `Hi ${first},`,
      ``,
      `I'm setting you up on AGP's collaboration workspace for ${input.clientName} so we can share files and updates in one place. I'll share the folders you need in a moment — you'll get a separate email from Microsoft to accept access, and then you can sign in${signIn} here:`,
      ``,
      url,
      ``,
      `You'll only ever see what's been shared with you.${from}`,
    ].join("\n");
  }
  return [
    `Hi ${first},`,
    ``,
    `You've been given access to ${input.folderCount} ${input.folderCount === 1 ? "area" : "areas"} on AGP's collaboration workspace for ${input.clientName}. You should also have (or shortly get) an email from Microsoft to accept access — once you have, sign in${signIn} here:`,
    ``,
    url,
    ``,
    `You'll only see what's been shared with you — the files for this project and our discussion. Anything you open is just visible to our team so we know you have what you need.${from}`,
  ].join("\n");
}

// ---- AI assistant client call -----------------------------------------------

export interface ContractorChatTurn { role: "user" | "assistant"; content: string }
export interface ContractorChatResult { configured: boolean; answer: string }

/** Ask the grounded AI assistant a question about this account's contractors. */
export async function askContractorChat(
  accountId: string,
  question: string,
  history: ContractorChatTurn[] = [],
): Promise<ContractorChatResult> {
  return msApiCallPlain<ContractorChatResult>("/api/contractor-chat", {
    method: "POST",
    body: { accountId, question, history },
  });
}
