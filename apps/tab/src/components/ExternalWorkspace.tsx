import { useEffect, useMemo, useState } from "react";
import { T } from "../theme.js";
import { Button, Card, EmptyState, Crumbs } from "./ui.js";
import { TagChip } from "./bits.js";
import type { Me } from "../workspace/meApi.js";
import {
  fetchExternalWorkspace,
  postExternalMessage,
  decideFileApproval,
  type ExternalWorkspacePayload,
  type ExternalMessage,
} from "../workspace/externalWorkspaceApi.js";
import { listFolder, uploadFile, type FileListing } from "../workspace/msFiles.js";
import { MsApiError } from "../workspace/msApiFetch.js";

/** `MsApiError.message` is a generic per-code bucket (e.g. "Microsoft Graph
 * request failed" for every graph_failed, regardless of cause) — the real
 * Graph status/reason is carried separately in `.detail`. Same helper as
 * `ClientAdminPanel.tsx`'s, kept as its own private copy here rather than
 * shared, matching this codebase's convention for this one small function. */
function describeMsApiError(err: unknown, fallback: string): string {
  if (err instanceof MsApiError) return err.detail ? `${err.message}: ${err.detail}` : err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

/**
 * The external's shell (teams-provisioning-plan.md C2: "one shell, two
 * roles"). A SEPARATE component subtree from ClientWorkspace.tsx — this
 * file must never import workspace/store.js, the ROI modules, or anything
 * else on clientSafety.test.ts's denylist. It is composed only from its own
 * fetch (externalWorkspaceApi.ts, a single RLS-scoped read) and generic UI
 * primitives (ui.js/bits.js/theme.js) — never a borrowed internal component.
 *
 * Role decides the view set — client gets Dashboard/Plan/Discussions/
 * Approvals/Files; contractor gets Tasks/Discussions/Files. Neither ever
 * sees resourcing, hours, money, another account's data, or the internal
 * thread — there is no prop or code path here that could carry any of that,
 * because this file never receives it in the first place.
 */
export function ExternalWorkspace({ me, loginHintEmail, onSignOut }: { me: Me; loginHintEmail?: string | undefined; onSignOut: () => void }) {
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(me.accounts[0]?.accountId ?? null);

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <ExternalBrandHeader />
      <div style={{ flex: 1, maxWidth: 1000, width: "100%", margin: "0 auto", padding: 18, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Crumbs trail={[{ label: me.displayName ?? "You" }]} />
          <Button variant="ghost" size="sm" onClick={onSignOut}>
            Sign out
          </Button>
        </div>

        {me.accounts.length === 0 && (
          <Card>
            <EmptyState icon="🔒" title="No accounts linked yet" hint="Ask your AGP contact to add you to a workspace." />
          </Card>
        )}

        {me.accounts.length > 1 && (
          <Card title="Client">
            <select value={selectedAccountId ?? ""} onChange={(e) => setSelectedAccountId(e.target.value)} className="select" style={{ minWidth: 220 }}>
              {me.accounts.map((a) => (
                <option key={a.accountId} value={a.accountId}>{a.clientName}</option>
              ))}
            </select>
          </Card>
        )}

        {selectedAccountId && <ExternalAccount key={selectedAccountId} accountId={selectedAccountId} loginHintEmail={loginHintEmail} />}
      </div>
      <ExternalFooter />
    </div>
  );
}

/** Same navy gradient + white text as the sign-in screen's brand block
 * (App.tsx's .auth-shell / .auth-logo-mark / .auth-wordmark CSS classes —
 * not reused directly, since this file stays on plain inline styles per its
 * own module-header rule, but matched color-for-color so this is
 * recognizably the SAME brand surface, not a second, differently-colored
 * one). This is the external's only screen, and until now it opened
 * straight into tabs with no identity above them at all. */
function ExternalBrandHeader() {
  return (
    <div
      style={{
        background: "linear-gradient(160deg, #22346f 0%, #152b54 100%)",
      }}
    >
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "12px 18px", display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            background: "#fff",
            color: "#1b3668",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: 0.2,
            flexShrink: 0,
          }}
        >
          AGP
        </span>
        <span style={{ fontSize: 14.5, fontWeight: 600, color: "#fff", letterSpacing: -0.2 }}>
          Allegiance Group <span style={{ color: "#7ccfe8", fontWeight: 500 }}>+ Pursuant</span>
        </span>
        <span style={{ fontSize: 11.5, color: "rgba(255,255,255,0.62)", fontWeight: 600 }}>Collaboration Workspace</span>
      </div>
    </div>
  );
}

