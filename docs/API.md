# SimpleCMS One — public API & incoming webhooks

Automation tools (n8n, Make, Zapier, curl, your own scripts) can read and write a **team workspace**:
a REST API with bearer tokens, and incoming webhooks that turn any POST into a database row. It is
the other half of One's *outgoing* webhooks (database automations, button blocks).

- The API lives on the team-cloud server (`server/`, see [`CLOUD.md`](CLOUD.md)). The local,
  browser-only workspace has no server and therefore no API.
- Everything the API writes reaches everybody who has the workspace open **live** — the server writes
  into the workspace's Yjs documents exactly like the app does (see *How writes work* below).
- Base URL: `https://<your server>/api/v1` — e.g. `https://cloud.example.com/api/v1`.
- AI agents: the same tokens open the server's **remote MCP endpoint** (`https://<your server>/mcp`) for Claude
  Code, Claude Desktop and other MCP clients — see [`MCP.md`](MCP.md#team-server).

Contents: [Tokens](#tokens) · [Conventions](#conventions) · [Endpoints](#endpoints) ·
[Values](#property-values) · [Content](#content-markdown-lite) · [Idempotency](#idempotency) ·
[Incoming webhooks](#incoming-webhooks) · [Custom agents](#custom-agents) · [Errors](#errors) · [Limits](#limits) ·
[Recipes](#recipes-n8n-make-zapier) · [How writes work](#how-writes-work)

## Tokens

Owners and admins create tokens in **Workspace settings → Automation → API tokens** (members and viewers see a note
instead). A token belongs to **one workspace** and has a scope:

| Scope | May |
|---|---|
| `read` | every `GET` endpoint |
| `write` | everything `read` may, plus creating rows and pages and changing rows |

The secret looks like `one_` + 43 characters and is shown **once**, when it is created; the server
keeps only an HMAC fingerprint (keyed with the server's `SECRET`) and can never show it again. Lost
it? Revoke it and create a new one. Tokens belong to the workspace, not to the person who made them:
they keep working when that person leaves — revoke them in the same place. Deleting the workspace
deletes its tokens and webhooks.

Send it as a bearer token — the only way the API accepts:

```bash
curl https://cloud.example.com/api/v1/workspace \
  -H "Authorization: Bearer one_Xy…"
```

- `/api/v1` never reads the session cookie, so a browser that is signed in to One gives a page on
  another site nothing to ride on, and the API needs no CSRF checks (cross-origin server calls are
  fine). There are no CORS headers: call the API from servers and automation tools, not from
  browser JavaScript on other sites.
- The list in the settings shows who made each token, when, and when it was last used (updated at
  most once a minute).
- **Worker tokens are not API tokens.** A cloud coding worker's token (`onew_…`, written into
  `one-worker-cloud.mjs`, [`CODING.md`](CODING.md#cloud-worker)) belongs to one member in one workspace and opens
  only the coding relay and `GET /api/coding/worker` — `/api/v1` and `/mcp` refuse it (`401 invalid_token`), and an
  API token never opens the relay.

## Conventions

- JSON in, JSON out (`Content-Type: application/json` is assumed for request bodies even when a
  tool sends something else). Bodies are at most **256 KB**.
- Page, row and database ids are strings (`[A-Za-z0-9_-]`). Every id you send is checked against the token's own workspace:
  a page, row or database of any other workspace is simply `404`.
- Timestamps (`createdAt`, `updatedAt`) are ISO 8601 in UTC.
- `url` fields open the page in the app, in that workspace:
  `https://cloud.example.com/app/?w=<workspaceId>#/p/<pageId>` (`?w=` picks the workspace even when
  the browser last used another one).
- Pages and rows in the trash (or below a page in the trash) don't exist for the API.
- Neither do templates (the template gallery's page subtrees, root marked `template`):
  they are blueprints, not workspace content.
- Errors: `{ "error": { "code": "…", "message": "…", "details"?: … } }` — see [Errors](#errors).

## Endpoints

| Method & path | Scope | |
|---|---|---|
| `GET /api/v1/workspace` | read | the token's workspace |
| `GET /api/v1/databases` | read | every database with its schema |
| `GET /api/v1/databases/:id` | read | one database's schema |
| `GET /api/v1/databases/:id/rows` | read | rows, paginated |
| `POST /api/v1/databases/:id/rows` | write | create a row |
| `GET /api/v1/rows/:id` | read | one row |
| `PATCH /api/v1/rows/:id` | write | change a row's title / properties |
| `GET /api/v1/pages/:id` | read | a page (or row, or database page) with its text |
| `POST /api/v1/pages` | write | create a page |
| `GET` / `POST /api/v1/hooks/:secret` | the URL | [incoming webhooks](#incoming-webhooks) |
| `POST /api/v1/agents/:agentId/hook/:secret` | the URL | [starts a custom agent](#webhook-trigger) |

### `GET /api/v1/workspace`

```json
{ "id": "9DjVlXCMBAZ6BHkt", "name": "Northwind Ops", "url": "https://cloud.example.com/app/?w=9DjVlXCMBAZ6BHkt", "scope": "write" }
```

### `GET /api/v1/databases` · `GET /api/v1/databases/:id`

A list (sorted by title) of, or one:

```json
{
  "id": "13jc38xiqxpa",
  "title": "Leads",
  "url": "https://cloud.example.com/app/?w=9DjVlXCMBAZ6BHkt#/p/13jc38xiqxpa",
  "parentId": null,
  "createdAt": "2026-10-03T13:40:12.004Z",
  "updatedAt": "2026-10-03T13:40:12.004Z",
  "properties": [
    { "id": "kq2…", "name": "Name", "type": "title", "readOnly": false },
    { "id": "s81…", "name": "Status", "type": "status", "readOnly": false,
      "options": [{ "id": "o1", "name": "Not started", "color": "gray", "group": "todo" }, …] },
    { "id": "r7…", "name": "Company", "type": "relation", "readOnly": false, "relationDatabaseId": "db…" },
    { "id": "u3…", "name": "Key", "type": "unique_id", "readOnly": true, "prefix": "LEAD" },
    { "id": "f9…", "name": "Score", "type": "formula", "readOnly": true }
  ]
}
```

`readOnly` properties (formula, rollup, created time, last edited time, unique id) can't be set.
Extra fields per type: `options` (select, multi-select, status), `relationDatabaseId` (relation),
`prefix` (unique id), `max` (rating). `key: true` marks the database's **key** (a text, number or url
property, at most one): its values are unique per row — empty allowed, text compared trimmed, numbers
numerically — and a write that gives it a value another row holds is a `409 duplicate_key` (`details.errors`:
`property`, `value`, `rowId` of the row holding it). `onlyByHand: true` marks a property people fill in by
hand: agents and MCP clients never write it (the API itself may).

### `GET /api/v1/databases/:id/rows`

Query: `limit` (1–100, default 50), `cursor` (the `next` of the previous page), `sort`:
`order` (default — the table's own order), `createdAt`, `-createdAt` (newest first — what polling
triggers want), `updatedAt`, `-updatedAt`.

```json
{
  "rows": [
    {
      "id": "aGqsHWOL555kRALH",
      "databaseId": "13jc38xiqxpa",
      "title": "Ada Lovelace",
      "url": "https://cloud.example.com/app/?w=9DjVlXCMBAZ6BHkt#/p/aGqsHWOL555kRALH",
      "createdAt": "2026-10-03T13:41:02.511Z",
      "updatedAt": "2026-10-03T13:45:40.120Z",
      "properties": {
        "Status": "In progress",
        "Tags": ["Hot"],
        "Due": { "start": "2026-10-05T14:30", "end": null },
        "Owner": [{ "id": "u_8f…", "name": "Mia Member", "email": "mia@example.com" }],
        "Company": [{ "id": "c1…", "title": "Analytical Engines" }],
        "Key": "LEAD-42",
        "Created": "2026-10-03T13:41:02.511Z"
      }
    }
  ],
  "next": "WyJvcmRlciIsMywxNz…"
}
```

`next` is `null` on the last page. Cursors are stable while rows are added or changed and belong to
one `sort` (another sort is `400 invalid_cursor`). Properties are keyed by **name**; the title is
the `title` field; formula and rollup values are computed by the app and are not part of the
output.

### `POST /api/v1/databases/:id/rows`

```json
{
  "title": "Ada Lovelace",
  "properties": { "Status": "in progress", "Tags": ["Hot"], "Owner": "mia@example.com", "Due": "2026-10-05" },
  "content": "## Call notes\n\nWants the **team plan**.\n\n- [ ] send quote"
}
```

All fields are optional. Properties are matched by **id or name** (case-insensitive); a title given
as a property (`"Name": "…"`) counts as the title. Values: see [Property values](#property-values).
`content` is [markdown-lite](#content-markdown-lite). Unknown properties and values that don't fit
are a `422` that lists **every** problem (nothing is written):

```json
{ "error": { "code": "invalid_value", "message": "Status: unknown option \"Blocked\"",
  "details": { "errors": [{ "property": "Status", "message": "Status: unknown option \"Blocked\"",
  "allowed": ["Not started", "In progress", "Done"] }] } } }
```

→ `201 { "id": "aGqsHWOL555kRALH", "url": "https://cloud.example.com/app/?w=…#/p/aGqsHWOL555kRALH" }`

The row is added after the last row; unique ids are numbered from the database's counter like a row
made in the app; two-way relations are updated on the other side too. Send an
[`Idempotency-Key`](#idempotency) to make retries safe.

### `GET /api/v1/rows/:id`

One row, in the same shape as in the list. A page that is not a database row is `404 row_not_found`.

### `PATCH /api/v1/rows/:id`

```json
{ "title": "Ada King", "properties": { "Status": "Done", "Tags": null } }
```

Only what you send changes (`null` clears a value). Validation is the same as for creating. →
`200` with the updated row. Content is not changed by `PATCH`.

### `GET /api/v1/pages/:id`

Any page: a page, a database row or a database page.

```json
{
  "id": "aGqsHWOL555kRALH",
  "kind": "row",
  "title": "Ada Lovelace",
  "url": "https://cloud.example.com/app/?w=…#/p/aGqsHWOL555kRALH",
  "parentId": "13jc38xiqxpa",
  "databaseId": "13jc38xiqxpa",
  "createdAt": "2026-10-03T13:41:02.511Z",
  "updatedAt": "2026-10-03T13:45:40.120Z",
  "properties": { "Status": "In progress" },
  "text": "Call notes\nWants the team plan.\nsend quote"
}
```

`kind` is `page`, `row` or `database`; `properties` only for rows. `text` is the page's plain text,
read from its live content (one line per block, like the app's search excerpt). A task block (the app's
`workItem`) reads as its title line and its notes; its fields (status, due date, people, links) are not part
of the API yet.

### `POST /api/v1/pages`

```json
{ "parentId": "doc-1", "title": "Release notes", "content": "Version **1.0**\n\n- fast\n- small" }
```

`parentId` is optional (no parent = a top-level page in the sidebar); it must be a page of this
workspace that is not a database (`422 parent_is_database` — create rows instead). The page goes
after its last sibling. → `201 { "id", "url" }`. `Idempotency-Key` works here too.

## Property values

| Type | Send | Get back |
|---|---|---|
| title | `title` field, or the title property's name | `title` field |
| text, url, email, phone | a string (numbers are turned into text) | string or `null` |
| number | a number, or a numeric string (`"3,5"` works) | number or `null` |
| rating | a whole number 0 … max | number or `null` |
| checkbox | `true` / `false`, or `"yes"`, `"no"`, `"1"`, `"0"`, `"on"`, `"off"`, `"true"`, `"false"` | boolean |
| select, status | an option **name** (case-insensitive) or option id | option name or `null` |
| multi_select | an array of names / ids, or `"A, B"` | array of names |
| date | `"2026-10-05"`, `"2026-10-05T14:30"`, or `{ "start", "end" }` | `{ "start", "end" }` or `null` |
| person | a member's **email** or a person id (one, or an array) | `[{ id, name, email }]` |
| relation | row ids of the related database (one, or an array) | `[{ id, title }]` |
| files | http(s) URLs (one, or an array) | array of strings |
| unique_id | read-only | `"PREFIX-12"` or `12` |
| created_time, last_edited_time | read-only | ISO timestamp |
| formula, rollup | read-only | not in the output (computed in the app) |

- `null` (or `""`) clears a value.
- Dates are **wall-clock times without a time zone**, like in the app: seconds and a zone suffix
  (`Z`, `+02:00`) are dropped — send local time. An end before the start is a `422`. A reminder set
  on a date in the app stays with it when `PATCH` moves the date (`null` clears both).
- Unknown option names are a `422` that lists the allowed names; the API never invents options.
- A **locked** database (the app's "Lock database") takes new rows and row changes like any other —
  the lock fixes properties, options and views, and the API changes none of those (like the app).
- A sub-items parent relation holds one row; a row can't be its own parent.

## Content (markdown-lite)

`content` (rows and pages, on create) understands the common blocks and marks, and writes them as the
editor's own blocks:

| Markdown | Block |
|---|---|
| `# `, `## `, `### ` | heading (levels below 3 become 3) |
| a paragraph; a single line break inside it | paragraph; line break |
| `- `, `* `, `+ ` (indent 2 spaces to nest) | bulleted list |
| `1. ` / `1) ` | numbered list (keeps the first number) |
| `- [ ] ` / `- [x] ` | to-do list |
| `> ` | quote (may contain lists) |
| ```` ```lang ```` … ```` ``` ```` | code block with language |
| `---` | divider |
| `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, `[text](https://…)` | marks (links: http, https, mailto, `#/p/<id>`) |

Anything else stays as text. Content is limited to 200 000 characters.

## Idempotency

`POST /databases/:id/rows`, `POST /pages` and incoming webhooks take an **`Idempotency-Key`**
header (1–255 characters; webhooks also read a `deliveryId` field in the body — One's own outgoing
webhooks send one). The first answer is kept for **24 hours**; a repeat with the same key gets the
same body back with **`200`** and `Idempotent-Replayed: true`, and creates nothing. A repeat that
arrives while the first is still running waits for it. Keys are per token (per webhook for hooks).
Failed requests (4xx/5xx) are not remembered, so a retry after a fix goes through.

## Incoming webhooks

**Workspace settings → Automation → Incoming webhooks**: pick a database, *Create webhook*, copy the URL. The URL
holds the secret (`https://cloud.example.com/api/v1/hooks/<43 characters>`), so a tool can post to
it without any headers. Like a token it is shown **once**; *New URL* makes a new one (the old one
stops at once), *Delete* removes it. Treat the URL like a password: whoever has it can add rows to that
database (and nothing else); the server never logs it, but a reverse proxy that logs request paths
would. The list shows the database, when the hook was made, how many
rows it delivered and when it last did.

```bash
curl -X POST https://cloud.example.com/api/v1/hooks/<secret> \
  -H "Content-Type: application/json" \
  -d '{"name": "Ada Lovelace", "email": "ada@example.com", "stage": "New", "company": "Analytical Engines"}'
```

→ `201 { "id", "url" }`. Each POST creates one row:

- **Bodies**: a JSON object; form fields (`application/x-www-form-urlencoded` or
  `multipart/form-data`; repeated fields become lists, uploaded files are noted by name, not stored);
  or plain text (the first line is the title, all of it the content). JSON sent as `text/plain` is
  read as JSON (that is how One's own automations retry when a browser blocks the first attempt).
- **Mapping is lenient**: keys match property names (or ids) case-insensitively. `title` or `name`
  (unless a property has that name) is the title — else the first string value, else
  `Webhook <date>`. `content` (unless a property has that name) is markdown-lite content.
- **Nothing is lost**: keys without a property, read-only properties and values that don't fit
  (an unknown option, text in a number field …) are appended to the row's content as a
  `key: value` list. Nested objects are kept as JSON text.
- **One's own payloads** (`"source": "simplecms-one"` — automations, buttons) map their `row` /
  `page` (title, properties by name, markdown); the envelope (event, timestamp …) is left out. So an
  automation in one workspace can feed a database in another.
- **Idempotency**: `Idempotency-Key` header or `deliveryId` field, as above.
- `GET` on the URL answers `{ database: { id, title }, properties: [...] }` — to check a URL, or to
  let a tool learn the fields.
- Errors: `404 hook_not_found` (deleted or regenerated), `404 database_not_found` (the database was
  deleted or is in the trash), `400 invalid_payload` / `invalid_json`, `413`, `429`.

## Custom agents

Agents with `runner: 'server'` run on the team-cloud server around the clock (architecture, triggers,
security: [`CLOUD.md`](CLOUD.md#agents)). Their definitions are workspace data (the meta document's
`agents` map, written by the app); these endpoints configure the server runtime, start runs and read them.
They are **cookie routes** of the app (`/api/workspaces/:id/…`, JSON, the CSRF rules of `CLOUD.md`) —
except the webhook trigger, whose URL carries its secret.

| Method & path | Who | |
|---|---|---|
| `GET /api/workspaces/:id/agent-runtime` | members, admins, owner | `{ claudeKey: { set, last4? }, mcpServers: [{ name, url, token: { set, last4? } }], enabled, available, updated_at }` |
| `PUT /api/workspaces/:id/agent-runtime` | admins, owner | `{ claudeKey?: string \| null, mcpServers?: [{ name, url, token? }], enabled?: boolean }` → as `GET` |
| `GET /api/workspaces/:id/agent-runs?agentId=&limit=` | every member | `AgentRun[]`, newest first (`limit` 1–200, default 50) |
| `POST /api/workspaces/:id/agents/:agentId/run` | members, admins, owner | `202 { runId }` |
| `POST /api/workspaces/:id/agent-runs/:runId/apply` | members, admins, owner | `{ changeIds?: string[] }` → the run (staged changes applied on the server) |
| `POST /api/workspaces/:id/agent-runs/:runId/resolve` | members, admins, owner | `{ applied: string[], discarded: string[] }` → the run (the app applied them itself) |
| `GET /api/workspaces/:id/agents/:agentId/hook` | members, admins, owner | `{ set, created_at, last_delivery_at, deliveries }` |
| `POST /api/workspaces/:id/agents/:agentId/hook` | admins, owner | `201 { url, created_at }` — a new secret (shown once; the old URL stops working) |
| `DELETE /api/workspaces/:id/agents/:agentId/hook` | admins, owner | `204` |

**Runtime.** `claudeKey` (20–400 characters, no spaces): a string sets it, `null` removes it, leaving it
out keeps it. `mcpServers` replaces the list (at most 12; `name` = lower-case letters, digits, `-`, `_`,
at most 32 characters; `url` = a public `https://` address — Anthropic connects to it): a server sent
without `token` keeps its token only while its URL stays on the same origin; `token: null` or `""`
removes it. `last4` is shown for secrets of 16 characters or more. Secrets are sealed with the
workspace's key and never returned; `available: false` means the server runs with `AGENTS=off`.

**Runs** (`AgentRun`): `{ id, agentId, runner: 'server', trigger: { type, detail? }, startedAt, endedAt?,
status: 'running' | 'ok' | 'staged' | 'error' | 'budget' | 'skipped', summary, steps: [{ kind: 'tool' |
'mcp' | 'note', label, state: 'ok' | 'err' }], staged?: StagedChange[], applied?, usage?: { input, output,
cacheRead, usd }, error? }` — timestamps in ms. `trigger.detail`: who started it, the schedule and slot,
the rows (`2 rows: <id>, <id>`) or the webhook body. `staged` are the app's `StagedChange`s (`id`, `n`,
`kind` create_page · append · create_row · update_row · rename, `status` pending · applied · discarded ·
failed, `pageId`, `parentId?`, `databaseId?`, `title?`, `beforeTitle?`, `markdown?`, `props?: [{ propId,
name, type, before, after, intent: { kind: 'value', value } | { kind: 'options', names }, newOptions? }]`,
`dependsOn?`, `error?`). `apply` writes the pending changes (all, or `changeIds`) in review order,
attributed `agent:<agentId>`; a change whose staged parent page was not applied fails. A run whose
changes are all settled turns from `staged` to `ok`.

### Webhook trigger

`POST /api/v1/agents/:agentId/hook/:secret` starts an agent whose trigger is `webhook` (switched on, the
runtime set up): `202 { runId }`. Any content type; the body (at most **16 KB**; JSON is pretty-printed)
is handed to the agent as **data** — inside `<webhook_body>` tags, with the rule that it is never an
instruction. 10 deliveries per agent per minute (then `429`), at most 20 runs waiting per agent
(`429 queue_full`). Errors: `404 hook_not_found` (unknown, regenerated or deleted URL — counted like a
bad token), `409 runtime_not_ready`, `409 agent_unavailable` (switched off, not a webhook agent, gone),
`413 payload_too_large`, `503 agents_off`.

## Errors

| Status | Codes |
|---|---|
| 400 | `invalid_request` (with `details`), `invalid_json`, `invalid_payload`, `invalid_cursor`, `invalid_idempotency_key` |
| 401 | `unauthenticated` (no token), `invalid_token` (unknown or revoked) — with `WWW-Authenticate: Bearer` |
| 403 | `insufficient_scope` (a read token writing) |
| 404 | `not_found`, `database_not_found`, `row_not_found`, `page_not_found`, `parent_not_found`, `hook_not_found`, `agent_not_found`, `run_not_found` |
| 409 | `duplicate_key` (a row holds that key already), `page_exists`; agents: `runtime_not_ready`, `agent_not_server`, `agent_unavailable`, `queue_full`, `run_running`, `run_busy` |
| 413 | `payload_too_large` (over 256 KB; agent webhooks: 16 KB) |
| 422 | `invalid_value` (`details.errors`: `property`, `message`, `allowed?`), `parent_is_database` |
| 429 | `rate_limited`, with `Retry-After` (seconds) |
| 500 | `internal` |
| 503 | `agents_off` (the server runs with `AGENTS=off`) |

## Limits

| | |
|---|---|
| Requests per token | 120 per minute (`API_RATE_LIMIT` on the server) |
| Requests per incoming webhook | 120 per minute (same setting) |
| Failed authentications (bad tokens, unknown hook URLs) per client address | 30 per minute, then `429` |
| Request body | 256 KB |
| Rows per page | 100 |
| Tokens / incoming webhooks per workspace | 25 each |
| Idempotency window | 24 hours |
| Agent webhook deliveries | 10 per agent per minute, body ≤ 16 KB, ≤ 20 runs waiting per agent |
| Agent runs | 25 rounds of tool calls, the agent's `maxRunUsd` (0.01–50 $), 2 at a time per workspace |

**Fetch media (members in the app, not the public API).** `POST /api/workspaces/:id/files/fetch { url, kind?,
private? }` lets a signed-in member's app have the server download one https image / video / audio file (an MCP
server's result the browser may not load) into the workspace's files. It takes the session cookie, never an API
token; the SSRF guard, type / magic-number checks and limits (20 per minute, 300 per day per member) are in
[`CLOUD.md`](CLOUD.md#security-notes).

## Recipes (n8n, Make, Zapier)

**curl — list databases, then add a row**

```bash
TOKEN=one_…
curl -s https://cloud.example.com/api/v1/databases -H "Authorization: Bearer $TOKEN"
curl -X POST https://cloud.example.com/api/v1/databases/<databaseId>/rows \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-1001" \
  -d '{"title": "Order 1001", "properties": {"Status": "New", "Amount": 129.5}}'
```

**n8n**

- *Write*: an **HTTP Request** node, method `POST`, URL `…/api/v1/databases/<id>/rows`,
  Authentication *Generic Credential Type → Header Auth* with name `Authorization` and value
  `Bearer one_…`, body *JSON* `{ "title": "{{ $json.name }}", "properties": { "Status": "New" } }`.
  Or, without credentials, post to an incoming-webhook URL.
- *Read / trigger*: a **Schedule Trigger** + HTTP Request `GET …/rows?sort=-createdAt&limit=20`,
  then *Remove Duplicates* on `id` (or keep the last seen `createdAt`).
- *From One to n8n*: database automations and button blocks already post to an n8n **Webhook** node
  (their payload carries a `deliveryId` to dedupe on).

**Make**

- *Write*: **HTTP → Make a request**, `POST` to the incoming-webhook URL with *Body type: Raw,
  JSON* — or to `/api/v1/databases/<id>/rows` with a header `Authorization: Bearer one_…`.
- *Read*: **HTTP → Make a request** `GET …/rows?sort=-createdAt`, *Parse response: yes*, then an
  iterator over `rows`.

**Zapier**

- *Write*: action **Webhooks by Zapier → POST**, URL = the incoming-webhook URL, *Payload type:
  JSON*, map your fields to property names (unmatched ones land in the row's content). For updates:
  **Webhooks by Zapier → Custom Request**, `PATCH …/api/v1/rows/<id>`, header
  `Authorization: Bearer one_…`.
- *Trigger*: **Webhooks by Zapier → Retrieve Poll**, URL `…/api/v1/databases/<id>/rows?sort=-createdAt`,
  header `Authorization: Bearer one_…`, *Key*: `rows` — Zapier dedupes on `id`.

## How writes work

The workspace lives in Yjs documents on the server (see [`CLOUD.md`](CLOUD.md)). The API changes
them the way a member's app would — through a server-side connection to the realtime layer, in one
transaction: everybody who has the workspace open sees the row appear, and the change is stored at
once. A row's content is written first (so it arrives with its content), then its entry in the
workspace's meta document. Rows and pages written by the API carry `createdBy` / `updatedBy`
`api:<tokenId>` (incoming webhooks: `hook:<hookId>`, custom agents on the server: `agent:<agentId>`).
`created_by` / `last_edited_by` values show them as `{ kind: 'api' | 'webhook' | 'agent', id }`.

Not over the API (yet): deleting or moving pages, changing content after creation, database schemas,
comments, files (except as URLs in a files property). Dependency loops between rows are not checked.
