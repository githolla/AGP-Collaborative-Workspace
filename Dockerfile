# Base stage used for dependency installation. This is a pnpm workspace
# (apps/tab, services/sync, packages/roi, packages/shared) — pnpm needs every
# workspace package.json present to resolve the lockfile, so the whole repo
# is copied here rather than just the root manifest.
#
# `corepack enable` alone only installs a lazy-loading shim — it does NOT
# download pnpm itself. `corepack prepare --activate` (reading the
# `packageManager` field from the package.json just copied in) does the
# actual download, once, here at build time, baking the pnpm binary into
# this layer. Every stage below repeats this after its own COPY, because
# each `FROM node:22-alpine AS <stage>` starts a fresh filesystem — without
# it, a stage whose only pnpm invocation is its runtime CMD (dev, prod) would
# silently defer that download to every container start, making the
# container's ability to come up depend on network access to the npm
# registry at runtime, not just at build time.
FROM node:22-alpine AS base
WORKDIR /app
COPY . .
RUN corepack enable && corepack prepare --activate
RUN pnpm install --frozen-lockfile

# Development image with hot reload support
FROM node:22-alpine AS dev
WORKDIR /app
ENV NODE_ENV=development
COPY --from=base /app ./
RUN corepack enable && corepack prepare --activate
EXPOSE 3000
CMD ["pnpm", "--filter", "@agp/tab", "dev", "--host", "--port", "3000"]

# Build stage compiles the Vite frontend (apps/tab) — same command as
# vercel.json's buildCommand. Supabase auth vars are compile-time for Vite.
# Every VITE_*-prefixed var the client reads at runtime (App.tsx's
# readViteEnv, graphAuth.ts's env()) MUST be listed here as its own ARG and
# forwarded into the build RUN command below — .env's `env_file` in
# docker-compose.yml only reaches the container at RUNTIME, never this build
# stage, so a var missing from this list bakes in as permanently empty no
# matter what .env says (caught live: VITE_GRAPH_CLIENT_ID/VITE_GRAPH_TENANT_ID
# were added for B1/MSAL but never added here, so Graph never worked from
# this image despite being correctly set in .env).
FROM node:22-alpine AS build
WORKDIR /app
ENV NODE_ENV=production
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_ENABLE_MICROSOFT_LOGIN
ARG VITE_SUPABASE_REDIRECT_URI
ARG VITE_GRAPH_CLIENT_ID
ARG VITE_GRAPH_TENANT_ID
ARG VITE_GRAPH_REDIRECT_URI
ARG VITE_APP_ADMIN_EMAILS
COPY --from=base /app ./
RUN corepack enable && corepack prepare --activate
RUN VITE_SUPABASE_URL=${VITE_SUPABASE_URL} \
	VITE_SUPABASE_ANON_KEY=${VITE_SUPABASE_ANON_KEY} \
	VITE_ENABLE_MICROSOFT_LOGIN=${VITE_ENABLE_MICROSOFT_LOGIN} \
	VITE_SUPABASE_REDIRECT_URI=${VITE_SUPABASE_REDIRECT_URI} \
	VITE_GRAPH_CLIENT_ID=${VITE_GRAPH_CLIENT_ID} \
	VITE_GRAPH_TENANT_ID=${VITE_GRAPH_TENANT_ID} \
	VITE_GRAPH_REDIRECT_URI=${VITE_GRAPH_REDIRECT_URI} \
	VITE_APP_ADMIN_EMAILS=${VITE_APP_ADMIN_EMAILS} \
	pnpm --filter @agp/tab build

# Final production image used for Azure/container deployments. Runs the tsx
# binary directly (no compile step): server.mts is a small Express server
# that serves the built SPA and hosts /api/state + /api/mirror by calling
# the exact same handler functions Vercel uses — this image is a full
# replacement for Vercel, not just the static frontend half. api/*.ts is
# self-contained (no workspace-package imports), so only the root
# node_modules, api/, and server.mts need to ship — not the whole workspace.
# Invoking node_modules/.bin/tsx directly (rather than `pnpm start`) means
# this stage needs no pnpm, so corepack is dropped here.
FROM node:22-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/package.json ./package.json
COPY --from=base /app/api ./api
COPY --from=base /app/server.mts ./server.mts
COPY --from=build /app/apps/tab/dist ./apps/tab/dist
EXPOSE 3000
CMD ["node_modules/.bin/tsx", "server.mts"]
