# SimpleCMS One Cloud — architecture

Status: in development. This document is the contract between the server (`server/`) and the
client (`src/app/cloud/`). Change it first, then the code.

## Product

| | Local (default) | Team Cloud |
|---|---|---|
| Who | one person, one browser | teams |
| Where data lives | IndexedDB in the browser | the team's server (hosted in Germany, or self-hosted) **and** a copy on every device |
| Account | none | email sign-in (magic link) |
| Collaboration | tabs of one browser stay in sync | live: several people in the same page, presence, cursors |
| Offline | always | always — edits sync when the connection is back |
| Price | free, forever | cheaper than Notion (target ~4 € per person/month); self-host free |
| AI | your own Claude key | still your own key (per person, never synced) |

The app is the same build. A browser can hold one local workspace plus any number of cloud
workspaces; the workspace switcher in the sidebar header moves between them.

## Deployment shape

One process, one origin, one Docker image (`server/Dockerfile`):

```
https://cloud.example.com/            landing (static, from the app build)
https://cloud.example.com/app/        the app (static, from the app build, base "/")
https://cloud.example.com/api/*       REST (JSON, cookie session)
wss://cloud.example.com/collab        Yjs sync (Hocuspocus), cookie session
/data                                 volume: one.sqlite + files/
```

Same origin means: HttpOnly session cookie (SameSite=Lax), no CORS, no tokens in JS.
The GitHub Pages build stays local-only.

- Runtime: Node 22, TypeScript compiled with esbuild, HTTP via Hono (`@hono/node-server`),
  WebSocket via Hocuspocus 4 attached to the same HTTP server, SQLite via `node:sqlite`.
- TLS: Caddy in `docker-compose.yml` (automatic HTTPS) or any reverse proxy.
- Licence: `server/` is **AGPL-3.0**; the app stays MIT.

## Configuration (environment)

| Variable | Meaning |
|---|---|
| `PUBLIC_URL` | e.g. `https://cloud.example.com` (links in emails, cookie `Secure` when https) |
| `DATA_DIR` | default `/data` |
| `SECRET` | 32+ random bytes (hex/base64), signs tokens; required in production |
| `SMTP_URL` / `MAIL_FROM` | nodemailer transport URL and sender; without SMTP the server runs in dev-mail mode |
| `SIGNUP` | `open` (default) · `invite` (only invited emails) · `domains:acme.com,acme.de` |
| `DEV_MODE` | `1` = magic links are logged and returned by `/api/dev/mailbox` (never in production) |
| `MAX_UPLOAD_MB` | default 25 |
| `PORT` | default 8080 |

## Data on the server (SQLite)

```
users(id, email UNIQUE, name, created_at, last_seen_at)
sessions(id, token_hash UNIQUE, user_id, created_at, expires_at, user_agent)
login_tokens(token_hash UNIQUE, email, created_at, expires_at, used_at, redirect)
workspaces(id, name, icon, created_at, created_by, plan)
members(workspace_id, user_id, role, created_at, PRIMARY KEY(workspace_id, user_id))
invites(id, token_hash UNIQUE, workspace_id, role, email NULL, created_by, created_at, expires_at, accepted_by NULL)
documents(name PRIMARY KEY, workspace_id, data BLOB, updated_at)      -- Yjs state per document
files(id, workspace_id, name, mime, size, sha256, created_by, created_at)  -- bytes in DATA_DIR/files/<ws>/<id>
```

Roles: `owner` > `admin` > `member` (edit) > `viewer` (read-only connection). Exactly one owner per
workspace (transferable). Tokens (login, invite, session) are random 32 bytes, stored only as SHA-256.

## REST API (same origin, JSON, session cookie `one_session`)

All mutating requests require `Content-Type: application/json` (CSRF guard together with SameSite).

| Method & path | Auth | Body → Response |
|---|---|---|
| `POST /api/auth/request` | – | `{ email, redirect? }` → `204` (always, no account enumeration; rate-limited per email and IP) |
| `GET /api/auth/verify?token=` | – | sets cookie, `302` to `redirect` (default `/app/`), or an error page |
| `POST /api/auth/logout` | session | → `204` |
| `GET /api/me` | session | → `{ user: { id, email, name }, workspaces: [{ id, name, icon, role }] }` |
| `PATCH /api/me` | session | `{ name }` → user |
| `POST /api/workspaces` | session | `{ name }` → workspace (caller = owner) |
| `PATCH /api/workspaces/:id` | admin | `{ name?, icon? }` |
| `DELETE /api/workspaces/:id` | owner | deletes workspace, documents, files |
| `GET /api/workspaces/:id/members` | member | → `[{ user: {id,email,name}, role, created_at }]` |
| `PATCH /api/workspaces/:id/members/:userId` | admin | `{ role }` (owner transfer only by owner) |
| `DELETE /api/workspaces/:id/members/:userId` | admin, or self (leave) | |
| `POST /api/workspaces/:id/invites` | admin | `{ role, email? }` → `{ id, link, expires_at }` (email → also sent) |
| `GET /api/workspaces/:id/invites` | admin | open invites |
| `DELETE /api/workspaces/:id/invites/:inviteId` | admin | |
| `GET /api/invites/:token` | – | → `{ workspace: { name }, role, inviter }` (preview) |
| `POST /api/invites/:token/accept` | session | → `{ workspaceId }` |
| `PUT /api/workspaces/:id/files/:fileId` | member | raw body (≤ MAX_UPLOAD_MB), headers `x-file-name`, `content-type` → `{ id }` |
| `GET /api/workspaces/:id/files/:fileId` | viewer | bytes, `Cache-Control: private, max-age=31536000, immutable` |
| `GET /api/health` | – | `{ ok: true, version }` |
| `GET /api/dev/mailbox` | DEV_MODE only | last 50 mails `{ to, subject, text, link }` |

