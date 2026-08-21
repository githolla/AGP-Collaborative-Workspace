/**
 * POST /api/account-import — `POST /api/account/:id/import`
 * (docs/api-spec-workspace-mutations.md), replacing `importAllFromKantata`/
 * `importCampaigns`/`importTasks`/`ensureAutoPopulated`.
 *
 * `selected` (review-gated picking of specific candidates, matching
 * `importCampaigns`/`importTasks`'s client-side review panel) re-pulls fresh
 * live Kantata data exactly like an unfiltered import, then keeps only the
 * campaigns/tasks named by `selected.campaignProjectIds`/`taskStoryIds`
 * (Kantata project/story ids — the same ones the candidate list itself
 * carries) before writing. Omitted entirely still means "import everything
 * found," unchanged from before this existed.
 *
 * Works ONLY from the account's own explicit `kantata_project_ids` — no
 * fuzzy title-matching against the wider tenant (confirmed out of scope;
 * see kantataImport.ts's header). An account with none linked has nothing
 * to import; that's a real, reportable state, not an error.
 */

import { requireUser } from "./_lib/requireUser.js";
import { withUserContext } from "./_lib/db.js";
import { runKantataImport, claimKantataPullSlot, type ImportSelection } from "./_lib/kantataImport.js";
import { toApiError } from "./_lib/apiError.js";

const SCOPES = new Set(["all", "campaigns", "tasks"]);

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

  const b = req.body as { accountId?: unknown; scope?: unknown; selected?: unknown };
  const accountId = typeof b?.accountId === "string" ? b.accountId : "";
  const scope = typeof b?.scope === "string" && SCOPES.has(b.scope) ? (b.scope as "all" | "campaigns" | "tasks") : "";
  if (!accountId || !scope) {
    res.status(400).json({ error: { code: "validation_failed", message: "accountId and scope ('all'|'campaigns'|'tasks') are required" } });
    return;
  }
  let selected: ImportSelection | undefined;
  if (b.selected !== undefined) {
    if (typeof b.selected !== "object" || b.selected === null) {
      res.status(400).json({ error: { code: "validation_failed", message: "selected must be an object: { campaignProjectIds?: string[], taskStoryIds?: string[] }" } });
      return;
    }
    const s = b.selected as { campaignProjectIds?: unknown; taskStoryIds?: unknown };
    const campaignProjectIds = Array.isArray(s.campaignProjectIds) ? s.campaignProjectIds.filter((x): x is string => typeof x === "string") : undefined;
    const taskStoryIds = Array.isArray(s.taskStoryIds) ? s.taskStoryIds.filter((x): x is string => typeof x === "string") : undefined;
    selected = { ...(campaignProjectIds ? { campaignProjectIds } : {}), ...(taskStoryIds ? { taskStoryIds } : {}) };
  }

  try {
    const [account] = await withUserContext(auth.userId!, async (tx) => {
      return tx<{ client_name: string; kantata_project_ids: string[]; is_member: boolean }[]>`
        select client_name, kantata_project_ids, collab.is_account_member_or_admin(id) as is_member
        from collab.client_account where id = ${accountId}
      `;
    });
    // client_account_read's policy (can_read_account) also passes for a
    // linked EXTERNAL, which is broader than this route's real role
    // (member/admin) — an external can see the account exists but must not
    // trigger a live Kantata pull, so that's checked explicitly here rather
    // than left to whatever the read policy alone would allow.
    if (!account || !account.is_member) {
      res.status(404).json({ error: { code: "not_found", message: "account not found" } });
      return;
    }
    if (account.kantata_project_ids.length === 0) {
      res.status(200).json({ data: { campaignsAdded: 0, campaignsUpdated: 0, tasksAdded: 0, note: "no linked Kantata projects — link some first via POST /api/account-projects" } });
      return;
    }

    const token = process.env.KANTATA_API_TOKEN;
    if (!token) throw new Error("KANTATA_API_TOKEN not set");

    // Rate limit — this fans out into ~10 parallel paginated Kantata API
    // calls per invocation; without this, any account member could loop
    // this endpoint and burn through the shared KANTATA_API_TOKEN's rate
    // limit or run up compute cost (a real finding from a security review,
    // not theoretical). See migration 0014.
    const claimed = await withUserContext(auth.userId!, async (tx) => claimKantataPullSlot(tx, accountId));
    if (!claimed) {
      res.status(409).json({ error: { code: "conflict", message: "an import for this account ran too recently — please wait a few seconds and try again" } });
      return;
    }

    const result = await withUserContext(auth.userId!, async (tx) => {
      return runKantataImport(tx, token, accountId, account.client_name, account.kantata_project_ids, scope, selected);
    });
    res.status(200).json({ data: result });
  } catch (err) {
    const { status, body: errBody } = toApiError(err);
    res.status(status).json(errBody);
  }
}