function ExternalFooter() {
  return (
    <div style={{ borderTop: `1px solid ${T.grid}`, marginTop: 24 }}>
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "14px 18px", fontSize: 11.5, color: T.inkMuted }}>
        Allegiance Group + Pursuant — questions about what you're seeing here go to your AGP contact.
      </div>
    </div>
  );
}

type ExternalTab = "dashboard" | "plan" | "discussions" | "approvals" | "files" | "tasks";

function ExternalAccount({ accountId, loginHintEmail }: { accountId: string; loginHintEmail?: string | undefined }) {
  const [data, setData] = useState<ExternalWorkspacePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<ExternalTab | null>(null);

  async function reload() {
    try {
      const d = await fetchExternalWorkspace(accountId);
      setData(d);
      setError(null);
    } catch (err) {
      setError(err instanceof MsApiError ? err.message : "failed to load");
    }
  }

  useEffect(() => {
    void reload();
  }, [accountId]);

  if (error) return <Card><div style={{ color: T.status.critical, fontSize: 13 }}>{error}</div></Card>;
  if (!data) return <Card><div style={{ color: T.inkMuted, fontSize: 13 }}>Loading…</div></Card>;

  const isClient = data.myRole === "client";
  const tabs: ExternalTab[] = isClient ? ["dashboard", "plan", "discussions", "approvals", "files"] : ["tasks", "discussions", "files"];
  const activeTab = tab && tabs.includes(tab) ? tab : tabs[0];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Same navy-band underline-tab treatment as the internal ClientWorkspace
          header (ClientWorkspace.tsx's Cara-wireframe band) — one tab style
          across employee, client and contractor views, not three looks for
          the same idea. */}
      <div style={{ display: "flex", alignItems: "stretch", gap: 18, background: T.roi.navy, borderRadius: 10, padding: "0 18px", flexWrap: "wrap", minHeight: 52 }}>
        <h1 style={{ fontSize: 16.5, fontWeight: 800, color: "#fff", alignSelf: "center", whiteSpace: "nowrap", padding: "10px 0", display: "flex", alignItems: "center", gap: 8 }}>
          {data.clientName}
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              color: "rgba(255,255,255,0.85)",
              background: "rgba(255,255,255,0.15)",
              border: "1px solid rgba(255,255,255,0.3)",
              borderRadius: 999,
              padding: "2px 9px",
            }}
          >
            {isClient ? "Client" : "Contractor"}
          </span>
        </h1>
        <div role="tablist" aria-label="Workspace" style={{ display: "flex", gap: 4, flex: 1, flexWrap: "wrap", alignItems: "stretch" }}>
          {tabs.map((t) => {
            const active = activeTab === t;
            return (
              <button
                key={t}
                role="tab"
                aria-selected={active}
                type="button"
                onClick={() => setTab(t)}
                style={{
                  background: "none",
                  border: "none",
                  borderBottom: active ? "3px solid #fff" : "3px solid transparent",
                  color: active ? "#fff" : "rgba(255,255,255,0.72)",
                  fontSize: 12.5,
                  fontWeight: active ? 800 : 600,
                  padding: "16px 10px 13px",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {tabLabel(t)}
              </button>
            );
          })}
        </div>
      </div>

      {activeTab === "dashboard" && <ClientDashboard data={data} />}
      {activeTab === "plan" && <ClientPlan data={data} />}
      {activeTab === "tasks" && <ContractorTasks data={data} />}
      {activeTab === "discussions" && <Discussions accountId={accountId} data={data} onPosted={reload} />}
      {activeTab === "approvals" && <Approvals data={data} onDecided={reload} />}
      {activeTab === "files" && <ExternalFiles accountId={accountId} data={data} {...(loginHintEmail ? { loginHintEmail } : {})} />}
    </div>
  );
}

function tabLabel(t: ExternalTab): string {
  switch (t) {
    case "dashboard": return "Dashboard";
    case "plan": return "Plan";
    case "tasks": return "Tasks";
    case "discussions": return "Discussions";
    case "approvals": return "Approvals";
    case "files": return "Files";
  }
}

