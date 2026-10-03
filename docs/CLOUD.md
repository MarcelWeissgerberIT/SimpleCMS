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
https://cloud.example.com/api/v1/*    public API: bearer tokens + incoming webhooks, never the cookie (docs/API.md)
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
| `DATA_KEY` | exactly 32 random bytes (base64 or hex, `openssl rand -base64 32`): the master key that wraps every workspace's data key (*Tenancy & encryption at rest*); required in production, never equal to `SECRET` *(server addition)* |
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
| `AUTH_IP_LIMIT` | sign-in link requests per client IP per 15 min (default 20). **Only with `DEV_MODE=1`** (test servers sign many people in from one address); without it the server refuses to start (exit 78) *(server addition)* |
| `API_RATE_LIMIT` | public API requests per minute per token and per incoming webhook (default 120, see [`API.md`](API.md#limits)) *(server addition)* |

In development (`NODE_ENV` ≠ `production`) `DATA_DIR` defaults to `server/.data`, `PUBLIC_URL` to
`http://localhost:$PORT`, and a `SECRET` and a `DATA_KEY` are generated once into `DATA_DIR/dev-secret` and
`DATA_DIR/dev-data-key` (mode 0600). Production refuses to start without `SECRET`, `DATA_KEY` and
`PUBLIC_URL`, or with `DEV_MODE=1` (exit code 78, message names the variable and how to make it).

## Data on the server (SQLite)

```
users(id, email UNIQUE, name, created_at, last_seen_at)
sessions(id, token_hash UNIQUE, user_id, created_at, expires_at, user_agent)
login_tokens(token_hash UNIQUE, email, created_at, expires_at, used_at, redirect)
workspaces(id, name, icon, created_at, created_by, plan)
members(workspace_id, user_id, role, created_at, PRIMARY KEY(workspace_id, user_id))
invites(id, token_hash UNIQUE, workspace_id, role, email NULL, created_by, created_at, expires_at, accepted_by NULL)
documents(name PRIMARY KEY, workspace_id, data BLOB, updated_at)      -- Yjs state per document
files(id, workspace_id, name, mime, size, sha256, created_by, created_at, private_to NULL)  -- bytes in DATA_DIR/files/<ws>/<id>; private_to: v4
document_tombstones(name PRIMARY KEY, workspace_id, deleted_at, deleted_by) -- migration v2, see DELETE …/documents
api_tokens(id, workspace_id, name, scope 'read'|'write', token_hash UNIQUE, created_by, created_at, last_used_at, revoked_at)  -- v3
webhooks(id, workspace_id, database_id, secret_hash UNIQUE, created_by, created_at, rotated_at, last_delivery_at, deliveries) -- v3
idempotency(scope, key, workspace_id, status, body, created_at, PRIMARY KEY(scope, key))  -- v3, first answers kept 24 h
users.personal_space_at, workspaces.personal_of                             -- v5, the own workspace (see Tenancy)
workspace_keys(workspace_id PRIMARY KEY, wrapped BLOB, kek_id, created_at, rotated_at)  -- v6, wrapped data keys
documents.enc, files.enc (0 = plaintext from before v6, 1 = sealed)          -- v6
server_state(key PRIMARY KEY, value, updated_at)                            -- v6, the running server's heartbeat
```

Migrations v5/v6 (*Tenancy & encryption at rest* below): the own workspace of every account, one data
key per workspace (stored wrapped), and the `enc` markers — `documents.data`, file bytes
(`DATA_DIR/files/<ws>/<id>.enc`), `files.name` and `idempotency.body` are ciphertext; `files.sha256` holds a
keyed fingerprint (HMAC with the workspace's key), no plain content hash.

Migration v4 (private pages, see *Private pages* below): `files.private_to` — a file uploaded from a
private page is served to that user only until it is published.

Migration v3 (public API, [`API.md`](API.md)): API token secrets (`one_<43 chars>`) and incoming-webhook
secrets (the last path segment of the hook URL) are stored only as HMAC like every other token and shown
once. All three tables `ON DELETE CASCADE` from `workspaces`, so deleting a workspace ends its tokens and
hooks. A revoked token stays (`revoked_at`) for 90 days for the audit trail, then housekeeping removes
it; idempotency rows go after 24 h.

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
| `GET /api/me` | session | → `{ user: { id, email, name }, workspaces: [{ id, name, icon, role, personal }] }` — the caller's own workspace first |
| `GET /api/session` | – | *(server addition)* → `200 { user: {…} \| null, workspaces: [...] }` — like `/api/me`, but signed out is `user: null`, not a 401 |
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
| `PUT /api/workspaces/:id/files/:fileId` | member | raw body (≤ MAX_UPLOAD_MB), headers `x-file-name`, `content-type`, `x-file-scope: private`? → `{ id }` |
| `GET /api/workspaces/:id/files/:fileId` | viewer | bytes, `Cache-Control: private, max-age=31536000, immutable` (someone else's private file: `404 file_not_found`) |
| `POST /api/workspaces/:id/files/publish` | member | *(private pages)* `{ ids: string[] (1–500) }` → `{ published }` — the caller's private files among them become workspace files |
| `DELETE /api/workspaces/:id/documents/:pageId` | member | *(server addition)* drop the content document of a page deleted for good → `204` (`409 page_exists` while the meta document still lists the page); `?scope=private`: the caller's own private content document of that page |
| `GET /api/health` | – | `{ ok: true, version }` |
| `GET /api/dev/mailbox` | DEV_MODE only | last 50 mails `{ to, subject, text, link }` |
| `POST /api/auth/verify` | – | *(server addition)* form `token=` (the confirmation page) or JSON `{ token }` → sets cookie, `303` to `redirect` |
| `GET /api/config` | – | *(server addition)* `{ version, signup: { mode, domains? }, max_upload_mb, dev_mode, source_url }` |
| `GET /api/workspaces/:id/tokens` | admin | *(public API)* active API tokens `[{ id, name, scope, created_at, last_used_at, revoked, created_by: { id, name, email } \| null }]`, newest first |
| `POST /api/workspaces/:id/tokens` | admin | `{ name (1–80), scope: 'read'\|'write' }` → `201` token **+ `token`** (the secret, only here); `409 too_many_tokens` past 25 |
| `DELETE /api/workspaces/:id/tokens/:tokenId` | admin | revoke → `204` (`404 token_not_found`) |
| `GET /api/workspaces/:id/hooks` | admin | incoming webhooks `[{ id, database: { id, title \| null }, created_at, rotated_at, last_delivery_at, deliveries, created_by }]` (`title: null` = the database is gone) |
| `POST /api/workspaces/:id/hooks` | admin | `{ databaseId }` → `201` hook **+ `url`** (`${PUBLIC_URL}/api/v1/hooks/<secret>`, only here); `404 database_not_found`, `409 too_many_hooks` past 25 |
| `POST /api/workspaces/:id/hooks/:hookId/regenerate` | admin | new secret, the old URL stops at once → hook + `url` |
| `DELETE /api/workspaces/:id/hooks/:hookId` | admin | → `204` (`404 hook_not_found`) |
| `/api/v1/*` | bearer token | the public API — [`API.md`](API.md). Never reads or sets the session cookie; exempt from the CSRF guard (Origin / Sec-Fetch-Site / JSON content type); no CORS |

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
  `PUBLIC_URL` is https. The expiry slides on API use (re-sent at most once a day) — call `GET /api/session`
  (or `/api/me`) on boot. An invalid cookie is cleared.
- **Workspace object** (`POST` → `201`, `PATCH` → `200`, `/api/me`):
  `{ id, name, icon, role, plan, created_at, personal }`; `icon` is opaque JSON (`null`, a string ≤ 64 chars or an
  object ≤ 2 KB); `name` 1–100 chars, trimmed. At most 20 new workspaces per user per day (the own
  workspace, made by the server, does not count). `personal: true` marks the caller's own workspace
  (created at their first sign-in, *Tenancy* below) while they own it.
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
- **Session** (`GET /api/session`): `{ user: null, workspaces: [] }` when there is no (valid) session —
  an invalid cookie is cleared as everywhere — else exactly the `/api/me` body. Slides the session like
  any API call. The client boots with it, so a signed-out boot leaves no 401 in the console.
- **Page documents deleted for good** (`DELETE /api/workspaces/:id/documents/:pageId`, member+): only
  for a page the workspace's meta document no longer lists (the live copy if loaded, else the stored
  one) — a trashed page is still listed and keeps its content (`409 page_exists`). Removes the stored
  document and writes a tombstone: the name is never stored again, even when a device that still had
  the document open, or an old offline copy, syncs it later. When a page with that id comes back into
  the meta document (an undo, a restored backup keeps page ids), its next store lifts the tombstone.
  Idempotent `204`; every call is logged (`page document deleted`, workspace, page, user).
- **Error codes** — 400: `invalid_request` (zod; `details` attached), `invalid_json`, `json_required`,
  `invalid_file_id`, `invalid_page_id` · 401: `unauthenticated` · 403: `forbidden`, `owner_only`, `bad_origin`,
  `invite_email_mismatch` · 404: `not_found`, `workspace_not_found`, `member_not_found`,
  `invite_not_found`, `invite_used`, `invite_expired`, `file_not_found`, `token_not_found`, `hook_not_found`,
  `database_not_found` · 409: `owner_must_transfer`, `already_member`, `page_exists`, `too_many_tokens`,
  `too_many_hooks` · 413: `file_too_large`, `payload_too_large` (JSON > 256 KB) · 429: `rate_limited` ·
  500: `internal`. The public API adds its own (`invalid_token`, `insufficient_scope`, `invalid_value` …,
  see [`API.md`](API.md#errors)).

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
State is stored debounced (2 s, at most 10 s) and on the last disconnect and shutdown — except for a
tombstoned page document (deleted for good, see the REST notes), which is never stored again unless its
page is back in the meta document. The server writes into documents **only for the public API and
incoming webhooks** (see *Server writes* below) — everything else is the clients' job: renaming a
workspace means `PATCH /api/workspaces/:id` (what `/api/me` and invites show) **and** the meta document's
`workspace` map; mirroring members into `people` is the client's job.

Document names:

- `ws:<workspaceId>` — the workspace **meta document** (structure, properties, databases).
- `ws:<workspaceId>:p:<pageId>` — the **content** of one page (TipTap via y-prosemirror,
  `XmlFragment` named `default`).
- `ws:<workspaceId>:u:<userId>` — one member's **private meta document** (same schema; only their
  private pages, databases and rows) and `ws:<workspaceId>:u:<userId>:p:<pageId>` — the content of one of
  their private pages. Opened for that user only (see *Private pages*). User ids `[A-Za-z0-9_-]{8,64}`.

### Server writes (public API, incoming webhooks)

*(public API, [`API.md`](API.md))* Rows and pages created over `/api/v1` (and rows from incoming
webhooks), and rows changed with `PATCH /api/v1/rows/:id`, are written by the server itself:

- **How**: a Hocuspocus direct connection (`openDirectConnection(name, context)`) — it loads the
  document like a client would (or joins the loaded one), the change is **one** Y transaction that
  every connected client receives live, and disconnecting stores it at once through the normal
  `onStoreDocument` path (tombstones included). Reads use the live copy when the document is loaded,
  else the stored state. Validation happens before the transaction changes anything.
- **Order**: a new page's content document (`ws:<id>:p:<pageId>`) is written first, then its meta
  entry — so clients that see the row can load its content at once.
- **Meta entries exactly like the app's `newPageMap`**: `kind: 'page'`, `title`, `icon: null`,
  `cover: null`, `parentId` (rows: the database id), `databaseId`, `order` = the largest `order` among
  pages with the same `parentId` + 1, `trashed: false`, `trashedAt: null`, `createdAt` = `updatedAt` =
  now, `settings` = the default page settings, `plain` (the app's `plainText()` rules), `createdBy` /
  `updatedBy` = **`api:<tokenId>`** (incoming webhooks: **`hook:<hookId>`** — not account ids),
  `properties` and `comments` as Y.Maps. Property values are stored as the app stores them (option ids,
  `DateValue`, person / page id arrays …). unique_id properties take the database's `nextUniqueId`,
  which is raised by one in the same transaction (the clients' `uniqueIdRepairs` still apply).
  Two-way relations (`<id>.2way` pairs) are updated on the other rows too, with `updatedAt` /
  `updatedBy`; a sub-items parent holds one row. `PATCH` sets the changed cells, `updatedAt`,
  `updatedBy`.
- **Content documents** hold what y-prosemirror would store for the editor schema, built without
  ProseMirror on the server: `Y.XmlElement`s named after the TipTap nodes (paragraph, heading{level},
  bulletList / orderedList{start} > listItem > paragraph, taskList > taskItem{checked} > paragraph,
  blockquote, codeBlock{language}, horizontalRule, hardBreak) with marks as `Y.XmlText` formatting
  attributes (`bold`, `italic`, `strike`, `code`: `{}`; `link`: `{ href }`). Every block element carries
  a fresh `id` (UUID) — the block-id contract of the editor's UniqueID (`BLOCK_ID_TYPES`); attributes
  left out take the schema defaults.

### Meta document schema

```
Y.Map 'workspace'  name, icon (JSON), createdAt
Y.Map 'pages'      pageId → Y.Map {
                     kind, title, icon (JSON|null), cover (JSON|null), parentId, databaseId,
                     order (number), trashed, trashedAt, createdAt, updatedAt, createdBy, updatedBy,
                     settings (JSON), hidden?, template? (JSON: a template's root — Page.template)
                     properties: Y.Map propId → JSON value     (per-cell last-writer-wins)
                     comments:   Y.Map commentId → JSON thread (without `replies`)
                                       `<commentId>/r/<replyId>` → JSON reply
                     plain: string (search excerpt, ≤ 20k chars, written by the last editor)
                   }
Y.Map 'databases'  dbId → Y.Map {
                     properties:  Y.Map propId → JSON PropertyDef (incl. `order` number)
                     views:       Y.Map viewId → JSON View (incl. `order` number)
                     automations: Y.Map automationId → JSON Automation (incl. `order` number)
                     templates:   Y.Map templateId → JSON template (incl. `order` number)
                     nextUniqueId: number, inline?: boolean,
                     any other Database key (subItems, dependencies, locked …): JSON
                   }
Y.Map 'people'     personId → JSON Person   (workspace people; members are mirrored as people)
```

*(client C1 refinements, backwards compatible on read)*: comment **replies** are entries of their
own (`<commentId>/r/<replyId>`), so two people replying to one thread at the same time both keep
their reply; a thread written whole with `replies` inside is still read (merged by reply id).
`automations` and `templates` are keyed by id like properties and views — the automation engine
writes each run's status into its automation, which must not overwrite someone's concurrent edit
of another automation; a JSON array found there is read and becomes keyed on the next write.
`createdBy` / `updatedBy` are the account ids of the writing client. The `workspace` map is filled
(name, icon, createdAt) by the first member who writes after its first sync, if it is empty.

Not synced (per person, per device): `favorite`, `recent`, all `Settings` (theme, language,
**AI key**, sidebar), `contentRev`, `contentOrigin`. The client keeps them in a small local
overlay per workspace. The inbox (reminders that fired, mentions, assignments, replies, read and
archived marks — `src/app/features/inbox`) is also per device: it is derived from the synced data and
kept in IndexedDB (`one-inbox`); removing a workspace's copy from a device removes it too.

### Client rules

*(as implemented, client C1 — see `src/app/cloud/index.ts` for the module map)*

- **Boot** (`bootCloud()`): only a build served at `/` talks to a server (the GitHub Pages build never
  sends a request). Copies marked for removal (see *This browser's copies* below) go first. The tab's
  workspace is `?w=<id|local>`, else the browser's choice (localStorage `one.cloud.active`). Cloud →
  `GET api/config` + `GET api/session` (signed out = `user: null`, so no 401 in the console), the
  store is hydrated from the y-indexeddb copy (`one:ws:<id>`; a device that never saw the workspace
  waits ≤ 8 s for the server), then syncs. No connection → the local copy opens offline when this
  browser was signed in before (last session answer in localStorage `one.cloud.session`). No session
  → status `signed-out` with an empty, unsaved store. Local mode asks `api/session` only when this
  browser was signed in before or a magic link just came back (`?signed-in=1` is added to the
  sign-in `redirect`). An open workspace's own checks (socket refused, role changed) use
  `api/session` too; `user: null` there means `session-ended`.
- **This device's data** per cloud workspace (settings incl. the AI key, favourites, recent, pages
  with unconfirmed edits, the last known content of every page for instant boots and search,
  queued uploads, page documents waiting to be dropped on the server) lives in IndexedDB
  `one-cloud` / `kv`, never in a Y document. A new cloud
  workspace starts with the local workspace's settings.
- **Content refresh** (Y → `page.content`, debounced): typing in this tab goes through
  `setContent(…, 'cloud')` (history snapshots, `updatedAt`, `plain` for the others); changes from
  others arrive as remote patches (`contentOrigin: 'sync'`, `isApplyingCloudChange()`).
- **Bridge**: a `setContent` that did not come from Y is three-way merged with what Y has meanwhile
  (base = the store's previous content) and applied to the fragment as a minimal diff
  (`prosemirrorJSONToYXmlFragment` on the existing fragment, one transaction).
- **Close reasons**: `role-changed` → `/api/me`, then every closed document re-authenticates on the
  same socket (`sendToken()` + `startSync()`; *not* `detach()`+`attach()` — the CLOSE frame that
  detaching sends is queued by the server until the new authentication and then closes it again);
  `membership-revoked` / `workspace-deleted` → status `error` (+ `error`), read-only, nothing syncs;
  `session-ended` → status `signed-out`. The browser's `offline` event closes the socket on purpose
  (`online` reconnects at once).
- **Presence**: the meta document's awareness carries `{ user: { id, name, color, tone }, pageId }`;
  `pageId` follows the route (`null` on a private page). `Peer.color` is a CSS colour token (`var(--c-<tone>-text)`).
- **Pages deleted for good** (`deletePagePermanently`, empty trash, an undone create …): the client
  that deleted them asks the server to drop their content documents (`DELETE …/documents/:pageId`,
  `purge.ts`), once the meta document's change is confirmed (`hasUnsyncedChanges` false, connected).
  The queue is this device's (`one-cloud` / `purge:<ws>`), survives reloads and offline spells; a page
  that is back in the store by then is skipped, `409 page_exists` is retried 3× (2, 4, 8 s) and then
  dropped, network / 5xx / 429 retry after 15 s, other refusals drop the entry. Viewers never queue.
- **unique_id numbers** are handed out from `nextUniqueId` on the device that creates the row, so two
  people creating rows at the same moment (or a device that was offline) can hand out the same number.
  After every remote change and every local numbering (debounced 1.5 s, writable clients after the first
  sync — the same pass as the structural repairs) the client runs `uniqueIdRepairs`: per unique_id
  property, rows sorted by (value, `createdAt`, id); the first row with a number keeps it, later
  duplicates get the next numbers above the highest in use, and `nextUniqueId` is raised past the
  highest (it is never lowered). Deterministic, so every device that sees the same rows writes the same
  values. Limitation: until the devices have synced, both show the same number for a moment — the
  later-created row's number then changes once (e.g. `BUG-2` → `BUG-3`).
- **This browser's copies** (`device.ts`): `removeDeviceCopy(wsId)` and `signOut({ forgetDevice })`
  remove team workspace copies from this browser — the y-indexeddb databases (`one:ws:<id>`,
  `one:ws:<id>:p:*`), the `one-cloud` keys (`overlay` incl. the AI key, `content`, `uploads`, `purge`),
  the version history of their pages (`one-history`: `idx:<page>` + `snap:*`, except pages the local
  workspace has with the same id) and cached files that nothing else in this browser uses (the local
  workspace, history of other pages, other workspaces' cached content and pending uploads keep theirs).
  The server is not touched. Because an open workspace holds its databases, a removal is a flag
  (localStorage `one.cloud.forget`: workspace ids or `*`) that the next boot carries out before any
  cloud database opens (≤ 5 s wait; a database another tab holds is deleted when it lets go, the flag
  stays until then); the tab reloads into the local workspace, other tabs showing that workspace switch
  too (BroadcastChannel `one-cloud-forget`), and nothing writes the overlay back meanwhile.
  Unconfirmed changes in a removed copy are lost — the UI warns when `useCloudSync()` reports any.
- **Writes a team workspace refuses in the UI**: "Erase workspace" (`requestReset`) is for the local
  workspace only — in a cloud workspace Settings → Data offers *Remove this workspace's copy from this
  browser* instead, and only the owner deletes the team workspace (Settings → Team). A JSON backup
  merges into a team workspace but never replaces it (the option is shown disabled, with the reason;
  `applyBackup(…, 'replace')` throws there). Viewers can't import at all (the import dialog says so;
  `applyBackup` / `applyPlan` throw). Signing out asks first: *Also remove the team workspace copies
  from this browser* (on by default, for shared computers).
- **Viewers and databases**: with `useCloud().readOnly` the database area (`database/readonly.ts`) shows
  a VIEW ONLY plate instead of "New" and hides or disables every write: cell editors, row / property /
  view creation, header menus, column resize and reorder, row and card dragging, bulk actions, the
  filter / sort / group / properties / automations tools (filter and sort chips stay as read-outs),
  layout and structure panels, footer calculations they haven't set, calendar / timeline moves, form
  building, sharing and answers (fill mode shows the form, submitting is blocked), templates, autofill
  and the row page's property editors. Search, opening rows, exports and copying links stay. The
  model actions (`writeValue`, `deleteRows`, `duplicateRows`, autofill runs) refuse as well, and the
  binding reverts any viewer change regardless.

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

## Private pages

Notion's "Private" next to the workspace's pages: pages only I can see, in the same team workspace —
enforced by the server, not just hidden in the UI.

**Documents.** Each member has a private meta document `ws:<ws>:u:<userId>` (the meta document schema;
`workspace` and `people` stay empty) and a content document per private page
`ws:<ws>:u:<userId>:p:<pageId>`. A page is either in the workspace's meta document or in its owner's
private one — never both for long (a move writes the target first). Everything below a private page
(subpages, databases, rows, trashed ones) is private too: a new page goes where its parent / database
is; a top-level page where it was created (sidebar "PRIVATE → New page" = `createPrivatePage()`).

**Server.**
- `onAuthenticate`: a `:u:<userId>` document opens only for that user, whatever the role — the
  workspace's owner and admins included (`forbidden` otherwise, logged as `private document refused`).
  Viewers open their own private documents **read-only** (pages from before a demotion stay visible;
  they create none — the app shows no Private section to write in).
- The server never writes private documents (`collab.write` refuses them): the public API and incoming
  webhooks only ever read and write `ws:<ws>` and `ws:<ws>:p:<pageId>`, and look every id up in the
  workspace's meta document — a private page, database or row is a `404` there. Invites never touch
  documents.
- Tombstones (`DELETE …/documents/:pageId?scope=private`, the caller's own namespace only — there is no
  way to name another member's private document) and their revival check the meta document of the same
  scope: a page moved back into Private revives its private content document.
- A removed member's private documents are refused at store time (a document still open when the
  membership ends cannot come back).
- **Leaving / removal** (`DELETE …/members/:userId`): the member's private documents (+ their
  tombstones) and private files are **deleted** — the confirmations in Settings → Team say so. Invited
  again, they start with an empty Private section (an old offline copy on one of their devices may sync
  back into it — it is their own data). **Workspace deletion** removes everything (cascade).
- **Files**: `PUT …/files/:id` with `x-file-scope: private` (the app sends it for files saved while a
  private page is on screen: main view, peek or a pane) stores `private_to = <user>`; `GET` answers
  `404 file_not_found` to everyone else. `POST …/files/publish { ids }` makes the caller's own private
  files workspace files; other ids are ignored. Moving a page to Private does not make its files private
  again (others may have them already).

**Client.**
- `openCloudWorkspace` opens both meta documents (y-indexeddb `one:ws:<ws>:u:<userId>`, no awareness on
  the private one); the binding merges them into the store: pages from the private document carry
  `page.private = true` (a local marker, never a synced field). In both documents at once (another
  device's move half through): the scope the store already shows, else private. Writes go to the
  document that holds the page; new pages as above. A plain store change that would move a page between
  the two documents (`movePage` under a page of the other scope, from any UI) is refused and put back
  (toast) — that is `movePagePrivacy()`.
- **Moving** (`movePagePrivacy(pageId, toPrivate, { parentId, index })`, online only, one at a time):
  every content document of the subtree synced, then a standby provider on the target name for the
  same Y.Doc until the server confirmed the full state there (Yjs state, not JSON — devices with an old
  copy of the target name merge instead of duplicating); moving to the workspace first clears mention
  labels of pages that stay private (a cleared value is not part of the encoded state) and publishes the
  private files the pages use; then the meta entries are copied (`Y.Map.clone()`, createdBy & co. kept)
  into the target meta document and deleted from the source one, the store is updated, the content
  documents switch over (open editors keep their document and carets — the awareness moves with them)
  and the old content documents are purged (`purge.ts`, `?scope=private` for the private side, once
  both meta documents are confirmed). Ids stay. The shell asks first either way ("Everyone in
  <workspace> will see it" / "Everyone else loses access"). Another device of the same member follows
  (`rescoped` pages retarget). Entry points: sidebar drag & drop between PAGES and PRIVATE (onto a page
  or a section head), the row menu ("Move to Private" / "Move to <workspace>") and "Move to" (a
  *Private* target, private pages marked).
- **Nothing leaks by construction**: search, graph, agenda, inbox, agent, exports, backlinks and the
  version history only see the store, which never holds another member's private pages. Things that do
  leave a private page and need care:
  - *mention labels* — a page mention stores the title as `label` (and `plain`, the search excerpt every
    member gets, spells it `@label`): the "@" menu stores no label for private pages; a local edit that
    brings a labelled mention of a private page into a workspace page has the label cleared at once
    (`content.ts`), and `plain` of workspace pages is written without labels of pages the writing device
    can't see or holds privately (`privacy.ts`). Members who don't have the page see a neutral
    **"No access"** chip (`pageLink` and mention views, team workspaces only) — never the stored label.
  - *presence* — the awareness `pageId` is `null` while a private page is on screen.
  - *files* — see above; a private upload referenced by a workspace page written on the uploading
    device (copy & paste) is published automatically.
  - Deliberate sharing stays possible: copying text, a synced block whose copy sits in a workspace
    page, a share link, a JSON export.
- **Offline**: private pages are edited offline like any other (y-indexeddb per document); moving
  between scopes needs a connection (`CloudError('offline')`, nothing changes).
- This browser's copies (`device.ts`) include the private documents.
- The local workspace has no Private section (everything is local anyway).
- Limits: the server operator can read private documents like any other (privacy between members, not
  end-to-end encryption — they are encrypted at rest like everything else, see below); a member keeps the version history snapshots this device made of a page while
  it was shared; edits someone makes in the second before a page leaves the workspace can be lost.

## Tenancy & encryption at rest

Everyone who uses the cloud is in a space of their own from the first sign-in, nothing of one workspace
is reachable from another, and what a workspace contains is encrypted on disk with a key of its own.

### A workspace of one's own

- At a person's **first successful sign-in** (`GET`/`POST /api/auth/verify`, also when the account is
  created there) the server creates their own workspace: **`<name>’s space`** / **`Bereich von <name>`**
  (the sign-in's `lang`; the name, else the part of the address before the @), the person as owner,
  nobody else in it. `users.personal_space_at` records it was made — **once**: deleting it does not
  bring it back. `workspaces.personal_of` says whose it is; handing it over (ownership transfer) makes it
  an ordinary workspace. Accounts that already owned a workspace before migration v5 count as having one.
- Sharing only by explicit invitation, as before. Accepting an invitation adds the team workspace next to
  the own one. `SIGNUP` is unchanged (no account → no workspace).
- `/api/me` lists the own workspace first, with `personal: true`. It does not count towards the
  20-per-day limit.
- **Client**: back from the magic link (`?signed-in`) in a browser that never chose a workspace
  (`localStorage['one.cloud.active']` unset, no `?w=`, no `#/invite/…` to answer), `bootCloud` opens the
  own workspace at once and remembers it (no empty "create a workspace" step); otherwise the choice stands
  and the own workspace waits at the top of the switcher.

### Isolation guarantees

Each is enforced in one place; `server/test/tenancy.test.ts` sweeps them with a member of workspace A
against workspace B (and with B's ids inside A). The sweep reads the app's own route table and the MCP
tool list: **a new route or tool without an entry in its table fails the suite**, so nothing can silently
skip the check.

| Surface | Gate | Outsider gets |
|---|---|---|
| REST `/api/workspaces/:id/**` | `access()` (`routes/access.ts`): membership + role; sub-resources (members, invites, tokens, hooks, files, documents) are looked up `WHERE workspace_id = :id` | `404 workspace_not_found` (existence not revealed); B's ids in A: `404 …_not_found`, nothing of B touched |
| Public API `/api/v1`, remote MCP `/mcp` | the bearer token belongs to exactly one workspace; every id is looked up in that workspace's meta document; private documents never | `404` / tool error; listings and search show only the token's workspace |
| Incoming webhooks | the URL secret names one hook = one database of one workspace | `404 hook_not_found` |
| WebSocket `/collab` | `onAuthenticate`: the document name's workspace needs a membership; `ws:<id>:u:<userId>…` only for that user | `forbidden` (no document is loaded) |
| Files | rows keyed `(workspace_id, id)`, bytes under `files/<workspace>/`; private files for their uploader only | `404 file_not_found` |
| Invite links, magic links | the token is the credential, stored as HMAC only | `404` / error page |

### Encryption at rest — one key per workspace

**Keys.** `DATA_KEY` (master key, KEK) comes from the environment and is never stored by the server.
Every workspace has a random 256-bit **data key** (DEK), created in the transaction that creates the
workspace (older workspaces get theirs at the next start) and stored only **wrapped**: AES-256-GCM under
`DATA_KEY` with AAD `dek\n<workspace id>`, in `workspace_keys` (a wrapped key copied to another
workspace's row does not open). `kek_id` (16 hex of HMAC-SHA256(DATA_KEY, fixed label)) names the master
key without revealing it — the startup log prints it as `data_key=`. Two subkeys are derived per workspace
with HKDF-SHA256: one for AES-256-GCM, one for HMAC fingerprints. `DATA_KEY` is separate from `SECRET`:
rotating `SECRET` signs everyone out and never touches data. At start every wrapped key must be under this
`DATA_KEY` and one must open — otherwise the server refuses to start (exit 78) and says which key ids it
found and what to do.

**What is encrypted** — AES-256-GCM with the workspace's key, a fresh random 96-bit nonce for every write,
and AAD naming the place, so a ciphertext copied to another row, document, file or workspace fails to
authenticate instead of decrypting there:

| Data | At rest | AAD |
|---|---|---|
| Yjs state of every document (meta, page, private) | `documents.data` (`enc = 1`) | `doc\n<document name>` |
| File bytes | `DATA_DIR/files/<ws>/<id>.enc`, sealed while the upload streams in | `file\n<ws>\n<id>` |
| File names | `files.name` = `v1.<base64url>` | `file-name\n<ws>\n<id>` |
| File fingerprint (`ETag`) | `files.sha256` = HMAC-SHA256 of the bytes with the workspace's MAC key — no plain hash | – |
| Kept answers of create requests (24 h) | `idempotency.body` = `v1.…` | `idempotency\n<scope>\n<key>` |
| Sign-in redirect (can carry an invite token) | `login_tokens.redirect` = `v1.…`, key derived (HKDF) from the link's own token — the database alone cannot read it | `login-redirect` |

Format v1: `0x01 ‖ nonce (12) ‖ ciphertext ‖ tag (16)`; the version byte is authenticated too and lets a
later algorithm or key scheme coexist. Files use the same layout as a stream; a download is
authenticated completely (one pass over the file) before its first byte is sent, then decrypted on the way
out. A document that does not decrypt is never replaced by an empty one: it does not load (logged as
`document cannot be decrypted`), a file answers `500`.

**Not encrypted** — metadata the server needs to route, list, mail and limit: account emails and names,
workspace names and icons, memberships and roles, invitation addresses, document names (they contain page
ids), file ids, types, sizes and timestamps, API token names, hook database ids. **Secrets are not stored
at all**: sessions, magic links, the sign-in browser marker, invitations, API tokens and hook URLs are kept
only as HMAC-SHA256 keyed with `SECRET` (`server/test/encryption.test.ts` checks that none of them appears
in the database file or the log; with SMTP configured no sign-in link is logged — dev-mail mode logs them
on purpose).

**From plaintext (upgrade).** Data stored before migration v6 is marked `enc = 0` and still reads. At
every start the server creates missing keys and seals plaintext rows **before listening**; files are sealed
in the background (`<id>` → temp file → fsync → rename to `<id>.enc` → remove `<id>` → mark the row; reads
prefer `<id>.enc`, so every intermediate state serves the right bytes; shutdown stops between two files).
Idempotent and crash-safe; `node dist/cli.js encrypt-all` does the same on demand (also while the server
runs) and reports what is left. Afterwards the WAL is checkpointed and truncated and `PRAGMA secure_delete`
zeroes freed pages, so old plaintext pages do not linger in the database file.

**Crypto-shredding.** Deleting a workspace deletes its wrapped key **first** (same transaction), then its
rows (cascade); the WAL is checkpointed and `secure_delete` overwrites the key's bytes. Whatever is left
of the workspace — files not yet removed, copies of `files/`, old disk blocks, later backups — can no
longer be decrypted. Honest limit: a database backup made **before** the deletion still contains the wrapped
key and opens with `DATA_KEY` until it ages out of your backup rotation. To make such backups unreadable
too (e.g. a GDPR erasure that must reach backups), rotate `DATA_KEY` after the deletion and destroy the old
key once no backup you still need depends on it. Removing a member's private documents works as before
(they are deleted; *Private pages*).

**Rotating `DATA_KEY`** (`DATA_KEY=<old> NEW_DATA_KEY=<new> node dist/cli.js rotate-data-key`, server
stopped — a heartbeat in `server_state` makes the CLI refuse while it runs): every workspace key is
re-wrapped in one transaction; content is not re-encrypted, so it takes a moment whatever the size.
Idempotent (rows already under the new key are skipped) and all-or-nothing (a row under neither key stops
it before anything changes). Backups made before need the old key. Steps: docs/SELF_HOSTING.md.

**Threat model.** This protects data **at rest**: a lost or stolen disk or volume snapshot, a leaked
database file or backup without `DATA_KEY`, a copy of `files/`, the hoster's storage layer, and what is
left of deleted workspaces; and it stops ciphertexts from being moved between documents or workspaces. It
does **not** protect against someone who controls the running server or its memory, or who has `DATA_KEY`
together with the data (e.g. root on the host, where the key is in the environment): the server must read
content to merge Yjs updates, answer the API and MCP and fill webhook rows — that is why this is
encryption at rest and not end-to-end encryption. Members' devices keep plaintext copies (IndexedDB); the
browser-side secrets (AI key, GitHub token) are protected in the app separately. Integrity: GCM
authenticates every blob, but someone with write access to the database could still delete a row or put
back an older ciphertext of the same document (the AAD binds the place, not the time).

## Security notes

- Magic-link tokens: 15 min, single use, bound to the email; sessions 30 days sliding, revocable.
- Rate limits: auth requests 5/15 min per email and 20/15 min per IP (`AUTH_IP_LIMIT`, test servers with
  `DEV_MODE=1` only); invite creation 50/day per workspace.
- Uploads: size limit, stored outside any served path, served with `Content-Disposition: attachment`
  for non-image types and `X-Content-Type-Options: nosniff`.
- Every query is scoped by workspace membership; viewers can never write (REST or Yjs). The isolation
  sweep (`server/test/tenancy.test.ts`) fails for a new route or MCP tool that does not say how it is scoped.
- Workspace content is encrypted at rest with a key per workspace, wrapped by `DATA_KEY`; deleting a
  workspace shreds its key (*Tenancy & encryption at rest*).
- Private documents (`ws:<id>:u:<userId>…`) open for their owner only; the public API, webhooks and the
  server's own writes never touch them; private files are served to their uploader only.
- Public API: bearer tokens only on `/api/v1` (the cookie is never read there, so no CSRF surface); a
  token or hook sees only its own workspace — every page / row / database id is looked up in that
  workspace's meta document (`404` otherwise); write needs a `write` token; secrets are HMAC-stored,
  compared in constant time and never logged; per-token and per-hook rate limits (`API_RATE_LIMIT`,
  120/min) and 30 failed authentications per client IP per minute; the usual 256 KB body limit.
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
