import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  // Vite's default envDir is this project's own root (apps/tab), but
  // .env.example — and every var it documents — lives at the monorepo root
  // alongside the other workspace packages' env usage. Point here so a
  // single root .env is read directly, without relying on the vars already
  // being set in the process environment (which is what makes it work under
  // Docker/Compose regardless of this setting — see docker-compose.yml).
  envDir: path.resolve(here, "../.."),
  server: {
    // Dev parity with Vercel: /api/* is served by serverless functions in
    // production. Point a local mock (or `vercel dev`) at 5310 to exercise
    // shared persistence; with nothing listening the app falls back to
    // localStorage-only mode, same as an unconfigured deployment.
    proxy: {
      "/api": { target: "http://localhost:5310", changeOrigin: true },
    },
  },
});
