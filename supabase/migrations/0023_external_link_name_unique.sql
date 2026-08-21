-- Nothing stopped the same person being added to an account twice by the
-- free-text "invite client/contractor" path (only the "pick an existing
-- person" picker, keyed on a real userId, ever deduped) — a code review
-- flagged this as a real gap. Case/whitespace-insensitive on name, since
-- that's the one field always present (email is optional here, same as the
-- old model) and matches how account_member/addAccountMemberNamed-era
-- dedup checks already compared names elsewhere in this codebase.
create unique index external_link_account_name_unique
  on collab.external_link (account_id, lower(trim(name)));
