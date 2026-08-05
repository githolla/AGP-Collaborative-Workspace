import { useState } from "react";
import { card, T } from "../theme.js";
import { loadMirror } from "../workspace/agpKnowledge.js";
import { classifyClientTitle } from "../workspace/liveMirror.js";
import { initialism } from "../workspace/campaignImport.js";

/**
 * Data Inspector — the tuning window into what Kantata actually sent.
 * When matching misses on a real tenant, guessing conventions is a losing
 * game; this panel shows the derived client directory, raw project titles,
 * and group names so one screenshot is enough to tune the derivation.
 * Internal-only surface: rendered by App (never reachable from the guest
 * component graph).
 */
export function DataInspector({ live, unlinkedCount = 0 }: { live: boolean; unlinkedCount?: number }) {
  // Live data + several unlinked workspaces = the exact moment this panel
  // matters. Open itself instead of hiding behind a link.
  const [open, setOpen] = useState(() => live && unlinkedCount >= 3);
  const [copied, setCopied] = useState(false);
  if (!open) {
    return (
      <button type="button" className="btn-link" style={{ fontSize: 11.5, alignSelf: "flex-start" }} onClick={() => setOpen(true)}>
        🔍 Inspect what Kantata sent (matching diagnostics)
      </button>
    );
  }

  const mirror = loadMirror();
  const groups = [...new Set(mirror.projects.map((p) => p.clientGroup).filter((g): g is string => !!g))];
  const mono: React.CSSProperties = { fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: 11, lineHeight: 1.6, color: T.inkSecondary, whiteSpace: "pre-wrap", wordBreak: "break-word" };

  // WHY N clients? Classify every title the way the derivation does, then
  // break the count down by convention — this is what exposes over-splitting
  // (verbatim project-titles becoming "clients", or the same client twice).
  const via = { colon: 0, dash: 0, verbatim: 0, internal: 0 };
  const countByClient = new Map<string, { name: string; via: string; count: number }>();
  for (const p of mirror.projects) {
    const cls = classifyClientTitle(p.title);
    via[cls.via] += 1;
    if (cls.via === "internal") continue;
    const key = cls.client.toLowerCase();
    const e = countByClient.get(key) ?? { name: cls.client, via: cls.via, count: 0 };
    e.count += 1;
    countByClient.set(key, e);
  }
  const clients = [...countByClient.values()];
  const verbatimClients = clients.filter((c) => c.via === "verbatim").sort((a, b) => a.name.localeCompare(b.name));
  const singletons = clients.filter((c) => c.count === 1);

  // Likely duplicates: a short client whose name is the acronym of a longer
  // one ("AWW" ↔ "American Water Works"). O(n²) over a few hundred — fine.
  const dupPairs: string[] = [];
  const seenPair = new Set<string>();
  for (const c of clients) {
    const key = c.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (key.length < 2 || key.length > 6) continue;
    for (const o of clients) {
      if (o === c) continue;
      if (initialism(o.name).toLowerCase() === key) {
        const pair = [c.name, o.name].sort().join(" ⇄ ");
        if (!seenPair.has(pair)) {
          seenPair.add(pair);
          dupPairs.push(`${c.name} ⇄ ${o.name}`);
        }
      }
    }
  }

  // Task→project nesting diagnostic, folded into the copyable text so it can
  // be pasted back: the one signal for "why aren't tasks grouped by project".
  const diagTasks = mirror.tasks ?? [];
  const diagWithParent = diagTasks.filter((t) => !!t.parentId).length;
  const diagWithHours = diagTasks.filter((t) => (t.estimatedHours ?? 0) > 0).length;
  const diagWithStart = diagTasks.filter((t) => !!t.startDate).length;
  const diagMilestones = mirror.milestones ?? [];
  const pct = (n: number) => (diagTasks.length ? Math.round((n / diagTasks.length) * 100) : 0);

  // Resource Center allocations — the reserved-hours grid. This is where
  // scheduled hours actually live, so its shape (and whether a reservation
  // ties to a specific task) is the pivotal diagnostic for resourcing.
  const diagAllocs = mirror.allocations ?? [];
  const diagAllocStory = diagAllocs.filter((a) => !!a.storyId).length;
  // Raw sample rides in the cached live payload (financial keys already
  // stripped server-side) — the only place the untouched field names show.
  let rawAllocSample: Record<string, unknown>[] = [];
  try {
    const wrapped = JSON.parse(window.localStorage.getItem("agp-live-mirror-v1") ?? "{}") as { payload?: { kantataAllocationsSample?: Record<string, unknown>[] } };
    rawAllocSample = wrapped.payload?.kantataAllocationsSample ?? [];
  } catch {
    // no cache / parse error — the derived rows below still tell the story
  }
  const allocFieldNames = rawAllocSample.length ? [...new Set(rawAllocSample.flatMap((r) => Object.keys(r)))] : [];

  const asText = [
    `=== TASK RESOURCING FIELDS (from Kantata) ===`,
    `tasks pulled: ${diagTasks.length}`,
    `  with a parent link:      ${diagWithParent} (${pct(diagWithParent)}%)`,
    `  with scheduled HOURS:    ${diagWithHours} (${pct(diagWithHours)}%)   <- if ~0, hours live in another Kantata field`,
    `  with a START date:       ${diagWithStart} (${pct(diagWithStart)}%)   <- needed to spread hours across the span`,
    `sample tasks (title · hours · start → due · ws):`,
    ...diagTasks.slice(0, 14).map((t) => `  ${t.title.slice(0, 38).padEnd(38)}  ·  ${t.estimatedHours ?? "—"}h  ·  ${t.startDate ?? "—"} → ${t.dueDate ?? "—"}  ·  ws=${t.projectId}`),
    ``,
    `=== RESOURCE CENTER ALLOCATIONS (reserved-hours grid — where hours actually live) ===`,
    `allocations pulled: ${diagAllocs.length}`,
    `  linked to a task (story_id):  ${diagAllocStory} (${diagAllocs.length ? Math.round((diagAllocStory / diagAllocs.length) * 100) : 0}%)   <- if ~0, hours are per person+week only, not per task`,
    `raw allocation field names Kantata sent: ${allocFieldNames.length ? allocFieldNames.join(", ") : "— (no live sample cached)"}`,
    `sample allocations (person · hours · start → end · ws · story):`,
    ...diagAllocs.slice(0, 14).map((a) => `  ${(a.userName || a.userId).slice(0, 24).padEnd(24)}  ·  ${a.hours}h  ·  ${a.startDate || "—"} → ${a.endDate || "—"}  ·  ws=${a.projectId}  ·  story=${a.storyId ?? "—"}`),
    ...(rawAllocSample.length ? [``, `raw sample rows (financial keys stripped):`, ...rawAllocSample.map((r) => `  ${JSON.stringify(r)}`)] : []),
    ``,
    `=== TASK → PROJECT NESTING ===`,
    `milestones (project level): ${diagMilestones.length}`,
    `sample milestones:`,
    ...diagMilestones.slice(0, 12).map((m) => `  ${m.title.slice(0, 44)}  ·  id=${m.id}  ·  ws=${m.projectId}`),
    ``,
    `=== WHY ${mirror.clients.length} CLIENTS from ${mirror.projects.length} projects ===`,
    `by convention: colon-prefix ${via.colon} · dash ${via.dash} · verbatim ${via.verbatim} · internal/agency ${via.internal}`,
    `distinct clients: ${clients.length} · verbatim (no "Client:" prefix) ${verbatimClients.length} · single-project ${singletons.length} · likely-duplicate pairs ${dupPairs.length}`,
    ``,
    `=== verbatim "clients" — titles with NO "Client:" prefix (${verbatimClients.length}) ===`,
    ...verbatimClients.map((c) => `${c.name}  (${c.count})`),
    ``,
    `=== likely duplicate pairs (${dupPairs.length}) ===`,
    ...dupPairs,
    ``,
    `=== all derived clients with project counts (${clients.length}) ===`,
    ...[...clients].sort((a, b) => b.count - a.count).map((c) => `${c.count}\t${c.name}${c.via === "verbatim" ? "  «verbatim»" : ""}`),
    ``,
    `=== every project title (${mirror.projects.length}) ===`,
    ...mirror.projects.map((p) => p.title),
  ].join("\n");

  return (
    <div style={{ ...card, borderColor: "#e7c66f" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: T.roi.navy }}>
          Matching diagnostics — what {live ? "the live pull" : "demo data"} contains
        </span>
        <span style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => {
              void navigator.clipboard?.writeText(asText).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2500);
              });
            }}
          >
            {copied ? "✓ Copied" : "Copy as text"}
          </button>
          <button type="button" className="btn-link" style={{ fontSize: 11.5 }} onClick={() => setOpen(false)}>
            Close
          </button>
        </span>
      </div>
      <div style={{ fontSize: 11.5, color: T.inkMuted, margin: "4px 0 10px" }}>
        Hit <strong>Copy as text</strong> (or screenshot this panel) and share it — it now shows the
        full per-client breakdown, so client matching can be tuned to your real naming in one pass.
      </div>

      {/* The headline diagnosis: where the client count actually comes from. */}
      <div style={{ background: "#faf3dc", border: "1px solid #e7c66f", borderRadius: 8, padding: "10px 12px", marginBottom: 12, fontSize: 12, color: "#6b5410", lineHeight: 1.6 }}>
        <strong>{mirror.projects.length} projects → {clients.length} clients.</strong>{" "}
        By convention: <strong>{via.colon}</strong> colon-prefix · <strong>{via.dash}</strong> dash ·{" "}
        <strong>{via.verbatim}</strong> verbatim (no “Client:” prefix){via.internal ? ` · ${via.internal} internal` : ""}.
        <div style={{ marginTop: 4 }}>
          <strong>{verbatimClients.length}</strong> verbatim “clients”, <strong>{singletons.length}</strong> with a
          single project, <strong>{dupPairs.length}</strong> likely-duplicate pairs — the usual sources of over-counting.
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
        {verbatimClients.length > 0 && (
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: T.status.critical, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
              Verbatim — no “Client:” prefix ({verbatimClients.length})
            </div>
            <div style={mono}>
              {verbatimClients.slice(0, 40).map((c) => `${c.name} (${c.count})`).join("\n") || "— none —"}
              {verbatimClients.length > 40 ? `\n… +${verbatimClients.length - 40} more` : ""}
            </div>
          </div>
        )}
        {dupPairs.length > 0 && (
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: T.status.critical, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
              Likely duplicates ({dupPairs.length})
            </div>
            <div style={mono}>
              {dupPairs.slice(0, 40).join("\n")}
              {dupPairs.length > 40 ? `\n… +${dupPairs.length - 40} more` : ""}
            </div>
          </div>
        )}
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: T.inkMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
            Derived clients ({mirror.clients.length})
          </div>
          <div style={mono}>
            {mirror.clients.slice(0, 40).map((c) => `${c.name}${c.abbreviation && c.abbreviation !== c.name ? ` [${c.abbreviation}]` : ""}`).join("\n") || "— none —"}
            {mirror.clients.length > 40 ? `\n… +${mirror.clients.length - 40} more` : ""}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: T.inkMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
            Raw project titles (first 40 of {mirror.projects.length})
          </div>
          <div style={mono}>{mirror.projects.slice(0, 40).map((p) => p.title).join("\n") || "— none —"}</div>
        </div>
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: T.inkMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
            Task → project nesting (does Kantata send parent links?)
          </div>
          {(() => {
            // The one diagnostic behind "why aren't tasks grouped by project":
            // if few tasks carry a parent id, Kantata isn't sending the nesting
            // and grouping can't work; if most do, the resolver has what it
            // needs. Milestones are the project level, so count them too.
            const tasks = mirror.tasks ?? [];
            const withParent = tasks.filter((t) => !!t.parentId).length;
            const ms = mirror.milestones ?? [];
            return (
              <div style={mono}>
                {`tasks: ${tasks.length}\n`}
                {`  with a parent link: ${withParent} (${tasks.length ? Math.round((withParent / tasks.length) * 100) : 0}%)\n`}
                {`milestones (project level): ${ms.length}\n`}
                {`\nsample (first 8 tasks):\n`}
                {tasks.slice(0, 8).map((t) => `  ${t.title.slice(0, 34).padEnd(34)}  parent=${t.parentId ?? "—"}`).join("\n") || "  — none —"}
              </div>
            );
          })()}
        </div>
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: T.inkMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
            Group names on projects ({groups.length} distinct)
          </div>
          <div style={mono}>
            {groups.slice(0, 40).join("\n") || "— none —"}
            {groups.length > 40 ? `\n… +${groups.length - 40} more` : ""}
          </div>
        </div>
      </div>
    </div>
  );
}
