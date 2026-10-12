# syntax=docker/dockerfile:1.7
# One long-lived Node process. Debian slim (glibc) because better-sqlite3 ships glibc
# prebuilt binaries; Alpine (musl) would compile from source on every install.

FROM node:24-bookworm-slim AS build
WORKDIR /app
# Fallback toolchain for node-gyp when no prebuilt better-sqlite3 binary matches this Node.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* values are baked in at build time; pass them as build args (Railway: service variables are exposed to the build).
ARG NEXT_PUBLIC_SENTRY_DSN=""
ARG NEXT_PUBLIC_PLAUSIBLE_DOMAIN=""
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_PUBLIC_PLAUSIBLE_DOMAIN=$NEXT_PUBLIC_PLAUSIBLE_DOMAIN
RUN pnpm build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Next's own SIGTERM handler exits at once; ours in instrumentation.ts drains generations first.
ENV NEXT_MANUAL_SIG_HANDLE=true
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV DATABASE_PATH=/data/app.db
RUN mkdir -p /data && chown node:node /data
# The standalone trace includes better-sqlite3 and the `bindings` package it loads its binary
# through; copying node_modules/better-sqlite3 alone would miss `bindings`.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/src/db/migrations ./src/db/migrations
COPY --from=build --chown=node:node /app/fixtures ./fixtures
# Starts as root only to hand a runtime-mounted volume to `node`, then drops to `node` for the server.
COPY --chmod=755 scripts/docker-entrypoint.sh /usr/local/bin/chat-entrypoint
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Exec form so Node receives SIGTERM directly rather than via a shell or pnpm; the entrypoint execs it.
ENTRYPOINT ["/usr/local/bin/chat-entrypoint"]
CMD ["node", "server.js"]
