import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "./components/AppHeader.js";
import { InitiativeWorkspace } from "./components/InitiativeWorkspace.js";
import { Sandbox } from "./components/Sandbox.js";
import { SandboxWorkspace } from "./components/SandboxWorkspace.js";
import { SearchBox } from "./components/SearchBox.js";
import { ClientList } from "./components/ClientList.js";
import { ClientWorkspace } from "./components/ClientWorkspace.js";
import { Button, EmptyState } from "./components/ui.js";
import { Tour, type TourStep } from "./components/Tour.js";
import { useWorkspace } from "./workspace/store.js";
import { useProfile } from "./workspace/profile.js";
import { initLiveMirror, refreshLiveMirror, type LiveStatus } from "./workspace/liveMirror.js";
import { loadMirror } from "./workspace/agpKnowledge.js";
import { accountLiveContext, campaignsFromMirror } from "./workspace/campaignImport.js";
import { AS_OF_TODAY } from "./workspace/format.js";
import { T } from "./theme.js";

/**
 * Two surfaces, per the focus decision: Cara's client-account workspace
 * (the wireframe, exactly) and the Sandbox where anything starts. Promoted
 * builds keep their full ROI workspace — reached from their idea or via
 * search — but they don't get a top-level section.
 */

type Route =
  | { view: "clients" }
  | { view: "sandbox" }
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
  if (hash === "#sandbox") return { view: "sandbox" };
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
    case "sandbox":
      return "sandbox";
    default:
      return "";
  }
}