function fmtDay(d: string): string {
  return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Composed only from this account's campaigns/tasks/approvals — never
 * borrows ClientDashboard from ClientWorkspace.tsx (C2's own rule: "built,
 * not borrowed"). */
function ClientDashboard({ data }: { data: ExternalWorkspacePayload }) {
  const upcoming = data.campaigns.filter((c) => c.nextMilestoneDate).sort((a, b) => (a.nextMilestoneDate! < b.nextMilestoneDate! ? -1 : 1));
  const needsDecision = data.fileApprovals.filter((f) => f.purpose === "approval" && !f.decision);
  const shipped = data.tasks.filter((t) => t.status === "done" && t.completedAt).sort((a, b) => (b.completedAt! < a.completedAt! ? -1 : 1)).slice(0, 8);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Card title="Campaigns">
        {data.campaigns.length === 0 && <div style={{ fontSize: 12.5, color: T.inkMuted }}>Nothing active yet.</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {data.campaigns.map((c) => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: `1px solid ${T.grid}` }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: T.ink, flex: 1 }}>{c.name}</span>
              <TagChip>{c.status}</TagChip>
            </div>
          ))}
        </div>
      </Card>
      <Card title="Upcoming milestones">
        {upcoming.length === 0 && <div style={{ fontSize: 12.5, color: T.inkMuted }}>Nothing scheduled.</div>}
        {upcoming.map((c) => (
          <div key={c.id} style={{ display: "flex", gap: 10, fontSize: 12.5, padding: "4px 0" }}>
            <span style={{ color: T.ink, flex: 1 }}>{c.nextMilestone}</span>
            <span style={{ color: T.inkMuted }}>{fmtDay(c.nextMilestoneDate!)}</span>
          </div>
        ))}
      </Card>
      <Card title="Needs your decision">
        {needsDecision.length === 0 && <div style={{ fontSize: 12.5, color: T.inkMuted }}>Nothing waiting on you.</div>}
        {needsDecision.map((f) => (
          <div key={f.id} style={{ fontSize: 12.5, padding: "4px 0" }}>{f.name}</div>
        ))}
      </Card>
      <Card title="Recently shipped">
        {shipped.length === 0 && <div style={{ fontSize: 12.5, color: T.inkMuted }}>Nothing yet.</div>}
        {shipped.map((t) => (
          <div key={t.id} style={{ fontSize: 12.5, padding: "4px 0" }}>{t.title}</div>
        ))}
      </Card>
    </div>
  );
}

/**
 * Every milestone (or nested phase) folder this person holds a grant on,
 * shown as its own entry regardless of whether any individual task under
 * it happens to be flagged client_visible/contractor_visible — grants (who
 * can see something) and visibility flags (what's shared) are deliberately
 * separate in this app (B7: "flags choose what is shared; grants choose
 * with whom"), so a milestone grant with no visible tasks yet would
 * otherwise show up nowhere in Plan/Tasks at all. Mirrors how Discussions
 * already shows a heading per granted milestone, independent of individual
 * message visibility.
 */
