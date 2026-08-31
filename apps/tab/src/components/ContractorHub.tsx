/**
 * Contractor Hub — one place per client to add contractors, share SharePoint
 * files with them, and see exactly what each has opened and said. Redesigned
 * from the old split across the Access/Files/Admin tabs into a single view
 * (Cara & Kellie's pilot ask: "make it much easier").
 *
 * Data is the same account payload the Admin tab loads (fetchAccountCollabData);
 * buildContractorRows (unit-tested) rolls it into a per-contractor view. Add /
 * share / grant reuse the existing endpoints (addExternal, grantAccess,
 * shareItems). The AI assistant is grounded server-side over this account's
 * contractor data (api/contractor-chat), and degrades honestly when the
 * Anthropic key isn't set.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { card, T } from "../theme.js";
import { StatTile, SectionTitle } from "./bits.js";
import { FolderTreePicker } from "./ClientAdminPanel.js";
import { fetchAllAccounts } from "../workspace/msAccountData.js";
import { MsApiError } from "../workspace/msApiFetch.js";
import { addExternal } from "../workspace/msPeople.js";
import { grantAccess } from "../workspace/msShare.js";
import { shareItems, type ShareItemInput } from "../workspace/msHandover.js";
import type { FolderTreeNode } from "../workspace/msFolderTree.js";
import {
  buildContractorRows, contractorKpis, humanDuration, askContractorChat, buildInviteMessage, signInState, fetchContractorHubData,
  type ContractorRow, type ContractorStatus, type ContractorChatTurn, type ContractorHubData,
} from "../workspace/contractorHub.js";

/** The bit of account identity the hub and its modals need. */
type HubAccount = { id: string; clientName: string };

const navy = T.roi.navy;

// ---- small shared bits ------------------------------------------------------

function initials(name: string): string {
  return name.split(/\s+/).map((w) => w[0] ?? "").join("").slice(0, 2).toUpperCase();
}

function avatarColor(name: string): string {
  const ramp = [T.roi.navy, "#1e8695", "#249fb0", "#2bb8c9", "#186d7a"];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return ramp[h % ramp.length]!;
}

function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  return (
    <span aria-hidden style={{ width: size, height: size, borderRadius: size * 0.28, background: avatarColor(name), color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.36, fontWeight: 700, flexShrink: 0 }}>
      {initials(name)}
    </span>
  );
}

const STATUS_META: Record<ContractorStatus, { color: string; wash: string; label: string }> = {
  active: { color: T.status.good, wash: "#e4f5ec", label: "Active" },
  idle: { color: T.status.warning, wash: "#faf1dc", label: "Idle" },
  pending: { color: T.inkMuted, wash: "#eef0f4", label: "Invite pending" },
};

function StatusDot({ status }: { status: ContractorStatus }) {
  const m = STATUS_META[status];
  return <span title={m.label} style={{ width: 9, height: 9, borderRadius: "50%", background: m.color, boxShadow: `0 0 0 3px ${m.wash}`, flexShrink: 0 }} />;
}

/** A "needs a nudge" pill for contractors who haven't signed in. Null when
 * they're active (nothing to nudge). */
