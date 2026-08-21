-- The admin panel showed the raw Team GUID next to "Adopted: Team" — nothing
-- persisted the Team's actual display name, even though the adopt/connect
-- call (api/account-team.ts) already fetches `GET /teams/{id}`, which
-- carries `displayName`, and simply discarded it.
alter table collab.client_account add column ms_team_name text;
