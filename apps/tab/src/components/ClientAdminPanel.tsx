import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { T } from "../theme.js";
import { Button, Card } from "./ui.js";
import {
  fetchAccountCollabData,
  fetchProvisioningPlan,
  toOldTask,
  setViewConfig,
  type MsAccountData,
  type MsAccountMember,
  type WorkspaceAccountPayload,
  type ProvisioningPlanNode,
} from "../workspace/msAccountData.js";
import { TIER_LABELS, type ViewConfig, type ViewTier } from "../workspace/roles.js";
import { adoptTeam, syncProjectFolders, createMilestoneFolders, syncTeamMembers, subscribeTeamsSync, teamsSyncStatus, type TeamsSyncStatus } from "../workspace/msProvision.js";
import { grantAccess, revokeGrant, revokeAllForPerson } from "../workspace/msShare.js";
import { addMember, setMemberEmail, resolveMemberEmails, addExternal, removeExternal, resolveExternalIdentity, linkKantataProjects, fetchAllExternals, type AdminExternalRow } from "../workspace/msPeople.js";
import { listFolder, uploadFile, type FileListing } from "../workspace/msFiles.js";
import { listFolderChildren, type FolderTreeNode } from "../workspace/msFolderTree.js";
import { shareItems, revokeShare as revokeShareApi, type ShareItemInput } from "../workspace/msHandover.js";
import { personHandover, isLive, type PersonHandover } from "../workspace/handover.js";
import { AS_OF_TODAY } from "../workspace/format.js";
import type { Task } from "../workspace/types.js";
import { MsApiError } from "../workspace/msApiFetch.js";

/** `MsApiError.message` is deliberately a generic per-code bucket (e.g.
 * "Microsoft Graph request failed" for every graph_failed, regardless of
 * cause — see api/_lib/graph.ts's graphApiError) — the actual Graph status
 * and response body are carried separately in `.detail`. Every catch site
 * below was showing only `.message`, silently discarding the one piece of
 * information that would tell a user (or us, reading a bug report) WHICH
 * Graph call failed and why. */
function describeMsApiError(err: unknown, fallback: string): string {
  if (err instanceof MsApiError) return err.detail ? `${err.message}: ${err.detail}` : err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

/** A grant's kantataId is an opaque identity (a real Kantata id, or a
 * "graph:"-prefixed synthetic one for a browsed, non-Kantata folder) —
 * never something to show a person directly. `collab.ms_folder` already
 * carries the real name for both cases (ensureMsFolderForGraphId persists
 * one even for synthetic ids), so this is a lookup, not a fallback guess;
 * only a grant whose folder hasn't been resolved yet (no ms_folder row so
 * far) falls back to the raw id, which is genuinely all there is to show. */
function folderDisplayName(kantataId: string, msFolders: WorkspaceAccountPayload["msFolders"]): ReactNode {
  const folder = msFolders.find((f) => f.kantataId === kantataId);
  return folder ? folder.name : <code>{kantataId}</code>;
}

/** A grant's level as a folder glyph, colour-coded so "folder" (a hand-picked,
 * possibly non-Kantata folder) and "milestone" (the usual grant unit) read
 * apart at a glance instead of as plain text. Other levels (project/phase/task)
 * are rare here and stay as plain text. */
function LevelIcon({ level }: { level: "project" | "milestone" | "phase" | "task" | "folder" }) {
  if (level !== "folder" && level !== "milestone") return <span>{level}</span>;
  const color = level === "folder" ? T.status.warning : T.series1;
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill={color} aria-label={level} role="img" style={{ verticalAlign: "text-bottom", flexShrink: 0 }}>
      <title>{level}</title>
      <path d="M4 4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8L8 4H4z" />
    </svg>
  );
}

interface ExistingPersonCandidate {
  /** userId when resolved, else "email:<lowercased email>" — whatever this
   * person was deduped by across every other account's external_link rows. */
  key: string;
  name: string;
  org: string;
  email?: string;
  userId?: string;
  role: "client" | "contractor";
  /** Every other client this person is already linked to. */
  accounts: string[];
}

/**
 * "Add an existing person instead of retyping them" — search-as-you-type
 * over every external already added anywhere else (fetchAllExternals,
 * app_admin only; GrantPanel only renders this when that fetch succeeded).
 * Picking a suggestion prefills the manual-entry fields below it; the
 * caller decides what "picked" means (GrantPanel also stores the userId so
 * the new link can skip the pending "waiting for sign-in" state).
 */
