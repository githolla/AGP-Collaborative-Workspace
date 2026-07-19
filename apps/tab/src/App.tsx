import { useMemo, useState } from "react";
import { AppHeader } from "./components/AppHeader.js";
import { ProjectList } from "./components/ProjectList.js";
import { Dashboard } from "./components/Dashboard.js";
import { ResourcePlanner } from "./components/ResourcePlanner.js";
import { FeedBadge, NeedsYou } from "./components/NeedsYou.js";
import { buildFeed } from "./data/feed.js";
import { loadProjects } from "./data/model.js";
import { T } from "./theme.js";

type Page = "dashboard" | "planner" | "needs-you";

const PAGES: { key: Page; label: string }[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "planner", label: "Resource planner" },
  { key: "needs-you", label: "Needs you" },
];

function initialPage(): Page {
  const hash = window.location.hash.replace("#", "");
  return PAGES.some((p) => p.key === hash) ? (hash as Page) : "dashboard";
}

export function App() {
  const projects = useMemo(loadProjects, []);
  const feed = useMemo(() => buildFeed(projects), [projects]);
  const [selectedId, setSelectedId] = useState(projects[0]?.id ?? "");
  const [page, setPageState] = useState<Page>(initialPage);
  const setPage = (p: Page) => {
    setPageState(p);
    window.location.hash = p === "dashboard" ? "" : p;
  };
  const project = projects.find((p) => p.id === selectedId) ?? projects[0];

  if (!project) return <AppHeader userInitials="JN" />;

  return (
    <div style={{ minHeight: "100vh", background: T.page }}>
      <AppHeader userInitials="JN" />
      <div style={{ display: "flex", gap: 18, padding: 18, maxWidth: 1280, margin: "0 auto" }}>
        <aside style={{ width: 250, flexShrink: 0 }}>
          <ProjectList projects={projects} selectedId={project.id} onSelect={setSelectedId} />
        </aside>
        <main style={{ flex: 1, minWidth: 0 }}>
          <div role="tablist" aria-label="Workspace pages" style={{ display: "flex", gap: 4, marginBottom: 16 }}>
            {PAGES.map((p) => {
              const active = p.key === page;
              return (
                <button
                  key={p.key}
                  role="tab"
                  aria-selected={active}
                  type="button"
                  onClick={() => setPage(p.key)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 7,
                    fontSize: 12.5,
                    fontWeight: 600,
                    padding: "7px 14px",
                    borderRadius: 999,
                    cursor: "pointer",
                    border: `1px solid ${active ? T.series1 : T.grid}`,
                    background: active ? T.series1 : "transparent",
                    color: active ? "#fff" : T.inkSecondary,
                  }}
                >
                  {p.label}
                  {p.key === "needs-you" && <FeedBadge count={feed.length} />}
                </button>
              );
            })}
          </div>
          {page === "dashboard" && <Dashboard project={project} />}
          {page === "planner" && <ResourcePlanner project={project} allProjects={projects} />}
          {page === "needs-you" && (
            <NeedsYou
              items={feed}
              onOpenProject={(id) => {
                setSelectedId(id);
                setPage("dashboard");
              }}
            />
          )}
        </main>
      </div>
    </div>
  );
}
