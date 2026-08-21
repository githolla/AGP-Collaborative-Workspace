/**
 * Shared "is this caller an app admin" gate for /api/admin/* — every one of
 * those endpoints needs the identical check, and unlike a single-resource
 * endpoint (where "no access" collapses into a 404 to avoid revealing a
 * row's existence) there is no row here to hide: the admin surface itself
 * isn't a secret, so a non-admin gets a direct, honest 403.
 */
import { withUserContext } from "./db.js";

export async function isAppAdmin(userId: string): Promise<boolean> {
  const [row] = await withUserContext(userId, async (tx) => {
    return tx<{ ok: boolean }[]>`select collab.is_app_admin() as ok`;
  });
  return row?.ok === true;
}
