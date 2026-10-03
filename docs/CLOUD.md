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
| `HOST` | default `0.0.0.0` *(server addition)* |
| `APP_DIR` | the app build to serve; default `../dist` next to `server/`, `/app/dist` in Docker *(server addition)* |
| `TRUST_PROXY` | `1` behind a reverse proxy: client IP for rate limits = right-most `X-Forwarded-For` (compose sets it) *(server addition)* |
| `SOURCE_URL` | AGPL §13 source offer, returned by `GET /api/config` *(server addition)* |
| `LOG_LEVEL` | `debug` · `info` (default) · `warn` · `error` *(server addition)* |

In development (`NODE_ENV` ≠ `production`) `DATA_DIR` defaults to `server/.data`, `PUBLIC_URL` to
`http://localhost:$PORT`, and a `SECRET` is generated once into `DATA_DIR/dev-secret`. Production refuses to
start without `SECRET` and `PUBLIC_URL`, or with `DEV_MODE=1` (exit code 78, message names the variable).

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

As implemented (migration v1, additive to the above): tokens are stored as HMAC-SHA256 keyed with
`SECRET` (a leaked database alone cannot be replayed or forged; rotating `SECRET` signs everyone out);
`sessions.last_used_at`; `login_tokens.browser_hash, invite_hash, lang` (see sign-in below);
`invites.accepted_at`; `files` primary key is `(workspace_id, id)` because file ids are chosen by the
client; a partial unique index enforces at most one `owner` per workspace; all child tables
`ON DELETE CASCADE` from `workspaces`. Timestamps are integer ms in SQLite and ISO strings in the API.

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
| `POST /api/auth/verify` | – | *(server addition)* form `token=` (the confirmation page) or JSON `{ token }` → sets cookie, `303` to `redirect` |
| `GET /api/config` | – | *(server addition)* `{ version, signup: { mode, domains? }, max_upload_mb, dev_mode, source_url }` |

Errors: `{ error: { code, message } }` with 400/401/403/404/409/413/429.

### As implemented (server v0.1) — details the client needs

- **Sign-in request** also takes `lang?: 'en'|'de'` (mail language; else `Accept-Language`) and
  `invite?: <invite token>` (lets a new address through `SIGNUP=invite`/`domains`). Over the limit it
  answers `429 rate_limited` with `Retry-After` (seconds). With `SIGNUP` restrictions an address that may
  not sign up still gets `204` but no mail.
- **Magic link** (`GET /api/auth/verify`): the request sets a short-lived `one_login` cookie
  (path `/api/auth`). Opened in that same browser the link signs in at once (`302`). Opened elsewhere
  (other device, or a mail security scanner pre-fetching links) it shows a *Confirm sign-in* page whose
  button POSTs to `/api/auth/verify` — so scanners cannot burn the single-use token. Invalid/used/expired
  links render an HTML error page (`400`); a new account refused by `SIGNUP` renders `403`. `redirect` must
  be a same-origin path (`/…`, not `//…`), else `/app/`; fragments are kept (`/app/#/invite/<token>`).
- **Session cookie** `one_session`: HttpOnly, SameSite=Lax, Path=/, Max-Age 30 days, `Secure` when
  `PUBLIC_URL` is https. The expiry slides on API use (re-sent at most once a day) — call `GET /api/me` on
  boot. An invalid cookie is cleared.
- **Workspace object** (`POST` → `201`, `PATCH` → `200`, `/api/me`):
  `{ id, name, icon, role, plan, created_at }`; `icon` is opaque JSON (`null`, a string ≤ 64 chars or an
  object ≤ 2 KB); `name` 1–100 chars, trimmed. At most 20 new workspaces per user per day.
- **Members**: `created_at` is the membership date. `PATCH … { role: 'owner' }` transfers ownership (owner
  only; the old owner becomes `admin`). The owner's own role can only change through a transfer
  (`409 owner_must_transfer`); the owner cannot leave or be removed (same code). Non-members get `404
  workspace_not_found` for every workspace route (existence is not revealed), members below the needed role
  `403 forbidden`.
- **Invites**: `POST` → `201 { id, link, expires_at, role, email, email_sent? }`; roles `admin|member|viewer`
  (default `member`); valid 7 days; **single use**; `lang?` picks the mail language. The **link is
  `${PUBLIC_URL}/app/#/invite/<token>`** — the app's router handles `#/invite/<token>`: preview with
  `GET /api/invites/:token`, sign in if needed (pass `invite` and `redirect`), then accept. The token is
  stored hashed, so the link is only returned once. `GET …/invites` →
  `[{ id, role, email, created_at, expires_at, inviter: { id, name, email } | null }]`.
  `409 already_member` when inviting the email of a member.
- **Invite preview** → `{ workspace: { name, icon }, role, inviter: { name, email } | null, email, expires_at }`.
  **Accept** → `{ workspaceId, role }`; an email-bound invite needs that email (`403 invite_email_mismatch`);
  accepting while already a member keeps the role and leaves the invite unused.
