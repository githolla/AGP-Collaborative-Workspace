import { useState, type CSSProperties } from "react";
import { APP_TITLE, BRAND } from "../branding.js";
import { initialsOf } from "../workspace/profile.js";

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
  titlePrimary: { fontSize: 13, fontWeight: 700, letterSpacing: 1.2, color: BRAND.accent },
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
    border: "none",
    cursor: "pointer",
    padding: 0,
  },
  popover: {
    position: "absolute",
    top: 44,
    right: 0,
    width: 264,
    background: "#fff",
    color: "#26251f",
    border: "1px solid #e1e0d9",
    borderRadius: 10,
    boxShadow: "0 10px 30px rgba(11, 60, 110, 0.18)",
    padding: 14,
    zIndex: 60,
    textAlign: "left",
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
  /** Display name; from the local profile today, Teams SSO once M3 lands. */
  userName: string;
  onChangeName: (name: string) => void;
  /** Truthful data status: green when /api/mirror served live Kantata/HubSpot data. */
  live?: boolean;
  liveLabel?: string;
  liveDetail?: string;
  /** Click-to-refresh: hard re-pull of HubSpot & Kantata, bypassing caches. */
  onRefreshData?: () => void;
  onSettings?: () => void;
  onSignOut?: () => void;
  /** Click the logo to return to the client list (home). */
  onHome?: () => void;
}

/** Click the avatar → the profile panel: see who you are, change your name. */
function ProfileMenu({ userName, onChangeName }: { userName: string; onChangeName: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(userName);

  const toggle = () => {
    setDraft(userName);
    setOpen((o) => !o);
  };
  const save = () => {
    if (!draft.trim()) return;
    onChangeName(draft.trim());
    setOpen(false);
  };

  return (
    <div style={{ position: "relative" }}>
      <button type="button" style={styles.avatar} aria-label="Your profile" aria-expanded={open} onClick={toggle}>
        {initialsOf(userName)}
      </button>
      {open && (
        <div style={styles.popover} role="dialog" aria-label="Your profile">
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: "#8a887f" }}>
            Your profile
          </div>
          <label htmlFor="profile-name" style={{ display: "block", fontSize: 11.5, color: "#52514e", margin: "10px 0 4px" }}>
            Display name
          </label>
          <input
            id="profile-name"
            className="input"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") setOpen(false);
            }}
            style={{ width: "100%", fontSize: 12.5 }}
          />
          <div style={{ fontSize: 10.5, color: "#8a887f", marginTop: 6, lineHeight: 1.5 }}>
            Shown in greetings and on messages you post. Stored in this browser until Teams
            sign-in takes over.
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button type="button" className="btn btn-primary btn-sm" disabled={!draft.trim()} onClick={save}>
              Save
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function AppHeader({ userName, onChangeName, live = false, liveLabel, liveDetail, onRefreshData, onSettings, onSignOut, onHome }: AppHeaderProps) {
  return (
    <header style={styles.bar}>
      <div style={styles.left}>
        <button
          type="button"
          onClick={onHome}
          title="Back to the client list"
          style={{ ...styles.logo, background: "none", border: "none", padding: 0, cursor: onHome ? "pointer" : "default", color: "inherit" }}
        >
          <span style={styles.logoMark}>AGP</span>
          <span style={styles.logoDivider} />
          <span style={styles.logoSub}>{"Allegiance Group &\nPursuant"}</span>
        </button>
        <div style={styles.title}>
          <span style={styles.titlePrimary}>{APP_TITLE.primary}</span>
          <span style={styles.titleSecondary}>— {APP_TITLE.secondary}</span>
        </div>
      </div>
      <div style={styles.right}>
        <button
          type="button"
          onClick={onRefreshData}
          title={`${liveDetail ?? ""}${onRefreshData ? " — click to refresh from Kantata now" : ""}`}
          style={{
            ...styles.live,
            ...(live ? {} : { color: "rgba(255,255,255,0.55)" }),
            background: "none",
            border: "none",
            cursor: onRefreshData ? "pointer" : "default",
            padding: 0,
            font: "inherit",
          }}
        >
          <span style={{ ...styles.liveDot, ...(live ? {} : { background: "rgba(255,255,255,0.35)" }) }} />
          {liveLabel ?? (live ? "Live" : "Demo data")}
          {onRefreshData && <span aria-hidden style={{ marginLeft: 5, opacity: 0.7 }}>⟳</span>}
        </button>
        <button type="button" style={styles.iconButton} aria-label="Settings" onClick={onSettings}>
          <GearIcon />
        </button>
        <button type="button" style={styles.iconButton} aria-label="Sign out" onClick={onSignOut}>
          <SignOutIcon />
        </button>
        <ProfileMenu userName={userName} onChangeName={onChangeName} />
      </div>
    </header>
  );
}
