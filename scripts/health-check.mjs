#!/usr/bin/env node
/**
 * One-command connection check — "is everything wired actually reachable?"
 *
 * After the migration onto Postgres + Microsoft Graph provisioning, the app
 * depends on several live services. This probes each one using the credentials
 * in your local .env and prints a PASS/FAIL table — no app, no UI, no clicking
 * through features. Run it before testing with the team so you KNOW the backend
 * is up.
 *
 *   pnpm health          (or: node scripts/health-check.mjs)
 *
 * Exits 0 only when every REQUIRED connection passes, so it also works in CI.
 * It never prints secret values — only whether each one works. Requires Node 18+
 * (built-in fetch) and, for the live database check, the project's deps
 * installed (`pnpm install`), since it reuses the same `postgres` client the API
 * uses. Reads .env from the working directory; real env vars take precedence.
 */

import { readFileSync } from "node:fs";

// --- load .env (no dependency on dotenv) -----------------------------------
function loadEnv() {
  const env = { ...process.env };
  const candidates = [new URL(`file://${process.cwd()}/.env`), new URL("../.env", import.meta.url)];
  let raw = null;
  for (const c of candidates) {
    try { raw = readFileSync(c, "utf8"); break; } catch { /* try next */ }
  }
  if (raw) {
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      if (env[m[1]] === undefined || env[m[1]] === "") env[m[1]] = val;
    }
  }
  return env;
}

const env = loadEnv();
const TIMEOUT_MS = 12_000;

async function ping(url, opts = {}) {
  try {
    const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(TIMEOUT_MS) });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, status: 0, error: e?.name === "TimeoutError" ? "timed out" : (e?.cause?.code || e?.message || "unreachable") };
  }
}

const pass = (detail) => ({ state: "pass", detail });
const fail = (detail) => ({ state: "fail", detail });
const skip = (detail) => ({ state: "skip", detail });
const host = (u) => { try { return new URL(u).host; } catch { return u; } };

// --- checks ----------------------------------------------------------------
const checks = [];
const add = (name, required, run) => checks.push({ name, required, run });

// THE core check: a real connection to the migrated Postgres database.
add("Postgres database (SELECT 1)", true, async () => {
  const url = env.SUPABASE_DB_URL;
  if (!url) return skip("SUPABASE_DB_URL not set (the pooler connection string)");
  let postgres;
  try { ({ default: postgres } = await import("postgres")); }
  catch { return skip("`postgres` dep not installed — run `pnpm install`, then retry"); }
  let sql;
  try {
    sql = postgres(url, { connect_timeout: 10, idle_timeout: 2, max: 1, onnotice: () => {} });
    const rows = await sql`select 1 as ok`;
    return rows?.[0]?.ok === 1 ? pass(`connected to ${host(url.replace(/^postgres(ql)?:\/\/[^@]*@/, "postgresql://"))}`) : fail("connected but unexpected result");
  } catch (e) {
    const msg = e?.code || e?.message || "connection failed";
    return fail(String(msg).slice(0, 80));
  } finally {
    try { await sql?.end({ timeout: 2 }); } catch { /* ignore */ }
  }
});

add("Supabase REST API (browser path)", true, async () => {
  const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
  const key = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return skip("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set");
  const r = await ping(`${url.replace(/\/$/, "")}/rest/v1/`, { headers: { Authorization: `Bearer ${key}`, apikey: key } });
  if (r.ok || r.status === 200) return pass("PostgREST responding");
  if (r.status === 401 || r.status === 403) return fail("key rejected (401/403)");
  if (r.status === 0) return fail(`can't reach ${host(url)} (${r.error})`);
  return fail(`HTTP ${r.status}`);
});

add("Kantata OX (live project mirror)", true, async () => {
  const token = env.KANTATA_API_TOKEN;
  const base = (env.KANTATA_API_BASE || "https://api.mavenlink.com/api/v1").replace(/\/$/, "");
  if (!token) return skip("KANTATA_API_TOKEN not set");
  const r = await ping(`${base}/workspaces.json?per_page=1`, { headers: { Authorization: `Bearer ${token}` } });
  if (r.ok) return pass("token valid — workspaces reachable");
  if (r.status === 401) return fail("token rejected (401)");
  if (r.status === 0) return fail(`can't reach Kantata (${r.error})`);
  return fail(`HTTP ${r.status}`);
});

add("Microsoft Graph config (Teams/SharePoint)", true, async () => {
  const cid = env.VITE_GRAPH_CLIENT_ID, tid = env.VITE_GRAPH_TENANT_ID;
  const missing = [!cid && "VITE_GRAPH_CLIENT_ID", !tid && "VITE_GRAPH_TENANT_ID"].filter(Boolean);
  if (missing.length) return fail(`missing ${missing.join(", ")} — Teams/SharePoint provisioning can't run`);
  // A live Graph token needs an interactive sign-in, so config presence is the
  // most we can verify here; the app does the token exchange at sign-in.
  return pass("client + tenant configured (sign-in does the live token exchange)");
});

add("HubSpot (CRM mirror)", false, async () => {
  const token = env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) return skip("HUBSPOT_PRIVATE_APP_TOKEN not set (optional)");
  const r = await ping("https://api.hubapi.com/crm/v3/objects/companies?limit=1", { headers: { Authorization: `Bearer ${token}` } });
  if (r.ok) return pass("token valid — companies reachable");
  if (r.status === 401) return fail("token rejected (401)");
  if (r.status === 0) return fail(`can't reach HubSpot (${r.error})`);
  return fail(`HTTP ${r.status}`);
});

add("Anthropic key (collaboration agents)", false, async () => {
  const key = env.ANTHROPIC_API_KEY;
  if (!key) return skip("ANTHROPIC_API_KEY not set (optional)");
  return key.startsWith("sk-ant-") ? pass("key present, correct format") : fail("set but not an sk-ant- key");
});

// --- runner ----------------------------------------------------------------
const ICON = { pass: "\x1b[32m✅ PASS\x1b[0m", fail: "\x1b[31m❌ FAIL\x1b[0m", skip: "\x1b[33m➖ SKIP\x1b[0m" };
console.log("\nConnection health check — probing each service with your .env\n");

let requiredFailures = 0;
const results = await Promise.all(checks.map(async (c) => {
  const r = await c.run();
  if ((r.state === "fail" || r.state === "skip") && c.required) requiredFailures += 1;
  return { ...c, ...r };
}));

const pad = Math.max(...results.map((r) => r.name.length));
for (const r of results) {
  const req = r.required ? "" : " \x1b[90m(optional)\x1b[0m";
  console.log(`  ${ICON[r.state]}  ${r.name.padEnd(pad)}  ${r.detail}${req}`);
}

console.log("");
if (requiredFailures === 0) {
  console.log("\x1b[32mAll required connections are working.\x1b[0m The backend is reachable end to end.\n");
  process.exit(0);
} else {
  console.log(`\x1b[31m${requiredFailures} required connection${requiredFailures === 1 ? "" : "s"} not ready.\x1b[0m See the rows above — usually a missing/typo'd value in .env.\n`);
  process.exit(1);
}
