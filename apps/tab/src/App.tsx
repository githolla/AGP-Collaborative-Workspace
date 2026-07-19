import { useState } from "react";
import { AppHeader } from "./components/AppHeader.js";
import { Portfolio } from "./components/Portfolio.js";
import { InitiativeWorkspace } from "./components/InitiativeWorkspace.js";
import { Sandbox } from "./components/Sandbox.js";
import { SandboxWorkspace } from "./components/SandboxWorkspace.js";
import { useWorkspace } from "./workspace/store.js";
import { T } from "./theme.js";

type Route =
  | { view: "initiatives" }
  | { view: "sandbox" }
  | { view: "initiative"; id: string }
  | { view: "idea"; id: string };

function parseHash(): Route {
  const hash = window.location.hash;
  const initiative = hash.match(/^#i\/(.+)$/);
  if (initiative?.[1]) return { view: "initiative", id: initiative[1] };
  const idea = hash.match(/^#s\/(.+)$/);
  if (idea?.[1]) return { view: "idea", id: idea[1] };
  if (hash === "#sandbox") return { view: "sandbox" };
  return { view: "initiatives" };
}

function hashOf(route: Route): string {
  switch (route.view) {
    case "initiative":
      return `i/${route.id}`;
    case "idea":
      return `s/${route.id}`;
    case "sandbox":
      return "sandbox";
    default:
      return "";
  }
}

export function App() {
  const ws = useWorkspace();
  const [route, setRouteState] = useState<Route>(parseHash);
  const setRoute = (r: Route) => {
    setRouteState(r);
    window.location.hash = hashOf(r);
  };

  const selectedInitiative =
    route.view === "initiative" ? ws.initiatives.find((i) => i.id === route.id) ?? null : null;
  const selectedIdea = route.view === "idea" ? ws.ideas.find((i) => i.id === route.id) ?? null : null;

  const navTab = (label: string, active: boolean, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontSize: 12.5,
        fontWeight: 600,
        padding: "7px 16px",
        borderRadius: 999,
        cursor: "pointer",
        border: `1px solid ${active ? T.series1 : T.grid}`,
        background: active ? T.series1 : "transparent",
        color: active ? "#fff" : T.inkSecondary,
      }}
    >
      {label}
    </button>
  );

  const listView = route.view === "initiatives" || route.view === "sandbox";

  return (
    <div style={{ minHeight: "100vh", background: T.page }}>
      <AppHeader userInitials="BM" />
      <div style={{ maxWidth: 1240, margin: "0 auto", padding: 18 }}>
        {listView && (
          <>
            <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
              {navTab(`Initiatives (${ws.initiatives.length})`, route.view === "initiatives", () => setRoute({ view: "initiatives" }))}
              {navTab(`Sandbox (${ws.ideas.length})`, route.view === "sandbox", () => setRoute({ view: "sandbox" }))}
            </div>

            {route.view === "initiatives" ? (
              <>
                <div style={{ marginBottom: 14 }}>
                  <h1 style={{ fontSize: 18, fontWeight: 700, color: T.ink }}>Product initiatives</h1>
                  <p style={{ fontSize: 12.5, color: T.inkSecondary, marginTop: 4, maxWidth: 720 }}>
                    Collaborate with the team and AI agents on new product builds and AI iterations of
                    existing products. Every initiative runs the shared ROI engine in the background —
                    the headline, grade, and scenarios update live as evidence lands.
                  </p>
                </div>
                <Portfolio
                  initiatives={ws.initiatives}
                  onOpen={(id) => setRoute({ view: "initiative", id })}
                  onCreate={(name, type) => setRoute({ view: "initiative", id: ws.createInitiative(name, type) })}
                />
              </>
            ) : (
              <>
                <div style={{ marginBottom: 14 }}>
                  <h1 style={{ fontSize: 18, fontWeight: 700, color: T.ink }}>Sandbox</h1>
                  <p style={{ fontSize: 12.5, color: T.inkSecondary, marginTop: 4, maxWidth: 720 }}>
                    Ideas not tied to any product. Drop one in, rough out what it would replace with
                    the ROI Analyst, and promote it to a real build when the napkin math earns it.
                  </p>
                </div>
                <Sandbox
                  ideas={ws.ideas}
                  onOpen={(id) => setRoute({ view: "idea", id })}
                  onCreate={(title, pitch) => setRoute({ view: "idea", id: ws.createIdea(title, pitch) })}
                />
              </>
            )}

            <div style={{ marginTop: 18, fontSize: 11, color: T.inkMuted }}>
              Demo data is stored locally in your browser.{" "}
              <button
                type="button"
                onClick={ws.resetDemo}
                style={{ fontSize: 11, color: T.inkSecondary, background: "none", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }}
              >
                Reset demo data
              </button>
            </div>
          </>
        )}

        {selectedInitiative && (
          <InitiativeWorkspace
            initiative={selectedInitiative}
            onBack={() => setRoute({ view: "initiatives" })}
            onFactorChange={(key, patch) => ws.updateFactor(selectedInitiative.id, key, patch)}
            onPost={(body) => ws.postMessage(selectedInitiative.id, body)}
            onAskAnalyst={() => ws.askRoiAnalyst(selectedInitiative.id)}
            onSummaryChange={(summary) => ws.setSummary(selectedInitiative.id, summary)}
          />
        )}

        {selectedIdea && (
          <SandboxWorkspace
            idea={selectedIdea}
            onBack={() => setRoute({ view: "sandbox" })}
            onUpdate={(patch) => ws.updateIdea(selectedIdea.id, patch)}
            onPost={(body) => ws.postIdeaMessage(selectedIdea.id, body)}
            onAskAnalyst={() => ws.askIdeaAnalyst(selectedIdea.id)}
            onPromote={(type) => {
              const id = ws.promoteIdea(selectedIdea.id, type);
              if (id) setRoute({ view: "initiative", id });
            }}
            onOpenInitiative={(id) => setRoute({ view: "initiative", id })}
          />
        )}

        {route.view === "initiative" && !selectedInitiative && (
          <div style={{ fontSize: 12.5, color: T.inkSecondary }}>
            Initiative not found.{" "}
            <button type="button" onClick={() => setRoute({ view: "initiatives" })} style={{ color: T.series1, background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline" }}>
              Back to initiatives
            </button>
          </div>
        )}
        {route.view === "idea" && !selectedIdea && (
          <div style={{ fontSize: 12.5, color: T.inkSecondary }}>
            Idea not found.{" "}
            <button type="button" onClick={() => setRoute({ view: "sandbox" })} style={{ color: T.series1, background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline" }}>
              Back to the sandbox
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
