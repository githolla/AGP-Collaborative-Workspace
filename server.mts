/**
 * Standalone server for non-Vercel hosts (Azure Container Apps via
 * docker-compose/Dockerfile's `prod` target). Serves the built apps/tab SPA
 * and hosts the same /api endpoints Vercel runs — api/state.ts and
 * api/mirror.ts are imported and called unmodified: their (req, res)
 * signature is a structural subset of Express's, so no adapter is needed.
 * vercel.json remains the source of truth for the Vercel deployment; this
 * file is only read when running via `tsx server.mts` (see package.json's
 * `start` script and the Dockerfile's `prod` stage).
 *
 * `dotenv/config` loads a root .env for direct/bare runs (`pnpm start`
 * outside Docker). It never overrides vars already in process.env, so it's a
 * no-op — not a conflict — when Docker/Azure inject them directly, and a
 * no-op when no .env file exists (e.g. the built image, which never bakes
 * one in per .dockerignore).
 */
import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import stateHandler from "./api/state.js";
import mirrorHandler from "./api/mirror.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(here, "apps/tab/dist");

const app = express();
app.use(express.json({ limit: "5mb" }));

// Express 5 auto-forwards a rejected promise RETURNED from a route handler to
// its error handling — but only if the handler returns that promise. Never
// discard it (e.g. with `void`): an un-returned rejection becomes an
// unhandled rejection that crashes this whole long-lived process, not just
// the one request (unlike Vercel, where each request is an isolated
// invocation). The explicit try/catch is defense in depth on top of that.
function guard(handler: (req: express.Request, res: express.Response) => Promise<void>) {
  return async (req: express.Request, res: express.Response) => {
    try {
      await handler(req, res);
    } catch (err) {
      console.error("API handler error:", err);
      if (!res.headersSent) res.status(500).json({ error: "internal error" });
    }
  };
}

app.all("/api/state", guard(stateHandler));
app.all("/api/mirror", guard(mirrorHandler));

app.use(express.static(distDir));
// SPA fallback — anything not a static asset or /api/* route gets index.html.
app.use((_req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`agp-ai-collaboration listening on :${port}`);
});
