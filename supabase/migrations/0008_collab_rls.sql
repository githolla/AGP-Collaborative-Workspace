-- Row-level security for the collab schema (teams-provisioning-plan.md B6).
-- Every handler in /api builds its Supabase client from the CALLER'S OWN JWT —
-- never SUPABASE_SERVICE_ROLE_KEY, which bypasses every policy below and is
-- reserved for migrations and the two admin operations that deliberately
-- cross user boundaries. That discipline lives in the API layer, not here;
-- this file is the half that actually enforces it.
--
-- STATUS AS OF WRITING: not applied anywhere. Review alongside 0007_collab_schema.sql.

-- ---------------------------------------------------------------------------
-- Helpers — security definer, so they can read tables the calling policy's
-- own row-visibility rules would otherwise hide from the caller. Kept small
-- and single-purpose on purpose: each answers exactly one question, and
-- every policy below is built by composing these, never by re-deriving the
-- logic inline (which is what invites either infinite recursion — a policy
-- on account_member that queries account_member — or a sequential scan).
-- ---------------------------------------------------------------------------

-- The seam between "whoever is calling this" and "the identity everything
-- else is keyed on". Same value as auth.uid() today; kept as its own
-- function so a future change (impersonation, a service identity) has one
-- place to change rather than a search-and-replace across every policy.
create or replace function collab.current_app_user()
returns uuid
language sql stable
security definer
set search_path = collab, public
as $$
  select auth.uid();
$$;

create or replace function collab.is_app_admin()
returns boolean
language sql stable
security definer
set search_path = collab, public
as $$
  select exists (
    select 1 from collab.user_role
    where user_id = auth.uid() and role = 'app_admin'
  );
$$;

-- App admin implies workspace admin everywhere (D4: app admin can do
-- everything a workspace admin can) — checked here once rather than at
-- every call site.
create or replace function collab.is_workspace_admin(p_account_id uuid)
returns boolean
language sql stable
security definer
set search_path = collab, public
as $$
  select
    collab.is_app_admin()
    or exists (
      select 1 from collab.user_role
      where user_id = auth.uid() and role = 'workspace_admin' and account_id = p_account_id
    );
$$;

-- Internal member OR a linked external — the base "may this person see
-- anything about this account at all" check most read policies start from.
create or replace function collab.can_read_account(p_account_id uuid)
returns boolean
language sql stable
security definer
set search_path = collab, public
as $$
  select
    collab.is_app_admin()
    or exists (select 1 from collab.account_member where account_id = p_account_id and user_id = auth.uid())
    or exists (select 1 from collab.external_link where account_id = p_account_id and user_id = auth.uid());
$$;

