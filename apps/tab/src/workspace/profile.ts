import { useCallback, useEffect, useState } from "react";

/**
 * Local user profile. Stored under its own key — separate from the workspace
 * data — so "Reset demo data" keeps your name. When Teams SSO lands (M3) the
 * name comes from the signed-in identity and this becomes the display-name
 * override at most.
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
  const [name, setNameState] = useState<string>(() => {
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

  return { name, setName };
}
