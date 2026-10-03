# syntax=docker/dockerfile:1.7
#
# SimpleCMS One — team cloud / self-hosting image (app + server in one container).
# The build context is the REPOSITORY ROOT:
#   docker build -f server/Dockerfile -t simplecms-one .
# or, from server/: docker compose up -d --build
#
# The final image holds two folders: /app/dist (the static app build) and /app/server/dist
# (the server, bundled into a single file — no node_modules at runtime).

# ── 1. the app (landing + workspace), served from / and /app/ ─────────────────
FROM node:22-slim AS app
WORKDIR /src
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN BASE_PATH=/ npm run build

# ── 2. the server ───────────────────────────────────────────────────────────
FROM node:22-slim AS server
WORKDIR /srv
COPY server/package.json server/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY server/ ./
RUN npm run build

# ── 3. runtime ──────────────────────────────────────────────────────────────
FROM node:22-slim
# node:sqlite is stable enough for us but still prints an ExperimentalWarning on Node 22 — keep logs clean
ENV NODE_ENV=production \
    NODE_OPTIONS="--disable-warning=ExperimentalWarning --enable-source-maps" \
    PORT=8080 \
    DATA_DIR=/data \
    APP_DIR=/app/dist
WORKDIR /app/server
COPY --from=app /src/dist /app/dist
COPY --from=server /srv/dist ./dist
COPY server/package.json server/LICENSE server/README.md ./
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
# SIGTERM (docker stop) flushes open Yjs documents to SQLite before exiting.
# Admin CLI: docker compose exec one node dist/cli.js help
CMD ["node", "dist/index.js"]
