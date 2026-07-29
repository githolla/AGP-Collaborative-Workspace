import { currentAccessToken } from "./ssoAuth.js";

/**
 * Wrapper for same-origin /api calls. When Supabase auth is active, attach
 * the current access token so AUTH_REQUIRED endpoints authorize.
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const token = (await currentAccessToken())?.trim();
  if (!token) return fetch(input, init);

  const headers = new Headers(init?.headers);
  if (!headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...(init ?? {}), headers });
}