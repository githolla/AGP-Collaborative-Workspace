import { useState } from "react";
import { createPortal } from "react-dom";
import { T } from "../theme.js";
import type { TeamAccount } from "../auth/localAuth.js";

/**
 * Team members & sign-in (interim, pre-Entra). An admin adds a person with a
 * name, email, role, and a starter password; that person can then sign in with
 * email + password. Replaced by Microsoft SSO later — see auth/entra.ts.
 */
export function TeamManager({
  open,
  team,
  onAdd,
  onRemove,
  onClose,
}: {
  open: boolean;
  team: TeamAccount[];
  onAdd: (name: string, email: string, title: string, password: string) => Promise<string | null>;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [title, setTitle] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [addedMsg, setAddedMsg] = useState<string | null>(null);

  if (!open) return null;

  const submit = async () => {
    setBusy(true);
    setErr(null);
    const problem = await onAdd(name, email, title, password);
    setBusy(false);
    if (problem) {
      setErr(problem);
      return;
    }
    setAddedMsg(`${name.trim()} can now sign in with ${email.trim().toLowerCase()}.`);
    setName("");
    setEmail("");
    setTitle("");
    setPassword("");
  };

  const field: React.CSSProperties = { width: "100%", fontSize: 12.5, padding: "8px 10px" };

  return createPortal(
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(16,21,46,0.4)", zIndex: 200 }} />
      <div
        role="dialog"
        aria-label="Team members"
        style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: 460, maxWidth: "94vw", maxHeight: "88vh", overflowY: "auto", background: "#fff", color: T.ink, borderRadius: 14, boxShadow: "0 24px 60px rgba(16,21,46,0.4)", padding: 22, zIndex: 201 }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontSize: 16, fontWeight: 800, color: T.roi.navy }}>Team members</span>
          <button type="button" className="btn-link" style={{ fontSize: 12 }} onClick={onClose}>Close ✕</button>
        </div>
        <div style={{ fontSize: 11.5, color: T.inkSecondary, marginTop: 3, lineHeight: 1.5 }}>
          Add a teammate and set a starter password — they sign in with their email and that password.
          Microsoft single sign-on replaces this later.
        </div>

        {/* Existing accounts */}
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: T.inkMuted, margin: "16px 0 6px" }}>
          Accounts ({team.length})
        </div>
        {team.length === 0 ? (
          <div style={{ fontSize: 12, color: T.inkMuted, padding: "6px 0" }}>No sign-in accounts yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {team.map((m) => (
              <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: `1px solid ${T.grid}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: T.ink }}>{m.name}<span style={{ color: T.inkMuted, fontWeight: 400 }}>{m.title ? ` · ${m.title}` : ""}</span></div>
                  <div style={{ fontSize: 11, color: T.inkSecondary, wordBreak: "break-all" }}>{m.email}</div>
                </div>
                <button type="button" className="btn btn-danger btn-sm" onClick={() => onRemove(m.id)}>Remove</button>
              </div>
            ))}
          </div>
        )}

        {/* Add form */}
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: T.inkMuted, margin: "16px 0 6px" }}>
          Add a team member
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input className="input" style={field} placeholder="Full name" value={name} onChange={(e) => { setName(e.target.value); setAddedMsg(null); }} />
          <input className="input" style={field} placeholder="Email" type="email" value={email} onChange={(e) => { setEmail(e.target.value); setAddedMsg(null); }} />
          <input className="input" style={field} placeholder="Role / title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input className="input" style={field} placeholder="Starter password (min 6 characters)" type="text" value={password} onChange={(e) => { setPassword(e.target.value); setAddedMsg(null); }} />
          {err && <div style={{ fontSize: 11.5, color: T.status.critical }}>{err}</div>}
          {addedMsg && <div style={{ fontSize: 11.5, color: "#116a43", fontWeight: 600 }}>✓ {addedMsg}</div>}
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void submit()} style={{ alignSelf: "flex-start" }}>
            {busy ? "Adding…" : "Add member & set password"}
          </button>
        </div>
        <div style={{ fontSize: 10, color: T.inkMuted, marginTop: 10, lineHeight: 1.5 }}>
          Passwords are stored hashed (PBKDF2), never in the clear. This is a lightweight interim gate for the prototype — Microsoft SSO is the production path.
        </div>
      </div>
    </>,
    document.body,
  );
}