-- Does the caller hold a grant covering ANY of the given Kantata ids? Pass a
-- row's own precomputed kantata_ancestor_ids (task, thread_message) — this
-- function does not walk Kantata's hierarchy itself. That resolution is an
-- application-layer concern (the same code as campaignImport.ts's
-- projectPhaseResolver / msTeams.ts's folderTreeOf), computed once when the
-- row is written, because the live Kantata mirror it depends on is not part
-- of this schema and should not become part of it.
create or replace function collab.holds_grant(p_account_id uuid, p_kantata_ids text[])
returns boolean
language sql stable
security definer
set search_path = collab, public
as $$
  select exists (
    select 1 from collab.access_grant
    where account_id = p_account_id and user_id = auth.uid() and kantata_id = any(p_kantata_ids)
  );
$$;

-- Is the caller linked to this account as the given external role?
create or replace function collab.external_role(p_account_id uuid)
returns text
language sql stable
security definer
set search_path = collab, public
as $$
  select role from collab.external_link where account_id = p_account_id and user_id = auth.uid() limit 1;
$$;

-- The ONE bootstrap check: did the caller create this account? Must be its
-- own security-definer function, not an inline subquery in a policy — a
-- plain subquery against client_account runs as the CALLING role and is
-- therefore subject to client_account_read's own policy (can_read_account),
-- which the brand-new creator cannot pass yet (no account_member row exists
-- until AFTER this very check succeeds). That circularity is a real deadlock,
-- not a hypothetical one — it was caught by testing as a non-superuser role,
-- where table-owner RLS bypass doesn't paper over it.
create or replace function collab.created_this_account(p_account_id uuid)
returns boolean
language sql stable
security definer
set search_path = collab, public
as $$
  select exists (select 1 from collab.client_account where id = p_account_id and created_by = auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- app_user
-- ---------------------------------------------------------------------------

alter table collab.app_user enable row level security;

create policy app_user_read on collab.app_user
  for select using (id = auth.uid() or collab.is_app_admin());

create policy app_user_self_update on collab.app_user
  for update using (id = auth.uid()) with check (id = auth.uid());

-- No insert policy for normal callers: rows are created only by the
-- security-definer trigger on auth.users, which runs as its owner and is not
-- subject to RLS.

-- ---------------------------------------------------------------------------
-- user_role
-- ---------------------------------------------------------------------------

alter table collab.user_role enable row level security;

create policy user_role_read on collab.user_role
  for select using (
    collab.is_app_admin()
    or user_id = auth.uid()
    or (account_id is not null and collab.is_workspace_admin(account_id))
  );

-- The bootstrap case: a brand-new account has no workspace_admin yet, so
-- "is_workspace_admin(account_id)" is false for its own creator at the
-- moment they need to become one. Allowed instead via client_account's own
-- created_by column — the one and only path to becoming an account's FIRST
-- admin without already being one.
create policy user_role_insert on collab.user_role
  for insert with check (
    (role = 'app_admin' and collab.is_app_admin())
    or (
      role = 'workspace_admin' and account_id is not null and (
        collab.is_workspace_admin(account_id)
        or collab.created_this_account(account_id)
      )
    )
  );

create policy user_role_delete on collab.user_role
  for delete using (
    (role = 'app_admin' and collab.is_app_admin())
    or (role = 'workspace_admin' and account_id is not null and collab.is_workspace_admin(account_id))
  );

-- ---------------------------------------------------------------------------
-- client_account
-- ---------------------------------------------------------------------------

alter table collab.client_account enable row level security;

create policy client_account_read on collab.client_account
  for select using (collab.can_read_account(id));

-- Any signed-in INTERNAL person may create a workspace — there is no account
-- yet to be "workspace admin" of, so this cannot be gated by
-- is_workspace_admin. The API handler inserts the matching user_role row
-- (workspace_admin, granted via the bootstrap path above) in the same
-- request. External users never reach this: they have no reason to create
-- a client workspace and kind = 'external' blocks it here.
create policy client_account_insert on collab.client_account
  for insert with check (
    exists (select 1 from collab.app_user where id = auth.uid() and kind = 'internal')
  );

create policy client_account_update on collab.client_account
  for update using (collab.is_workspace_admin(id)) with check (collab.is_workspace_admin(id));

-- ---------------------------------------------------------------------------
-- account_member
-- ---------------------------------------------------------------------------

alter table collab.account_member enable row level security;

create policy account_member_read on collab.account_member
  for select using (collab.can_read_account(account_id));

create policy account_member_insert on collab.account_member
  for insert with check (collab.is_workspace_admin(account_id));

create policy account_member_delete on collab.account_member
  for delete using (collab.is_workspace_admin(account_id));

-- ---------------------------------------------------------------------------
-- external_link
-- ---------------------------------------------------------------------------

alter table collab.external_link enable row level security;

create policy external_link_read on collab.external_link
  for select using (
    collab.is_workspace_admin(account_id)
    or exists (select 1 from collab.account_member m where m.account_id = external_link.account_id and m.user_id = auth.uid())
    or user_id = auth.uid() -- an external can always see their own link
  );

create policy external_link_insert on collab.external_link
  for insert with check (collab.is_workspace_admin(account_id));

create policy external_link_update on collab.external_link
  for update using (collab.is_workspace_admin(account_id)) with check (collab.is_workspace_admin(account_id));

create policy external_link_delete on collab.external_link
  for delete using (collab.is_workspace_admin(account_id));

-- ---------------------------------------------------------------------------
-- access_grant
-- ---------------------------------------------------------------------------

alter table collab.access_grant enable row level security;

create policy access_grant_read on collab.access_grant
  for select using (collab.is_workspace_admin(account_id) or user_id = auth.uid());

create policy access_grant_insert on collab.access_grant
  for insert with check (collab.is_workspace_admin(account_id));

create policy access_grant_delete on collab.access_grant
  for delete using (collab.is_workspace_admin(account_id));

-- ---------------------------------------------------------------------------
-- task
-- ---------------------------------------------------------------------------

alter table collab.task enable row level security;

create policy task_read on collab.task
  for select using (
    exists (select 1 from collab.account_member m where m.account_id = task.account_id and m.user_id = auth.uid())
    or collab.is_app_admin()
    or (
      collab.holds_grant(task.account_id, task.kantata_ancestor_ids)
      and (
        (collab.external_role(task.account_id) = 'client' and task.client_visible)
        or (collab.external_role(task.account_id) = 'contractor' and task.contractor_visible)
      )
    )
  );

-- Flagging a task shareable is member-level (D1); giving access is not this
-- policy's concern — that is access_grant. Any member may write; externals
-- never write a task in this version (the API spec lists task mutations as
-- member-only).
create policy task_insert on collab.task
  for insert with check (exists (select 1 from collab.account_member m where m.account_id = task.account_id and m.user_id = auth.uid()) or collab.is_workspace_admin(task.account_id));

create policy task_update on collab.task
  for update using (exists (select 1 from collab.account_member m where m.account_id = task.account_id and m.user_id = auth.uid()) or collab.is_workspace_admin(task.account_id));

create policy task_delete on collab.task
  for delete using (exists (select 1 from collab.account_member m where m.account_id = task.account_id and m.user_id = auth.uid()) or collab.is_workspace_admin(task.account_id));

-- ---------------------------------------------------------------------------
-- thread_message
-- ---------------------------------------------------------------------------

alter table collab.thread_message enable row level security;

create policy thread_message_read on collab.thread_message
  for select using (
    exists (select 1 from collab.account_member m where m.account_id = thread_message.account_id and m.user_id = auth.uid())
    or collab.is_app_admin()
    or (
      collab.holds_grant(thread_message.account_id, thread_message.kantata_ancestor_ids)
      and (
        (collab.external_role(thread_message.account_id) = 'client' and thread_message.client_visible)
        or (collab.external_role(thread_message.account_id) = 'contractor' and thread_message.contractor_visible)
      )
    )
  );

-- An external MAY post (API spec: "external may post into a milestone they
-- hold") but only into a milestone their own grant covers, and only flagged
-- for their own audience — never the other. The handler is what actually
-- stamps author/kantataId/the flag from the token rather than trusting the
-- body; this check is the database's OWN backstop on the same rule, not a
-- restatement of it in a different place.
create policy thread_message_insert on collab.thread_message
  for insert with check (
    exists (select 1 from collab.account_member m where m.account_id = thread_message.account_id and m.user_id = auth.uid())
    or (
      collab.external_role(thread_message.account_id) = 'client'
      and collab.holds_grant(thread_message.account_id, thread_message.kantata_ancestor_ids)
      and thread_message.client_visible and not thread_message.contractor_visible
    )
    or (
      collab.external_role(thread_message.account_id) = 'contractor'
      and collab.holds_grant(thread_message.account_id, thread_message.kantata_ancestor_ids)
      and thread_message.contractor_visible and not thread_message.client_visible
    )
  );

-- Author only, enforced on the real identity column — never the display-name
-- string, which is exactly the kind of fragile match handover.ts warns
-- against elsewhere.
create policy thread_message_update on collab.thread_message
  for update using (author_user_id = auth.uid()) with check (author_user_id = auth.uid());

create policy thread_message_delete on collab.thread_message
  for delete using (author_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- campaign / activity — internal-member surfaces, plus one external case
-- ---------------------------------------------------------------------------

alter table collab.campaign enable row level security;

-- A CLIENT external's dashboard shows campaigns (the plan's "what each caller
-- gets" table: "Campaigns, plan, dashboard, approvals — limited to granted
-- milestones" for clients, "—" for contractors). Per-milestone filtering
-- needs campaign.kantata_project_id populated, which nothing writes yet — see
-- the column's own comment in 0007. Until then a client sees every campaign
-- on an account they are linked to; a contractor sees none. Documented gap,
-- not a silent one.
create policy campaign_read on collab.campaign
  for select using (
    exists (select 1 from collab.account_member m where m.account_id = campaign.account_id and m.user_id = auth.uid())
    or collab.is_app_admin()
    or collab.external_role(campaign.account_id) = 'client'
  );

create policy campaign_write on collab.campaign
  for insert with check (exists (select 1 from collab.account_member m where m.account_id = campaign.account_id and m.user_id = auth.uid()) or collab.is_workspace_admin(campaign.account_id));

create policy campaign_update on collab.campaign
  for update using (exists (select 1 from collab.account_member m where m.account_id = campaign.account_id and m.user_id = auth.uid()) or collab.is_workspace_admin(campaign.account_id));

create policy campaign_delete on collab.campaign
  for delete using (exists (select 1 from collab.account_member m where m.account_id = campaign.account_id and m.user_id = auth.uid()) or collab.is_workspace_admin(campaign.account_id));

-- Never external — activity is the internal "what's new" feed, not listed
-- anywhere in the external payload.
alter table collab.activity enable row level security;

create policy activity_read on collab.activity
  for select using (exists (select 1 from collab.account_member m where m.account_id = activity.account_id and m.user_id = auth.uid()) or collab.is_app_admin());

create policy activity_insert on collab.activity
  for insert with check (exists (select 1 from collab.account_member m where m.account_id = activity.account_id and m.user_id = auth.uid()) or collab.is_workspace_admin(activity.account_id));

-- ---------------------------------------------------------------------------
-- ms_folder
-- ---------------------------------------------------------------------------

alter table collab.ms_folder enable row level security;

-- An external needs read access to resolve which folder /api/files should
-- list, whenever that handler forwards the caller's own JWT rather than
-- using the service role.
create policy ms_folder_read on collab.ms_folder
  for select using (
    exists (select 1 from collab.account_member m where m.account_id = ms_folder.account_id and m.user_id = auth.uid())
    or collab.is_app_admin()
    or collab.holds_grant(ms_folder.account_id, array[ms_folder.kantata_id])
  );

create policy ms_folder_insert on collab.ms_folder
  for insert with check (collab.is_workspace_admin(account_id));

create policy ms_folder_update on collab.ms_folder
  for update using (collab.is_workspace_admin(account_id));

-- No delete policy: folders are reported when gone from Kantata, never
-- deleted (B4 §4) — there is deliberately no way to remove a row here at all.

-- ---------------------------------------------------------------------------
-- share
-- ---------------------------------------------------------------------------

alter table collab.share enable row level security;

create policy share_read on collab.share
  for select using (
    exists (select 1 from collab.account_member m where m.account_id = share.account_id and m.user_id = auth.uid())
    or collab.is_app_admin()
    or recipient_user_id = auth.uid()
  );

create policy share_insert on collab.share
  for insert with check (collab.is_workspace_admin(account_id));

-- HONEST GAP: "POST /api/files/opened" is `role: any` — even the recipient
-- should be able to mark their own share opened, but RLS alone cannot
-- restrict an UPDATE to touching only opened_at/open_source without a
-- trigger this pass doesn't yet build. For now the handler is what must
-- refuse to change anything else when the caller is not a workspace admin;
-- this policy only gates WHO may run an update at all, not WHICH columns.
-- A follow-up trigger (collab.protect_share_fields) should close this before
-- the endpoint is trusted at scale.
create policy share_update on collab.share
  for update using (
    collab.is_workspace_admin(account_id)
    or recipient_user_id = auth.uid()
  );

-- ---------------------------------------------------------------------------
-- file_approval
-- ---------------------------------------------------------------------------

alter table collab.file_approval enable row level security;

-- Same documented gap as campaign_read: no per-milestone filter yet, since an
-- approval is keyed on a SharePoint item id with no stored Kantata ancestor.
-- A client linked to the account sees every approval on it for now.
create policy file_approval_read on collab.file_approval
  for select using (
    exists (select 1 from collab.account_member m where m.account_id = file_approval.account_id and m.user_id = auth.uid())
    or collab.is_app_admin()
    or collab.external_role(file_approval.account_id) = 'client'
  );

create policy file_approval_insert on collab.file_approval
  for insert with check (collab.is_workspace_admin(account_id) or exists (select 1 from collab.account_member m where m.account_id = file_approval.account_id and m.user_id = auth.uid()));

create policy file_approval_delete on collab.file_approval
  for delete using (collab.is_workspace_admin(account_id) or exists (select 1 from collab.account_member m where m.account_id = file_approval.account_id and m.user_id = auth.uid()));

-- The client's decision — approve or request changes. Nothing else on the
-- row should move via this path; same column-level caveat as share_update.
create policy file_approval_decision on collab.file_approval
  for update using (
    collab.external_role(file_approval.account_id) = 'client'
    or collab.is_workspace_admin(account_id)
    or exists (select 1 from collab.account_member m where m.account_id = file_approval.account_id and m.user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- access_audit
-- ---------------------------------------------------------------------------

alter table collab.access_audit enable row level security;

create policy access_audit_read on collab.access_audit
  for select using (collab.is_workspace_admin(account_id));

-- Anyone who can read the account may write an audit row about their own
-- action on it (an external's file open, a member's grant change) — audit
-- trails should never be blocked by the same permission they are recording.
create policy access_audit_insert on collab.access_audit
  for insert with check (collab.can_read_account(account_id));
