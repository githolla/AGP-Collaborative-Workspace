import { useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "./components/AppHeader.js";
import { InitiativeWorkspace } from "./components/InitiativeWorkspace.js";
import { Sandbox } from "./components/Sandbox.js";
import { SandboxWorkspace } from "./components/SandboxWorkspace.js";
import { SearchBox } from "./components/SearchBox.js";
import { ClientList } from "./components/ClientList.js";
import { DataInspector } from "./components/DataInspector.js";
import { ClientWorkspace } from "./components/ClientWorkspace.js";
import { Button, EmptyState } from "./components/ui.js";
import { Tour, type TourStep } from "./components/Tour.js";
import { useWorkspace } from "./workspace/store.js";
import { useProfile } from "./workspace/profile.js";
import { classifyClientTitle, initLiveMirror, refreshLiveMirror, type LiveStatus } from "./workspace/liveMirror.js";
import { loadMirror } from "./workspace/agpKnowledge.js";
import { accountLiveContext, campaignsFromMirror, isInBook, suggestClients, taskColumn, taskIsDone } from "./workspace/campaignImport.js";
import { AS_OF_TODAY } from "./workspace/format.js";
import type { ClientAccount } from "./workspace/types.js";
import { T } from "./theme.js";

/**
 * One surface: Cara's client-account workspace (the wireframe, exactly).
 * The Sandbox lives INSIDE each client as a tab — every idea is tied to
 * the client it's for, never a separate top-level pile. Promoted builds
 * keep their full ROI workspace — reached from their idea or via search.
 */

type Route =
  | { view: "clients" }
  | { view: "initiative"; id: string }
  | { view: "idea"; id: string }
  | { view: "account"; id: string };

function parseHash(): Route {
  const hash = window.location.hash;
  const initiative = hash.match(/^#i\/(.+)$/);
  if (initiative?.[1]) return { view: "initiative", id: initiative[1] };
  const idea = hash.match(/^#s\/(.+)$/);
  if (idea?.[1]) return { view: "idea", id: idea[1] };
  const account = hash.match(/^#c\/(.+)$/);
  if (account?.[1]) return { view: "account", id: account[1] };
  // Legacy "#sandbox" links land on Clients — the sandbox is per-client now.
  return { view: "clients" };
}

function hashOf(route: Route): string {
  switch (route.view) {
    case "initiative":
      return `i/${route.id}`;
    case "idea":
      return `s/${route.id}`;
    case "account":
      return `c/${route.id}`;
    default:
      return "";
  }
}

const TOUR_KEY = "agp-collab-tour-v1";

/**
 * The spotlight walkthrough — written to be read aloud while demoing. Each
 * step pairs the ask (a line from Cara's features doc or the product-owner
 * brief) with what was built from it. Routes use the seeded demo data
 * (ABC Foodbank, the grant-report idea).
 */
const TOUR_STEPS: TourStep[] = [
  {
    key: "welcome",
    route: "",
    title: "Welcome to the workspace",
    body: "A 90-second spotlight tour, ask by ask: what Cara's features doc called for, what was built from it, and what the AI adds on top. → or Enter to continue, Esc to exit any time.",
  },
  {
    key: "nav",
    route: "",
    target: '[data-tour="nav"]',
    title: "One surface: your clients",
    quote: { text: "…without adding unnecessary complexity or overhead.", from: "Cara's features doc — opening line" },
    body: "Taken literally. Everything lives with the client it belongs to — delivery, discussions, files, and each client's own Sandbox for new ideas. Search reaches the rest, including builds promoted out of a sandbox.",
  },
  {
    key: "book",
    route: "",
    target: '[data-tour="book"]',
    title: "Your active clients, live from Kantata",
    quote: { text: "Separate workspace per client… ability to apply a template for consistent set up.", from: "Cara's features doc — two Musts" },
    body: "Every active client, derived straight from Kantata — its client groups and project titles — sectioned by vertical, with the live work each one has waiting. One click sets up the standard workspace. No prospects, no CRM noise.",
  },
  {
    key: "client-tabs",
    route: "c/acct-abc-foodbank",
    target: '[data-tour="client-tabs"]',
    title: "Cara's wireframe — to the pixel",
    quote: { text: "Home · Project Plan · Client Dashboard · Files · Discussions · Contractor Access", from: "the nav in Cara's wireframe" },
    body: "Her navy band, her tabs, the team's faces on the right — and every Home zone populated from live data: campaigns, milestone dates, tasks, files, discussions. Empty zones are doors, not dead ends.",
  },
  {
    key: "review-import",
    route: "c/acct-abc-foodbank",
    target: '[data-tour="review-import"]',
    title: "Nothing lands until you say so",
    quote: { text: "…you choose what imports.", from: "the import contract" },
    body: "Kantata projects, milestones, and open tasks matched to this client wait HERE for your approval — check what belongs, import, remove anything wrong later. Below the band: the live delivery pulse — projects in flight, hours logged, who's on it.",
  },
  {
    key: "client-access",
    route: "c/acct-abc-foodbank",
    target: '[data-tour="client-access"]',
    title: "Access that revokes for real",
    quote: { text: "Offboarding revokes access immediately.", from: "Cara's features doc — a Must" },
    body: "The register shows who invited whom and when they were last active — 30 days idle raises a review flag. Remove revokes on the spot, and “Offboard everywhere” clears a person from every client workspace at once, audit-logged.",
  },
  {
    key: "sandbox",
    route: "c/acct-abc-foodbank",
    target: '[data-tour="client-sandbox"]',
    title: "Every client has its own Sandbox",
    quote: { text: "A collaboration workspace where the AI is used to help collaborate on projects — new ones and iterations of current ones.", from: "the product-owner brief" },
    body: "Ideas live INSIDE the client they're for — no separate pile. Open the tab, describe an idea in a sentence, and the Copilot names it, sizes it, plans it, and picks the team. “Start blank” keeps it human-only — the AI observes silently until invited.",
  },
  {
    key: "review",
    route: "s/idea-grant-report",
    target: '[data-tour="draft-review"]',
    title: "Review what the AI built",
    quote: { text: "AI that builds — and then the people are added to the project to add their part.", from: "the product-owner brief" },
    body: "The Copilot drafted the value case, the team, and a dated plan — every line with its “because”. Remove what's wrong with ×, or tell it in the chat. Accepting records that a human reviewed the machine's work.",
  },
  {
    key: "roi",
    route: "s/idea-grant-report",
    target: '[data-tour="decision-view"]',
    title: "The ROI engine, always on",
    quote: { text: "Internal financials never render on a client surface.", from: "the hard rule — enforced by a build-time test" },
    body: "Every idea carries a live decision view — annual net, payback, grade — with grades honestly capped at C until required numbers land. Clients never see any of it.",
  },
  {
    key: "done",
    title: "That's the loop",
    body: "Live book → workspace per client → everything Kantata has populates in → the team works one plan, and the Copilot drafts the weekly client update for your sign-off. Ideas run in each client's own Sandbox tab (delete the dead ones — sandbox is disposable). Every Must in Cara's doc is built or backend-gated. Restart any time with “Take the tour”.",
  },
];

function PageIntro({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <h1 style={{ fontSize: 19, fontWeight: 700, color: T.ink }}>{title}</h1>
      <p style={{ fontSize: 12.5, color: T.inkSecondary, marginTop: 4, maxWidth: 720, lineHeight: 1.5 }}>{children}</p>
    </div>
  );
}

export function App() {
  const ws = useWorkspace();
  const { name: userName, setName } = useProfile();
  // Auto-start the walkthrough on first visit; the nav button restarts it.
  const [tourStep, setTourStep] = useState<number | null>(() => {
    try {
      return window.localStorage.getItem(TOUR_KEY) ? null : 0;
    } catch {
      return null;
    }
  });
  const closeTour = () => {
    setTourStep(null);
    try {
      window.localStorage.setItem(TOUR_KEY, "seen");
    } catch {
      // storage unavailable — the tour just won't remember it ran
    }
  };
  const [route, setRouteState] = useState<Route>(parseHash);
  const setRoute = (r: Route) => {
    setRouteState(r);
    window.location.hash = hashOf(r);
    window.scrollTo({ top: 0 });
  };

  // Browser back/forward and pasted #links must navigate, not just in-app clicks.
  useEffect(() => {
    const onHash = () => setRouteState(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Live Kantata + HubSpot mirror — the header tells the truth about it.
  const [liveStatus, setLiveStatus] = useState<LiveStatus>({
    live: false,
    label: "Demo data",
    detail: "checking /api/mirror…",
  });
  useEffect(() => {
    void initLiveMirror(setLiveStatus);
  }, []);

  // Auto-populate on open: the moment a live client workspace is opened, fill
  // it from Kantata's full task tree — no button, no "Import everything".
  // ensureAutoPopulated runs the deepen + import once per workspace and marks
  // it done; the ref guards against firing twice while that first call is in
  // flight. This is what makes EVERY client populate, not just the ones the
  // user happens to click through.
  const autoTriedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!liveStatus.live || route.view !== "account") return;
    const acct = ws.accounts.find((a) => a.id === route.id);
    if (!acct || acct.archived || acct.autoPopulated) return;
    if (autoTriedRef.current.has(acct.id)) return;
    autoTriedRef.current.add(acct.id);
    void ws.ensureAutoPopulated(acct.id);
    // Keyed on the open account and the live flag — reopening after the live
    // mirror arrives retries a workspace that had nothing to match before.
  }, [route, liveStatus.live, ws.accounts, ws.ensureAutoPopulated]);

  // The book-of-business candidates: every mirror client without a workspace,
  // scored by what a one-click create would import. Memoized — at a full
  // book (1000 clients × 1000 projects) this is real work.
  const clientCandidates = useMemo(() => {
    const mirror = loadMirror();
    const today = AS_OF_TODAY();
    return mirror.clients
      .filter((c) => !ws.accounts.some((a) => a.clientName.toLowerCase() === c.name.toLowerCase()))
      .map((c) => ({
        name: c.name,
        vertical: c.vertical,
        ...(c.lifecycleStage ? { lifecycleStage: c.lifecycleStage } : {}),
        ...(c.targetAccount ? { targetAccount: true } : {}),
        ...(c.icpTier ? { icpTier: c.icpTier } : {}),
        workCount: campaignsFromMirror(mirror, c.name, today).length,
        isClient: c.lifecycleStage === "customer" || !!c.abbreviation,
      }))
      // Delivery tool = clients only: active Kantata work, or a real client
      // marker. The server already filters the live pull; this guards the
      // demo fixture and any stale cached payload.
      .filter((c) => c.workCount > 0 || c.isClient)
      .sort(
        (a, b) =>
          b.workCount - a.workCount ||
          Number(b.lifecycleStage === "customer") - Number(a.lifecycleStage === "customer") ||
          Number(b.targetAccount ?? false) - Number(a.targetAccount ?? false) ||
          a.name.localeCompare(b.name),
      );
    // liveStatus flips when the live mirror arrives — the trigger to recompute.
  }, [ws.accounts, liveStatus]);

  const selectedInitiative =
    route.view === "initiative" ? ws.initiatives.find((i) => i.id === route.id) ?? null : null;
  const selectedIdea = route.view === "idea" ? ws.ideas.find((i) => i.id === route.id) ?? null : null;
  const selectedAccount = route.view === "account" ? ws.accounts.find((a) => a.id === route.id) ?? null : null;

  // Workspaces pointing at names that don't exist in the live book (demo
  // leftovers, misspellings) — badged on the Clients list.
  const unlinkedNames = useMemo(() => {
    if (!liveStatus.live) return [];
    const mirror = loadMirror();
    return ws.accounts.filter((a) => !a.archived && !isInBook(mirror, a.clientName)).map((a) => a.clientName);
  }, [ws.accounts, liveStatus]);

  // Per-workspace live pulse for the Clients page: how many Kantata matches
  // are WAITING for review, and the next real milestone — so the hero grid
  // is a work queue, not a guessing game.
  const accountPulse = useMemo(() => {
    const mirror = loadMirror();
    const today = AS_OF_TODAY();
    const pulse: Record<string, { waiting: number; nextMilestone?: string; nextMilestoneDate?: string }> = {};
    for (const a of ws.accounts) {
      if (a.archived) continue;
      const matched = campaignsFromMirror(mirror, a.clientName, today, a.kantataProjectIds);
      const waiting = matched.filter(
        (c) => !a.campaigns.some((e) => e.name.toLowerCase() === c.name.toLowerCase()),
      ).length;
      const next = matched
        .filter((c) => c.nextMilestone && c.nextMilestoneDate && c.nextMilestoneDate >= today)
        .sort((x, y) => (x.nextMilestoneDate ?? "").localeCompare(y.nextMilestoneDate ?? ""))[0];
      pulse[a.clientName] = {
        waiting,
        ...(next ? { nextMilestone: next.nextMilestone!, nextMilestoneDate: next.nextMilestoneDate! } : {}),
      };
    }
    return pulse;
  }, [ws.accounts, liveStatus]);

  // Sortable directory: EVERY client the app sees — derived-from-Kantata and
  // existing workspaces alike — with its live project count and next
  // milestone. Computed here (App can reach the matcher) and passed to
  // ClientList as plain data, keeping the guest-safety boundary intact.
  const clientDirectory = useMemo(() => {
    const mirror = loadMirror();
    const today = AS_OF_TODAY();
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const activeAccounts = ws.accounts.filter((a) => !a.archived);
    const accountByName = new Map(activeAccounts.map((a) => [norm(a.clientName), a] as const));
    const rows: {
      name: string;
      vertical?: string;
      liveProjects: number;
      nextMilestone?: string;
      nextMilestoneDate?: string;
      accountId?: string;
    }[] = [];
    const usedAccounts = new Set<string>();
    const emit = (name: string, vertical: string | undefined, account?: ClientAccount) => {
      const ctx = accountLiveContext(mirror, name, account?.kantataProjectIds);
      let nextMilestone: string | undefined;
      let nextMilestoneDate: string | undefined;
      for (const p of ctx.projects) {
        for (const m of p.milestones) {
          if (m.state !== "completed" && m.dueDate >= today && (nextMilestoneDate === undefined || m.dueDate < nextMilestoneDate)) {
            nextMilestoneDate = m.dueDate;
            nextMilestone = m.title;
          }
        }
      }
      rows.push({
        name,
        ...(vertical ? { vertical } : {}),
        liveProjects: ctx.projects.length,
        ...(nextMilestone ? { nextMilestone } : {}),
        ...(nextMilestoneDate ? { nextMilestoneDate } : {}),
        ...(account ? { accountId: account.id } : {}),
      });
    };
    for (const c of mirror.clients) {
      const account = accountByName.get(norm(c.name));
      if (account) usedAccounts.add(account.id);
      emit(c.name, c.vertical, account);
    }
    // Workspaces whose name isn't in the derived directory (manual / renamed).
    for (const a of activeAccounts) {
      if (usedAccounts.has(a.id)) continue;
      emit(a.clientName, undefined, a);
    }
    return rows;
  }, [ws.accounts, liveStatus]);

  // How the client count breaks down by title convention — shown in the
  // directory header so the number explains itself (colon-prefix clients vs
  // dash vs the verbatim project-titles that are deliberately NOT counted).
  const directoryStats = useMemo(() => {
    const mirror = loadMirror();
    const s = { colon: 0, dash: 0, verbatim: 0 };
    for (const p of mirror.projects) {
      const via = classifyClientTitle(p.title).via;
      if (via === "colon") s.colon += 1;
      else if (via === "dash") s.dash += 1;
      else if (via === "verbatim") s.verbatim += 1;
    }
    return s;
  }, [liveStatus]);

  // Everything the mirror knows about the open account, computed once per
  // render of that workspace — the workspace renders it as plain props.
  const selectedLiveCtx = selectedAccount
    ? accountLiveContext(loadMirror(), selectedAccount.clientName, selectedAccount.kantataProjectIds)
    : null;
  const selectedLinkSuggestions =
    selectedAccount && selectedLiveCtx && liveStatus.live && !selectedLiveCtx.crm
      ? suggestClients(loadMirror(), selectedAccount.clientName)
      : [];
  const selectedTaskCandidates = selectedAccount && selectedLiveCtx
    ? selectedLiveCtx.projects.flatMap((p) =>
        p.tasks
          .filter((t) => !taskIsDone(t.state))
          .filter((t) => !selectedAccount.tasks.some((e) => e.title.toLowerCase() === t.title.toLowerCase()))
          .map((t) => ({
            title: t.title,
            status: taskColumn(t.state),
            ...(t.dueDate ? { due: t.dueDate } : {}),
            project: p.title,
          })),
      )
    : [];

  const listView = route.view === "clients";

  // The sandbox lives inside each client: an idea's Back returns to its
  // owning workspace when one still exists.
  const ideaHome = (idea: { accountId?: string }): Route =>
    idea.accountId && ws.accounts.some((a) => a.id === idea.accountId)
      ? { view: "account", id: idea.accountId }
      : { view: "clients" };

  // This client's sandbox: its own ideas, plus legacy ideas not yet tied to
  // any client (claimable). Composed HERE so internal-only modules (ROI,
  // copilot) never enter ClientWorkspace's import graph — clientSafety.test.ts.
  const selectedAccountIdeas = selectedAccount ? ws.ideas.filter((i) => i.accountId === selectedAccount.id) : [];
  const unclaimedIdeas = ws.ideas.filter((i) => !i.accountId || !ws.accounts.some((a) => a.id === i.accountId));

  return (
    <div style={{ minHeight: "100vh", background: T.page }}>
      <AppHeader
        userName={userName}
        onChangeName={setName}
        live={liveStatus.live}
        liveLabel={liveStatus.label}
        liveDetail={liveStatus.detail}
        onRefreshData={() => void refreshLiveMirror(setLiveStatus)}
      />

      {/* Persistent navigation — visible on every page, including workspaces. */}
      <div style={{ background: "#fff", borderBottom: `1px solid ${T.grid}` }}>
        <div style={{ maxWidth: 1240, margin: "0 auto", padding: "10px 18px", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span data-tour="nav" style={{ display: "inline-flex", gap: 6 }}>
            <button
              type="button"
              className={`nav-pill${route.view === "clients" || route.view === "account" ? " active" : ""}`}
              title="Client workspaces you've set up — the full Kantata client roster is under “All clients — list”."
              onClick={() => setRoute({ view: "clients" })}
            >
              Workspaces ({ws.accounts.filter((a) => !a.archived).length})
            </button>
          </span>
          <button type="button" className="nav-pill" onClick={() => setTourStep(0)} title="Spotlight walkthrough of the workspace">
            ✦ Take the tour
          </button>
          <SearchBox accounts={ws.accounts} initiatives={ws.initiatives} ideas={ws.ideas} onNavigate={(target) => setRoute(target)} />
        </div>
      </div>

      {/* Live-data failures are debugging information — show them, don't
          bury them in a hover tooltip. */}
      {!liveStatus.live && liveStatus.detail && !liveStatus.detail.startsWith("checking") && liveStatus.label !== "Refreshing…" && (
        <div style={{ background: "#faf3dc", borderBottom: "1px solid #e7c66f" }}>
          <div style={{ maxWidth: 1240, margin: "0 auto", padding: "7px 18px", fontSize: 11.5, color: "#8a6d1a", lineHeight: 1.5 }}>
            <strong>Live data unavailable — showing demo data.</strong> {liveStatus.detail}. Click
            the ⟳ pill (top right) to retry.
          </div>
        </div>
      )}

      <div className="fade-in" key={hashOf(route)} style={{ maxWidth: 1240, margin: "0 auto", padding: 18 }}>
        {route.view === "clients" && (
          <>
            <PageIntro title="Client workspaces">
              One standardized execution workspace per client account — communication, tasks, files,
              and visibility for internal teams, clients, and contractors. Internal financials never
              appear here.
            </PageIntro>
            <ClientList
              accounts={ws.accounts.filter((a) => !a.archived)}
              archivedAccounts={ws.accounts.filter((a) => a.archived)}
              onRestore={(id) => ws.setAccountArchived(id, false)}
              candidates={clientCandidates}
              candidatesLive={liveStatus.live}
              directory={clientDirectory}
              directoryStats={directoryStats}
              pulse={accountPulse}
              onOpen={(id) => setRoute({ view: "account", id })}
              onCreate={(name) => setRoute({ view: "account", id: ws.createAccount(name) })}
              onCreateFromClient={(name) => setRoute({ view: "account", id: ws.createAccountFromMirror(name) })}
              onClearAll={() => ws.archiveAllAccounts()}
            />
            {(() => {
              const waitingTotal = Object.values(accountPulse).reduce((s, p) => s + p.waiting, 0);
              if (waitingTotal === 0) return null;
              return (
                <div className="card" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", flexWrap: "wrap", borderColor: T.roi.navy }}>
                  <span style={{ fontSize: 12.5, color: T.inkSecondary, flex: 1, minWidth: 260 }}>
                    <strong style={{ color: T.ink }}>{waitingTotal} Kantata item{waitingTotal === 1 ? "" : "s"} waiting across your workspaces.</strong>{" "}
                    Populate everything at once — campaigns, milestones, and open tasks land in every workspace. Remove stays one click away per workspace.
                  </span>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      // Sequential on purpose: each import deepens its own
                      // workspaces from Kantata first — don't stampede the API.
                      void (async () => {
                        for (const a of ws.accounts) {
                          if (!a.archived && (accountPulse[a.clientName]?.waiting ?? 0) > 0) await ws.importAllFromKantata(a.id);
                        }
                      })();
                    }}
                  >
                    ⚡ Populate all workspaces from Kantata →
                  </button>
                </div>
              );
            })()}
            <DataInspector live={liveStatus.live} unlinkedCount={unlinkedNames.length} />
          </>
        )}

        {listView && (
          <div style={{ marginTop: 18, fontSize: 11, color: T.inkMuted }}>
            {ws.syncStatus.mode === "shared" ? (
              <>
                Shared team workspace — synced to Supabase
                {ws.syncStatus.savedAt ? ` · last saved ${new Date(ws.syncStatus.savedAt).toLocaleTimeString()}` : ""}
                {ws.syncStatus.error ? " · retrying…" : ""}{" "}
                <Button variant="link" style={{ fontSize: 11 }} onClick={ws.resetDemo}>
                  Reset shared demo data
                </Button>
              </>
            ) : (
              <>
                Demo data is stored locally in your browser.{" "}
                <Button variant="link" style={{ fontSize: 11 }} onClick={ws.resetDemo}>
                  Reset demo data
                </Button>
              </>
            )}
          </div>
        )}

        {selectedInitiative && (
          <InitiativeWorkspace
            initiative={selectedInitiative}
            onBack={() =>
              setRoute(
                selectedInitiative.clientAccountId && ws.accounts.some((a) => a.id === selectedInitiative.clientAccountId)
                  ? { view: "account", id: selectedInitiative.clientAccountId }
                  : { view: "clients" },
              )
            }
            onFactorChange={(key, patch) => ws.updateFactor(selectedInitiative.id, key, patch)}
            onPost={(body) => ws.postMessage(selectedInitiative.id, body, userName)}
            onAskAnalyst={() => ws.askRoiAnalyst(selectedInitiative.id)}
            onSummaryChange={(summary) => ws.setSummary(selectedInitiative.id, summary)}
            onInvite={(personId) => ws.setPackageStatus("initiative", selectedInitiative.id, personId, "invited")}
            onPartAdded={(personId) => ws.setPackageStatus("initiative", selectedInitiative.id, personId, "part_added")}
            onAddTask={(title, ownerName, due, label) => ws.addTask(selectedInitiative.id, title, ownerName, due, label)}
            onTaskStatus={(taskId, status) => ws.setTaskStatus(selectedInitiative.id, taskId, status)}
            onArchive={(archived) => ws.setArchived(selectedInitiative.id, archived)}
            accounts={ws.accounts.map((a) => ({ id: a.id, clientName: a.clientName }))}
            onSetClientAccount={(accountId) => ws.setClientAccount(selectedInitiative.id, accountId)}
            onToggleClientVisible={(taskId) => ws.toggleTaskClientVisible(selectedInitiative.id, taskId)}
          />
        )}

        {selectedIdea && (
          <SandboxWorkspace
            idea={selectedIdea}
            onBack={() => setRoute(ideaHome(selectedIdea))}
            backLabel={ws.accounts.find((a) => a.id === selectedIdea.accountId)?.clientName ?? "Clients"}
            onDelete={() => {
              const home = ideaHome(selectedIdea);
              ws.removeIdea(selectedIdea.id);
              setRoute(home);
            }}
            onUpdate={(patch) => ws.updateIdea(selectedIdea.id, patch)}
            onPost={(body) => ws.postIdeaMessage(selectedIdea.id, body, userName)}
            onAskAnalyst={() => ws.askIdeaAnalyst(selectedIdea.id)}
            onPromote={(type) => {
              const id = ws.promoteIdea(selectedIdea.id, type, userName);
              if (id) setRoute({ view: "initiative", id });
            }}
            onOpenInitiative={(id) => setRoute({ view: "initiative", id })}
            onInvite={(personId) => ws.setPackageStatus("idea", selectedIdea.id, personId, "invited")}
            onPartAdded={(personId) => ws.setPackageStatus("idea", selectedIdea.id, personId, "part_added")}
            onInviteCopilot={() => ws.inviteCopilotIn(selectedIdea.id)}
            onAddMember={(personId) => ws.addTeamMember(selectedIdea.id, personId)}
            onAcceptReview={() => ws.acceptDraftReview(selectedIdea.id)}
            people={ws.availablePeople}
            flags={ws.copilotFlags(selectedIdea)}
          />
        )}

        {selectedAccount && (
          <ClientWorkspace
            account={selectedAccount}
            sharedTasks={ws.sharedTasksFor(selectedAccount.id)}
            userName={userName}
            onBack={() => setRoute({ view: "clients" })}
            onAddTask={(title, ownerName, due, label) => ws.addAccountTask(selectedAccount.id, title, ownerName, due, label)}
            onTaskStatus={(taskId, status) => ws.setSharedTaskStatus(selectedAccount.id, taskId, status)}
            onPost={(body) => ws.postAccountMessage(selectedAccount.id, body, userName)}
            onAddLink={(name, kind, url) => ws.addAccountLink(selectedAccount.id, name, kind, url)}
            onAddExternal={(name, org, role, access) => ws.addExternal(selectedAccount.id, name, org, role, access, userName)}
            onRemoveExternal={(externalId) => ws.removeExternal(selectedAccount.id, externalId)}
            onOffboardEverywhere={(personName) => ws.offboardEverywhere(personName)}
            importCandidates={campaignsFromMirror(
              loadMirror(),
              selectedAccount.clientName,
              AS_OF_TODAY(),
              selectedAccount.kantataProjectIds,
            ).filter((c) => !selectedAccount.campaigns.some((e) => e.name.toLowerCase() === c.name.toLowerCase()))}
            onImportCampaigns={(selected) => ws.importCampaigns(selectedAccount.id, selected)}
            onRemoveCampaign={(campaignId) => ws.removeCampaign(selectedAccount.id, campaignId)}
            onClearCampaigns={() => ws.clearCampaigns(selectedAccount.id)}
            taskCandidates={selectedTaskCandidates}
            onImportTasks={(selected) => ws.importTasks(selectedAccount.id, selected)}
            onImportAll={() => ws.importAllFromKantata(selectedAccount.id)}
            {...(selectedLiveCtx ? { liveContext: selectedLiveCtx } : {})}
            liveDataOn={liveStatus.live}
            linkSuggestions={selectedLinkSuggestions}
            onRelink={(name) => ws.renameAccount(selectedAccount.id, name)}
            onLinkProjects={(ids) => ws.linkProjects(selectedAccount.id, ids)}
            onArchive={() => {
              ws.setAccountArchived(selectedAccount.id, true);
              setRoute({ view: "clients" });
            }}
            onApplyTemplate={(templateKey, startDate) => ws.applyTemplate(selectedAccount.id, templateKey, startDate)}
            people={ws.availablePeople.map((p) => ({ id: p.id, name: p.name, title: p.title }))}
            onAddMember={(personId) => ws.addAccountMember(selectedAccount.id, personId)}
            sandboxCount={selectedAccountIdeas.length}
            sandboxContent={
              <Sandbox
                ideas={selectedAccountIdeas}
                clientName={selectedAccount.clientName}
                unclaimed={unclaimedIdeas}
                onClaim={(ideaId) => ws.claimIdea(ideaId, selectedAccount.id)}
                onOpen={(id) => setRoute({ view: "idea", id })}
                onCreate={(title, pitch, aiMode, overrides) =>
                  setRoute({ view: "idea", id: ws.createIdea(title, pitch, aiMode, overrides, selectedAccount.id) })
                }
              />
            }
          />
        )}

        {route.view === "account" && !selectedAccount && (
          <EmptyState
            icon="🔍"
            title="Client workspace not found"
            hint="It may have been removed, or the link is stale."
            action={<Button variant="secondary" onClick={() => setRoute({ view: "clients" })}>Back to Clients</Button>}
          />
        )}
        {route.view === "initiative" && !selectedInitiative && (
          <EmptyState
            icon="🔍"
            title="Build not found"
            hint="It may have been removed, or the link is stale."
            action={<Button variant="secondary" onClick={() => setRoute({ view: "clients" })}>Back to Clients</Button>}
          />
        )}
        {route.view === "idea" && !selectedIdea && (
          <EmptyState
            icon="🔍"
            title="Idea not found"
            hint="It may have been removed, or the link is stale."
            action={<Button variant="secondary" onClick={() => setRoute({ view: "clients" })}>Back to Clients</Button>}
          />
        )}
      </div>

      {tourStep !== null && <Tour steps={TOUR_STEPS} step={tourStep} onStep={setTourStep} onClose={closeTour} />}
    </div>
  );
}
