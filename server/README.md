# SimpleCMS One — team cloud server

The server behind **SimpleCMS One Cloud**: email sign-in (magic links), workspaces with members and
invitations, live collaboration (Yjs over [Hocuspocus](https://hocuspocus.dev)), file storage, a public
REST API with incoming webhooks for automation tools — and it serves the app itself. One process, one origin, one SQLite file. The same Docker image runs our hosted
cloud (in Germany) and your self-hosted instance.

- **Contract** (REST API, document names, schema, security): [`docs/CLOUD.md`](../docs/CLOUD.md)
- **Public API & incoming webhooks** (n8n, Make, Zapier, scripts): [`docs/API.md`](../docs/API.md)
- **Remote MCP** for Claude Code, Claude Desktop and other MCP clients (same API tokens): [`docs/MCP.md`](../docs/MCP.md#team-server)
- **Custom agents** that run on the server around the clock (schedules, row and webhook triggers, the
  workspace's own Claude key, MCP servers): [`docs/CLOUD.md`](../docs/CLOUD.md#agents)
- **Self-hosting guide** (VPS, DNS, SMTP, backups, updates): [`docs/SELF_HOSTING.md`](../docs/SELF_HOSTING.md)
- **Licence:** AGPL-3.0 ([`LICENSE`](LICENSE)). The app in `src/` stays MIT.

```
https://cloud.example.com/          landing page   ┐
https://cloud.example.com/app/      the app        ┘ static, from the app build (APP_DIR)
https://cloud.example.com/api/*     REST (JSON, HttpOnly session cookie)
https://cloud.example.com/api/v1/*  public API (bearer tokens) + incoming webhooks — docs/API.md
https://cloud.example.com/mcp       remote MCP, Streamable HTTP (same bearer tokens) — docs/MCP.md
wss://cloud.example.com/collab      Yjs sync (Hocuspocus 4), same cookie
DATA_DIR                            one.sqlite (+ WAL) and files/<workspace>/<file>.enc
```

**Tenancy & encryption at rest** ([`docs/CLOUD.md`](../docs/CLOUD.md#tenancy--encryption-at-rest)): everyone
gets a workspace of their own at the first sign-in; every route, API call, MCP tool and document is gated by
membership (swept by `test/tenancy.test.ts`). Each workspace has its own random data key, stored only
wrapped by `DATA_KEY`; documents, files, file names and kept API answers are AES-256-GCM ciphertext on
disk. Deleting a workspace shreds its key first.

Stack: Node 22 · TypeScript bundled with esbuild · Hono on `@hono/node-server` · Hocuspocus 4 ·
`node:sqlite` (no native modules) · nodemailer · zod · the MCP TypeScript SDK (remote MCP) · the Anthropic
TypeScript SDK (custom agents).

## Run it locally

```bash
# 1. build the app once (repository root) — the server serves it at / and /app/
npm install && npm run build

# 2. the server
cd server
npm install
npm run dev          # esbuild watch + restart; DEV_MODE=1, data in server/.data
```

Open <http://localhost:8080/app/>. Without SMTP the server runs in **dev-mail mode**: sign-in links are
printed to the console and, with `DEV_MODE=1`, listed at <http://localhost:8080/api/dev/mailbox>.

Sign in with curl:

```bash
curl -c jar -b jar -X POST localhost:8080/api/auth/request \
     -H 'content-type: application/json' -d '{"email":"me@example.com"}'
LINK=$(curl -s 'localhost:8080/api/dev/mailbox?to=me@example.com' | node -pe 'JSON.parse(require("fs").readFileSync(0))[0].link')
curl -c jar -b jar -i "$LINK"            # 302 → /app/, sets one_session
curl -b jar localhost:8080/api/me
```

Working on the app with Vite instead of the built copy? Proxy the API and the socket and set
`PUBLIC_URL=http://localhost:5173` on the server so mail links go through Vite:

```ts
// vite.config.ts → server.proxy
{ '/api': 'http://localhost:8080', '/collab': { target: 'ws://localhost:8080', ws: true } }
```

## Scripts

| | |
|---|---|
| `npm run dev` | rebuild on change and restart the server (DEV_MODE=1) |
| `npm run build` | bundle to `dist/index.js` (server) and `dist/cli.js` (admin CLI) |
| `npm start` | run `dist/index.js` |
| `npm test` | build, then integration tests (`node:test`, real server processes on random ports) |
| `npm run typecheck` | `tsc --noEmit` over `src/` and `test/` |

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PUBLIC_URL` | `http://localhost:$PORT` (dev) · **required** in production | Origin for mail links; `https://` turns on `Secure` cookies and HSTS |
| `SECRET` | generated into `DATA_DIR/dev-secret` (dev) · **required** in production | 32+ random bytes, hex or base64 (`openssl rand -hex 32`). Keys the HMAC that stores tokens — changing it signs everyone out |
| `DATA_KEY` | generated into `DATA_DIR/dev-data-key` (dev) · **required** in production | Exactly 32 random bytes, base64 or hex (`openssl rand -base64 32`). Master key that wraps every workspace's data key — keep a copy apart from backups; change it only with `rotate-data-key`. Must differ from `SECRET` |
| `DATA_DIR` | `/data` (production) · `server/.data` (dev) | SQLite database and uploaded files |
| `SMTP_URL` | – | nodemailer URL, e.g. `smtps://user:pass@smtp.example.com:465`. Unset → dev-mail mode (links only in the log) |
| `MAIL_FROM` | `SimpleCMS One <no-reply@<host>>` | Sender address |
| `SIGNUP` | `open` | `open` · `invite` (only invited addresses) · `domains:acme.com,acme.de` (those domains, plus invited people). Invite-only servers let people in with a workspace invite or a **registration link** |
| `ADMIN_EMAILS` | – | Server admins, comma-separated addresses. They create registration links (app: Settings → Server) and may always create their own account |
| `DEV_MODE` | off | `1`: `/api/dev/mailbox` and logged links. Refused when `NODE_ENV=production` |
| `MAX_UPLOAD_MB` | `25` | Per-file upload limit |
| `PORT` / `HOST` | `8080` / `0.0.0.0` | Listen address (`PORT=0` picks a free port) |
| `APP_DIR` | `../dist` next to `server/` · `/app/dist` in Docker | The app build to serve |
| `TRUST_PROXY` | off | `1` behind a reverse proxy: client IP for rate limits = right-most `X-Forwarded-For` |
| `SOURCE_URL` | this repository | AGPL §13 source offer, returned by `/api/config` — point it at your fork if you change the server |
| `LOG_LEVEL` | `info` | `debug` · `info` · `warn` · `error` |
| `AUTH_IP_LIMIT` | `20` | Sign-in link requests per client IP per 15 minutes. **Test servers only** (`DEV_MODE=1`); without `DEV_MODE` the server refuses to start with it |
| `API_RATE_LIMIT` | `120` | Public API requests per minute, per token and per incoming webhook ([`docs/API.md`](../docs/API.md#limits)) |
| `NODE_ENV` | – | `production` enforces `SECRET`, `DATA_KEY` and `PUBLIC_URL` and forbids `DEV_MODE` |

## API in one screen

Full details, shapes and error codes: [`docs/CLOUD.md`](../docs/CLOUD.md#rest-api-same-origin-json-session-cookie-one_session).

```
POST   /api/auth/request                  { email, redirect?, lang?, invite?, signup? } → 204
GET    /api/auth/verify?token=            → 302 (same browser) or confirmation page
POST   /api/auth/verify                   confirmation form → 303
POST   /api/auth/logout                   → 204
GET    /api/me   PATCH /api/me            { user, workspaces (own workspace first, personal: true), server_admin? } / { name }
GET    /api/session                       { user | null, workspaces } — 200 even when signed out
POST   /api/workspaces                    { name, icon? } → 201 workspace
PATCH  /api/workspaces/:id                admin
DELETE /api/workspaces/:id                owner
GET    /api/workspaces/:id/members        any member
PATCH  /api/workspaces/:id/members/:uid   admin ({ role: 'owner' } = transfer, owner only)
DELETE /api/workspaces/:id/members/:uid   admin, or yourself (leave)
POST   /api/workspaces/:id/invites        admin { role, email?, lang?, max_uses?, expires_in_days?, domains? } → link once
POST   /api/workspaces/:id/invites/emails admin { emails (≤ 20), role, expires_in_days?, lang? } → { results }
GET    /api/workspaces/:id/invites        admin: open invites with uses
DELETE /api/workspaces/:id/invites/:iid   admin
GET    /api/invites/:token                preview, no auth (places left: the workspace's admins only)
POST   /api/invites/:token/accept         → { workspaceId, role }
GET    /api/server/signup-links           server admin (ADMIN_EMAILS): open registration links
POST   /api/server/signup-links           server admin { max_uses?, expires_in_days?, domains?, label? } → link once
DELETE /api/server/signup-links/:lid      server admin: revoke
GET    /api/signup/:token                 registration link preview, no auth
PUT    /api/workspaces/:id/files/:fid     member, raw body (x-file-name, content-type) → { id }
GET    /api/workspaces/:id/files/:fid     any member
DELETE /api/workspaces/:id/documents/:pid member: content of a page deleted for good (409 while it exists)
GET    /api/workspaces/:id/tokens         admin: API tokens          POST { name, scope } → secret once
DELETE /api/workspaces/:id/tokens/:tid    admin: revoke
GET    /api/workspaces/:id/hooks          admin: incoming webhooks   POST { databaseId } → URL once
POST   /api/workspaces/:id/hooks/:hid/regenerate · DELETE /api/workspaces/:id/hooks/:hid
GET    /api/health · GET /api/config · GET /api/dev/mailbox (DEV_MODE)
WS     /collab                            Hocuspocus; documents ws:<id> and ws:<id>:p:<pageId>

/api/v1 — Authorization: Bearer one_… (never the cookie), docs/API.md
GET    /api/v1/workspace · /databases · /databases/:id · /databases/:id/rows?limit&cursor&sort
POST   /api/v1/databases/:id/rows         write: { title?, properties?, content? } → 201 { id, url }
GET    /api/v1/rows/:id    PATCH /api/v1/rows/:id (write: { title?, properties? })
GET    /api/v1/pages/:id   POST  /api/v1/pages (write: { parentId?, title, content? })
POST   /api/v1/hooks/<secret>             incoming webhook: JSON / form / text → a row (no headers needed)

/mcp — Authorization: Bearer one_… (the same tokens), docs/MCP.md
POST   /mcp                               MCP Streamable HTTP, stateless, JSON answers; read tokens get the read tools
```

Try it (after creating a token in Settings → Team → API tokens):

```bash
curl -s localhost:8080/api/v1/databases -H "Authorization: Bearer one_…"
claude mcp add --transport http one http://localhost:8080/mcp --header "Authorization: Bearer one_…"
```

## Admin CLI

```bash
node dist/cli.js help                                # in Docker: docker compose exec one node dist/cli.js help
node dist/cli.js create-user admin@acme.com "Ada Admin"
node dist/cli.js list-users
node dist/cli.js list-workspaces
node dist/cli.js make-owner <workspaceId> admin@acme.com
node dist/cli.js revoke-sessions someone@acme.com
node dist/cli.js backup [file]                       # VACUUM INTO, default DATA_DIR/backups/ (ciphertext)
node dist/cli.js encrypt-all                         # seal what is still stored in plaintext, report the rest
DATA_KEY=<old> NEW_DATA_KEY=<new> node dist/cli.js rotate-data-key   # server stopped; re-wraps the keys only
```

## Docker

```bash
cd server
cp .env.example .env         # DOMAIN, SECRET, DATA_KEY, SMTP_URL, SIGNUP …
docker compose up -d --build # server + Caddy (automatic HTTPS for DOMAIN)
```

The image builds the app from the repository root (`BASE_PATH=/`), bundles the server into one file and
runs as the unprivileged `node` user with `/data` as a volume. See
[`docs/SELF_HOSTING.md`](../docs/SELF_HOSTING.md) for the whole walk-through.

## Layout

```
src/
  index.ts            entry: config → startServer → graceful SIGTERM (flushes Yjs documents)
  server.ts           wires db, sessions, mailer, collab and the Hono app onto one HTTP server
  app.ts              middleware (security headers, CSRF, sessions, body limit), routes, errors
  config.ts           env parsing + validation
  db/                 node:sqlite wrapper and versioned migrations
  repo.ts             all SQL (users, workspaces, members, invites, registration links, documents, files); seals / opens content
  crypto/             AES-256-GCM envelopes + streamed files (aead), workspace keys wrapped by DATA_KEY
                      (keyring, rotation), sealing data from before encryption (migrate)
  storage.ts          where file bytes live (files/<ws>/<id>.enc)
  auth/               sessions + cookies, rate limiter, signup policy (who may create an account, and why)
  routes/             auth, me + session, workspaces (+ members, invites), invites (public), files, documents,
                      integrations (API tokens + incoming webhooks of a workspace), server (registration links)
  api/                public API v1: bearer auth + idempotency, routes, incoming webhooks, the model that
                      reads / writes meta + content documents, value coercion, markdown-lite → Y.XmlElement
  collab/             Hocuspocus on /collab: upgrade gate, auth per document, persistence, disconnects,
                      read / write for the server's own changes (direct connections)
  mail/               nodemailer / dev mailbox, EN + DE templates
  http/               security headers + CSP, static app serving, server-rendered pages
  cli.ts              admin CLI
test/                 integration tests (spawn dist/index.js)
```