function NudgePill({ row }: { row: ContractorRow }) {
  const st = signInState(row);
  if (st === "active") return null;
  const [label, color, wash] = st === "invited"
    ? ["Invited · not signed in", T.status.warning, "#faf1dc"]
    : ["No access yet", T.inkMuted, "#eef0f4"];
  return (
    <span title={st === "invited" ? "They've been invited but haven't signed in — a nudge may help" : "No folder shared yet, so no invite has gone out"}
      style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: wash, color, whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

function Spark({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  return (
    <span style={{ display: "inline-flex", gap: 2, alignItems: "flex-end", height: 24 }}>
      {values.map((v, i) => {
        const h = Math.max(3, (v / max) * 24);
        const shade = v > 0 ? T.seq[Math.min(T.seq.length - 1, Math.max(2, Math.ceil((v / max) * (T.seq.length - 1))))]! : T.grid;
        return <span key={i} style={{ width: 6, height: h, borderRadius: "2px 2px 0 0", background: shade }} />;
      })}
    </span>
  );
}

function relTime(iso?: string): string {
  if (!iso) return "No activity yet";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const chip: CSSProperties = { fontSize: 11, fontWeight: 500, padding: "3px 8px", borderRadius: 6, background: "#eef4f6", color: T.inkSecondary, border: `1px solid ${T.grid}`, whiteSpace: "nowrap" };

// ---- main component ---------------------------------------------------------

/** Copy text to the clipboard, resolving true on success (best-effort). */
async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard?.writeText(text); return true; } catch { return false; }
}

/** The app URL a contractor signs into — the deployed origin. */
function appOrigin(): string {
  return typeof window !== "undefined" ? window.location.origin : "";
}

export function ContractorHub({
  accountId,
  clientName,
  loginHintEmail,
  canManage = false,
  userName,
  onOpenDiscussions,
}: {
  /** The resolved collab account id, when the parent already has it. May be
   * null/undefined — the hub then resolves by clientName itself, so it never
   * hangs waiting on the parent's slow/absent collabData for a big account. */
  accountId?: string | null | undefined;
  clientName: string;
  loginHintEmail?: string | undefined;
  canManage?: boolean;
  userName?: string;
  onOpenDiscussions?: () => void;
}) {
  const [data, setData] = useState<ContractorHubData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | ContractorStatus>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modal, setModal] = useState<"add" | "share" | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (msg: string) => { setToast(msg); window.setTimeout(() => setToast(null), 2600); };

  // Self-resolving load, mirroring ClientAdminTab: use the id when we have one,
  // else match the client by name (a light LIST call). Then one lightweight
  // fetch of just the contractor collections — no tasks/campaigns — so a big
  // account loads fast, and it never depends on the parent's collabData timing.
  const nameRef = useRef(clientName);
  useEffect(() => { nameRef.current = clientName; }, [clientName]);
  const reload = () => {
    const forName = clientName;
    void (async () => {
      let id = accountId ?? null;
      if (!id) {
        const { accounts } = await fetchAllAccounts();
        if (nameRef.current !== forName) return;
        const matches = accounts.filter((a) => a.clientName.toLowerCase() === forName.toLowerCase());
        if (matches.length !== 1) { setErr(matches.length === 0 ? "No workspace found for this client yet." : "More than one workspace matches this client name."); return; }
        id = matches[0]!.id;
      }
      const payload = await fetchContractorHubData(id);
      if (nameRef.current !== forName) return; // a newer client won the race
      setData(payload);
    })().catch((e) => { if (nameRef.current === forName) setErr(e instanceof MsApiError ? e.message : "Couldn't load contractor data"); });
  };
  // Clear the previous client's data on switch so the old account's contractors
  // (and account id, which Add/Share act on) can't linger while the new fetch
  // is in flight.
  useEffect(() => { setErr(null); setData(null); reload(); }, [accountId, clientName]);

  const account: HubAccount | null = data?.account ?? null;
  const copyInvite = async (row: ContractorRow) => {
    if (!account) return;
    const msg = buildInviteMessage({ name: row.name, ...(row.email ? { email: row.email } : {}), clientName: account.clientName, folderCount: row.folderCount, appUrl: appOrigin(), ...(userName ? { fromName: userName } : {}) });
    flash(await copyText(msg) ? `Invite for ${row.name.split(" ")[0]} copied — paste it into an email or Teams` : "Couldn't copy — check clipboard permissions");
  };

  const rows = useMemo(
    () => data ? buildContractorRows(data.externals, data.grants, data.shares, data.thread, data.fileApprovals) : [],
    [data],
  );
  const kpis = useMemo(() => data ? contractorKpis(rows, data.fileApprovals) : null, [rows, data]);
  const shown = filter === "all" ? rows : rows.filter((r) => r.status === filter);
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  if (err) return (
    <div style={{ ...card, color: T.status.critical, fontSize: 12.5, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ flex: 1, minWidth: 200 }}>{err}</span>
      <button type="button" className="btn-secondary" onClick={() => { setErr(null); setData(null); reload(); }}>Retry</button>
    </div>
  );
  if (!account || !data || !kpis) return <div style={{ ...card, color: T.inkMuted, fontSize: 12.5 }}>Loading contractors…</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: navy }}>Contractors &amp; sharing</div>
          <div style={{ fontSize: 12, color: T.inkMuted, marginTop: 2 }}>Add a contractor, share the SharePoint files they need, and see what they've opened — all here.</div>
        </div>
        {canManage && (
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn-secondary" onClick={() => setModal("share")}>Share files</button>
            <button type="button" className="btn-primary" onClick={() => setModal("add")}>+ Add contractor</button>
          </div>
        )}
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
        <StatTile label="Active contractors" value={String(kpis.activeThisWeek)} detail={`of ${kpis.contractors} on the account`} />
        <StatTile label="Files shared" value={String(kpis.filesShared)} detail="across contractors" />
        <StatTile label="Opens this week" value={String(kpis.opensThisWeek)} detail="file opens" {...(kpis.opensThisWeek > 0 ? { detailColor: T.status.good } : {})} />
        <StatTile label="Not signed in" value={String(kpis.notSignedIn)} detail={kpis.notSignedIn > 0 ? "may need a nudge" : "everyone's in"} {...(kpis.notSignedIn > 0 ? { detailColor: T.status.warning } : { detailColor: T.status.good })} />
        <StatTile label="Awaiting approval" value={String(kpis.awaitingApproval)} detail="pending decision" {...(kpis.awaitingApproval > 0 ? { detailColor: T.status.warning } : {})} />
      </div>

      {/* AI assistant */}
      <ChatPanel accountId={account.id} />

      {/* Filter + list */}
      <SectionTitle right={
        <div style={{ display: "inline-flex", gap: 4, background: "#eef2f5", border: `1px solid ${T.grid}`, borderRadius: 8, padding: 3 }}>
          {(["all", "active", "idle", "pending"] as const).map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)}
              style={{ border: 0, background: filter === f ? "#fff" : "transparent", color: filter === f ? T.ink : T.inkSecondary, fontSize: 11.5, fontWeight: 600, padding: "5px 10px", borderRadius: 6, boxShadow: filter === f ? "0 1px 2px rgba(0,0,0,.08)" : "none", cursor: "pointer", textTransform: "capitalize" }}>
              {f}
            </button>
          ))}
        </div>
      }>Contractors <span style={{ fontSize: 12, color: T.inkMuted, fontWeight: 600 }}>· {shown.length}</span></SectionTitle>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {shown.length === 0 && <div style={{ ...card, color: T.inkMuted, fontSize: 12.5 }}>No contractors {filter !== "all" ? `that are ${filter}` : "yet"}. {canManage && filter === "all" && "Use “Add contractor” to invite one."}</div>}
        {shown.map((r) => <ContractorRowCard key={r.id} row={r} onOpen={() => setSelectedId(r.id)} />)}
      </div>

      {selected && <Drawer row={selected} onClose={() => setSelectedId(null)} {...(canManage ? { onCopyInvite: () => void copyInvite(selected) } : {})} {...(onOpenDiscussions ? { onOpenDiscussions } : {})} />}
      {modal === "add" && <AddContractorModal account={account} loginHintEmail={loginHintEmail} {...(userName ? { userName } : {})} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} onCopied={flash} />}
      {modal === "share" && <ShareFilesModal account={account} loginHintEmail={loginHintEmail} contractors={rows} {...(userName ? { userName } : {})} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} onCopied={flash} />}

      {toast && (
        <div style={{ position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%)", background: navy, color: "#fff", padding: "11px 18px", borderRadius: 10, fontSize: 13, fontWeight: 500, boxShadow: "0 20px 50px -18px rgba(16,21,46,.5)", zIndex: 70 }}>{toast}</div>
      )}
    </div>
  );
}

