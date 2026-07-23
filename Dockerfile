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
# vercel.json's buildCommand. VITE_ENTRA_* are optional (see apps/tab's
# src/auth/entra.ts) — with neither set, SSO just reports "not configured".
FROM node:22-alpine AS build
WORKDIR /app
ENV NODE_ENV=production
ARG VITE_ENTRA_TENANT_ID
ARG VITE_ENTRA_CLIENT_ID
COPY --from=base /app ./
RUN corepack enable && corepack prepare --activate
RUN VITE_ENTRA_TENANT_ID=${VITE_ENTRA_TENANT_ID} \
	VITE_ENTRA_CLIENT_ID=${VITE_ENTRA_CLIENT_ID} \
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