- **Files**: `PUT` is exempt from the JSON rule (it carries the file's type; PUT always needs a CORS
  preflight, which the server never grants) but cross-origin `Origin` is still rejected. `x-file-name` is
  **URI-encoded** (`encodeURIComponent`). Ids: `[A-Za-z0-9_-]{1,64}`. Answers `201 { id }`, or `200 { id }`
  when that id already exists (uploads are idempotent; content for an id never changes). Check
  `max_upload_mb` from `/api/config` before uploading. `GET` sends `ETag` (sha256) and honours
  `If-None-Match`; raster images (`png|jpeg|gif|webp|avif`) are `inline`, everything else (SVG too)
  `attachment`; viewers may download.
- **CSRF**: besides `Content-Type: application/json` (on POST/PATCH/DELETE, also without a body), a
  request whose `Origin` (or `Sec-Fetch-Site`) is not this site is refused with `403 bad_origin`. Don't
  send API requests with `referrerPolicy: 'no-referrer'` — browsers then send `Origin: null`.
- **Dev mailbox**: newest first, optional `?to=<email>`, entries also carry `created_at`.
- **Error codes** — 400: `invalid_request` (zod; `details` attached), `invalid_json`, `json_required`,
  `invalid_file_id` · 401: `unauthenticated` · 403: `forbidden`, `owner_only`, `bad_origin`,
  `invite_email_mismatch` · 404: `not_found`, `workspace_not_found`, `member_not_found`,
  `invite_not_found`, `invite_used`, `invite_expired`, `file_not_found` · 409: `owner_must_transfer`,
  `already_member` · 413: `file_too_large`, `payload_too_large` (JSON > 256 KB) · 429: `rate_limited` ·
  500: `internal`.

## Realtime documents (Yjs over Hocuspocus, `wss://…/collab`)

Authentication: the WebSocket upgrade carries the session cookie; `onAuthenticate` resolves the
user and the membership for the document's workspace; viewers get `connection.readOnly = true`.
Unknown document names are rejected.

As implemented: one socket per browser tab can carry many documents (`HocuspocusProviderWebsocket`
shared by several `HocuspocusProvider`s, each `attach()`ed); no `token` is needed (the cookie is used).
The upgrade is refused with `401` without a valid session, `403` when `Origin` is another site, `404` on
any path but `/collab`. Per document: `authenticated` → `scope` is `'read-write'` or `'readonly'`
(viewers — make the editor read-only; their updates are not applied); `authenticationFailed` → `reason`
is `'unauthenticated' | 'forbidden' | 'invalid-document'`. The server closes a document connection
(provider `close` event, `event.reason`) with `'membership-revoked'` (removed or left), `'role-changed'`
(viewer ↔ writer: re-attach to get the new scope), `'workspace-deleted'` or `'session-ended'` (logout,
revoked or expired session). Name ids: workspace `[A-Za-z0-9_-]{8,64}`, page `[A-Za-z0-9_-]{1,64}`.
State is stored debounced (2 s, at most 10 s) and on the last disconnect and shutdown. The server never
writes into documents itself: renaming a workspace means `PATCH /api/workspaces/:id` (what `/api/me` and
invites show) **and** the meta document's `workspace` map; mirroring members into `people` is the client's job.

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
- **Service worker** (`public/sw.js`): it must not touch `/api/` and `/collab` — today its
  stale-while-revalidate branch would cache same-origin `GET /api/me`, member lists and files. Return early
  for those paths (file downloads may be cached by `useFileUrl()` instead).
- Development against a local server: proxy `/api` and `/collab` (`ws: true`) from Vite to
  `http://localhost:8080` and start the server with `PUBLIC_URL=http://localhost:5173`, so mail links go
  through Vite; `GET /api/dev/mailbox?to=<email>` returns the link.

## Security notes

- Magic-link tokens: 15 min, single use, bound to the email; sessions 30 days sliding, revocable.
- Rate limits: auth requests 5/15 min per email and 20/15 min per IP; invite creation 50/day per workspace.
- Uploads: size limit, stored outside any served path, served with `Content-Disposition: attachment`
  for non-image types and `X-Content-Type-Options: nosniff`.
- Every query is scoped by workspace membership; viewers can never write (REST or Yjs).
- Security headers on all responses (CSP for the app, frame-ancestors 'none', referrer policy).
- As implemented: the app CSP allows scripts/styles/fonts from the origin only (`'unsafe-inline'` for
  styles), `connect-src 'self' wss://<host> https:` — `https:` because the browser calls
  api.anthropic.com with the user's own key **and** posts automation webhooks to user-chosen endpoints —
  and `frame-src https:` for page embeds. API responses get `default-src 'none'; sandbox`; downloads a
  sandboxed CSP. Also `nosniff`, `X-Frame-Options: DENY`, COOP `same-origin`, a restrictive
  `Permissions-Policy`, HSTS when https. The WebSocket upgrade checks `Origin` (cross-site WebSocket
  hijacking). Magic links are bound to the requesting browser (see sign-in) so link scanners cannot use
  them up.

## Roadmap

1. **C1 — foundation:** server (auth, workspaces, members, invites, Yjs persistence, files), client
   binding, live editor collaboration, presence, sign-in, workspace switcher, members settings.
2. **C2 — hardening:** offline/reconnect edge cases, history in cloud workspaces, email templates,
   backups (Litestream / nightly copy), self-hosting guide, admin CLI.
3. **C3 — business:** plans and billing (Stripe), usage limits, landing/pricing page, DPA/AVV.
