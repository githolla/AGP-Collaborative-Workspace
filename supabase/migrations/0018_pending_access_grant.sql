-- Lets a grant be created before the person has ever signed into the app —
-- the fix for a real ordering bug: the Microsoft B2B guest invite
-- (api/grant.ts's issueSharePointInvite, POST /invite) only needs an email
-- address to fire, but access_grant.user_id was `not null`, so a grant
-- (and therefore the invite) couldn't be created until the person already
-- had a collab.app_user row — which only exists AFTER they've signed in.
-- For someone with no Microsoft account, that's a dead end: they can't sign
-- in until they're a real Entra guest, and they can't become a guest until
-- the invite fires.
--
-- A grant now targets EITHER a resolved user_id OR a not-yet-resolved
-- external_link_id (the row that exists the moment staff add the client,
-- no sign-in required). No RLS policy changes needed: access_grant_read/
-- insert/update/delete already gate on `is_workspace_admin(account_id) or
-- user_id = auth.uid()` — a NULL user_id row can never match anyone's
-- auth.uid(), so a pending grant is inert (grants nothing via holds_grant,
-- visible only to an admin) until api/external.ts's "Resolve sign-in"
-- backfills the real user_id.
alter table collab.access_grant alter column user_id drop not null;
alter table collab.access_grant add column external_link_id uuid references collab.external_link (id) on delete cascade;
alter table collab.access_grant add constraint access_grant_target_check check (user_id is not null or external_link_id is not null);

-- The existing unique(account_id, user_id, kantata_id) doesn't dedupe two
-- pending grants for the same not-yet-resolved person — Postgres never
-- treats two NULLs as colliding in a unique constraint. This closes that
-- specific gap for the pending case only (user_id is null).
create unique index access_grant_pending_unique on collab.access_grant (account_id, external_link_id, kantata_id) where user_id is null;
