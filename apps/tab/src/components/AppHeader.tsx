import type { CSSProperties } from "react";
import { APP_TITLE, BRAND } from "../branding.js";

const styles: Record<string, CSSProperties> = {
  bar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    height: 56,
    padding: "0 20px",
    background: BRAND.headerBg,
    color: BRAND.headerText,
  },
  left: { display: "flex", alignItems: "center", gap: 18, minWidth: 0 },
  logo: { display: "flex", alignItems: "center", gap: 8 },
  logoMark: { fontSize: 22, fontWeight: 800, letterSpacing: 0.5, lineHeight: 1 },
  logoDivider: { width: 1, height: 26, background: "rgba(255,255,255,0.35)" },
  logoSub: {
    fontSize: 7.5,
    fontWeight: 600,
    letterSpacing: 0.8,
    lineHeight: 1.35,
    textTransform: "uppercase",
    opacity: 0.9,
    whiteSpace: "pre-line",
  },
  title: { display: "flex", alignItems: "baseline", gap: 7, whiteSpace: "nowrap" },
  titlePrimary: { fontSize: 13, fontWeight: 700, letterSpacing: 1.2 },
  titleSecondary: { fontSize: 13, fontWeight: 500, letterSpacing: 1.2, color: BRAND.headerMuted },
  right: { display: "flex", alignItems: "center", gap: 16 },
  live: { display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: BRAND.live },
  liveDot: { width: 7, height: 7, borderRadius: "50%", background: BRAND.live },
  iconButton: {
    display: "flex",
    alignItems: "center",
    background: "none",
    border: "none",
    padding: 4,
    cursor: "pointer",
    color: "rgba(255,255,255,0.85)",
  },
  avatar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 34,
    height: 34,
    borderRadius: "50%",
    background: BRAND.avatarBg,
    color: BRAND.avatarText,
    fontSize: 12.5,
    fontWeight: 700,
  },
};

function GearIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.09a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.09a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z" />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

export interface AppHeaderProps {
  /** Initials shown in the avatar chip; comes from Teams SSO once M3 lands. */
  userInitials: string;
  live?: boolean;
  onSettings?: () => void;
  onSignOut?: () => void;
}

export function AppHeader({ userInitials, live = true, onSettings, onSignOut }: AppHeaderProps) {
  return (
    <header style={styles.bar}>
      <div style={styles.left}>
        <div style={styles.logo}>
          <span style={styles.logoMark}>AGP</span>
          <span style={styles.logoDivider} />
          <span style={styles.logoSub}>{"Allegiance Group &\nPursuant"}</span>
        </div>
        <div style={styles.title}>
          <span style={styles.titlePrimary}>{APP_TITLE.primary}</span>
          <span style={styles.titleSecondary}>— {APP_TITLE.secondary}</span>
        </div>
      </div>
      <div style={styles.right}>
        {live && (
          <span style={styles.live}>
            <span style={styles.liveDot} />
            Live
          </span>
        )}
        <button type="button" style={styles.iconButton} aria-label="Settings" onClick={onSettings}>
          <GearIcon />
        </button>
        <button type="button" style={styles.iconButton} aria-label="Sign out" onClick={onSignOut}>
          <SignOutIcon />
        </button>
        <span style={styles.avatar}>{userInitials}</span>
      </div>
    </header>
  );
}
