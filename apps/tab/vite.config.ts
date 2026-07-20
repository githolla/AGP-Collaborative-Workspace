import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
