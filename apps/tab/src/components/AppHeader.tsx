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
  logo: { display: "flex", alignItems: "center", gap: 13 },
  /** White rounded chip with black "AGP" — the master-logo mark. */
  logoMark: {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    background: "#ffffff", color: BRAND.chipInk,
    fontSize: 17, fontWeight: 800, letterSpacing: 0.4, lineHeight: 1,
    padding: "8px 10px", borderRadius: 8,
  },
  lockup: { display: "flex", flexDirection: "column", lineHeight: 1.15, whiteSpace: "nowrap" },
  logoName: { fontSize: 16, fontWeight: 700, letterSpacing: 0.2, color: BRAND.headerText },
  logoOrg: { fontSize: 9, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: BRAND.lime, marginTop: 2 },
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
  onSettings?: () => void;
  onSignOut?: () => void;
  /** Click the logo to return to the client list (home). */
  onHome?: () => void;
  /** MS SSO identity state. */
  signedIn?: boolean;
  email?: string | null;
  ssoConfigured?: boolean;
  onSignIn?: () => void;
  /** Interim email+password sign-in; returns true on success. */
  onSignInPassword?: (email: string, password: string) => Promise<boolean>;
  /** Open the team-members admin. */
  onManageTeam?: () => void;
}

/** A little Microsoft logo — four coloured squares. */
function MsLogo() {
  return (
    <svg width="15" height="15" viewBox="0 0 21 21" aria-hidden style={{ flexShrink: 0 }}>
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

interface ProfileMenuProps {
  userName: string;
  onChangeName: (name: string) => void;
  signedIn?: boolean;
  email?: string | null;
  ssoConfigured?: boolean;
  onSignIn?: () => void;
  onSignOut?: () => void;
  /** Interim email+password sign-in; returns true on success. */
  onSignInPassword?: (email: string, password: string) => Promise<boolean>;
  /** Open the team-members admin (add people + passwords). */
  onManageTeam?: () => void;
}

/** Click the avatar → the profile panel: identity, sign-in, name. */
function ProfileMenu({ userName, onChangeName, signedIn, email, ssoConfigured, onSignIn, onSignOut, onSignInPassword, onManageTeam }: ProfileMenuProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(userName);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPw, setLoginPw] = useState("");
  const [loginErr, setLoginErr] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  const doLogin = async () => {
    if (!onSignInPassword || !loginEmail.trim() || !loginPw) return;
    setLoggingIn(true);
    setLoginErr(null);
    const ok = await onSignInPassword(loginEmail.trim(), loginPw);
    setLoggingIn(false);
    if (ok) {
      setLoginEmail("");
      setLoginPw("");
      setOpen(false);
    } else {
      setLoginErr("Email or password is incorrect.");
    }
  };

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
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 55 }} />
        <div style={{ ...styles.popover, zIndex: 56 }} role="dialog" aria-label="Your profile">
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: "#8a887f" }}>
            Your profile
          </div>

          {/* Microsoft sign-in / signed-in state */}
          <div style={{ margin: "10px 0", padding: "10px 11px", border: "1px solid #e1e0d9", borderRadius: 8, background: "#f8f8f6" }}>
            {signedIn ? (
              <>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: "#116a43" }}>✓ Signed in with Microsoft</div>
                {email && <div style={{ fontSize: 11, color: "#52514e", marginTop: 2, wordBreak: "break-all" }}>{email}</div>}
                <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={onSignOut}>
                  Sign out
                </button>
              </>
            ) : (
              <>
                {/* Interim email + password sign-in */}
                {onSignInPassword && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: "#52514e" }}>Sign in</div>
                    <input className="input" style={{ fontSize: 12.5 }} placeholder="Email" type="email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} />
                    <input
                      className="input"
                      style={{ fontSize: 12.5 }}
                      placeholder="Password"
                      type="password"
                      value={loginPw}
                      onChange={(e) => setLoginPw(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") void doLogin(); }}
                    />
                    {loginErr && <div style={{ fontSize: 11, color: "#c0392b" }}>{loginErr}</div>}
                    <button type="button" className="btn btn-primary btn-sm" disabled={loggingIn} onClick={() => void doLogin()}>
                      {loggingIn ? "Signing in…" : "Sign in"}
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  onClick={ssoConfigured ? onSignIn : undefined}
                  disabled={!ssoConfigured}
                  style={{
                    display: "flex", alignItems: "center", gap: 9, width: "100%", justifyContent: "center", marginTop: 8,
                    background: "#fff", border: "1px solid #8c8c8c", borderRadius: 6, padding: "8px 10px",
                    fontSize: 12.5, fontWeight: 600, color: "#3c3c3c", cursor: ssoConfigured ? "pointer" : "not-allowed",
                    opacity: ssoConfigured ? 1 : 0.6,
                  }}
                >
                  <MsLogo /> Sign in with Microsoft
                </button>
                <div style={{ fontSize: 10, color: "#8a887f", marginTop: 6, lineHeight: 1.5 }}>
                  {ssoConfigured
                    ? "Single sign-on via your Allegiance Microsoft 365 account."
                    : onSignInPassword
                      ? "Microsoft SSO turns on once Azure is wired — email + password is the interim sign-in."
                      : "Microsoft SSO turns on once Azure is wired."}
                </div>
              </>
            )}
            {onManageTeam && (
              <button type="button" className="btn-link" style={{ fontSize: 11, marginTop: 10 }} onClick={() => { setOpen(false); onManageTeam(); }}>
                Manage team members →
              </button>
            )}
          </div>

          <label htmlFor="profile-name" style={{ display: "block", fontSize: 11.5, color: "#52514e", margin: "10px 0 4px" }}>
            Display name
          </label>
          <input
            id="profile-name"
            className="input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") setOpen(false);
            }}
            style={{ width: "100%", fontSize: 12.5 }}
          />
          <div style={{ fontSize: 10.5, color: "#8a887f", marginTop: 6, lineHeight: 1.5 }}>
            {signedIn ? "Overrides the name shown from your Microsoft profile." : "Shown in greetings and on messages you post."}
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
        </>
      )}
    </div>
  );
}

