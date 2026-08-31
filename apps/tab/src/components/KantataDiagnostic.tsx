import { useState } from "react";
import { T } from "../theme.js";
import { Button, Card } from "./ui.js";
import { SectionTitle } from "./bits.js";
import { msApiGetPlain, MsApiError } from "../workspace/msApiFetch.js";

/**
 * App-admin Kantata resourcing-data check (#admin). Answers "does this Kantata
 * workspace have hours we can pull?" from the server's KANTATA_API_TOKEN, so an
 * admin can see it in the app instead of running the CLI script. Calls
 * GET /api/admin/kantata-diagnostic (app-admin gated server-side too).
 */

interface DiagWorkspace {
  workspaceId: string;
  allocations: number;
  allocationsTaskLinked: number;
  allocationsHours: number;
  allocationWindow: { from: string; to: string } | null;
  stories: number;
  storiesWithHours: number;
  storyHours: number;
  verdict: "has_allocations" | "has_story_hours" | "no_hours" | "unknown";
  sample: Record<string, unknown> | null;
}
interface DiagResult {
  configured: boolean;
  message?: string;
  totalAllocationsVisible?: number;
  allocationsError?: string;
  workspaces?: DiagWorkspace[];
}

const VERDICT: Record<DiagWorkspace["verdict"], { icon: string; label: string; color: string; bg: string; note: string }> = {
  has_allocations: { icon: "✅", label: "Has allocations", color: "#116a43", bg: "#e6f4ea", note: "The “By hours” view should populate from these. If it's empty in the app, the gap is the workspace↔account match, not the data." },
  has_story_hours: { icon: "◑", label: "Story hours only", color: "#8a6d1a", bg: "#faf3dc", note: "No Resource Center allocations, but stories carry estimated hours — the derived weekly view can spread those if the import carries estimated_minutes." },
  no_hours: { icon: "⚠", label: "No hours in Kantata", color: T.inkSecondary, bg: "#eef0f4", note: "No allocations and no story hours for this workspace. Nothing to pull — the task-load view is the honest picture until someone enters hours." },
  unknown: { icon: "🔒", label: "Couldn't read allocations", color: "#8a6d1a", bg: "#faf3dc", note: "The allocations read failed — the token likely lacks resource-management (allocations) read scope. This is NOT proof there are no hours; add the scope and re-check." },
};

async function fetchDiagnostic(workspaceIds: string): Promise<DiagResult> {
  return msApiGetPlain<DiagResult>(`/api/admin/kantata-diagnostic?workspaceIds=${encodeURIComponent(workspaceIds)}`);
}

export function KantataDiagnostic() {
  const [ids, setIds] = useState("45402856, 45442936");
  const [result, setResult] = useState<DiagResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showSample, setShowSample] = useState<string | null>(null);

  const run = () => {
    setBusy(true); setErr(null); setResult(null);
    void fetchDiagnostic(ids)
      .then((r) => setResult(r))
      .catch((e) => setErr(e instanceof MsApiError ? e.message : "Check failed"))
      .finally(() => setBusy(false));
  };

  return (
    <Card>
      <SectionTitle>Kantata resourcing data</SectionTitle>
      <p style={{ color: T.inkMuted, fontSize: 14, marginBottom: 12 }}>
        Checks whether a Kantata workspace has Resource Center allocations (reserved hours the &ldquo;By hours&rdquo; view
        reads) or story-level estimated hours &mdash; so you can tell why a client&apos;s resourcing shows 0h.
      </p>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
        <input value={ids} onChange={(e) => setIds(e.target.value)} placeholder="Kantata workspace ids, comma-separated"
          style={{ flex: 1, minWidth: 220, border: `1px solid ${T.grid}`, borderRadius: 8, padding: "9px 12px", fontSize: 13, fontFamily: "inherit" }} />
        <Button variant="secondary" disabled={busy || !ids.trim()} onClick={run}>{busy ? "Checking…" : "Run check"}</Button>
      </div>

      {err && <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: "#fdecea", color: T.status.critical, fontSize: 13 }}>{err}</div>}

      {result && !result.configured && (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: "#faf3dc", color: "#8a6d1a", fontSize: 13 }}>
          {result.message ?? "Kantata isn't configured on the server."}
        </div>
      )}

      {result?.configured && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 11.5, color: T.inkMuted }}>
            {result.totalAllocationsVisible ?? 0} allocations found across these workspaces.
            {result.allocationsError ? ` ⚠ allocations pull error: ${result.allocationsError} (a 403 means the token lacks resource-management scope).` : ""}
          </div>
          {(result.workspaces ?? []).map((w) => {
            const v = VERDICT[w.verdict];
            return (
              <div key={w.workspaceId} style={{ border: `1px solid ${T.grid}`, borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 800, color: T.ink, fontSize: 14 }}>Workspace {w.workspaceId}</span>
                  <span style={{ fontSize: 11.5, fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: v.bg, color: v.color }}>{v.icon} {v.label}</span>
                </div>
                <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 8, fontSize: 12.5, color: T.inkSecondary }}>
                  <span>Allocations: <b style={{ color: T.ink }}>{w.allocations}</b>{w.allocations > 0 ? ` (${w.allocationsTaskLinked} task-linked, ~${w.allocationsHours}h)` : ""}</span>
                  <span>Stories with hours: <b style={{ color: T.ink }}>{w.storiesWithHours}</b> / {w.stories}{w.storiesWithHours > 0 ? ` (~${w.storyHours}h)` : ""}</span>
                  {w.allocationWindow && <span>Window: <b style={{ color: T.ink }}>{w.allocationWindow.from} → {w.allocationWindow.to}</b></span>}
                </div>
                <div style={{ fontSize: 11.5, color: T.inkMuted, marginTop: 8, lineHeight: 1.5 }}>{v.note}</div>
                {w.sample && (
                  <div style={{ marginTop: 8 }}>
                    <button type="button" className="btn-link" style={{ fontSize: 11.5 }} onClick={() => setShowSample((s) => (s === w.workspaceId ? null : w.workspaceId))}>
                      {showSample === w.workspaceId ? "Hide" : "Show"} sample allocation (money stripped)
                    </button>
                    {showSample === w.workspaceId && (
                      <pre style={{ marginTop: 6, padding: 10, borderRadius: 8, background: "#f4f6f8", fontSize: 11, overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                        {JSON.stringify(w.sample, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