// ---- contractor row ---------------------------------------------------------

function ContractorRowCard({ row, onOpen }: { row: ContractorRow; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen}
      style={{ ...card, display: "grid", gridTemplateColumns: "auto minmax(0,1.5fr) minmax(0,1fr) auto", alignItems: "center", gap: 16, textAlign: "left", cursor: "pointer", width: "100%", padding: 14 }}>
      <Avatar name={row.name} />
      <span style={{ minWidth: 0 }}>
        <span style={{ fontWeight: 700, color: T.ink, display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>{row.name}
          <span style={{ ...chip, textTransform: "capitalize" }}>{row.role}</span>
          <NudgePill row={row} />
        </span>
        <span style={{ fontSize: 12, color: T.inkMuted, display: "block", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {row.org || "—"} · {row.folderCount} folder{row.folderCount === 1 ? "" : "s"} · {row.sharedCount} shared{row.notOpenedCount > 0 ? ` · ${row.notOpenedCount} unopened` : ""}
        </span>
      </span>
      <span style={{ fontSize: 12, color: T.inkSecondary }}>
        <span style={{ fontWeight: 700, color: T.ink, display: "block" }}>{relTime(row.lastActiveAt)}</span>
        {STATUS_META[row.status].label}
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 12, justifySelf: "end" }}>
        <Spark values={row.spark} />
        <span style={{ textAlign: "right", minWidth: 42 }}>
          <span style={{ fontSize: 18, fontWeight: 700, color: T.ink, fontVariantNumeric: "tabular-nums" }}>{row.openedCount}</span>
          <span style={{ display: "block", fontSize: 10, color: T.inkMuted, textTransform: "uppercase", letterSpacing: ".05em" }}>opens</span>
        </span>
        <StatusDot status={row.status} />
      </span>
    </button>
  );
}

// ---- drawer (activity + discussion) ----------------------------------------

function Drawer({ row, onClose, onCopyInvite, onOpenDiscussions }: { row: ContractorRow; onClose: () => void; onCopyInvite?: () => void; onOpenDiscussions?: () => void }) {
  const [tab, setTab] = useState<"activity" | "discussion">("activity");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const verbColor: Record<ContractorRow["events"][number]["kind"], string> = { open: T.roi.cyan, share: navy, approve: T.status.good };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(16,21,46,.42)", zIndex: 40 }} />
      <aside style={{ position: "fixed", top: 0, right: 0, height: "100%", width: "min(540px, 94vw)", background: "#fff", borderLeft: `1px solid ${T.grid}`, boxShadow: "-20px 0 60px -20px rgba(16,21,46,.4)", zIndex: 50, display: "flex", flexDirection: "column" }}>
        {/* header */}
        <div style={{ padding: "18px 20px 14px", borderBottom: `1px solid ${T.grid}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
            <Avatar name={row.name} size={46} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: T.ink }}>{row.name}</div>
              <div style={{ fontSize: 12.5, color: T.inkMuted }}>{row.role}{row.org ? ` · ${row.org}` : ""}</div>
            </div>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
              {onCopyInvite && <button type="button" className="btn-secondary" style={{ fontSize: 12, padding: "6px 11px" }} onClick={onCopyInvite} title="Copy a message you can paste into an email or Teams">Copy invite</button>}
              <button type="button" onClick={onClose} aria-label="Close" style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${T.grid}`, background: "#f4f6f8", color: T.inkSecondary, fontSize: 17, cursor: "pointer" }}>×</button>
            </div>
          </div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 12, fontSize: 12, color: T.inkSecondary }}>
            {row.email && <span><b style={{ color: T.ink }}>{row.email}</b></span>}
            <span>Access: <b style={{ color: T.ink }}>{row.folderCount} area{row.folderCount === 1 ? "" : "s"}</b></span>
            <span>Sign-in: <b style={{ color: T.ink }}>{row.entraStatus}</b></span>
          </div>
        </div>
        {/* stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 1, background: T.grid, borderBottom: `1px solid ${T.grid}` }}>
          {[
            { v: String(row.sharedCount), l: "Files shared" },
            { v: String(row.openedCount), l: "Total opens" },
            { v: row.avgTimeToOpenMs !== undefined ? humanDuration(row.avgTimeToOpenMs) : "—", l: "Avg time to open" },
            { v: String(row.approvals), l: "Approvals" },
          ].map((s, i) => (
            <div key={i} style={{ background: "#fff", padding: "11px 13px" }}>
              <div style={{ fontSize: 19, fontWeight: 700, color: T.ink, fontVariantNumeric: "tabular-nums" }}>{s.v}</div>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".05em", color: T.inkMuted, fontWeight: 600, marginTop: 2 }}>{s.l}</div>
            </div>
          ))}
        </div>
        {/* tabs */}
        <div style={{ display: "flex", gap: 2, padding: "10px 20px 0", borderBottom: `1px solid ${T.grid}` }}>
          {(["activity", "discussion"] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)}
              style={{ border: 0, background: "transparent", borderBottom: `2px solid ${tab === t ? T.roi.cyan : "transparent"}`, color: tab === t ? T.ink : T.inkMuted, fontSize: 13, fontWeight: 600, padding: "8px 12px 12px", marginBottom: -1, cursor: "pointer", textTransform: "capitalize" }}>
              {t} <span style={{ fontSize: 10.5, background: tab === t ? "#e2f3f6" : "#eef2f5", color: tab === t ? T.roi.cyan : T.inkSecondary, borderRadius: 999, padding: "1px 7px", fontWeight: 700 }}>{t === "activity" ? row.events.length : row.messages.length}</span>
            </button>
          ))}
        </div>
        {/* body */}
        <div style={{ overflowY: "auto", flex: 1, padding: "16px 20px 40px" }}>
          {tab === "activity" ? (
            row.events.length === 0
              ? <div style={{ color: T.inkMuted, fontSize: 13, textAlign: "center", padding: "30px 0" }}>Nothing shared with {row.name.split(" ")[0]} yet.</div>
              : (
                <div style={{ position: "relative", paddingLeft: 24 }}>
                  <span style={{ position: "absolute", left: 8, top: 4, bottom: 4, width: 2, background: T.grid }} />
                  {row.events.map((e, i) => (
                    <div key={i} style={{ position: "relative", paddingBottom: 16 }}>
                      <span style={{ position: "absolute", left: -20, top: 3, width: 15, height: 15, borderRadius: "50%", background: "#fff", border: `2px solid ${verbColor[e.kind]}`, display: "grid", placeItems: "center" }}>
                        <span style={{ width: 5, height: 5, borderRadius: "50%", background: verbColor[e.kind] }} />
                      </span>
                      <div style={{ background: "#f7f9fa", border: `1px solid ${T.grid}`, borderRadius: 9, padding: "9px 12px" }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: verbColor[e.kind] }}>{e.kind === "open" ? "Opened" : e.kind === "share" ? "Shared" : "Approved"}</span>
                          <span style={{ fontWeight: 600, fontSize: 13, color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.file}</span>
                          <span style={{ marginLeft: "auto", fontSize: 11, color: T.inkMuted, whiteSpace: "nowrap" }}>{fmtWhen(e.at)}</span>
                        </div>
                        <div style={{ fontSize: 12, color: T.inkSecondary, marginTop: 4 }}>{e.detail}{e.tag && <span style={{ ...chip, marginLeft: 6, fontSize: 10.5, color: e.tag === "not opened" ? T.status.warning : T.inkSecondary }}>{e.tag}</span>}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )
          ) : (
            <>
              <div style={{ fontSize: 11.5, color: T.inkMuted, background: "#f4f6f8", border: `1px solid ${T.grid}`, borderRadius: 8, padding: "8px 11px", marginBottom: 14 }}>
                Just {row.name.split(" ")[0]}'s slice of the account Discussion — the same messages, filtered to them.
                {onOpenDiscussions && <> The full thread lives in <button type="button" className="btn-link" style={{ fontSize: 11.5, padding: 0 }} onClick={onOpenDiscussions}>Discussions →</button></>}
              </div>
              {row.messages.length === 0
                ? <div style={{ color: T.inkMuted, fontSize: 13, textAlign: "center", padding: "24px 0" }}>No messages with {row.name.split(" ")[0]} yet.</div>
                : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {row.messages.map((m, i) => (
                      <div key={i} style={{ maxWidth: "84%", alignSelf: m.who === "agp" ? "flex-end" : "flex-start" }}>
                        <div style={{ fontSize: 11, color: T.inkMuted, marginBottom: 3, textAlign: m.who === "agp" ? "right" : "left" }}><b style={{ color: T.inkSecondary }}>{m.author}</b> · {fmtWhen(m.at)}</div>
                        <div style={{ padding: "9px 13px", borderRadius: 12, fontSize: 13, lineHeight: 1.45, whiteSpace: "pre-wrap", ...(m.who === "agp" ? { background: T.roi.cyan, color: "#fff", borderTopRightRadius: 4 } : { background: "#f2f4f6", border: `1px solid ${T.grid}`, borderTopLeftRadius: 4 }) }}>{m.body}</div>
                      </div>
                    ))}
                  </div>
                )}
            </>
          )}
        </div>
      </aside>
    </>
  );
}