Errors: `{ error: { code, message } }` with 400/401/403/404/409/413/429.

## Realtime documents (Yjs over Hocuspocus, `wss://…/collab`)

Authentication: the WebSocket upgrade carries the session cookie; `onAuthenticate` resolves the
user and the membership for the document's workspace; viewers get `connection.readOnly = true`.
Unknown document names are rejected.

Document names:

- `ws:<workspaceId>` — the workspace **meta document** (structure, properties, databases).
- `ws:<workspaceId>:p:<pageId>` — the **content** of one page (TipTap via y-prosemirror,
  `XmlFragment` named `default`).

### Meta document schema

```
Y.Map 'workspace'  name, icon (JSON), createdAt
Y.Map 'pages'      pageId → Y.Map {
                     kind, title, icon (JSON|null), cover (JSON|null), parentId, databaseId,
                     order (number), trashed, trashedAt, createdAt, updatedAt, createdBy, updatedBy,
                     settings (JSON), hidden?,
                     properties: Y.Map propId → JSON value     (per-cell last-writer-wins)
                     comments:   Y.Map commentId → JSON thread
                     plain: string (search excerpt, ≤ 20k chars, written by the last editor)
                   }
Y.Map 'databases'  dbId → Y.Map {
                     properties: Y.Map propId → JSON PropertyDef (incl. `order` number)
                     views:      Y.Map viewId → JSON View (incl. `order` number)
                     templates:  JSON array,  automations: JSON array,
                     nextUniqueId: number, inline?: boolean
                   }
Y.Map 'people'     personId → JSON Person   (workspace people; members are mirrored as people)
```

Not synced (per person, per device): `favorite`, `recent`, all `Settings` (theme, language,
**AI key**, sidebar), `contentRev`, `contentOrigin`. The client keeps them in a small local
overlay per workspace.

### Client rules

- The Zustand store stays the UI's source of truth. A **binding** (`src/app/cloud/binding.ts`)
  mirrors store actions into the meta document (one Y transaction per action, origin `'local'`)
  and applies remote Y changes to the store (origin `'remote'`), without echo loops.
- The editor binds directly to the page's content document (`@tiptap/extension-collaboration`,
  carets via `@tiptap/extension-collaboration-caret`). `page.content` in the store is refreshed from
  the Y document (debounced) so search, export, graph, backlinks and history keep working.
- Non-editor writers (`setContent` with origin `ai`, `history`, `import`, `link`, buttons …) are
  bridged into the content document (`prosemirrorJSONToYXmlFragment` with the editor schema).
- Offline: every Y document is also persisted with `y-indexeddb`; the provider syncs on reconnect.
- Automations and webhooks fire only on the client where the change originated (`origin 'local'`).
- Files: `saveFile()` keeps writing to IndexedDB (`onefile:<id>`) and, in a cloud workspace,
  uploads in the background; `useFileUrl()` falls back to `GET /api/workspaces/:id/files/:id` and caches.
- Cross-tab merging (`store/merge.ts`) is off in cloud workspaces — Yjs handles it.

## Security notes

- Magic-link tokens: 15 min, single use, bound to the email; sessions 30 days sliding, revocable.
- Rate limits: auth requests 5/15 min per email and 20/15 min per IP; invite creation 50/day per workspace.
- Uploads: size limit, stored outside any served path, served with `Content-Disposition: attachment`
  for non-image types and `X-Content-Type-Options: nosniff`.
- Every query is scoped by workspace membership; viewers can never write (REST or Yjs).
- Security headers on all responses (CSP for the app, frame-ancestors 'none', referrer policy).

## Roadmap

1. **C1 — foundation:** server (auth, workspaces, members, invites, Yjs persistence, files), client
   binding, live editor collaboration, presence, sign-in, workspace switcher, members settings.
2. **C2 — hardening:** offline/reconnect edge cases, history in cloud workspaces, email templates,
   backups (Litestream / nightly copy), self-hosting guide, admin CLI.
3. **C3 — business:** plans and billing (Stripe), usage limits, landing/pricing page, DPA/AVV.