function MilestonesCard({ data }: { data: ExternalWorkspacePayload }) {
  const nameByKantataId = new Map(data.msFolders.map((f) => [f.kantataId, f.name] as const));
  const milestones = data.grants.filter((g) => g.level === "milestone" || g.level === "phase");
  if (milestones.length === 0) return null;
  return (
    <Card title="Milestones">
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {milestones.map((g) => (
          <div key={g.kantataId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0", borderBottom: `1px solid ${T.grid}` }}>
            <span style={{ flex: 1, fontSize: 12.5, color: T.ink }}>{nameByKantataId.get(g.kantataId) ?? g.kantataId}</span>
            <TagChip>{g.role}</TagChip>
          </div>
        ))}
      </div>
    </Card>
  );
}

function ClientPlan({ data }: { data: ExternalWorkspacePayload }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <MilestonesCard data={data} />
      <Card title="Plan">
        {data.tasks.length === 0 && <div style={{ fontSize: 12.5, color: T.inkMuted }}>Nothing shared yet.</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {data.tasks.map((t) => (
            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: `1px solid ${T.grid}` }}>
              <span style={{ flex: 1, fontSize: 12.5, color: T.ink }}>{t.title}</span>
              <TagChip>{t.status}</TagChip>
              <span style={{ fontSize: 11.5, color: T.inkMuted, minWidth: 60, textAlign: "right" }}>{t.due ? fmtDay(t.due) : "—"}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function ContractorTasks({ data }: { data: ExternalWorkspacePayload }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <MilestonesCard data={data} />
      <Card title="Your tasks">
        {data.tasks.length === 0 && <div style={{ fontSize: 12.5, color: T.inkMuted }}>Nothing assigned to you yet.</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {data.tasks.map((t) => (
            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: `1px solid ${T.grid}` }}>
              <span style={{ flex: 1, fontSize: 12.5, color: T.ink }}>{t.title}</span>
              <TagChip>{t.status}</TagChip>
              <span style={{ fontSize: 11.5, color: T.inkMuted, minWidth: 60, textAlign: "right" }}>{t.due ? fmtDay(t.due) : "—"}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/** Per-milestone threads (C2: "present per milestone, not one filtered
 * list") — grouped by kantataId, never one flat feed. A message with no
 * kantataId never reaches this payload at all (RLS), so every group here is
 * real. */
function Discussions({ accountId, data, onPosted }: { accountId: string; data: ExternalWorkspacePayload; onPosted: () => void }) {
  const folderNameByKantataId = useMemo(() => new Map(data.msFolders.map((f) => [f.kantataId, f.name] as const)), [data.msFolders]);
  const grouped = useMemo(() => {
    const byId = new Map<string, ExternalMessage[]>();
    for (const m of data.messages) {
      if (!m.kantataId) continue;
      const list = byId.get(m.kantataId) ?? [];
      list.push(m);
      byId.set(m.kantataId, list);
    }
    return byId;
  }, [data.messages]);

  if (grouped.size === 0) {
    return <Card><div style={{ fontSize: 12.5, color: T.inkMuted }}>No discussions shared with you yet.</div></Card>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {[...grouped.entries()].map(([kantataId, messages]) => (
        <MilestoneThread key={kantataId} accountId={accountId} kantataId={kantataId} title={folderNameByKantataId.get(kantataId) ?? `Milestone ${kantataId}`} messages={messages} onPosted={onPosted} />
      ))}
    </div>
  );
}

function MilestoneThread({
  accountId,
  kantataId,
  title,
  messages,
  onPosted,
}: {
  accountId: string;
  kantataId: string;
  title: string;
  messages: ExternalMessage[];
  onPosted: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  return (
    <Card title={title}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
        {messages.map((m) => (
          <div key={m.id} style={{ background: "#f7f6f3", borderLeft: "3px solid #16708f", borderRadius: 6, padding: "8px 10px" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: T.ink }}>{m.author}</span>
              <span style={{ fontSize: 10, color: T.inkMuted, marginLeft: "auto" }}>{m.createdAt.slice(0, 10)}</span>
            </div>
            <div style={{ fontSize: 12.5, color: T.ink, marginTop: 4 }}>{m.body}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <textarea className="textarea" rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Reply…" style={{ flex: 1, fontSize: 12.5 }} />
        <Button
          size="sm"
          disabled={busy || !draft.trim()}
          onClick={() => {
            setBusy(true);
            setErr(null);
            postExternalMessage(accountId, draft.trim(), kantataId)
              .then(() => {
                setDraft("");
                onPosted();
              })
              .catch((e) => setErr(e instanceof MsApiError ? e.message : "failed to post"))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "Posting…" : "Reply"}
        </Button>
      </div>
      {err && <div style={{ fontSize: 11.5, color: T.status.critical, marginTop: 6 }}>{err}</div>}
    </Card>
  );
}

function Approvals({ data, onDecided }: { data: ExternalWorkspacePayload; onDecided: () => void }) {
  return (
    <Card title="Approvals">
      {data.fileApprovals.length === 0 && <div style={{ fontSize: 12.5, color: T.inkMuted }}>Nothing shared for review yet.</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {data.fileApprovals.map((f) => (
          <ApprovalRow key={f.id} approval={f} onDecided={onDecided} />
        ))}
      </div>
    </Card>
  );
}

function ApprovalRow({ approval, onDecided }: { approval: ExternalWorkspacePayload["fileApprovals"][number]; onDecided: () => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const decide = (decision: "approved" | "changes") => {
    setBusy(true);
    setErr(null);
    decideFileApproval(approval.id, decision, note.trim() || undefined)
      .then(() => onDecided())
      .catch((e) => setErr(e instanceof MsApiError ? e.message : "failed to record decision"))
      .finally(() => setBusy(false));
  };

  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: T.ink, flex: 1 }}>{approval.name}</span>
        <TagChip>{approval.purpose}</TagChip>
        {approval.decision && <span style={{ fontSize: 11, color: approval.decision === "approved" ? T.status.good : T.status.warning }}>{approval.decision}</span>}
      </div>
      {approval.purpose === "approval" && !approval.decision && (
        <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="input" style={{ flex: 1, minWidth: 160, fontSize: 12 }} />
          <Button size="sm" disabled={busy} onClick={() => decide("approved")}>Approve</Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => decide("changes")}>Request changes</Button>
        </div>
      )}
      {err && <div style={{ fontSize: 11.5, color: T.status.critical, marginTop: 6 }}>{err}</div>}
    </div>
  );
}

function ExternalFiles({ accountId, data, loginHintEmail }: { accountId: string; data: ExternalWorkspacePayload; loginHintEmail?: string | undefined }) {
  const [selectedKantataId, setSelectedKantataId] = useState(data.msFolders[0]?.kantataId ?? "");
  const [listing, setListing] = useState<FileListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);

  // A write-role grant row existing isn't enough — Graph will 403 the actual
  // upload unless the SharePoint invite behind it really completed
  // (msPermissionId set). Without that check the button looks live but is
  // guaranteed to fail with a raw Graph error for anyone caught in a
  // half-grant (api/grant.ts's own "the row is real, the UI shows a
  // half-grant with a retry, never a silent gap" — this is that check on
  // the contractor's own side, not just the admin's).
  const writeGrant = data.grants.find((g) => g.kantataId === selectedKantataId && g.role === "write");
  const canWrite = !!writeGrant?.msPermissionId;
  const writePending = !!writeGrant && !writeGrant.msPermissionId;

  async function reload(kantataId: string) {
    setLoading(true);
    setErr(null);
    try {
      const l = await listFolder(accountId, kantataId, loginHintEmail);
      setListing(l);
    } catch (e) {
      setErr(describeMsApiError(e, "failed to list folder"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (selectedKantataId) void reload(selectedKantataId);
  }, [selectedKantataId]);

  if (data.msFolders.length === 0) {
    return <Card><div style={{ fontSize: 12.5, color: T.inkMuted }}>No folders shared with you yet.</div></Card>;
  }

  return (
    <Card title="Files">
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <select value={selectedKantataId} onChange={(e) => setSelectedKantataId(e.target.value)} className="select" style={{ minWidth: 220 }}>
          {data.msFolders.map((f) => (
            <option key={f.kantataId} value={f.kantataId}>{f.name}</option>
          ))}
        </select>
        {listing?.folderWebUrl && (
          <a href={listing.folderWebUrl} target="_blank" rel="noreferrer" className="btn-link" style={{ fontSize: 12 }}>
            Open in SharePoint ↗
          </a>
        )}
        {canWrite && (
          <label className="btn btn-secondary btn-sm" style={{ cursor: "pointer" }}>
            {uploadPct !== null ? `Uploading… ${uploadPct}%` : "Upload"}
            <input
              type="file"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setUploadPct(0);
                uploadFile(accountId, selectedKantataId, file, {
                  ...(loginHintEmail ? { loginHintEmail } : {}),
                  onProgress: (p) => setUploadPct(Math.round((p.bytesSent / p.totalBytes) * 100)),
                })
                  .then(() => reload(selectedKantataId))
                  .catch((err2) => setErr(describeMsApiError(err2, "upload failed")))
                  .finally(() => setUploadPct(null));
              }}
            />
          </label>
        )}
        {writePending && (
          <span style={{ fontSize: 11.5, color: T.status.warning }}>
            Your upload access to this folder is still being set up — ask AGP to finish it.
          </span>
        )}
      </div>
      {loading && <div style={{ fontSize: 12.5, color: T.inkMuted }}>Loading…</div>}
      {err && <div style={{ fontSize: 12.5, color: T.status.critical }}>{err}</div>}
      {listing && (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>
          {listing.items.length === 0 && <li style={{ color: T.inkMuted, listStyle: "none", marginLeft: -18 }}>Empty.</li>}
          {listing.items.map((item) => (
            <li key={item.id}>
              {item.isFolder ? "📁" : "📄"} {item.webUrl ? <a href={item.webUrl} target="_blank" rel="noreferrer">{item.name}</a> : item.name}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
