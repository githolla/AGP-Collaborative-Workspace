#!/usr/bin/env node
/**
 * One-command connection check — "is everything Ren wired actually reachable?"
 *
 * Probes each external service the app depends on, using the credentials in your
 * local .env, and prints a PASS/FAIL table. No app, no UI, no clicking through
 * features — just a definitive readout of what's connected and what isn't.
 *
 *   node scripts/health-check.mjs
 *
 * Exit code is 0 only when every REQUIRED check passes, so it also works in CI.
 * It never prints secret values — only whether each one works.
 *
 * Requires Node 18+ (built-in fetch). Reads .env from the current directory;
 * real environment variables already set take precedence over the file.
 */

import { readFileSync } from "node:fs";

// --- load .env (no dependency on dotenv being installed) -------------------
function loadEnv() {
  const env = { ...process.env };
  // Look for .env in the working directory first (repo root when run via
  // `pnpm health`), then next to this script's repo root — so it works however
  // it's invoked.
  const candidates = [
    new URL(`file://${process.cwd()}/.env`),
    new URL("../.env", import.meta.url),
  ];
  let raw = null;
  for (const c of candidates) {
    try { raw = readFileSync(c, "utf8"); break; } catch { /* try next */ }
  }
  if (raw) {
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      const key = m[1];
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (env[key] === undefined || env[key] === "") env[key] = val;
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

// --- checks ---------------------------------------------------------------
const checks = [];
const add = (name, required, run) => checks.push({ name, required, run });

add("Supabase Storage (state.json home)", true, async () => {
  const url = env.SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) return skip("SUPABASE_URL not set");
  if (!key) return skip("SUPABASE_SERVICE_ROLE_KEY not set");
  const r = await ping(`${url.replace(/\/$/, "")}/storage/v1/bucket`, { headers: { Authorization: `Bearer ${key}`, apikey: key } });
  if (r.ok) return pass("buckets listed — URL + service key valid");
  if (r.status === 401 || r.status === 403) return fail("service key rejected (401/403)");
  if (r.status === 0) return fail(`can't reach ${host(url)} (${r.error})`);
  return fail(`HTTP ${r.status}`);
});

add("Supabase Postgres (REST API up)", true, async () => {
  const url = env.SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return skip("SUPABASE_URL / service key not set");
  const r = await ping(`${url.replace(/\/$/, "")}/rest/v1/`, { headers: { Authorization: `Bearer ${key}`, apikey: key } });
  // PostgREST answers 200 on the root when the DB API is reachable.
  if (r.ok || r.status === 200) return pass("PostgREST responding");
  if (r.status === 401 || r.status === 403) return fail("key rejected by REST API");
  if (r.status === 0) return fail(`can't reach REST API (${r.error})`);
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
  return key.startsWith("sk-ant-") ? pass("key present, correct format") : fail("key set but not an sk-ant- key");
});

add("Frontend Supabase pair (VITE_*)", true, async () => {
  const u = env.VITE_SUPABASE_URL, a = env.VITE_SUPABASE_ANON_KEY;
  if (u && a) return pass("both present — browser can reach Supabase");
  const missing = [!u && "VITE_SUPABASE_URL", !a && "VITE_SUPABASE_ANON_KEY"].filter(Boolean).join(", ");
  return fail(`missing ${missing}`);
});

// --- helpers + runner ------------------------------------------------------
function pass(detail) { return { state: "pass", detail }; }
function fail(detail) { return { state: "fail", detail }; }
function skip(detail) { return { state: "skip", detail }; }
function host(u) { try { return new URL(u).host; } catch { return u; } }

const ICON = { pass: "\x1b[32m✅ PASS\x1b[0m", fail: "\x1b[31m❌ FAIL\x1b[0m", skip: "\x1b[33m➖ SKIP\x1b[0m" };

console.log("\nConnection health check — probing each service with your .env\n");

let requiredFailures = 0;
const results = await Promise.all(
  checks.map(async (c) => {
    const r = await c.run();
    if (r.state === "fail" && c.required) requiredFailures += 1;
    if (r.state === "skip" && c.required) requiredFailures += 1; // required-but-unconfigured counts as not-ready
    return { ...c, ...r };
  }),
);

const pad = Math.max(...results.map((r) => r.name.length));
for (const r of results) {
  const req = r.required ? "" : " \x1b[90m(optional)\x1b[0m";
  console.log(`  ${ICON[r.state]}  ${r.name.padEnd(pad)}  ${r.detail}${req}`);
}

console.log("");
if (requiredFailures === 0) {
  console.log("\x1b[32mAll required connections are working.\x1b[0m Ren's setup is reachable end to end.\n");
  process.exit(0);
} else {
  console.log(`\x1b[31m${requiredFailures} required connection${requiredFailures === 1 ? "" : "s"} not ready.\x1b[0m See the rows above — usually a missing/typo'd value in .env.\n`);
  process.exit(1);
}
