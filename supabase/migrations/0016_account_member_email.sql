-- B5 (teams-provisioning-plan.md): adding someone to the Microsoft Team means
-- resolving their email to a Graph user id (`GET /users?$filter=mail eq
-- '{email}'`) and POSTing them to `/teams/{teamId}/members`. account_member
-- carries no email today — most rows are seeded from Kantata's roster
-- (0007's own comment: "have never signed into the app"), identified only by
-- person_id/name. Without an email there is nothing to resolve against Graph
-- at all, so this is a real prerequisite, not an enrichment.
--
-- Nullable and workspace-admin-editable: a member added before this column
-- existed, or one Kantata never gave an email, simply cannot be synced to the
-- Team yet — reported as unresolved (B5's own rule), never guessed.
alter table collab.account_member add column email text;

-- account_member never had an UPDATE policy (0008 only shipped read/insert/
-- delete — there was nothing on the row worth changing after creation until
-- now). Same admin gate as insert/delete.
create policy account_member_update on collab.account_member
  for update using (collab.is_workspace_admin(account_id)) with check (collab.is_workspace_admin(account_id));