// ---- AI assistant panel -----------------------------------------------------

const SUGGESTIONS = [
  "Who hasn't opened the files I shared?",
  "Which contractors have gone quiet?",
  "What's still waiting on a contractor?",
];

function ChatPanel({ accountId }: { accountId: string }) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<ContractorChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [notConfigured, setNotConfigured] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Ref guard, not the `busy` state: two synchronous fires in one tick (double
  // Enter / double-click a chip) both read busy===false before the re-render.
  const inFlight = useRef(false);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [turns, busy]);

  const ask = async (q: string) => {
    const question = q.trim();
    if (!question || inFlight.current) return;
    inFlight.current = true;
    const history = turns;
    setTurns((t) => [...t, { role: "user", content: question }]);
    setInput("");
    setBusy(true);
    try {
      const res = await askContractorChat(accountId, question, history);
      setNotConfigured(!res.configured);
      setTurns((t) => [...t, { role: "assistant", content: res.answer }]);
    } catch (e) {
      setTurns((t) => [...t, { role: "assistant", content: e instanceof MsApiError ? `Sorry — ${e.message}` : "Sorry, I couldn't answer that just now." }]);
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  };

  return (
    <div style={{ ...card, padding: 0, overflow: "hidden", background: "#f7fbfc", borderColor: T.roi.cyan }}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", background: "transparent", border: 0, cursor: "pointer", textAlign: "left" }}>
        <span style={{ width: 28, height: 28, borderRadius: 8, background: T.roi.cyan, color: "#fff", display: "grid", placeItems: "center", fontSize: 15, flexShrink: 0 }}>✦</span>
        <span style={{ flex: 1 }}>
          <span style={{ fontWeight: 700, color: navy, fontSize: 13.5, display: "block" }}>Ask about your contractors</span>
          <span style={{ fontSize: 11.5, color: T.inkMuted }}>Opens, sharing, who's gone quiet — answered from this account's data.</span>
        </span>
        <span style={{ color: T.inkMuted, fontSize: 13 }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={{ borderTop: `1px solid ${T.grid}`, background: "#fff" }}>
          <div ref={scrollRef} style={{ maxHeight: 300, overflowY: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
            {turns.length === 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" onClick={() => void ask(s)}
                    style={{ ...chip, cursor: "pointer", background: "#eef7f9", color: T.roi.navy, borderColor: "#cbe8ee" }}>{s}</button>
                ))}
              </div>
            )}
            {turns.map((t, i) => (
              <div key={i} style={{ maxWidth: "88%", alignSelf: t.role === "user" ? "flex-end" : "flex-start" }}>
                <div style={{ padding: "9px 13px", borderRadius: 12, fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap", ...(t.role === "user" ? { background: T.roi.navy, color: "#fff", borderTopRightRadius: 4 } : { background: "#f2f6f8", color: T.ink, border: `1px solid ${T.grid}`, borderTopLeftRadius: 4 }) }}>{t.content}</div>
              </div>
            ))}
            {busy && <div style={{ alignSelf: "flex-start", fontSize: 12, color: T.inkMuted, fontStyle: "italic" }}>Thinking…</div>}
          </div>
          {notConfigured && <div style={{ fontSize: 11, color: T.status.warning, padding: "0 16px 8px" }}>AI answers activate once the Anthropic key is set on the server.</div>}
          <form onSubmit={(e) => { e.preventDefault(); void ask(input); }} style={{ display: "flex", gap: 8, padding: "12px 16px", borderTop: `1px solid ${T.grid}` }}>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask a question…" disabled={busy}
              style={{ flex: 1, border: `1px solid ${T.grid}`, borderRadius: 9, padding: "9px 12px", fontSize: 13, fontFamily: "inherit" }} />
            <button type="submit" className="btn-primary" disabled={busy || !input.trim()}>Ask</button>
          </form>
        </div>
      )}
    </div>
  );
}

