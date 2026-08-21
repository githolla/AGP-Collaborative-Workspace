-- Only ever one active file_approval per shared item (docs/api-spec-workspace-
-- mutations.md "Files and approvals"). Without this, two concurrent POST
-- /api/files-approval calls for the SAME (account, ms_item_id) — a
-- double-click, two open tabs, or a retried request after a network blip —
-- create two contradictory rows for the same document (one maybe already
-- decided, one freshly pending), with nothing in the schema preventing it
-- and no way to reconcile them except a manual delete.
--
-- Not partial: DELETE /api/files-approval (unshare) hard-deletes the row —
-- unlike collab.share, there is no "revoked but kept" state here — so a
-- plain unique constraint is correct: after unsharing, the slot is free for
-- a genuinely new share.
alter table collab.file_approval
  add constraint file_approval_account_item_unique unique (account_id, ms_item_id);