/** Which top-level section a route belongs to (keeps nav lit inside workspaces). */
function sectionOf(route: Route): "clients" | "sandbox" {
  if (route.view === "clients" || route.view === "account") return "clients";
  return "sandbox";
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
    title: "Two surfaces, that's it",
    quote: { text: "…without adding unnecessary complexity or overhead.", from: "Cara's features doc — opening line" },
    body: "Taken literally. Clients is everything client-facing; the Sandbox is where anything new starts. Search reaches the rest — including builds promoted out of the sandbox.",
  },
  {
    key: "client-tabs",
    route: "c/acct-abc-foodbank",
    target: '[data-tour="client-tabs"]',
    title: "Cara's wireframe, working",
    quote: { text: "Home · Project Plan · Client Dashboard · Files · Discussions · Contractor Access", from: "the nav in Cara's wireframe" },
    body: "Her tabs, exactly, and all of them live. Every client account gets this same workspace from the standard template — one workspace per account, no cross-visibility.",
  },
  {
    key: "client-access",
    route: "c/acct-abc-foodbank",
    target: '[data-tour="client-access"]',
    title: "Access that revokes for real",
    quote: { text: "Offboarding revokes access immediately.", from: "Cara's features doc — a Must" },
    body: "The register shows who invited whom and when they were last active. Remove revokes on the spot — and “Offboard everywhere” clears a person from every client workspace at once, audit-logged.",
  },
  {
    key: "intake",
    route: "sandbox",
    target: '[data-tour="intake-box"]',
    title: "Start anything in a sentence",
    quote: { text: "A collaboration workspace where the AI is used to help collaborate on projects — new ones and iterations of current ones.", from: "the product-owner brief" },
    body: "Type what should exist. “Build it for me” has the Copilot name it, size it, plan it, and pick the team. “Start blank” keeps it human-only — the AI observes silently until invited.",
  },
  {
    key: "chips",
    route: "sandbox",
    target: '[data-tour="intake-chips"]',
    title: "Tap what you already know",
    body: "Department, service line, vertical, client — one tap each, no forms, no drop-down maze. Your picks steer the AI's draft, and the picked department's person leads the plan.",
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
    body: "Idea → AI draft → human review → team parts → promoted build, while client work runs in its own workspace. Every Must in Cara's doc is built or backend-gated, tracked line-by-line in the requirements baseline. Restart any time with “Take the tour”.",
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
      }))
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

  // Everything the mirror knows about the open account, computed once per
  // render of that workspace — the workspace renders it as plain props.
  const selectedLiveCtx = selectedAccount ? accountLiveContext(loadMirror(), selectedAccount.clientName) : null;
  const selectedTaskCandidates = selectedAccount && selectedLiveCtx
    ? selectedLiveCtx.projects.flatMap((p) =>
        p.tasks
          .filter((t) => t.state !== "completed")
          .filter((t) => !selectedAccount.tasks.some((e) => e.title.toLowerCase() === t.title.toLowerCase()))
          .map((t) => ({
            title: t.title,
            status: (t.state === "started" || t.state === "in_progress" ? "doing" : "todo") as "doing" | "todo",
            ...(t.dueDate ? { due: t.dueDate } : {}),
            project: p.title,
          })),
      )
    : [];

  const section = sectionOf(route);
  const listView = route.view === "clients" || route.view === "sandbox";

  const navPill = (label: string, key: "clients" | "sandbox", target: Route) => (
    <button type="button" className={`nav-pill${section === key ? " active" : ""}`} onClick={() => setRoute(target)}>
      {label}
    </button>
  );

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
            {navPill(`Clients (${ws.accounts.filter((a) => !a.archived).length})`, "clients", { view: "clients" })}
            {navPill(`Sandbox (${ws.ideas.length})`, "sandbox", { view: "sandbox" })}
          </span>
          <button type="button" className="nav-pill" onClick={() => setTourStep(0)} title="Spotlight walkthrough of the workspace">
            ✦ Take the tour
          </button>
          <SearchBox initiatives={ws.initiatives} ideas={ws.ideas} onNavigate={(target) => setRoute(target)} />
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
              candidates={clientCandidates}
              candidatesLive={liveStatus.live}
              onOpen={(id) => setRoute({ view: "account", id })}
              onCreate={(name) => setRoute({ view: "account", id: ws.createAccount(name) })}
              onCreateFromClient={(name) => setRoute({ view: "account", id: ws.createAccountFromMirror(name) })}
            />
          </>
        )}

        {route.view === "sandbox" && (
          <>
            <PageIntro title="Sandbox">
              Where anything starts. Describe an idea and the Copilot builds the project behind the
              scenes — or start blank with just your team and invite the AI in later. Promote an
              idea when it earns it, and its full build workspace opens from here.
            </PageIntro>
            <Sandbox
              ideas={ws.ideas}
              onOpen={(id) => setRoute({ view: "idea", id })}
              onCreate={(title, pitch, aiMode, overrides) =>
                setRoute({ view: "idea", id: ws.createIdea(title, pitch, aiMode, overrides) })
              }
            />
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
            onBack={() => setRoute({ view: "sandbox" })}
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
            onBack={() => setRoute({ view: "sandbox" })}
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
            importCandidates={campaignsFromMirror(loadMirror(), selectedAccount.clientName, AS_OF_TODAY()).filter(
              (c) => !selectedAccount.campaigns.some((e) => e.name.toLowerCase() === c.name.toLowerCase()),
            )}
            onImportCampaigns={(selected) => ws.importCampaigns(selectedAccount.id, selected)}
            onRemoveCampaign={(campaignId) => ws.removeCampaign(selectedAccount.id, campaignId)}
            onClearCampaigns={() => ws.clearCampaigns(selectedAccount.id)}
            taskCandidates={selectedTaskCandidates}
            onImportTasks={(selected) => ws.importTasks(selectedAccount.id, selected)}
            {...(selectedLiveCtx ? { liveContext: selectedLiveCtx } : {})}
            liveDataOn={liveStatus.live}
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
            action={<Button variant="secondary" onClick={() => setRoute({ view: "sandbox" })}>Back to the Sandbox</Button>}
          />
        )}
        {route.view === "idea" && !selectedIdea && (
          <EmptyState
            icon="🔍"
            title="Idea not found"
            hint="It may have been removed, or the link is stale."
            action={<Button variant="secondary" onClick={() => setRoute({ view: "sandbox" })}>Back to the Sandbox</Button>}
          />
        )}
      </div>

      {tourStep !== null && <Tour steps={TOUR_STEPS} step={tourStep} onStep={setTourStep} onClose={closeTour} />}
    </div>
  );
}