// ---- add contractor modal ---------------------------------------------------

function ModalShell({ title, sub, children, foot, onClose }: { title: string; sub: string; children: React.ReactNode; foot: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(16,21,46,.42)", zIndex: 60 }} />
      <div style={{ position: "fixed", inset: 0, zIndex: 61, display: "grid", placeItems: "start center", padding: "44px 16px", overflowY: "auto" }}>
        <div style={{ width: "min(520px, 100%)", background: "#fff", borderRadius: 16, border: `1px solid ${T.grid}`, boxShadow: "0 28px 70px -24px rgba(16,21,46,.5)", overflow: "hidden" }}>
          <div style={{ padding: "20px 22px 4px" }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: T.ink }}>{title}</div>
            <div style={{ fontSize: 12.5, color: T.inkSecondary, marginTop: 5 }}>{sub}</div>
          </div>
          <div style={{ padding: "16px 22px 6px", display: "flex", flexDirection: "column", gap: 14 }}>{children}</div>
          <div style={{ padding: "14px 22px 18px", display: "flex", alignItems: "center", gap: 10, borderTop: `1px solid ${T.grid}`, background: "#f7f9fa", marginTop: 8 }}>{foot}</div>
        </div>
      </div>
    </>
  );
}

const labelStyle: CSSProperties = { fontSize: 12, fontWeight: 600, color: T.inkSecondary, display: "block", marginBottom: 5 };
const inputStyle: CSSProperties = { width: "100%", background: "#f7f9fa", border: `1px solid ${T.grid}`, borderRadius: 9, padding: "10px 12px", fontFamily: "inherit", fontSize: 13, color: T.ink };

