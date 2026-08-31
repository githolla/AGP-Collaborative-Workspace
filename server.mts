/**
 * Standalone server for non-Vercel hosts (Azure Container Apps via
 * docker-compose/Dockerfile's `prod` target). Serves the built apps/tab SPA
 * and hosts the same /api endpoints Vercel runs — api/state.ts and
 * api/mirror.ts are imported and called unmodified: their (req, res)
 * signature is a structural subset of Express's, so no adapter is needed.
 * vercel.json remains the source of truth for the Vercel deployment; this
 * file is only read when running via `tsx server.mts` (see package.json's
 * `start` script and the Dockerfile's `prod` stage).
 *
 * `dotenv/config` loads a root .env for direct/bare runs (`pnpm start`
 * outside Docker). It never overrides vars already in process.env, so it's a
 * no-op — not a conflict — when Docker/Azure inject them directly, and a
 * no-op when no .env file exists (e.g. the built image, which never bakes
 * one in per .dockerignore).
 */
import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import stateHandler from "./api/state.js";
import mirrorHandler from "./api/mirror.js";
import kantataWriteHandler from "./api/kantata-write.js";
import workspaceHandler from "./api/workspace.js";
import accountHandler from "./api/account.js";
import taskHandler from "./api/task.js";
import externalHandler from "./api/external.js";
import grantHandler from "./api/grant.js";
import grantRevokeAllHandler from "./api/grant/revoke-all.js";
import taskAssignmentsHandler from "./api/task-assignments.js";
import messageHandler from "./api/message.js";
import messageVisibilityHandler from "./api/message/visibility.js";
import memberHandler from "./api/member.js";
import shareHandler from "./api/share.js";
import notifyHandler from "./api/notify.js";
import remindHandler from "./api/remind.js";
import templateHandler from "./api/template.js";
import adminUsersHandler from "./api/admin/users.js";
import adminExternalsHandler from "./api/admin/externals.js";
import adminOffboardHandler from "./api/admin/offboard.js";
import adminAccountsArchiveAllHandler from "./api/admin/accounts/archive-all.js";
import adminWorkspaceClearHandler from "./api/admin/workspace/clear.js";
import accountDeepenHandler from "./api/account-deepen.js";
import accountImportHandler from "./api/account-import.js";
import accountScopeHandler from "./api/account-scope.js";
import accountProjectsHandler from "./api/account-projects.js";
import accountCampaignsHandler from "./api/account-campaigns.js";
import accountTasksSyncedHandler from "./api/account-tasks-synced.js";
import meHandler from "./api/me.js";
import externalWorkspaceHandler from "./api/external-workspace.js";
import accountTeamHandler from "./api/account-team.js";
import accountTeamMembersHandler from "./api/account-team-members.js";
import accountFoldersSyncHandler from "./api/account-folders-sync.js";
import accountFoldersHandler from "./api/account-folders.js";
import accountProvisioningPlanHandler from "./api/account-provisioning-plan.js";
import accountFolderChildrenHandler from "./api/account-folder-children.js";
import filesHandler from "./api/files.js";
import filesUploadSessionHandler from "./api/files-upload-session.js";
import filesApprovalHandler from "./api/files-approval.js";
import filesApprovalDecisionHandler from "./api/files-approval-decision.js";
import accountMembersResolveEmailsHandler from "./api/account-members-resolve-emails.js";
import teamsWebhookHandler from "./api/teams-webhook.js";
import teamsSubscribeHandler from "./api/teams-subscribe.js";
import accountViewConfigHandler from "./api/account-view-config.js";
import myTasksHandler from "./api/my-tasks.js";
import filesOpenedHandler from "./api/files-opened.js";
import teamLoadHandler from "./api/team-load.js";
import personCapacityHandler from "./api/person-capacity.js";
import { startTeamsRenewalLoop } from "./api/teams-renew.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(here, "apps/tab/dist");

const app = express();
app.use(express.json({ limit: "5mb" }));

// Express 5 auto-forwards a rejected promise RETURNED from a route handler to
// its error handling — but only if the handler returns that promise. Never
// discard it (e.g. with `void`): an un-returned rejection becomes an
// unhandled rejection that crashes this whole long-lived process, not just
// the one request (unlike Vercel, where each request is an isolated
// invocation). The explicit try/catch is defense in depth on top of that.
function guard(handler: (req: express.Request, res: express.Response) => Promise<void>) {
  return async (req: express.Request, res: express.Response) => {
    try {
      await handler(req, res);
    } catch (err) {
      console.error("API handler error:", err);
      if (!res.headersSent) res.status(500).json({ error: "internal error" });
    }
  };
}

