import { AppHeader } from "./components/AppHeader.js";

export function App() {
  return (
    <div>
      <AppHeader userInitials="JN" />
      {/* Workspace content (project dashboard, resource planner, ROI card) lands in M2. */}
      <main style={{ padding: 24, color: "#5a5566", fontSize: 14 }}>
        Workspace UI arrives in M2 — this shell renders the header on fixture data only.
      </main>
    </div>
  );
}