function AddContractorModal({ account, loginHintEmail, userName, onClose, onDone, onCopied }: { account: HubAccount; loginHintEmail?: string | undefined; userName?: string; onClose: () => void; onDone: () => void; onCopied: (msg: string) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [org, setOrg] = useState("");
  const [role, setRole] = useState<"contractor" | "client">("contractor");
  const [picked, setPicked] = useState<Map<string, FolderTreeNode>>(new Map());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Post-add success view: what got created, so we can render the invite text.
  const [added, setAdded] = useState<{ name: string; email?: string; folderCount: number } | null>(null);

  const togglePick = (node: FolderTreeNode) => setPicked((prev) => {
    const next = new Map(prev);
    if (next.has(node.kantataId)) next.delete(node.kantataId); else next.set(node.kantataId, node);
    return next;
  });

  const submit = async () => {
    if (!name.trim()) { setErr("A name is required."); return; }
    setBusy(true); setErr(null);
    try {
      const ext = await addExternal(account.id, name.trim(), org.trim(), role, email.trim() || undefined);
      // Grant each picked folder immediately, targeting the external link
      // (works before they've ever signed in — grants can be backfilled to the
      // userId later via "Resolve sign-in"). Each grant is what actually fires
      // the Microsoft SharePoint invite email.
      let granted = 0;
      for (const node of picked.values()) {
        try { await grantAccess(account.id, { externalLinkId: ext.id }, node.kantataId, node.level, "read", loginHintEmail); granted += 1; } catch { /* best-effort per folder */ }
      }
      setAdded({ name: name.trim(), ...(email.trim() ? { email: email.trim() } : {}), folderCount: granted });
      setBusy(false);
    } catch (e) {
      setErr(e instanceof MsApiError ? e.message : "Couldn't add this contractor.");
      setBusy(false);
    }
  };

  // ---- success view: the copy-paste invite -----------------------------------
  if (added) {
    const message = buildInviteMessage({ name: added.name, ...(added.email ? { email: added.email } : {}), clientName: account.clientName, folderCount: added.folderCount, appUrl: appOrigin(), ...(userName ? { fromName: userName } : {}) });
    const first = added.name.split(" ")[0];
    return (
      <ModalShell title={`${added.name} added`} sub={added.folderCount > 0
        ? `They can see ${added.folderCount} ${added.folderCount === 1 ? "area" : "areas"} — and nothing else on the account. Send them this to get them in:`
        : "Heads up — you didn't share any folders, so they have no access and no invite went out yet. Share a folder or file and they'll get a Microsoft invite. You can still send them this note:"}
        onClose={() => { onDone(); }}
        foot={<>
          <span style={{ fontSize: 11.5, color: T.inkMuted, flex: 1 }}>The link signs them into their own view — they only ever see what's shared.</span>
          <button type="button" className="btn-link" onClick={() => onDone()}>Done</button>
          <button type="button" className="btn-primary" onClick={async () => { onCopied(await copyText(message) ? `Invite for ${first} copied — paste it into an email or Teams` : "Couldn't copy — select the text and copy it manually"); }}>Copy invite message</button>
        </>}>
        <textarea readOnly value={message} rows={9} style={{ ...inputStyle, fontFamily: "inherit", lineHeight: 1.5, resize: "vertical" }} onFocus={(e) => e.currentTarget.select()} />
      </ModalShell>
    );
  }

  const noFolder = picked.size === 0;
  return (
    <ModalShell title="Add a contractor" sub="One screen — they get access to only the folders you pick, nothing else on the account." onClose={onClose}
      foot={<>
        {err
          ? <span style={{ fontSize: 11.5, color: T.status.critical, flex: 1 }}>{err}</span>
          : noFolder
            ? <span style={{ fontSize: 11.5, color: T.status.warning, fontWeight: 600, flex: 1 }}>⚠ No folder picked — they'll have no access and won't be invited yet</span>
            : <span style={{ fontSize: 11.5, color: T.status.good, fontWeight: 600, flex: 1 }}>✓ {picked.size} {picked.size === 1 ? "folder" : "folders"} — invite + access in one go</span>}
        <button type="button" className="btn-link" onClick={onClose}>Cancel</button>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => void submit()}>{busy ? "Adding…" : noFolder ? "Add without access" : "Add contractor"}</button>
      </>}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div><label style={labelStyle}>Full name</label><input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Dana Reyes" /></div>
        <div><label style={labelStyle}>Work email</label><input style={inputStyle} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="dana@studio.co" /></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
        <div><label style={labelStyle}>Company <span style={{ color: T.inkMuted, fontWeight: 400 }}>(optional)</span></label><input style={inputStyle} value={org} onChange={(e) => setOrg(e.target.value)} placeholder="Freelance / Studio" /></div>
        <div><label style={labelStyle}>Role</label>
          <select style={inputStyle} value={role} onChange={(e) => setRole(e.target.value as "contractor" | "client")}>
            <option value="contractor">Contractor</option>
            <option value="client">Client</option>
          </select>
        </div>
      </div>
      <div>
        <label style={labelStyle}>Share SharePoint folders <span style={{ color: T.inkMuted, fontWeight: 400 }}>— pick these to give access &amp; send the invite ({picked.size} selected)</span></label>
        <FolderTreePicker accountId={account.id} loginHintEmail={loginHintEmail} multiSelect selectedKantataIds={new Set(picked.keys())} onSelect={togglePick} />
      </div>
    </ModalShell>
  );
}