/**
 * Teams embeds the app in an iframe, so the browser needs explicit permission
 * to frame it. `frame-ancestors` is the modern control; X-Frame-Options is
 * deliberately NOT set, because its ALLOW-FROM is ignored by every current
 * browser and a bare SAMEORIGIN would block Teams outright.
 *
 * The list is exact — Teams' own hosts and nothing else. Widening it to `*`
 * would let any site frame the workspace, which is a clickjacking surface on
 * an app holding live client data.
 */
const FRAME_ANCESTORS =
  "frame-ancestors 'self' teams.microsoft.com *.teams.microsoft.com *.teams.microsoft.us *.skype.com *.cloud.microsoft;";
app.use((_req, res, next) => {
  res.setHeader("Content-Security-Policy", FRAME_ANCESTORS);
  next();
});

app.all("/api/state", guard(stateHandler));
app.all("/api/mirror", guard(mirrorHandler));
app.all("/api/kantata-write", guard(kantataWriteHandler));
app.all("/api/workspace", guard(workspaceHandler));
app.all("/api/account", guard(accountHandler));
app.all("/api/task", guard(taskHandler));
app.all("/api/external", guard(externalHandler));
app.all("/api/grant", guard(grantHandler));
app.all("/api/grant/revoke-all", guard(grantRevokeAllHandler));
app.all("/api/task-assignments", guard(taskAssignmentsHandler));
app.all("/api/message", guard(messageHandler));
app.all("/api/message/visibility", guard(messageVisibilityHandler));
app.all("/api/member", guard(memberHandler));
app.all("/api/share", guard(shareHandler));
app.all("/api/notify", guard(notifyHandler));
app.all("/api/remind", guard(remindHandler));
app.all("/api/template", guard(templateHandler));
app.all("/api/admin/users", guard(adminUsersHandler));
app.all("/api/admin/externals", guard(adminExternalsHandler));
app.all("/api/admin/offboard", guard(adminOffboardHandler));
app.all("/api/admin/accounts/archive-all", guard(adminAccountsArchiveAllHandler));
app.all("/api/admin/workspace/clear", guard(adminWorkspaceClearHandler));
app.all("/api/account-deepen", guard(accountDeepenHandler));
app.all("/api/account-import", guard(accountImportHandler));
app.all("/api/account-scope", guard(accountScopeHandler));
app.all("/api/account-projects", guard(accountProjectsHandler));
app.all("/api/account-campaigns", guard(accountCampaignsHandler));
app.all("/api/account-tasks-synced", guard(accountTasksSyncedHandler));
app.all("/api/me", guard(meHandler));
app.all("/api/external-workspace", guard(externalWorkspaceHandler));
app.all("/api/account-team", guard(accountTeamHandler));
app.all("/api/account-team-members", guard(accountTeamMembersHandler));
app.all("/api/account-folders-sync", guard(accountFoldersSyncHandler));
app.all("/api/account-folders", guard(accountFoldersHandler));
app.all("/api/account-provisioning-plan", guard(accountProvisioningPlanHandler));
app.all("/api/account-folder-children", guard(accountFolderChildrenHandler));
app.all("/api/files", guard(filesHandler));
app.all("/api/files-upload-session", guard(filesUploadSessionHandler));
app.all("/api/files-approval", guard(filesApprovalHandler));
app.all("/api/files-approval-decision", guard(filesApprovalDecisionHandler));
app.all("/api/account-members-resolve-emails", guard(accountMembersResolveEmailsHandler));
// Two-way Teams sync: the webhook is intentionally unauthenticated (Graph has
// no session — it self-validates via clientState); subscribe is member-gated.
app.all("/api/teams-webhook", guard(teamsWebhookHandler));
app.all("/api/teams-subscribe", guard(teamsSubscribeHandler));
app.all("/api/account-view-config", guard(accountViewConfigHandler));
app.all("/api/my-tasks", guard(myTasksHandler));
// Recipient marks a shared file/approval opened — stamps opened_at so AGP sees
// who opened what, when (Client activity history). Was defined but unrouted.
app.all("/api/files-opened", guard(filesOpenedHandler));
// Cross-client resourcing: each person's weekly load vs capacity, portfolio-wide.
app.all("/api/team-load", guard(teamLoadHandler));
app.all("/api/person-capacity", guard(personCapacityHandler));

app.use(express.static(distDir));
// SPA fallback — anything not a static asset or /api/* route gets index.html.
app.use((_req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`agp-ai-collaboration listening on :${port}`);
  // Keep Teams two-way-sync subscriptions alive past their ~1h expiry. In-process
  // on this long-lived container (same model as background provisioning), so
  // there's nothing external to schedule. No-ops when Teams sync isn't configured.
  startTeamsRenewalLoop();
});
