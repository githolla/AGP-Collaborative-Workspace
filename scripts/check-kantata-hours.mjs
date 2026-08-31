/**
 * Diagnostic: do these Kantata workspaces have resourcing data we can pull?
 *
 * Answers two questions, per workspace:
 *   1. Resource Center allocations — reserved hours per person over a window.
 *      These are what the app's resourcing "By hours" view reads live.
 *   2. Story-level estimated hours (estimated_minutes) — the other place hours
 *      can live; if these exist, the derived weekly view can spread them.
 *
 * The Kantata token lives only in the server runtime, never in the repo — so run
 * this where the token is available:
 *
 *   KANTATA_API_TOKEN=xxxx node scripts/check-kantata-hours.mjs 45402856 45442936
 *
 * Reads nothing but Kantata; writes nothing; prints a short report. Financial
 * fields are never printed (stripped from every sample), matching the mirror.
 */

const TOKEN = process.env.KANTATA_API_TOKEN;
const BASE = (process.env.KANTATA_API_BASE || "https://api.mavenlink.com/api/v1").replace(/\/+$/, "");
const workspaceIds = process.argv.slice(2).length ? process.argv.slice(2) : ["45402856", "45442936"];

if (!TOKEN) {
  console.error("Set KANTATA_API_TOKEN (the same token the server uses) and re-run:");
  console.error("  KANTATA_API_TOKEN=xxxx node scripts/check-kantata-hours.mjs 45402856 45442936");
  process.exit(1);
}

const headers = { Authorization: `Bearer ${TOKEN}` };
const MONEY = /(cost|rate|bill|price|amount|budget|revenue|margin|charge|expense)/i;
const strip = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => !MONEY.test(k)));

/** Pull a whole Kantata collection (id→object map), following pages. */
async function pull(url, collection, cap = 4000) {
  const rows = [];
  for (let page = 1; rows.length < cap && page <= Math.ceil(cap / 200); page += 1) {
    const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}page=${page}`, { headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      if (page === 1) throw new Error(`${collection} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      break;
    }
    const json = await res.json();
    const batch = Object.values(json[collection] ?? {});
    rows.push(...batch);
    if (batch.length < 200) break;
  }
  return rows;
}

const num = (...vals) => { for (const v of vals) { const n = Number(v); if (Number.isFinite(n) && n !== 0) return n; } return 0; };
const hoursOf = (a) => {
  // Allocations express reserved time a few ways; match the mirror's tolerance.
  const mins = num(a.total_minutes, a.minutes, a.scheduled_minutes);
  if (mins) return Math.round((mins / 60) * 10) / 10;
  return num(a.total_hours, a.hours, a.scheduled_hours);
};

async function main() {
  console.log(`Kantata resourcing check · base ${BASE}\nWorkspaces: ${workspaceIds.join(", ")}\n`);

  // 1. All Resource Center allocations, then filter to the target workspaces.
  console.log("Pulling workspace_allocations …");
  let allocations = [];
  try {
    allocations = await pull(`${BASE}/workspace_allocations?per_page=200&order=updated_at:desc&include=user`, "workspace_allocations");
  } catch (e) {
    console.log(`  ⚠ allocations pull failed: ${e.message}`);
    console.log("  (If this is a 403, the token lacks resource-management scope — that alone would explain an empty hours view.)\n");
  }
  console.log(`  ${allocations.length} allocations visible to this token in total.\n`);

  for (const wsId of workspaceIds) {
    const mine = allocations.filter((a) => String(a.workspace_id) === String(wsId));
    const taskLinked = mine.filter((a) => a.story_id).length;
    const totalHours = Math.round(mine.reduce((s, a) => s + hoursOf(a), 0));
    const dates = mine.flatMap((a) => [a.start_date, a.end_date].filter(Boolean)).sort();

    // 2. Story-level estimated hours for this workspace.
    let stories = [];
    try {
      stories = await pull(`${BASE}/stories?workspace_id=${encodeURIComponent(wsId)}&per_page=200&order=updated_at:desc`, "stories");
    } catch (e) {
      console.log(`  ⚠ stories pull for ${wsId} failed: ${e.message}`);
    }
    const withEst = stories.filter((s) => num(s.estimated_minutes) > 0);
    const estHours = Math.round(withEst.reduce((s, x) => s + num(x.estimated_minutes) / 60, 0));

    console.log(`── Workspace ${wsId} ─────────────────────────────`);
    console.log(`  Resource Center allocations : ${mine.length}${mine.length ? `  (${taskLinked} task-linked, ~${totalHours}h reserved)` : ""}`);
    if (dates.length) console.log(`    window                    : ${dates[0]} → ${dates[dates.length - 1]}`);
    console.log(`  Stories                     : ${stories.length}  (${withEst.length} with estimated hours, ~${estHours}h)`);
    // Verdict.
    if (mine.length > 0) {
      console.log(`  ✅ HAS allocations — the "By hours" view should populate from these. If it's empty in the app,`);
      console.log(`     the gap is the workspace↔account match, not the data. Sample (money stripped):`);
      console.log("    ", JSON.stringify(strip(mine[0]), null, 0).slice(0, 400));
    } else if (withEst.length > 0) {
      console.log(`  ◑ No allocations, but ${withEst.length} stories carry estimated hours — the DERIVED weekly view can`);
      console.log(`     spread those. If the app shows 0h, the import isn't carrying estimated_minutes for this workspace.`);
    } else {
      console.log(`  ⚠ No allocations AND no story hours in Kantata for this workspace. There is nothing to pull —`);
      console.log(`     the task-load view is the honest picture until someone enters hours (in Kantata or the app).`);
    }
    console.log("");
  }

  console.log("Done. Share this output and I'll wire whichever path has data.");
}

main().catch((e) => { console.error("Failed:", e.message); process.exit(1); });