export function AppHeader({ userName, onChangeName, live = false, liveLabel, liveDetail, onSettings, onSignOut, onHome, signedIn = false, email = null, ssoConfigured = false, onSignIn, onSignInPassword, onManageTeam }: AppHeaderProps) {
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
          <span style={styles.lockup}>
            <span style={styles.logoName}>{APP_TITLE.primary} {APP_TITLE.secondary}</span>
            <span style={styles.logoOrg}>Allegiance Group &amp; Pursuant</span>
          </span>
        </button>
      </div>
      <div style={styles.right}>
        {/* Live status only — no manual refresh. Data re-pulls on its own in
            the background and whenever a workspace opens; users never click. */}
        <span
          title={liveDetail ?? ""}
          style={{ ...styles.live, ...(live ? {} : { color: "rgba(255,255,255,0.55)" }) }}
        >
          <span style={{ ...styles.liveDot, ...(live ? {} : { background: "rgba(255,255,255,0.35)" }) }} />
          {liveLabel ?? (live ? "Live" : "Demo data")}
        </span>
        {onSettings && (
          <button type="button" style={styles.iconButton} aria-label="Settings" onClick={onSettings}>
            <GearIcon />
          </button>
        )}
        {signedIn && (
          <button type="button" style={styles.iconButton} aria-label="Sign out" onClick={onSignOut}>
            <SignOutIcon />
          </button>
        )}
        <ProfileMenu
          userName={userName}
          onChangeName={onChangeName}
          signedIn={signedIn}
          email={email}
          ssoConfigured={ssoConfigured}
          {...(onSignIn ? { onSignIn } : {})}
          {...(onSignOut ? { onSignOut } : {})}
          {...(onSignInPassword ? { onSignInPassword } : {})}
          {...(onManageTeam ? { onManageTeam } : {})}
        />
      </div>
    </header>
  );
}