// ---- share files modal ------------------------------------------------------

function ShareFilesModal({ account, loginHintEmail, contractors, userName, onClose, onDone, onCopied }: { account: HubAccount; loginHintEmail?: string | undefined; contractors: ContractorRow[]; userName?: string; onClose: () => void; onDone: () => void; onCopied: (msg: string) => void }) {
  // Select by stable id, not display name — two contractors can share a name,
  // and resolving by name would target the wrong one.
  const [personId, setPersonId] = useState(contractors[0]?.id ?? "");
  const [picked, setPicked] = useState<Map<string, FolderTreeNode>>(new Map());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [shared, setShared] = useState<{ count: number } | null>(null);

  const recipient = contractors.find((c) => c.id === personId) ?? null;

  const togglePick = (node: FolderTreeNode) => setPicked((prev) => {
    const next = new Map(prev);
    if (next.has(node.kantataId)) next.delete(node.kantataId); else next.set(node.kantataId, node);
    return next;
  });

  const submit = async () => {
    if (!recipient) { setErr("Pick who to share with."); return; }
    if (picked.size === 0) { setErr("Pick at least one file or folder."); return; }
    setBusy(true); setErr(null);
    try {
      const items: ShareItemInput[] = [...picked.values()].map((n) => ({ kind: n.level === "folder" ? "folder" : "file", itemId: n.kantataId, itemName: n.name }));
      const res = await shareItems(account.id, recipient.name, items);
      if (res.rejected && res.rejected.length > 0) { setErr(`${res.rejected.length} item(s) couldn't be shared.`); setBusy(false); return; }
      setShared({ count: items.length });
      setBusy(false);
    } catch (e) {
      setErr(e instanceof MsApiError ? e.message : "Couldn't share those files.");
      setBusy(false);
    }
  };

  // ---- success view: offer the invite if the recipient hasn't signed in ------
  if (shared) {
    const notIn = recipient ? recipient.entraStatus !== "active" : false;
    const message = recipient
      ? buildInviteMessage({ name: recipient.name, ...(recipient.email ? { email: recipient.email } : {}), clientName: account.clientName, folderCount: Math.max(recipient.folderCount, picked.size), appUrl: appOrigin(), ...(userName ? { fromName: userName } : {}) })
      : "";
    const first = (recipient?.name ?? "there").split(" ")[0];
    return (
      <ModalShell title={`Shared with ${recipient?.name ?? "contractor"}`} sub={notIn
        ? `They haven't signed in yet — send them this so they know it's waiting. Every open shows up on their card.`
        : `They're already signed in and will see it in their workspace. Every open shows up on their card.`}
        onClose={() => onDone()}
        foot={<>
          <span style={{ fontSize: 11.5, color: T.inkMuted, flex: 1 }}>{shared.count} {shared.count === 1 ? "item" : "items"} shared.</span>
          <button type="button" className="btn-link" onClick={() => onDone()}>Done</button>
          {recipient && <button type="button" className="btn-primary" onClick={async () => { onCopied(await copyText(message) ? `Invite for ${first} copied — paste it into an email or Teams` : "Couldn't copy — select the text and copy it manually"); }}>Copy invite message</button>}
        </>}>
        {recipient
          ? <textarea readOnly value={message} rows={9} style={{ ...inputStyle, fontFamily: "inherit", lineHeight: 1.5, resize: "vertical" }} onFocus={(e) => e.currentTarget.select()} />
          : <div style={{ fontSize: 12.5, color: T.inkMuted }}>Shared successfully.</div>}
      </ModalShell>
    );
  }

  return (
    <ModalShell title="Share files" sub="Pick who and what — they're notified, and every open shows up on their card." onClose={onClose}
      foot={<>
        {err ? <span style={{ fontSize: 11.5, color: T.status.critical, flex: 1 }}>{err}</span> : <span style={{ fontSize: 11.5, color: T.inkMuted, flex: 1 }}>Opens are tracked automatically.</span>}
        <button type="button" className="btn-link" onClick={onClose}>Cancel</button>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => void submit()}>{busy ? "Sharing…" : `Share ${picked.size || ""} ${picked.size === 1 ? "item" : "items"}`.trim()}</button>
      </>}>
      <div>
        <label style={labelStyle}>Send to</label>
        {contractors.length === 0
          ? <div style={{ fontSize: 12.5, color: T.inkMuted }}>No contractors yet — add one first.</div>
          : <select style={inputStyle} value={personId} onChange={(e) => setPersonId(e.target.value)}>
              {contractors.map((c) => <option key={c.id} value={c.id}>{c.name}{c.org ? ` · ${c.org}` : ""}</option>)}
            </select>}
      </div>
      <div>
        <label style={labelStyle}>Files &amp; folders <span style={{ color: T.inkMuted, fontWeight: 400 }}>from this account's SharePoint ({picked.size} selected)</span></label>
        <FolderTreePicker accountId={account.id} loginHintEmail={loginHintEmail} multiSelect selectedKantataIds={new Set(picked.keys())} onSelect={togglePick} />
      </div>
    </ModalShell>
  );
}
