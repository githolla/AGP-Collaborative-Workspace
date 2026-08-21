import { msApiGetPlain } from "./msApiFetch.js";

/**
 * `GET /api/me` (teams-provisioning-plan.md C1) — the real, server-side
 * identity classification. Used by App.tsx to decide whether to mount the
 * internal app (`useWorkspace()`, `/api/state`) or the external subtree —
 * `kind` here, not a client-side email-domain guess, is what that decision
 * must be based on.
 */
export interface MeAccountLink {
  accountId: string;
  clientName: string;
  role: "client" | "contractor";
}

export interface Me {
  kind: "internal" | "external" | "unknown";
  displayName?: string;
  accounts: MeAccountLink[];
}

export async function fetchMe(): Promise<Me> {
  return msApiGetPlain<Me>("/api/me");
}
