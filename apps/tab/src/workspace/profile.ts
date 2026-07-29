import { useCallback, useEffect, useState } from "react";
import { currentIdentity, handleRedirect, signInWithMicrosoft, signOutOfMicrosoft, ssoConfigured } from "../auth/ssoAuth.js";

/**
 * Local user profile. Stored under its own key — separate from the workspace
 * data — so "Reset demo data" keeps your name. When MS SSO is configured, the
 * name/email come from the signed-in Microsoft identity and this local name
 * becomes a display-name override at most.
 */

const PROFILE_KEY = "agp-collab-profile-v1";
const DEFAULT_NAME = "Barry Medley";

/** "Barry Medley" → "BM"; single names use their first letter. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

export function useProfile() {
  const initialIdentity = currentIdentity();
  const [ssoName, setSsoName] = useState<string | null>(initialIdentity?.name ?? null);
  const [ssoEmail, setSsoEmail] = useState<string | null>(initialIdentity?.email ?? null);
  const [name, setNameState] = useState<string>(() => {
    if (initialIdentity?.name) return initialIdentity.name;
    try {
      const raw = window.localStorage.getItem(PROFILE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { name?: string };
        if (parsed.name?.trim()) return parsed.name.trim();
      }
    } catch {
      // corrupted storage falls through to the default
    }
    return DEFAULT_NAME;
  });

  // Complete a Microsoft redirect on load (no-op when SSO isn't configured).
  useEffect(() => {
    let live = true;
    void handleRedirect().then((id) => {
      if (live && id) {
        setSsoName(id.name);
        setSsoEmail(id.email);
        setNameState(id.name);
      }
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(PROFILE_KEY, JSON.stringify({ name }));
    } catch {
      // storage full/unavailable — the session still works in memory
    }
  }, [name]);

  /** Empty names are ignored — the app always has someone to greet. */
  const setName = useCallback((next: string) => {
    if (next.trim()) setNameState(next.trim());
  }, []);

  const signIn = useCallback(() => void signInWithMicrosoft(), []);
  const signOut = useCallback(() => {
    void signOutOfMicrosoft();
    setSsoName(null);
    setSsoEmail(null);
  }, []);

  return {
    name,
    setName,
    /** True once a Microsoft identity is present. */
    signedIn: ssoName != null,
    email: ssoEmail,
    /** Whether an Azure app registration is wired (env present). */
    ssoConfigured: ssoConfigured(),
    signIn,
    signOut,
  };
}
