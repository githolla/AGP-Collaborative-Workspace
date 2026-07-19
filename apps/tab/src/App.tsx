import { useState } from "react";
import { AppHeader } from "./components/AppHeader.js";
import { Portfolio } from "./components/Portfolio.js";
import { InitiativeWorkspace } from "./components/InitiativeWorkspace.js";
import { useWorkspace } from "./workspace/store.js";
import { T } from "./theme.js";

function initialSelection(): string | null {
  const m = window.location.hash.match(/^#i\/(.+)$/);
  return m?.[1] ?? null;
}

export function App() {
  const ws = useWorkspace();
  const [selectedId, setSelectedIdState] = useState<string | null>(initialSelection);
  const setSelectedId = (id: string | null) => {
    setSelectedIdState(id);
    window.location.hash = id ? `i/${id}` : "";
  };

  const selected = ws.initiatives.find((i) => i.id === selectedId) ?? null;

  return (
    <div style={{ minHeight: "100vh", background: T.page }}>
      <AppHeader userInitials="BM" />
      <div style={{ maxWidth: 1240, margin: "0 auto", padding: 18 }}>
        {selected ? (
          <InitiativeWorkspace
            initiative={selected}
            onBack={() => setSelectedId(null)}
            onFactorChange={(key, patch) => ws.updateFactor(selected.id, key, patch)}
            onPost={(body) => ws.postMessage(selected.id, body)}
            onAskAnalyst={() => ws.askRoiAnalyst(selected.id)}
            onSummaryChange={(summary) => ws.setSummary(selected.id, summary)}
          />
        ) : (
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
              onOpen={setSelectedId}
              onCreate={(name, type) => setSelectedId(ws.createInitiative(name, type))}
            />
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
      </div>
    </div>
  );
}
