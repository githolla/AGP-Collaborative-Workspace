import { useMemo, useState } from "react";
import { T } from "../theme.js";
import { MentionTextarea, type MentionPerson } from "./MentionTextarea.js";
import type { ClientAccount } from "../workspace/types.js";

/**
 * Global "Discuss" launcher — a floating button reachable from anywhere in the
 * system (client call: "I'd like to be anywhere and have a discussion button
 * that gives me ways to discuss with who I choose, and then that logs").
 *
 * Opens a composer: pick the client account, the project topic, the people to
 * include (they're @mentioned so they're notified), and post. It files into
 * that account's Discussions and logs to its activity feed — same store path
 * as an in-workspace post, so everything lands in one auditable place.
 */
export function DiscussLauncher({
  accounts,
  userName,
  currentAccountId,
  roster = [],
  onPost,
  onOpenAccount,
  onAddMember,
}: {
  accounts: ClientAccount[];
  userName: string;
  currentAccountId?: string | undefined;
  /** Full live AGP roster — powers @mention autocomplete + quick-add. */
  roster?: { id: string; name: string; title: string }[];
  onPost: (accountId: string, body: string, topic?: string) => void;
  onOpenAccount: (id: string) => void;
  /** Add an AGP person to an account (quick-add on mention). */
  onAddMember?: (accountId: string, personId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const live = accounts.filter((a) => !a.archived);
  const [acctId, setAcctId] = useState(currentAccountId ?? live[0]?.id ?? "");
  const [topic, setTopic] = useState("");
  const [include, setInclude] = useState<string[]>([]);
  const [body, setBody] = useState("");
  const [posted, setPosted] = useState<string | null>(null);
  const [pendingAdd, setPendingAdd] = useState<string | null>(null);

  // Reset the form to the current context each time it's opened.
  const openModal = () => {
    setAcctId(currentAccountId ?? live[0]?.id ?? "");
    setTopic("");
    setInclude([]);
    setBody("");
    setPosted(null);
    setPendingAdd(null);
    setOpen(true);
  };

  const account = accounts.find((a) => a.id === acctId);
  const people = useMemo(() => {
    if (!account) return [] as { name: string; sub: string }[];
    return [
      ...account.members.map((m) => ({ name: m.name, sub: m.title })),
      ...account.externals.map((e) => ({ name: e.name, sub: `${e.role} · ${e.org}` })),
    ];
  }, [account]);

  // Mention roster: account people first, then the rest of the AGP roster.
  const mentionRoster = useMemo<MentionPerson[]>(() => {
    const onAcct = new Set(people.map((p) => p.name));
    const list: MentionPerson[] = people.map((p) => ({ name: p.name, onAccount: true, ...(p.sub ? { sub: p.sub } : {}) }));
    for (const r of roster) {
      if (onAcct.has(r.name)) continue;
      list.push({ name: r.name, onAccount: false, ...(r.title ? { sub: r.title } : {}) });
    }
    return list;
  }, [people, roster]);

  const quickAdd = (name: string) => {
    const person = roster.find((r) => r.name === name);
    if (person && account && onAddMember) onAddMember(account.id, person.id);
    setPendingAdd(null);
  };

  const toggle = (name: string) =>
    setInclude((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));

  const submit = () => {
    if (!account || !body.trim()) return;
    // @mention the chosen people so they're notified + logged.
    const mentions = include.map((n) => `@${(n.split(" ")[0] ?? n)}`).join(" ");
    const full = mentions ? `${mentions} ${body.trim()}` : body.trim();
    onPost(account.id, full, topic || undefined);
    setPosted(account.clientName);
  };

  const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(20,33,58,0.42)", zIndex: 90, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 };
  const sheet: React.CSSProperties = { width: 520, maxWidth: "100%", maxHeight: "88vh", overflowY: "auto", background: "#fff", borderRadius: 14, boxShadow: "0 20px 60px rgba(11,33,63,0.34)", padding: 20 };
  const lbl: React.CSSProperties = { fontSize: 10.5, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: T.inkMuted, marginBottom: 5, display: "block" };

  return (
    <>
      {/* Floating launcher — present on every page. */}
      <button
        type="button"
        onClick={openModal}
        title="Start a discussion about anything, with whoever you choose"
        style={{
          // Sit ABOVE the Feedback pill (bottom:18, ~44px tall) so the two
          // fixed corner buttons don't overlap — Josh flagged Feedback hiding it.
          position: "fixed", right: 22, bottom: 74, zIndex: 80,
          display: "flex", alignItems: "center", gap: 8,
          background: T.roi.navy, color: "#fff", border: "none", borderRadius: 999,
          padding: "12px 18px", fontSize: 13.5, fontWeight: 800, cursor: "pointer",
          boxShadow: "0 8px 22px rgba(11,33,63,0.32)",
        }}
      >
        <span aria-hidden style={{ fontSize: 16 }}>💬</span> Discuss
      </button>

      {open && (
        <div style={overlay} onClick={() => setOpen(false)}>
          <div style={sheet} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Start a discussion">
            {posted ? (
              <div style={{ textAlign: "center", padding: "10px 6px" }}>
                <div style={{ fontSize: 30 }} aria-hidden>✓</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: T.roi.navy, marginTop: 6 }}>Posted to {posted}</div>
                <div style={{ fontSize: 12, color: T.inkSecondary, marginTop: 4, lineHeight: 1.5 }}>
                  It's in the account's Discussions{topic ? <> under <b>{topic}</b></> : ""} and logged to the activity feed{include.length > 0 ? ` — ${include.length} ${include.length === 1 ? "person" : "people"} notified` : ""}.
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 16 }}>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => { if (account) onOpenAccount(account.id); setOpen(false); }}>Open {posted}</button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={openModal}>Post another</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Done</button>
                </div>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: T.roi.navy }}>Start a discussion</div>
                  <button type="button" className="btn-link" style={{ fontSize: 12 }} onClick={() => setOpen(false)}>Close</button>
                </div>

                {live.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: T.inkMuted }}>No client workspaces yet — open a client first, then start a discussion.</div>
                ) : (
                  <>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <label style={{ flex: 1, minWidth: 180 }}>
                        <span style={lbl}>About (client)</span>
                        <select className="select" value={acctId} onChange={(e) => { setAcctId(e.target.value); setTopic(""); setInclude([]); }} style={{ width: "100%", fontSize: 12.5 }}>
                          {live.map((a) => <option key={a.id} value={a.id}>{a.clientName}</option>)}
                        </select>
                      </label>
                      <label style={{ flex: 1, minWidth: 160 }}>
                        <span style={lbl}>Project / topic</span>
                        <select className="select" value={topic} onChange={(e) => setTopic(e.target.value)} style={{ width: "100%", fontSize: 12.5 }}>
                          <option value="">General</option>
                          {(account?.campaigns ?? []).map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                        </select>
                      </label>
                    </div>

                    <div style={{ marginTop: 14 }}>
                      <span style={lbl}>Include — they'll be notified</span>
                      {people.length === 0 ? (
                        <div style={{ fontSize: 11.5, color: T.inkMuted }}>No one on this account yet — add people in the workspace, or just post to the team.</div>
                      ) : (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {people.map((p) => {
                            const on = include.includes(p.name);
                            return (
                              <button
                                key={p.name}
                                type="button"
                                onClick={() => toggle(p.name)}
                                title={p.sub}
                                style={{
                                  fontSize: 11, fontWeight: 700, padding: "4px 11px", borderRadius: 999, cursor: "pointer",
                                  border: `1px solid ${on ? T.roi.navy : T.border}`,
                                  background: on ? T.roi.navy : "transparent", color: on ? "#fff" : T.inkSecondary,
                                }}
                              >
                                {on ? "✓ " : ""}{p.name}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div style={{ marginTop: 14 }}>
                      <span style={lbl}>Message</span>
                      <MentionTextarea
                        value={body}
                        onChange={setBody}
                        roster={mentionRoster}
                        onPick={(p) => { if (!p.onAccount && onAddMember) setPendingAdd(p.name); }}
                        onSubmit={submit}
                        rows={4}
                        autoFocus
                        placeholder={`What do you want to discuss${account ? ` with ${account.clientName}'s team` : ""}? (@ to mention, Ctrl+Enter to post)`}
                        style={{ fontSize: 12.5 }}
                      />
                      {pendingAdd && onAddMember && (
                        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: "#faf3dc", border: "1px solid #e7c66f", borderRadius: 8, padding: "8px 12px" }}>
                          <span style={{ fontSize: 11.5, color: "#7a5c12", flex: 1, minWidth: 150 }}>
                            <b>{pendingAdd}</b> isn't on {account?.clientName ?? "this account"} yet — add them?
                          </span>
                          <button type="button" className="btn btn-primary btn-sm" onClick={() => quickAdd(pendingAdd)}>Add &amp; invite</button>
                          <button type="button" className="btn-link" style={{ fontSize: 11 }} onClick={() => setPendingAdd(null)}>Not now</button>
                        </div>
                      )}
                    </div>

                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
                      <button type="button" className="btn btn-primary" disabled={!body.trim()} onClick={submit}>Post discussion</button>
                      <span style={{ fontSize: 10.5, color: T.inkMuted }}>Posts as {userName}. Files into the account's Discussions and logs it.</span>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
