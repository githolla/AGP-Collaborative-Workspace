import { useEffect, useState } from "react";
import { AppHeader } from "./components/AppHeader.js";
import { InitiativeWorkspace } from "./components/InitiativeWorkspace.js";
import { Sandbox } from "./components/Sandbox.js";
import { SandboxWorkspace } from "./components/SandboxWorkspace.js";
import { SearchBox } from "./components/SearchBox.js";
import { ClientList } from "./components/ClientList.js";
import { ClientWorkspace } from "./components/ClientWorkspace.js";
import { Button, EmptyState } from "./components/ui.js";
import { useWorkspace } from "./workspace/store.js";
import { useProfile } from "./workspace/profile.js";
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

  const selectedInitiative =
    route.view === "initiative" ? ws.initiatives.find((i) => i.id === route.id) ?? null : null;
  const selectedIdea = route.view === "idea" ? ws.ideas.find((i) => i.id === route.id) ?? null : null;
  const selectedAccount = route.view === "account" ? ws.accounts.find((a) => a.id === route.id) ?? null : null;

  const section = sectionOf(route);
  const listView = route.view === "clients" || route.view === "sandbox";

  const navPill = (label: string, key: "clients" | "sandbox", target: Route) => (
    <button type="button" className={`nav-pill${section === key ? " active" : ""}`} onClick={() => setRoute(target)}>
      {label}
    </button>
  );

  return (
    <div style={{ minHeight: "100vh", background: T.page }}>
      <AppHeader userName={userName} onChangeName={setName} />

      {/* Persistent navigation — visible on every page, including workspaces. */}
      <div style={{ background: "#fff", borderBottom: `1px solid ${T.grid}` }}>
        <div style={{ maxWidth: 1240, margin: "0 auto", padding: "10px 18px", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {navPill(`Clients (${ws.accounts.filter((a) => !a.archived).length})`, "clients", { view: "clients" })}
          {navPill(`Sandbox (${ws.ideas.length})`, "sandbox", { view: "sandbox" })}
          <SearchBox initiatives={ws.initiatives} ideas={ws.ideas} onNavigate={(target) => setRoute(target)} />
        </div>
      </div>

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
              onOpen={(id) => setRoute({ view: "account", id })}
              onCreate={(name) => setRoute({ view: "account", id: ws.createAccount(name) })}
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
            Demo data is stored locally in your browser.{" "}
            <Button variant="link" style={{ fontSize: 11 }} onClick={ws.resetDemo}>
              Reset demo data
            </Button>
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
    </div>
  );
}