function ExistingPersonPicker({ candidates, onPick }: { candidates: ExistingPersonCandidate[]; onPick: (c: ExistingPersonCandidate) => void }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const matches =
    q.length === 0
      ? []
      : candidates.filter((c) => c.name.toLowerCase().includes(q) || c.org.toLowerCase().includes(q) || (c.email ?? "").toLowerCase().includes(q)).slice(0, 8);

  return (
    <div style={{ position: "relative", maxWidth: 320 }}>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Or search for an existing person…"
        style={{ width: "100%", padding: "6px 10px", borderRadius: 8, border: `1px solid ${T.border}`, fontSize: 12.5 }}
      />
      {matches.length > 0 && (
        <div
          style={{
            position: "absolute",
            zIndex: 5,
            top: "100%",
            left: 0,
            right: 0,
            background: T.surface,
            border: `1px solid ${T.border}`,
            borderRadius: 8,
            marginTop: 2,
            maxHeight: 220,
            overflowY: "auto",
            boxShadow: "0 4px 12px rgba(16,21,46,0.12)",
          }}
        >
          {matches.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => {
                onPick(c);
                setQuery("");
              }}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 10px", border: "none", background: "none", cursor: "pointer" }}
            >
              <div style={{ fontSize: 12.5, color: T.ink }}>
                <strong>{c.name}</strong> <span style={{ color: T.inkMuted }}>· {c.org}{c.email ? ` · ${c.email}` : ""}</span>
              </div>
              <div style={{ fontSize: 10.5, color: T.inkMuted }}>Already on: {c.accounts.join(", ")}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Live, expand-on-click browse of the account's real SharePoint folder tree
 * (B7, folder access widened to "any real folder" — not just ones synced
 * from Kantata). One `<select>`-replacing picker shared by FilesPanel
 * (single-pick, `selectedKantataId`) and GrantPanel/ExternalRow (multi-pick
 * for a batch grant, `selectedKantataIds` + `multiSelect`). `onSelect` fires
 * on every click either way — a single-select caller replaces its picked
 * node, a multi-select caller toggles the clicked node in its own set; this
 * component holds no selection state of its own beyond fetch/expand state.
 * Backed by `api/account-folder-children.ts`, which lists ONE folder's
 * children per call — this fetches the drive root on mount, and each
 * subtree only once it's actually expanded.
 */
export function FolderTreePicker({
  accountId,
  loginHintEmail,
  selectedKantataId,
  selectedKantataIds,
  multiSelect,
  onSelect,
}: {
  accountId: string;
  loginHintEmail?: string | undefined;
  selectedKantataId?: string | undefined;
  selectedKantataIds?: ReadonlySet<string> | undefined;
  multiSelect?: boolean | undefined;
  onSelect: (node: FolderTreeNode) => void;
}) {
  return (
    <div style={{ maxHeight: 220, overflowY: "auto", border: `1px solid ${T.border}`, borderRadius: 8, padding: 6, fontSize: 12.5 }}>
      <FolderTreeLevel
        accountId={accountId}
        loginHintEmail={loginHintEmail}
        selectedKantataId={selectedKantataId}
        selectedKantataIds={selectedKantataIds}
        multiSelect={multiSelect}
        onSelect={onSelect}
        depth={0}
      />
    </div>
  );
}

function FolderTreeLevel({
  accountId,
  folderId,
  depth,
  loginHintEmail,
  selectedKantataId,
  selectedKantataIds,
  multiSelect,
  onSelect,
}: {
  accountId: string;
  folderId?: string | undefined;
  depth: number;
  loginHintEmail?: string | undefined;
  selectedKantataId?: string | undefined;
  selectedKantataIds?: ReadonlySet<string> | undefined;
  multiSelect?: boolean | undefined;
  onSelect: (node: FolderTreeNode) => void;
}) {
  const [items, setItems] = useState<FolderTreeNode[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Toggled visibility vs. ever-opened: a node's subtree stays MOUNTED once
  // opened (just hidden on collapse) so re-expanding doesn't refetch it.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [everExpanded, setEverExpanded] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    listFolderChildren(accountId, folderId, loginHintEmail)
      .then((r) => {
        if (!cancelled) setItems(r.items);
      })
      .catch((e) => {
        if (!cancelled) setErr(describeMsApiError(e, "failed to list folders"));
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, folderId, loginHintEmail]);

  if (err) return <div style={{ color: T.status.critical, paddingLeft: depth * 14 }}>{err}</div>;
  if (!items) return <div style={{ color: T.inkMuted, paddingLeft: depth * 14 }}>Loading…</div>;
  if (items.length === 0) return depth === 0 ? <div style={{ color: T.inkMuted }}>No folders.</div> : null;

  return (
    <>
      {items.map((node) => (
        <div key={node.id}>
          <div style={{ display: "flex", alignItems: "center", gap: 4, paddingLeft: depth * 14 }}>
            {node.hasChildren ? (
              <button
                type="button"
                className="btn-link"
                style={{ fontSize: 11, width: 14, flexShrink: 0 }}
                onClick={() => {
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    if (next.has(node.id)) next.delete(node.id);
                    else next.add(node.id);
                    return next;
                  });
                  setEverExpanded((prev) => new Set(prev).add(node.id));
                }}
              >
                {expanded.has(node.id) ? "▼" : "▶"}
              </button>
            ) : (
              <span style={{ width: 14, flexShrink: 0 }} />
            )}
            {multiSelect ? (
              <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
                <input type="checkbox" checked={selectedKantataIds?.has(node.kantataId) ?? false} onChange={() => onSelect(node)} />
                📁 {node.name}
              </label>
            ) : (
              <button
                type="button"
                className="btn-link"
                style={{ textAlign: "left", fontWeight: node.kantataId === selectedKantataId ? 700 : 400 }}
                onClick={() => onSelect(node)}
              >
                📁 {node.name}
              </button>
            )}
          </div>
          {everExpanded.has(node.id) && (
            <div style={{ display: expanded.has(node.id) ? "block" : "none" }}>
              <FolderTreeLevel
                accountId={accountId}
                folderId={node.id}
                depth={depth + 1}
                loginHintEmail={loginHintEmail}
                selectedKantataId={selectedKantataId}
                selectedKantataIds={selectedKantataIds}
                multiSelect={multiSelect}
                onSelect={onSelect}
              />
            </div>
          )}
        </div>
      ))}
    </>
  );
}

/**
 * The internal-only "Client Admin" surface (teams-provisioning-plan.md B3
 * Provisioning, B4 folder tree, B5 internal membership, B7 external access)
 * — a tab (`ClientWorkspace.tsx`'s "Admin") inside a client's own page, not
 * a separate route. It used to be a standalone screen with its own client
 * picker; now the caller (`ClientWorkspace.tsx`'s `ClientAdminTab`) already
 * knows which client it's showing and resolves the matching
 * `collab.client_account` row itself, so this component only ever renders
 * for one already-resolved account.
 *
 * Operates on `collab.client_account` rows (the new Postgres schema, B6) —
 * NOT the same universe as `ws.accounts` (the old single-JSON-document
 * model `ClientWorkspace.tsx` still reads for everything else). The two
 * are bridged only by matching `clientName` (`ClientAdminTab`'s own job,
 * same pattern as `store.ts`'s `bridgeKantataProjectIds`) — there is still
 * no shared id between them.
 */
export function ClientAdminPanel({ account, loginHintEmail, onAccountChanged, canManage = false }: { account: MsAccountData; loginHintEmail?: string | undefined; onAccountChanged: () => void; canManage?: boolean }) {
  const [data, setData] = useState<WorkspaceAccountPayload | null>(null);
  const [plan, setPlan] = useState<ProvisioningPlanNode[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function reload() {
    try {
      const [d, p] = await Promise.all([fetchAccountCollabData(account.id), fetchProvisioningPlan(account.id)]);
      setData(d);
      setPlan(p.tree);
      setLoadError(null);
    } catch (err) {
      setLoadError(describeMsApiError(err, "failed to load client data"));
    }
  }

  useEffect(() => {
    void reload();
  }, [account.id]);

  if (loadError) return <Card><div style={{ color: T.status.critical, fontSize: 13 }}>{loadError}</div></Card>;
  if (!data || !plan) return <Card><div style={{ color: T.inkMuted, fontSize: 13 }}>Loading…</div></Card>;

  const myAccount = data.accounts.find((a) => a.id === account.id) ?? account;

  return (
    <>
      <KantataProjectsPanel account={myAccount} onChanged={() => { onAccountChanged(); void reload(); }} />
      <ProvisioningPanel account={myAccount} loginHintEmail={loginHintEmail} onChanged={() => { onAccountChanged(); void reload(); }} />
      <TeamsSyncPanel account={myAccount} />
      <FolderSyncPanel account={myAccount} plan={plan} loginHintEmail={loginHintEmail} onChanged={() => void reload()} />
      <FilesPanel account={myAccount} loginHintEmail={loginHintEmail} />
      <MembershipPanel account={myAccount} members={data.members} loginHintEmail={loginHintEmail} onChanged={() => void reload()} />
      {canManage && <ViewTiersPanel account={myAccount} members={data.members} onChanged={() => { onAccountChanged(); void reload(); }} />}
      <GrantPanel account={myAccount} externals={data.externals} grants={data.grants} msFolders={data.msFolders} loginHintEmail={loginHintEmail} onChanged={() => void reload()} />
      {/* HandoverPanel hidden per request — component/logic left in place below, just not mounted. */}
    </>
  );
}

/**
 * Role-based View Tiers (Kellie/Cara/Suuchi pilot). Super-admin-only card that
 * assigns internal people to a view tier: "account" (Client Experience —
 * strategists + PMs) sees every tab; "delivery" sees only Home, Project Plan,
 * Discussions and Files — no Client Dashboard, no Admin. Stored per account in
 * view_config; a person's tier applies on their next load. Presentation-layer
 * only for now (same honest limitation as roles.ts) — it curates the UI, it is
 * not yet a security boundary.
 */
function ViewTiersPanel({ account, members, onChanged }: { account: MsAccountData; members: MsAccountMember[]; onChanged: () => void }) {
  const [defaultTier, setDefaultTier] = useState<ViewTier>(account.viewConfig?.defaultTier ?? "project_manager");
  const [memberTiers, setMemberTiers] = useState<Record<string, ViewTier>>({ ...(account.viewConfig?.memberTiers ?? {}) });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Re-seed from the saved config after a reload replaces the account object.
  useEffect(() => {
    setDefaultTier(account.viewConfig?.defaultTier ?? "project_manager");
    setMemberTiers({ ...(account.viewConfig?.memberTiers ?? {}) });
  }, [account.id, account.viewConfig]);

  const setFor = (email: string, tier: ViewTier | "default") => {
    setMemberTiers((prev) => {
      const next = { ...prev };
      if (tier === "default") delete next[email];
      else next[email] = tier;
      return next;
    });
  };

  const save = () => {
    setBusy(true); setErr(null); setNote(null);
    const config: ViewConfig = { defaultTier, memberTiers };
    setViewConfig(account.id, config)
      .then(() => { setNote("Saved. Each person's view applies on their next load."); onChanged(); })
      .catch((e) => setErr(describeMsApiError(e, "couldn't save view tiers")))
      .finally(() => setBusy(false));
  };

  const withEmail = members.filter((m) => m.email);
  const noEmailCount = members.length - withEmail.length;
  const selStyle: React.CSSProperties = { fontSize: 12.5, padding: "2px 6px", borderRadius: 6, border: `1px solid ${T.grid}` };

  return (
    <Card title="Role-based views">
      <p style={{ fontSize: 12.5, color: T.inkMuted, marginBottom: 8 }}>
        What each person sees. <b>Account Manager</b>: client-facing — Home, Project Plan, Client Dashboard, Files, Discussions, Admin (no Resourcing). <b>Project Manager</b>: the full view — everything, including Resourcing. <b>Delivery</b>: Home, Project Plan, Discussions, Files only — no Client Dashboard, Resourcing or Admin. App admins always see everything.
      </p>
      <div style={{ fontSize: 12.5, marginBottom: 10 }}>
        <label>Default for anyone not set below:{" "}
          <select value={defaultTier} onChange={(e) => setDefaultTier(e.target.value as ViewTier)} style={selStyle}>
            {(Object.keys(TIER_LABELS) as ViewTier[]).map((t) => (
              <option key={t} value={t}>{TIER_LABELS[t]}</option>
            ))}
          </select>
        </label>
      </div>
      {withEmail.length > 0 && (
        <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
          {withEmail.map((m) => {
            const key = m.email!.toLowerCase();
            const cur: ViewTier | "default" = memberTiers[key] ?? "default";
            return (
              <div key={m.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, fontSize: 12.5 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}{m.title ? ` · ${m.title}` : ""}</span>
                <select value={cur} onChange={(e) => setFor(key, e.target.value as ViewTier | "default")} style={selStyle}>
                  <option value="default">Default ({TIER_LABELS[defaultTier]})</option>
                  {(Object.keys(TIER_LABELS) as ViewTier[]).map((t) => (
                    <option key={t} value={t}>{TIER_LABELS[t]}</option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      )}
      {noEmailCount > 0 && (
        <div style={{ fontSize: 11.5, color: T.inkMuted, marginBottom: 8 }}>
          {noEmailCount} member{noEmailCount > 1 ? "s have" : " has"} no email yet — set one in Internal membership above to assign a tier; until then they follow the default.
        </div>
      )}
      <Button size="sm" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save views"}</Button>
      {note && <div style={{ fontSize: 12, color: T.status.good, marginTop: 8 }}>{note}</div>}
      {err && <div style={{ fontSize: 12, color: T.status.critical, marginTop: 8 }}>{err}</div>}
    </Card>
  );
}

function KantataProjectsPanel({ account, onChanged }: { account: MsAccountData; onChanged: () => void }) {
  const [ids, setIds] = useState(account.kantataProjectIds.join(", "));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  return (
    <Card title="Linked Kantata projects">
      <p style={{ fontSize: 12.5, color: T.inkMuted, marginBottom: 8 }}>
        Comma-separated Kantata workspace ids. Everything below — the folder tree, the milestone picker — is computed from these.
      </p>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input
          value={ids}
          onChange={(e) => setIds(e.target.value)}
          placeholder="e.g. 123456, 789012"
          style={{ flex: 1, minWidth: 260, padding: "6px 10px", borderRadius: 8, border: `1px solid ${T.border}` }}
        />
        <Button
          size="sm"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setNote(null);
            const list = ids.split(",").map((s) => s.trim()).filter(Boolean);
            linkKantataProjects(account.id, list)
              .then(() => {
                setNote("saved");
                onChanged();
              })
              .catch((e) => setNote(describeMsApiError(e, "failed to save")))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
      {note && <div style={{ fontSize: 12, color: T.inkMuted, marginTop: 6 }}>{note}</div>}
    </Card>
  );
}

function ProvisioningPanel({ account, loginHintEmail, onChanged }: { account: MsAccountData; loginHintEmail?: string | undefined; onChanged: () => void }) {
  const [teamUrlOrId, setTeamUrlOrId] = useState("");
  // Not "General" — every Team already has that channel built in, so
  // defaulting to it here just guaranteed a NameAlreadyExists on the very
  // first Adopt Team click (caught live). Channel creation is optional;
  // an empty default matches that.
  const [channelNames, setChannelNames] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const provisioned = !!account.msTeam.teamId;

  return (
    <Card title="MS Team">
      {provisioned ? (
        <div style={{ fontSize: 13, color: T.ink, marginBottom: 10 }}>
          Connected Team: {account.msTeam.teamName ?? <code>{account.msTeam.teamId}</code>}
          {account.msTeam.webUrl && (
            <>
              {" · "}
              <a href={account.msTeam.webUrl} target="_blank" rel="noreferrer">
                open drive
              </a>
            </>
          )}
          {account.msTeam.provisionedAt && <span style={{ color: T.inkMuted }}> · provisioned {new Date(account.msTeam.provisionedAt).toLocaleString()}</span>}
        </div>
      ) : (
        <div style={{ fontSize: 13, color: T.inkMuted, marginBottom: 10 }}>Not connected yet. Paste the admin-created Team's URL or id below.</div>
      )}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input
          value={teamUrlOrId}
          onChange={(e) => setTeamUrlOrId(e.target.value)}
          placeholder="Teams link or Team/group id"
          style={{ flex: 1, minWidth: 280, padding: "6px 10px", borderRadius: 8, border: `1px solid ${T.border}` }}
        />
        <input
          value={channelNames}
          onChange={(e) => setChannelNames(e.target.value)}
          placeholder="Channel names, comma-separated"
          style={{ width: 220, padding: "6px 10px", borderRadius: 8, border: `1px solid ${T.border}` }}
        />
        <Button
          size="sm"
          disabled={busy || !teamUrlOrId.trim()}
          onClick={() => {
            setBusy(true);
            setErr(null);
            setResult(null);
            adoptTeam(
              account.id,
              teamUrlOrId.trim(),
              channelNames.split(",").map((s) => s.trim()).filter(Boolean),
              loginHintEmail,
            )
              .then((r) => {
                const failedNote = r.channelsFailed.length > 0 ? ` Failed: ${r.channelsFailed.map((f) => `${f.name} (${f.detail})`).join("; ")}.` : "";
                setResult(`Connected. Channels created: ${r.channelsCreated.join(", ") || "none"}; already present: ${r.channelsSkipped.join(", ") || "none"}.${failedNote}`);
                onChanged();
              })
              .catch((e) => setErr(describeMsApiError(e, "failed to connect Team")))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "Connecting…" : provisioned ? "Re-connect / update" : "Connect Team"}
        </Button>
      </div>
      {result && <div style={{ fontSize: 12, color: T.status.good, marginTop: 8 }}>{result}</div>}
      {err && <div style={{ fontSize: 12, color: T.status.critical, marginTop: 8 }}>{err}</div>}
    </Card>
  );
}

/** Two-way Teams sync diagnostics + control. Surfaces exactly why inbound
 * (Teams reply → Discussion) is or isn't working — server config, webhook URL,
 * and whether a live Graph subscription is registered — plus an Enable/renew
 * button that shows the real Graph error (403 = consent missing, etc.). */
function TeamsSyncPanel({ account }: { account: MsAccountData }) {
  const [status, setStatus] = useState<TeamsSyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const connected = !!account.msTeam.teamId;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const load = () => {
    teamsSyncStatus(account.id).then((s) => { if (mounted.current) setStatus(s); }).catch((e) => { if (mounted.current) setErr(describeMsApiError(e, "couldn't read sync status")); });
  };
  useEffect(() => { if (connected) load(); }, [account.id, connected]);

  // The subscription is created in a background job (a ~30s Microsoft
  // round-trip). subscribeTeamsSync returns immediately with state 'creating';
  // poll GET until it settles to 'active' or 'error' and surface the outcome.
  const pollUntilSettled = async () => {
    const deadline = Date.now() + 75_000;
    for (;;) {
      await new Promise((r) => setTimeout(r, 2500));
      if (!mounted.current) return;
      let s: TeamsSyncStatus;
      try { s = await teamsSyncStatus(account.id); } catch { if (Date.now() > deadline) return; continue; }
      if (!mounted.current) return;
      setStatus(s);
      if (s.status?.state === "active") { setNote("Two-way sync is on — replies in the Teams channel now flow into the Discussion."); return; }
      if (s.status?.state === "error") { setErr(s.status.lastError || "Enabling two-way sync failed."); return; }
      if (Date.now() > deadline) { setErr("Still creating the subscription — taking longer than expected. Click Refresh to check again."); return; }
    }
  };

  const onEnable = () => {
    setBusy(true); setErr(null); setNote(null);
    subscribeTeamsSync(account.id)
      .then(() => {
        setStatus((prev) => prev ? { ...prev, status: { state: "creating", lastError: null, lastAttemptAt: new Date().toISOString() } } : prev);
        return pollUntilSettled();
      })
      .catch((e) => { if (mounted.current) setErr(describeMsApiError(e, "couldn't start two-way sync")); })
      .finally(() => { if (mounted.current) setBusy(false); });
  };

  const state = status?.status?.state;

  return (
    <Card title="Two-way Teams sync">
      <p style={{ fontSize: 12.5, color: T.inkMuted, marginBottom: 8 }}>
        Replies typed in the Team channel flow back into Discussions. Needs the app credential (<code>GRAPH_APP_*</code>) + <code>ChannelMessage.Read.All</code> admin consent.
      </p>
      {!connected ? (
        <div style={{ fontSize: 13, color: T.inkMuted }}>Connect a Team above first — two-way sync attaches to its channel.</div>
      ) : (
        <>
          {status && (
            <div style={{ fontSize: 12.5, marginBottom: 10, lineHeight: 1.8 }}>
              <div>Server configured:{" "}
                {status.configured ? <b style={{ color: T.status.good }}>yes</b> : <b style={{ color: T.status.critical }}>no — missing {status.missingEnv.join(", ")}</b>}</div>
              <div>Webhook URL: {status.webhookUrl ? <code>{status.webhookUrl}</code> : <b style={{ color: T.status.critical }}>not set</b>}</div>
              <div>Subscription:{" "}
                {status.subscription
                  ? (status.subscription.active
                      ? <b style={{ color: T.status.good }}>active until {new Date(status.subscription.expiresAt).toLocaleString()}</b>
                      : <b style={{ color: T.status.warning }}>expired {new Date(status.subscription.expiresAt).toLocaleString()} — click Enable to renew</b>)
                  : <b style={{ color: T.status.critical }}>none registered</b>}</div>
              {state === "creating" && <div><b style={{ color: T.status.warning }}>creating subscription… (contacting Microsoft)</b></div>}
              {state === "error" && status.status?.lastError && !err && <div style={{ color: T.status.critical }}>Last attempt failed: {status.status.lastError}</div>}
            </div>
          )}
          <Button
            size="sm"
            disabled={busy}
            onClick={onEnable}
          >
            {busy ? "Enabling…" : status?.subscription?.active ? "Refresh subscription" : "Enable two-way sync"}
          </Button>
          {note && <div style={{ fontSize: 12, color: T.status.good, marginTop: 8 }}>{note}</div>}
          {err && <div style={{ fontSize: 12, color: T.status.critical, marginTop: 8 }}>{err}</div>}
        </>
      )}
    </Card>
  );
}

function FolderSyncPanel({
  account,
  plan,
  loginHintEmail,
  onChanged,
}: {
  account: MsAccountData;
  plan: ProvisioningPlanNode[];
  loginHintEmail?: string | undefined;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [pickBusy, setPickBusy] = useState(false);

  const projects = plan.filter((n) => n.level === "project");
  const [openProjectId, setOpenProjectId] = useState<string | null>(null);
  const milestones = openProjectId ? plan.filter((n) => n.level === "milestone" && n.parentKantataId === openProjectId) : [];

  if (!account.msTeam.driveId) {
    return (
      <Card title="Folder tree">
        <div style={{ fontSize: 13, color: T.inkMuted }}>Connect the Team above first — folders need a resolved drive.</div>
      </Card>
    );
  }

  return (
    <Card title="Folder tree">
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setErr(null);
            syncProjectFolders(account.id, loginHintEmail)
              .then((r) => {
                setResult(`Created ${r.created.length}, renamed ${r.renamed.length}, gone-from-Kantata ${r.goneFromKantata.length}.`);
                onChanged();
              })
              .catch((e) => setErr(describeMsApiError(e, "sync failed")))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "Syncing…" : "Sync project folders"}
        </Button>
        {result && <span style={{ fontSize: 12, color: T.status.good }}>{result}</span>}
        {err && <span style={{ fontSize: 12, color: T.status.critical }}>{err}</span>}
      </div>

      <div style={{ fontSize: 12.5, fontWeight: 700, color: T.ink, marginBottom: 6 }}>Milestone picker</div>
      {projects.length === 0 && <div style={{ fontSize: 12.5, color: T.inkMuted }}>No linked projects yet — set them above.</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {projects.map((p) => (
          <div key={p.kantataId}>
            <button
              type="button"
              className="btn-link"
              style={{ fontSize: 13 }}
              onClick={() => {
                setOpenProjectId(openProjectId === p.kantataId ? null : p.kantataId);
                setTicked(new Set());
              }}
            >
              {p.hasFolder ? "📁" : "○"} {p.title} {openProjectId === p.kantataId ? "▲" : "▼"}
            </button>
            {openProjectId === p.kantataId && (
              <div style={{ marginLeft: 18, marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                {milestones.length === 0 && <div style={{ fontSize: 12, color: T.inkMuted }}>No milestones found for this project.</div>}
                {milestones.map((m) => (
                  <label key={m.kantataId} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                    <input
                      type="checkbox"
                      disabled={m.hasFolder}
                      checked={m.hasFolder || ticked.has(m.kantataId)}
                      onChange={(e) => {
                        const next = new Set(ticked);
                        if (e.target.checked) next.add(m.kantataId);
                        else next.delete(m.kantataId);
                        setTicked(next);
                      }}
                    />
                    <span style={{ color: m.hasFolder ? T.inkMuted : T.ink }}>{m.title}</span>
                    {m.hasFolder && <span style={{ color: T.status.good, fontSize: 11 }}>already has a folder</span>}
                  </label>
                ))}
                {milestones.length > 0 && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pickBusy || ticked.size === 0}
                    onClick={() => {
                      setPickBusy(true);
                      createMilestoneFolders(account.id, Array.from(ticked), loginHintEmail)
                        .then((r) => {
                          const invalidNote = r.invalid && r.invalid.length > 0 ? ` Invalid: ${r.invalid.map((i) => `${i.kantataId} (${i.reason})`).join("; ")}.` : "";
                          const alreadyNote = r.alreadyHadFolder.length > 0 ? ` Already had a folder: ${r.alreadyHadFolder.length}.` : "";
                          setResult(`Created ${r.created.length} milestone folder(s).${alreadyNote}${invalidNote}`);
                          setTicked(new Set());
                          onChanged();
                        })
                        .catch((e) => setErr(describeMsApiError(e, "failed to create folders")))
                        .finally(() => setPickBusy(false));
                    }}
                    style={{ alignSelf: "flex-start", marginTop: 4 }}
                  >
                    {pickBusy ? "Creating…" : `Create folders (${ticked.size})`}
                  </Button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

/**
 * B5a "Files in the app" — a live Graph listing of whichever provisioned
 * folder is selected, with upload into it. This is the Admin-tab copy,
 * scoped to a `collab.client_account` the caller already resolved.
 * ClientWorkspace.tsx's own Files tab (the general account view, not just
 * Admin) now uses this same `FolderTreePicker`/`listFolder`/`uploadFile`
 * combination, bridged via `collabAccountId` — see that file's own `FilesTab`.
 */
function FilesPanel({ account, loginHintEmail }: { account: MsAccountData; loginHintEmail?: string | undefined }) {
  const [selectedNode, setSelectedNode] = useState<FolderTreeNode | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [listing, setListing] = useState<FileListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);

  const selectedKantataId = selectedNode?.kantataId ?? "";

  async function reload(kantataId: string) {
    setLoading(true);
    setErr(null);
    try {
      const l = await listFolder(account.id, kantataId, loginHintEmail);
      setListing(l);
    } catch (e) {
      setErr(describeMsApiError(e, "failed to list folder"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card title="Files">
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Button size="sm" variant="secondary" onClick={() => setBrowsing((b) => !b)}>
            {browsing ? "Hide folders" : "Browse folders"}
          </Button>
          <span style={{ fontSize: 12.5, color: T.inkMuted }}>{selectedNode ? `Selected: ${selectedNode.name}` : "No folder selected"}</span>
          {listing?.folderWebUrl && (
            <a href={listing.folderWebUrl} target="_blank" rel="noreferrer" className="btn-link" style={{ fontSize: 12 }}>
              Open in SharePoint ↗
            </a>
          )}
        </div>
        {browsing && (
          <FolderTreePicker
            accountId={account.id}
            loginHintEmail={loginHintEmail}
            selectedKantataId={selectedKantataId}
            onSelect={(node) => {
              setSelectedNode(node);
              setListing(null);
              void reload(node.kantataId);
            }}
          />
        )}
        {selectedKantataId && (
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
                uploadFile(account.id, selectedKantataId, file, {
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
      </div>
      {loading && <div style={{ fontSize: 12.5, color: T.inkMuted }}>Loading…</div>}
      {err && <div style={{ fontSize: 12.5, color: T.status.critical }}>{err}</div>}
      {listing && (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>
          {listing.items.length === 0 && <li style={{ color: T.inkMuted, listStyle: "none", marginLeft: -18 }}>Empty.</li>}
          {listing.items.map((item) => (
            <li key={item.id}>
              {item.isFolder ? "📁" : "📄"} {item.webUrl ? <a href={item.webUrl} target="_blank" rel="noreferrer">{item.name}</a> : item.name}
              {!item.isFolder && <span style={{ color: T.inkMuted }}> · {(item.size / 1024).toFixed(0)} KB</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function MembershipPanel({
  account,
  members,
  loginHintEmail,
  onChanged,
}: {
  account: MsAccountData;
  members: WorkspaceAccountPayload["members"];
  loginHintEmail?: string | undefined;
  onChanged: () => void;
}) {
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [resolveBusy, setResolveBusy] = useState(false);
  const missingEmailCount = members.filter((m) => !m.email).length;

  return (
    <Card title="Internal membership (B5)">
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
        {members.length === 0 && <div style={{ fontSize: 12.5, color: T.inkMuted }}>No members yet.</div>}
        {members.map((m) => (
          <label key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
            <input
              type="checkbox"
              disabled={!m.email}
              checked={ticked.has(m.id)}
              onChange={(e) => {
                const next = new Set(ticked);
                if (e.target.checked) next.add(m.id);
                else next.delete(m.id);
                setTicked(next);
              }}
            />
            <span>{m.name}</span>
            {m.title && <span style={{ color: T.inkMuted }}>({m.title})</span>}
            {m.email ? (
              <span style={{ color: T.inkMuted, fontSize: 11 }}>{m.email}</span>
            ) : (
              <EmailInline onSave={(email) => setMemberEmail(m.id, email).then(onChanged)} />
            )}
          </label>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name" style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${T.border}` }} />
        <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="Email (optional)" style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${T.border}` }} />
        <Button
          size="sm"
          variant="secondary"
          disabled={addBusy || !newName.trim()}
          onClick={() => {
            setAddBusy(true);
            addMember(account.id, newName.trim(), newEmail.trim() ? { email: newEmail.trim() } : {})
              .then(() => {
                setNewName("");
                setNewEmail("");
                onChanged();
              })
              .catch((e) => setErr(describeMsApiError(e, "failed to add member")))
              .finally(() => setAddBusy(false));
          }}
        >
          + Add member
        </Button>
        {missingEmailCount > 0 && (
          <Button
            size="sm"
            variant="ghost"
            disabled={resolveBusy}
            onClick={() => {
              setResolveBusy(true);
              setErr(null);
              resolveMemberEmails(account.id)
                .then((r) => {
                  const parts = [`matched ${r.matched.length}`];
                  if (r.unmatched.length > 0) parts.push(`no match: ${r.unmatched.join(", ")}`);
                  setResult(parts.join(" · "));
                  onChanged();
                })
                .catch((e) => setErr(describeMsApiError(e, "failed to resolve emails")))
                .finally(() => setResolveBusy(false));
            }}
          >
            {resolveBusy ? "Resolving…" : `Resolve ${missingEmailCount} email${missingEmailCount === 1 ? "" : "s"} from Kantata`}
          </Button>
        )}
      </div>

      <Button
        size="sm"
        disabled={busy || ticked.size === 0 || !account.msTeam.teamId}
        onClick={() => {
          setBusy(true);
          setErr(null);
          syncTeamMembers(account.id, Array.from(ticked), loginHintEmail)
            .then((r) => {
              const parts = [`added ${r.added.length}`, `already on Team ${r.alreadyOnTeam.length}`];
              if (r.unresolved?.length) parts.push(`unresolved: ${r.unresolved.map((u) => `${u.name} (${u.reason})`).join("; ")}`);
              setResult(parts.join(" · "));
              setTicked(new Set());
              onChanged();
            })
            .catch((e) => setErr(describeMsApiError(e, "sync failed")))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Adding to Team…" : `Add ticked to Team (${ticked.size})`}
      </Button>
      {!account.msTeam.teamId && <div style={{ fontSize: 11.5, color: T.inkMuted, marginTop: 6 }}>Connect the Team above first.</div>}
      {result && <div style={{ fontSize: 12, color: T.status.good, marginTop: 8 }}>{result}</div>}
      {err && <div style={{ fontSize: 12, color: T.status.critical, marginTop: 8 }}>{err}</div>}
    </Card>
  );
}

function EmailInline({ onSave }: { onSave: (email: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  if (!editing) {
    return (
      <button type="button" className="btn-link" style={{ fontSize: 11 }} onClick={() => setEditing(true)}>
        + add email
      </button>
    );
  }
  return (
    <span style={{ display: "inline-flex", gap: 4 }}>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="email"
        style={{ fontSize: 11, padding: "2px 6px", borderRadius: 6, border: `1px solid ${T.border}` }}
      />
      <button
        type="button"
        className="btn-link"
        style={{ fontSize: 11 }}
        onClick={() => {
          if (value.trim()) onSave(value.trim());
          setEditing(false);
        }}
      >
        save
      </button>
    </span>
  );
}

function GrantPanel({
  account,
  externals,
  grants,
  msFolders,
  loginHintEmail,
  onChanged,
}: {
  account: MsAccountData;
  externals: WorkspaceAccountPayload["externals"];
  grants: WorkspaceAccountPayload["grants"];
  msFolders: WorkspaceAccountPayload["msFolders"];
  loginHintEmail?: string | undefined;
  onChanged: () => void;
}) {
  const [newName, setNewName] = useState("");
  const [newOrg, setNewOrg] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<"client" | "contractor">("client");
  const [pickedUserId, setPickedUserId] = useState<string | undefined>(undefined);
  const [addBusy, setAddBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [allExternals, setAllExternals] = useState<AdminExternalRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAllExternals()
      .then((r) => {
        if (!cancelled) setAllExternals(r.externals);
      })
      .catch(() => {
        // Not an app admin, or offline — no picker for this caller, no error
        // shown; the form below still works exactly as manual entry.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const pickerCandidates = useMemo<ExistingPersonCandidate[]>(() => {
    if (!allExternals) return [];
    const byKey = new Map<string, ExistingPersonCandidate>();
    for (const e of allExternals) {
      if (e.accountId === account.id) continue; // already on this account
      const key = e.userId ?? (e.email ? `email:${e.email.toLowerCase()}` : null);
      if (!key) continue; // nothing stable to dedupe or link by
      const found = byKey.get(key);
      if (found) {
        if (!found.accounts.includes(e.clientName)) found.accounts.push(e.clientName);
        continue;
      }
      byKey.set(key, { key, name: e.name, org: e.org, ...(e.email ? { email: e.email } : {}), ...(e.userId ? { userId: e.userId } : {}), role: e.role, accounts: [e.clientName] });
    }
    return [...byKey.values()];
  }, [allExternals, account.id]);

  return (
    <Card title="External access — guests and grants (B7)">
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {externals.length === 0 && <div style={{ fontSize: 12.5, color: T.inkMuted }}>No externals yet.</div>}
        {externals.map((ext) => (
          <ExternalRow
            key={ext.id}
            account={account}
            ext={ext}
            // A not-yet-resolved external's grants carry externalLinkId, not
            // userId (api/grant.ts's pending-grant path) — matching only on
            // userId would incorrectly show nothing for them, or (since
            // ext.userId is undefined for every unresolved external) risk
            // matching a DIFFERENT unresolved person's grants if that check
            // alone were used.
            grants={grants.filter((g) => (g.userId && g.userId === ext.userId) || g.externalLinkId === ext.id)}
            msFolders={msFolders}
            loginHintEmail={loginHintEmail}
            onChanged={onChanged}
          />
        ))}

        <div style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: `1px solid ${T.border}`, paddingTop: 10 }}>
          {pickerCandidates.length > 0 && (
            <ExistingPersonPicker
              candidates={pickerCandidates}
              onPick={(c) => {
                setNewName(c.name);
                setNewOrg(c.org);
                setNewEmail(c.email ?? "");
                setNewRole(c.role);
                setPickedUserId(c.userId);
              }}
            />
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                setPickedUserId(undefined);
              }}
              placeholder="Name"
              style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${T.border}` }}
            />
            <input value={newOrg} onChange={(e) => setNewOrg(e.target.value)} placeholder="Org" style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${T.border}` }} />
            <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="Email" style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${T.border}` }} />
            <select value={newRole} onChange={(e) => setNewRole(e.target.value as "client" | "contractor")} style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${T.border}` }}>
              <option value="client">Client</option>
              <option value="contractor">Contractor</option>
            </select>
            <Button
              size="sm"
              variant="secondary"
              disabled={addBusy || !newName.trim() || !newOrg.trim()}
              onClick={() => {
                setAddBusy(true);
                setErr(null);
                addExternal(account.id, newName.trim(), newOrg.trim(), newRole, newEmail.trim() || undefined, pickedUserId)
                  .then(() => {
                    setNewName("");
                    setNewOrg("");
                    setNewEmail("");
                    setPickedUserId(undefined);
                    onChanged();
                  })
                  .catch((e) => setErr(describeMsApiError(e, "failed to add")))
                  .finally(() => setAddBusy(false));
              }}
            >
              + Add external
            </Button>
          </div>
          {pickedUserId && <div style={{ fontSize: 11, color: T.status.good }}>Linking as an already-known person — no sign-in wait.</div>}
        </div>
        {err && <div style={{ fontSize: 12, color: T.status.critical }}>{err}</div>}
      </div>
    </Card>
  );
}

function ExternalRow({
  account,
  ext,
  grants,
  msFolders,
  loginHintEmail,
  onChanged,
}: {
  account: MsAccountData;
  ext: WorkspaceAccountPayload["externals"][number];
  grants: WorkspaceAccountPayload["grants"];
  msFolders: WorkspaceAccountPayload["msFolders"];
  loginHintEmail?: string | undefined;
  onChanged: () => void;
}) {
  const [collapsed, setCollapsed] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [granting, setGranting] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [removing, setRemoving] = useState(false);
  // Which single grant is mid-revoke, or "all" for revoke-all — a real
  // Graph round trip, not instant, so this drives the spinner rather than
  // leaving the click looking like it did nothing.
  const [revokingId, setRevokingId] = useState<string | null>(null);
  // Keyed by kantataId, not a plain array, so re-clicking an already-picked
  // node in the tree toggles it off instead of adding a duplicate.
  const [pickedNodes, setPickedNodes] = useState<ReadonlyMap<string, FolderTreeNode>>(new Map());
  const [note, setNote] = useState<string | null>(null);

  function togglePicked(node: FolderTreeNode) {
    setPickedNodes((prev) => {
      const next = new Map(prev);
      if (next.has(node.kantataId)) next.delete(node.kantataId);
      else next.set(node.kantataId, node);
      return next;
    });
  }

  /** Grants every picked folder, one at a time — sequential, not
   * Promise.all, so one folder's Graph invite failing doesn't race the next
   * and each failure is attributed to the right folder in the result note. */
  async function grantPicked() {
    const nodes = [...pickedNodes.values()];
    if (nodes.length === 0) return;
    setGranting(true);
    let okCount = 0;
    const failures: string[] = [];
    for (const node of nodes) {
      try {
        const r = await grantAccess(account.id, ext.userId ? { userId: ext.userId } : { externalLinkId: ext.id }, node.kantataId, node.level, "write", loginHintEmail);
        okCount += 1;
        if (r.sharePoint !== "granted") failures.push(`${node.name}: SharePoint ${r.sharePoint} (${r.detail})`);
      } catch (e) {
        failures.push(`${node.name}: ${describeMsApiError(e, "grant failed")}`);
      }
    }
    setNote(
      failures.length === 0
        ? `Granted ${okCount} folder${okCount === 1 ? "" : "s"}.`
        : `Granted ${okCount} of ${nodes.length}. Problems — ${failures.join("; ")}`,
    );
    setPickedNodes(new Map());
    setGranting(false);
    onChanged();
  }

  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 13 }}>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand" : "Collapse"}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, padding: 0, width: 14, color: T.inkMuted }}
        >
          {collapsed ? "▶" : "▼"}
        </button>
        <strong>{ext.name}</strong>
        <span style={{ color: T.inkMuted }}>
          {ext.org} · {ext.role}
        </span>
        {ext.email && <span style={{ color: T.inkMuted, fontSize: 11.5 }}>{ext.email}</span>}
        <span style={{ fontSize: 11, color: ext.entraStatus === "active" ? T.status.good : T.inkMuted }}>Entra: {ext.entraStatus}</span>
        {collapsed && grants.length > 0 && (
          <span style={{ fontSize: 11, color: T.inkMuted }}>
            · {grants.length} grant{grants.length === 1 ? "" : "s"}
          </span>
        )}
        {!ext.userId && (
          <Button
            size="sm"
            variant="ghost"
            disabled={resolving}
            onClick={() => {
              setResolving(true);
              resolveExternalIdentity(ext.id)
                .then((r) => {
                  setNote(r.note ?? (r.userId ? "resolved" : null));
                  onChanged();
                })
                .catch((e) => setNote(describeMsApiError(e, "failed to resolve")))
                .finally(() => setResolving(false));
            }}
          >
            {resolving ? "Checking…" : "Resolve sign-in"}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={removing}
          onClick={() => {
            setRemoving(true);
            removeExternal(ext.id, loginHintEmail)
              .then(onChanged)
              .catch((e) => setNote(describeMsApiError(e, "failed to remove — access was NOT removed")))
              .finally(() => setRemoving(false));
          }}
        >
          {removing ? <span className="spinner" aria-label="Removing…" /> : "Remove"}
        </Button>
      </div>
      {!collapsed && (
        <>
          {note && <div style={{ fontSize: 11.5, color: T.inkMuted, marginTop: 4 }}>{note}</div>}

          {!ext.userId && (
            <div style={{ fontSize: 11.5, color: T.inkMuted, marginTop: 6 }}>
              Not signed in yet — granting still sends the real Microsoft invite off their email; app screens (tasks/discussions) unlock once they sign in and you resolve them.
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            {grants.length > 0 && (
              <ul style={{ margin: "0 0 6px", paddingLeft: 18, fontSize: 12 }}>
                {grants.map((g) => (
                  <li key={g.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span>
                      <LevelIcon level={g.level} /> {folderDisplayName(g.kantataId, msFolders)} — {g.role}
                    </span>
                    <span style={{ color: g.msPermissionId ? T.status.good : T.status.warning, fontSize: 10.5 }}>
                      {g.msPermissionId ? "SharePoint granted" : "half-grant — SharePoint pending"}
                    </span>
                    {revokingId === g.id ? (
                      <span className="spinner" aria-label="Revoking…" />
                    ) : (
                      <button
                        type="button"
                        className="btn-link"
                        style={{ fontSize: 11 }}
                        disabled={revokingId !== null}
                        onClick={() => {
                          setRevokingId(g.id);
                          // api/grant.ts's DELETE only ever succeeds once
                          // SharePoint access is actually gone (or never
                          // existed) — success here means fully revoked, no
                          // separate outcome to check. A grant it couldn't
                          // confirm revoking throws instead, caught below.
                          revokeGrant(g.id, loginHintEmail)
                            .then(() => {
                              onChanged();
                              setNote(null);
                            })
                            .catch((e) => setNote(describeMsApiError(e, "failed to revoke — access was NOT removed")))
                            .finally(() => setRevokingId(null));
                        }}
                      >
                        revoke
                      </button>
                    )}
                  </li>
                ))}
                {ext.userId && (
                  <li>
                    {revokingId === "all" ? (
                      <span className="spinner" aria-label="Revoking all…" />
                    ) : (
                      <button
                        type="button"
                        className="btn-link"
                        style={{ fontSize: 11 }}
                        disabled={revokingId !== null}
                        onClick={() => {
                          setRevokingId("all");
                          const hadRealAccessByKantataId = new Map(grants.map((g) => [g.kantataId, !!g.msPermissionId] as const));
                          revokeAllForPerson(account.id, ext.userId!, loginHintEmail)
                            .then((result) => {
                              onChanged();
                              // Grants api/grant/revoke-all.ts couldn't confirm
                              // revoked on SharePoint keep their row (not
                              // deleted, same "never diverge" rule the single
                              // revoke follows) — surfaced here so it isn't
                              // mistaken for "all done" just because the call
                              // resolved.
                              const leftBehind = result.perGrant.filter(
                                (r) => hadRealAccessByKantataId.get(r.kantataId) && r.sharePoint !== "granted",
                              );
                              setNote(
                                leftBehind.length > 0
                                  ? `${result.removed} revoked. SharePoint access could NOT be confirmed removed for ${leftBehind.length} folder${leftBehind.length === 1 ? "" : "s"} (${leftBehind.map((r) => r.detail).join("; ")}) — those weren't deleted; remove access manually in SharePoint/Teams, or retry.`
                                  : null,
                              );
                            })
                            .catch((e) => setNote(describeMsApiError(e, "failed to revoke all")))
                            .finally(() => setRevokingId(null));
                        }}
                      >
                        revoke all
                      </button>
                    )}
                  </li>
                )}
              </ul>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <Button size="sm" variant="ghost" onClick={() => setBrowsing((b) => !b)}>
                  {browsing ? "Hide folders" : "Pick folders…"}
                </Button>
                <span style={{ fontSize: 12, color: T.inkMuted }}>
                  {pickedNodes.size > 0 ? `Picked: ${[...pickedNodes.values()].map((n) => n.name).join(", ")}` : "No folders picked"}
                </span>
                <Button size="sm" variant="secondary" disabled={granting || pickedNodes.size === 0} onClick={() => void grantPicked()}>
                  {granting
                    ? "Granting…"
                    : `Grant read/write${pickedNodes.size > 1 ? ` (${pickedNodes.size})` : ""}`}
                </Button>
              </div>
              {browsing && (
                <FolderTreePicker
                  accountId={account.id}
                  loginHintEmail={loginHintEmail}
                  multiSelect
                  selectedKantataIds={new Set(pickedNodes.keys())}
                  onSelect={togglePicked}
                />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Handover — the record of what an outside person (client or contractor) was
 * given, migrated onto `collab.share` (docs/api-spec-workspace-mutations.md).
 * There was never a live UI for the old model's equivalent (`Share`/
 * `shareWithPerson` etc. in store.ts) — a repo-wide search found zero callers
 * outside store.ts/handover.ts/its own test, only the fully-worked-out pure
 * rollup logic. `personHandover` is reused here as-is: `MsAccountShare`
 * carries every field the old `Share` type does (plus `recipientUserId`,
 * unused by this function), so no adapter is needed.
 *
 * `offboardChecklist`/`shareState`/`stateLabel` are NOT reused, deliberately:
 * both derive an "opened"/"chase" signal from `opened_at`, but nothing in
 * this app can ever set that column for a `collab.share` row (the old
 * model's `recordItemOpened` — the one real "did they open it" observation —
 * was retired with no replacement caller wired up). Displaying their output
 * here would show every share as permanently "never opened," which reads as
 * an active warning rather than the honest "we don't track this yet" it
 * actually is. This component renders only what IS real: sent/revoked.
 *
 * Only externals get a card — handover answers "what did we give this
 * OUTSIDE person," per handover.ts's own framing; internal members aren't
 * handed anything to revoke.
 *
 * HIDDEN (not mounted in ClientAdminPanel's own return, below) per request —
 * left in place, not deleted, in case it comes back.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function HandoverPanel({
  account,
  shares,
  tasks,
  externals,
  onChanged,
}: {
  account: MsAccountData;
  shares: WorkspaceAccountPayload["shares"];
  tasks: WorkspaceAccountPayload["tasks"];
  externals: WorkspaceAccountPayload["externals"];
  onChanged: () => void;
}) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const today = AS_OF_TODAY();
  const oldTasks: Task[] = tasks.map(toOldTask);
  const openTasks = oldTasks.filter((t) => t.status !== "done");

  const handovers = externals.map((e) => ({ external: e, handover: personHandover({ shares, tasks: oldTasks }, e.name, today) }));

  async function handleRevoke(shareId: string) {
    setBusy(shareId);
    setErr(null);
    try {
      await revokeShareApi(shareId);
      onChanged();
    } catch (e) {
      setErr(describeMsApiError(e, "failed to revoke"));
    } finally {
      setBusy(null);
    }
  }

  async function handleRevokeAll(personName: string, liveIds: string[]) {
    setBusy(personName);
    setErr(null);
    try {
      await Promise.all(liveIds.map((id) => revokeShareApi(id)));
      onChanged();
    } catch (e) {
      setErr(describeMsApiError(e, "failed to revoke all"));
    } finally {
      setBusy(null);
    }
  }

  async function handleShare(personName: string, item: ShareItemInput) {
    setBusy(personName);
    setErr(null);
    try {
      const result = await shareItems(account.id, personName, [item]);
      if (result.rejected && result.rejected.length > 0) setErr(result.rejected.map((r) => r.reason).join("; "));
      onChanged();
    } catch (e) {
      setErr(describeMsApiError(e, "failed to share"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card title="Handover">
      {err && <div style={{ color: T.status.critical, fontSize: 12, marginBottom: 8 }}>{err}</div>}
      <div style={{ fontSize: 11, color: T.inkMuted, marginBottom: 10 }}>
        Tracks what's been sent and revoked. Whether a recipient has actually opened something isn't observed yet, so that's not shown here.
      </div>
      {externals.length === 0 && <div style={{ fontSize: 12.5, color: T.inkMuted }}>No client or contractor externals on this account yet.</div>}
      {handovers.map(({ external, handover }) => (
        <PersonHandoverCard
          key={external.id}
          external={external}
          handover={handover}
          openTasks={openTasks}
          busy={busy === external.name}
          onRevoke={handleRevoke}
          onRevokeAll={() => handleRevokeAll(external.name, handover.live.map((s) => s.id))}
          onShare={(item) => handleShare(external.name, item)}
        />
      ))}
    </Card>
  );
}

function PersonHandoverCard({
  external,
  handover,
  openTasks,
  busy,
  onRevoke,
  onRevokeAll,
  onShare,
}: {
  external: WorkspaceAccountPayload["externals"][number];
  handover: PersonHandover;
  openTasks: Task[];
  busy: boolean;
  onRevoke: (shareId: string) => void;
  onRevokeAll: () => void;
  onShare: (item: ShareItemInput) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [kind, setKind] = useState<"file" | "doc" | "task" | "folder">("task");
  const [taskId, setTaskId] = useState("");
  const [itemName, setItemName] = useState("");
  // Trimmed version of handover.ts's own offboardChecklist(): drops its
  // "N items were never opened" line, which — for this new collab.share-
  // backed system — is always true (nothing here can ever mark an item
  // opened yet) and would read as an active warning rather than the
  // honest "we don't track this" it actually is. The two lines kept
  // (revoke live items, reassign open tasks) are both real, current facts.
  const checklist: string[] = [];
  if (handover.live.length > 0) {
    checklist.push(`Revoke ${handover.live.length} live item${handover.live.length === 1 ? "" : "s"}: ${handover.live.map((s) => s.itemName).join(", ")}`);
  }
  if (handover.openTasks.length > 0) {
    checklist.push(`Reassign ${handover.openTasks.length} open task${handover.openTasks.length === 1 ? "" : "s"}: ${handover.openTasks.map((t) => t.title).join(", ")}`);
  }
  if (checklist.length === 0) checklist.push("Nothing outstanding — access can be removed cleanly.");

  return (
    <div style={{ borderTop: `1px solid ${T.border}`, padding: "10px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button type="button" className="btn-link" style={{ fontWeight: 700, fontSize: 13 }} onClick={() => setExpanded((x) => !x)}>
          {expanded ? "▼" : "▶"} {external.name}
        </button>
        <span style={{ fontSize: 11, color: T.inkMuted }}>{external.role} · {external.org}</span>
        <span style={{ fontSize: 11, color: T.inkMuted }}>{handover.sent} sent</span>
        {handover.live.length > 0 && (
          <button type="button" className="btn btn-sm" style={{ marginLeft: "auto", fontSize: 10.5 }} disabled={busy} onClick={onRevokeAll}>
            Revoke all ({handover.live.length})
          </button>
        )}
      </div>
      {expanded && (
        <div style={{ marginTop: 8, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 11.5, color: T.inkMuted }}>
            {checklist.map((line, i) => <div key={i}>• {line}</div>)}
          </div>
          {handover.shares.map((s) => (
            <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
              <span style={{ fontWeight: 600 }}>{s.itemName}</span>
              <span style={{ color: T.inkMuted }}>{s.itemKind}</span>
              <span style={{ color: T.inkMuted }}>{isLive(s) ? `Sent ${s.sentAt.slice(0, 10)}` : `Revoked ${(s.revokedAt ?? "").slice(0, 10)}`}</span>
              {isLive(s) && (
                <button type="button" className="btn-link" style={{ fontSize: 10.5 }} disabled={busy} onClick={() => onRevoke(s.id)}>Revoke</button>
              )}
            </div>
          ))}
          {handover.shares.length === 0 && <div style={{ fontSize: 11.5, color: T.inkMuted }}>Nothing sent to {external.name} yet.</div>}
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 4 }}>
            <select value={kind} onChange={(e) => setKind(e.target.value as "file" | "doc" | "task" | "folder")} className="select" style={{ fontSize: 11.5 }}>
              <option value="task">Task</option>
              <option value="file">File</option>
              <option value="doc">Doc</option>
              <option value="folder">Folder</option>
            </select>
            {kind === "task" ? (
              <select value={taskId} onChange={(e) => setTaskId(e.target.value)} className="select" style={{ fontSize: 11.5, minWidth: 160 }}>
                <option value="">Pick an open task…</option>
                {openTasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
            ) : (
              <input value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="Name" className="input" style={{ fontSize: 11.5, minWidth: 140 }} />
            )}
            <button
              type="button"
              className="btn btn-primary btn-sm"
              style={{ fontSize: 10.5 }}
              disabled={busy || (kind === "task" ? !taskId : !itemName.trim())}
              onClick={() => {
                if (kind === "task") {
                  const t = openTasks.find((x) => x.id === taskId);
                  if (!t) return;
                  onShare({ kind: "task", itemId: t.id, itemName: t.title });
                  setTaskId("");
                } else {
                  onShare({ kind, itemId: crypto.randomUUID(), itemName: itemName.trim() });
                  setItemName("");
                }
              }}
            >
              Share
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
