# One MCP — agents in your workspace

One speaks the [Model Context Protocol](https://modelcontextprotocol.io). Claude Desktop, Claude Code or any other
MCP client can search, read and write your workspace: pages, databases, rows and properties. There are two ways
in, with **one tool set** — the same names, arguments and result shapes:

| | Local bridge | Team server |
|---|---|---|
| Workspace | the local workspace (and any team workspace) **open in your browser tab** | a team workspace on your own server |
| Transport | stdio — your MCP client starts `one-mcp.mjs` on your computer | Streamable HTTP — `https://<your server>/mcp` |
| Needs | One open in a tab, *Settings → Agents · MCP* switched on | an API token (*Settings → Team → API tokens*) |
| Data path | MCP client ⇄ `one-mcp` (localhost) ⇄ your One tab ⇄ IndexedDB — nothing leaves your computer | MCP client ⇄ your server ⇄ the workspace's live documents |
| Changes | wait for your approval in the app (*Ask first*, the default) or apply directly; *read only* switch | apply at once; a **read** token only gets the read tools |

Contents: [Tools](#tools) · [Local bridge](#local-bridge) · [Team server](#team-server)

## Tools

| Tool | | What it does |
|---|---|---|
| `one_overview` | read | workspace name, today's date, the page tree, every database with its row count, the people |
| `one_search` | read | `{ query, limit? }` — titles, text and row values; ids, paths and a snippet per hit |
| `one_get_page` | read | `{ id }` or `{ title }` — title, icon, path, row properties, the content as **Markdown**, sub-pages, backlinks |
| `one_list_databases` | read | every database: id, title, path, row count, property names and types |
| `one_get_database` | read | `{ id }` — the schema (types, options, relations, read-only flags) and the views |
| `one_query_database` | read | `{ databaseId, filter?, sort?, limit?, cursor? }` — rows with friendly values, filtered and sorted, paginated |
| `one_create_page` | write | `{ title, parentId?, markdown?, icon? }` |
| `one_update_page` | write | `{ id, title?, icon?, markdown?, mode: 'append' \| 'replace' }` |
| `one_create_row` | write | `{ databaseId, title, properties?, markdown? }` |
| `one_update_row` | write | `{ id, properties }` — only what you pass changes, `null` clears |
| `one_create_property` | write | `{ databaseId, name, type, options?, relation?: { databaseId, twoWay?, reverseName? } }` |
| `one_create_database` | write | `{ title, parentId?, properties? }` — a database with a table view |
| `one_trash_page` | write | `{ id }` — to the trash, restorable in the app |

**Values** are the friendly ones of the public API ([API.md § Property values](API.md#property-values)): option
names, dates `"YYYY-MM-DD"` / `"YYYY-MM-DDTHH:mm"` (wall-clock time) or `{ start, end }`, people by email or name,
relations by row id or title, `true` / `false`, numbers, `null` to clear. A select or multi-select option that doesn't
exist yet is added to the property; everything else that doesn't fit fails the whole call and names every problem
(with the allowed values). **Filters** (`one_query_database`) are `[{ property, op, value }]`, all must hold; `op` is
`equals`, `not_equals`, `contains`, `not_contains`, `is_empty`, `is_not_empty`, `gt`, `gte`, `lt`, `lte` (numbers and
dates). **Sort** is a property name, `createdAt`, `updatedAt` or `order` (the table's order, the default); `-` in
front sorts descending (`"-Due"`). Results are JSON; failures are MCP tool errors (`isError: true`) with a message an
agent can act on.

## Local bridge

*Drives the One tab you have open — the static app at [getonecms.com](https://getonecms.com/app/), your own build,
or a team workspace open in that tab. No server, no account, no token.*

```
Claude Desktop / Claude Code ──stdio──▶ one-mcp.mjs ──ws://127.0.0.1:47321──▶ your One tab ──▶ IndexedDB
        (MCP client)                    (the bridge, on your computer)        (runs the tools)
```

The bridge is one file, [`one-mcp.mjs`](https://getonecms.com/mcp/one-mcp.mjs) (Node.js 20 or newer, no install).
The MCP client starts it; it lists the tools, and forwards every call to the tab, which runs it against the
workspace in the browser — the same code paths as the in-app agent — and answers.

### Set up

1. **Get the bridge** — *Settings → Agents · MCP → Setup* has a download button and these snippets ready to copy:

   ```bash
   curl -fsSL https://getonecms.com/mcp/one-mcp.mjs -o ~/one-mcp.mjs
   ```

2. **Add it to your client.**

   *Claude Code*

   ```bash
   claude mcp add one -- node ~/one-mcp.mjs
   ```

   *Claude Desktop* — *Settings → Developer → Edit Config* (`claude_desktop_config.json`), with the **full** path
   (Claude Desktop does not expand `~`), then restart Claude Desktop:

   ```json
   {
     "mcpServers": {
       "one": { "command": "node", "args": ["/Users/you/one-mcp.mjs"] }
     }
   }
   ```

   *Any other MCP client* (Cursor, VS Code, Windsurf, Zed, your own agent with the MCP SDK): a **stdio** server,
   command `node`, argument the path of `one-mcp.mjs`.

3. **Switch it on in One**: *Settings → Agents · MCP → Allow AI agents on this computer*. The panel's LED turns
   green — *Connected · Claude Desktop · 0 calls* — and a small **AGENT** LED appears in the status bar. Ask
   *“What is in my One workspace?”*

Without a connected tab every tool answers: "Open One (https://getonecms.com/app/) and switch on Settings → Agents ·
MCP." (a call waits up to 10 s for the tab first). The switch is **per browser**: it lives in this browser's
`localStorage`, never in the workspace, a backup or a team.

### Agent changes: Ask first · Apply directly · Read only

| Mode | Reads | Writes |
|---|---|---|
| **Ask first** (default) | answered at once | each one waits for a card in the tab (bottom right): the tool, the target and a diff-like summary — *Create row “Q4 launch” in Projects · Status: In progress*, property values *before → after*, new options, the Markdown that will be written. **Approve** (↵) or **Reject** (Esc). No answer within **2 minutes** = rejected. The agent sees the wait as progress (`notifications/progress`, *Waiting for approval in One…*) |
| **Apply directly** | answered at once | written right away |
| **Read only** | answered at once | refused: *One is set to "Agents can only read"* |

- Every call — read or write, and how it ended (OK, error, refused, expired, cancelled) — is listed in the
  **Agent activity** log of the settings tab. Applied writes have an **Undo** there (approved ones also get an Undo
  toast). Undo is careful: a page or row someone edited in the meantime goes to the trash instead of being deleted,
  values changed since are kept.
- A rejection tells the agent *The person rejected this change in One … Do not retry it*. A call that would change
  nothing (the same title, the same values) is answered without a card.
- Writes go through the workspace store like any edit: content with origin `ai`, version history snapshots before
  a replacement, undo, automations. In a **team workspace** tab they sync to everyone like your own edits; if you
  are a **viewer** there, every write is refused.

### Details

- **One tab at a time, the newest wins.** Opening a second One tab (with the switch on) moves the agent there; the
  older tab says *Another tab is connected* and offers **Use this tab**. It does not reconnect on its own, so two
  tabs never take turns.
- **Reconnects by itself**: while no bridge answers (*Waiting for an agent · start Claude Desktop*) the tab retries —
  every few seconds, every 30 s after two minutes, at once when the tab comes back into view. Chrome logs each
  refused attempt in the developer console (*WebSocket connection … failed*); that is expected while no MCP client
  runs.
- **Port**: 47321. Another port: `ONE_MCP_PORT` for the bridge and the same number in *Settings → Agents · MCP →
  Port* (the copied snippets then include it: `"env": { "ONE_MCP_PORT": "47400" }`, `claude mcp add one -e
  ONE_MCP_PORT=47400 -- node ~/one-mcp.mjs`).
- **Two MCP clients** (say Claude Desktop *and* Claude Code) each start a bridge; only the first gets the port. The
  second answers every call with *Another One MCP bridge is already using port 47321 …* and takes the port over when
  the first one quits. Use one client at a time, or give the second one another port (and switch the tab to it).
- **Logs** go to stderr (Claude Desktop: *Settings → Developer → Open Logs Folder*, `mcp-server-one.log`); stdout is
  the MCP channel. `ONE_MCP_QUIET=1` silences them. `node one-mcp.mjs --help` prints the setup, `--version` the
  version.
- **Environment**: `ONE_MCP_PORT` (47321) · `ONE_ORIGINS` (extra allowed page origins, comma-separated;
  `http://host:*` = any port) · `ONE_MCP_TIMEOUT_MS` (30000: how long the tab may take for a read) ·
  `ONE_MCP_WAIT_MS` (10000: how long a call waits for a tab) · `ONE_MCP_QUIET=1`.
- **Local extras** over the team server: computed values (formulas, rollups) come as the app shows them; icons can
  also be `asset:<name>` / `lucide:<IconName>`; `one_overview` names the page open in the tab.

### Security model

The bridge is a door into your workspace, so it only opens for One:

- **Loopback only.** The WebSocket listens on `127.0.0.1` — nothing on your network can reach it.
- **Origin allowlist.** Browsers send the page's `Origin` with every WebSocket handshake and pages cannot forge it.
  The bridge accepts `https://getonecms.com`, `http://localhost:<any port>` and `http://127.0.0.1:<any port>`
  (development and self-hosted builds) plus `ONE_ORIGINS`; everything else — other websites, sandboxed frames and
  `file://` (`Origin: null`), clients without an Origin — gets `403` before any data flows.
- **Host check against DNS rebinding.** A site that points its own domain at 127.0.0.1 still sends its own `Host`;
  only `127.0.0.1`, `localhost` and `[::1]` with the bridge's port are accepted.
- **Versioned handshake.** The tab must speak the subprotocol `one-mcp.v1` and introduce itself within 5 s; a
  connection that never does cannot push the real tab out. Plain HTTP gets `426` and nothing else (no CORS headers,
  no information). Messages are capped at 16 MB; dead connections are dropped after a missed ping.
- **The tab decides.** The bridge never sees your workspace except the answers to the calls the agent makes. Writes
  need your approval by default, *Read only* refuses them, viewers of a team workspace can't write, and the switch
  is off until you turn it on — per browser.
- **Nothing leaves your computer** through One: client ⇄ bridge is stdio, bridge ⇄ tab is loopback, the workspace
  stays in IndexedDB. What the agent reads goes to the agent — and so to the AI provider behind your MCP client.
  Text inside pages is treated as content, not instructions (the server instructions say so), but an agent that
  reads untrusted pages can still be misled: keep *Ask first* on for anything you didn't write yourself.
- **Limits of the model.** Any program running as you on this computer could also listen on the port or speak to
  the tab — but such a program can already read your browser's files. Allowed `localhost` origins include other
  local development servers you run; set the port to something unusual if that worries you.

### Browsers

The app is an `https` page talking to `ws://127.0.0.1`. What that means per browser:

| Browser | |
|---|---|
| **Chrome, Edge** (Chromium) | Works. Loopback addresses are *potentially trustworthy*, so `ws://127.0.0.1` from an `https` page is not mixed content. Checked with Chromium 141: an `https` page connects and gets the bridge's `welcome` — also with the page forced into the *public* address space and the Local Network Access checks switched on by flag. Chrome 142+ ships **Local Network Access**: a site that reaches *apps and services on this device* may have to ask once — choose **Allow**. While the browser reports the permission as pending the tab says so; if it was **blocked**, the tab shows *Blocked by the browser* and the way back (the icon left of the address → site settings → allow local network access, then *Retry now*). There is no server opt-in header for this — the old *Private Network Access* preflight headers never applied to WebSockets — so the bridge sends none. |
| **Firefox** | Expected to work: Firefox also treats `127.0.0.1` / `localhost` as potentially trustworthy (not tested here). |
| **Safari** | May refuse `ws://` from an `https` page as mixed content even for loopback (not tested here). The constructor then throws and the tab shows *This browser does not let a secure (https) page talk to the bridge* — use Chrome, Edge or Firefox for agents, or a local build (`npm run dev` / `vite preview` on http://localhost). |

Self-hosted builds served from `http://localhost` / `http://127.0.0.1` have none of these restrictions.

### The tab protocol

For other implementations: JSON text frames, subprotocol `one-mcp.v1`, defined in
[`src/app/features/mcp/contract.ts`](../src/app/features/mcp/contract.ts) (shared by the bridge and the app).

| Direction | Message |
|---|---|
| tab → bridge | `{ type: "hello", app: "one", version, workspace: { name, kind, readOnly }, mode }` — first message; then `status` with the same fields when they change |
| bridge → tab | `{ type: "welcome", bridge, client: { name, version } \| null }` — the MCP client from its `initialize` (later changes: `client`) |
| bridge → tab | `{ type: "call", id, tool, args }` |
| tab → bridge | `{ type: "result", id, result }` · `{ type: "error", id, error }` · `{ type: "pending", id, timeoutMs }` (waiting for approval: the bridge extends the deadline) |
| bridge → tab | `{ type: "cancel", id }` (the client cancelled, or the bridge gave up) · `{ type: "replaced" }` + close `4001` (a newer tab took over) |

The bridge's own code is in [`mcp/`](../mcp) (`npm --prefix mcp install`, `npm run build:mcp` rebuilds
`public/mcp/one-mcp.mjs`, which is committed — the Pages build just copies it; `npm run test:mcp` runs its tests).

## Team server

A team server (`server/`, [CLOUD.md](CLOUD.md)) has a **remote MCP endpoint** at `https://<your server>/mcp`. It works
with the API tokens of the [public API](API.md#tokens) — no extra setup on the server.

### Connect

1. An owner or admin creates a token in **Settings → Team → API tokens**: scope **write** lets the agent change
   things, **read** gives it only the six read tools (the write tools are not even listed).
2. Add the server to your MCP client with the token as a bearer header.

**Claude Code**

```bash
claude mcp add --transport http one https://team.example.com/mcp \
  --header "Authorization: Bearer one_…"
```

**Clients that take a URL and headers** (Cursor, Windsurf, VS Code, your own agent with the MCP SDK):

```json
{ "mcpServers": { "one": { "url": "https://team.example.com/mcp", "headers": { "Authorization": "Bearer one_…" } } } }
```

**Claude Desktop** starts local servers only from its config file; bridge the remote endpoint with
[`mcp-remote`](https://www.npmjs.com/package/mcp-remote):

```json
{
  "mcpServers": {
    "one-team": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://team.example.com/mcp", "--header", "Authorization:${ONE_TOKEN}"],
      "env": { "ONE_TOKEN": "Bearer one_…" }
    }
  }
}
```

Check it with curl — an `initialize` answer means the token and the endpoint are fine:

```bash
curl -s https://team.example.com/mcp \
  -H "Authorization: Bearer one_…" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
```

### What it sees and does

- **One workspace per token** — the token's. Every id is looked up in that workspace's meta document; anything else
  (another workspace, a page in the trash) is "not found".
- **Private pages never**: another member's — and your own — *Private* pages live in documents the server never
  reads for the API or MCP. A link or @-mention of a page the endpoint can't see shows as "(No access)" in the
  Markdown, never with its stored title.
- **Live**: every write goes into the workspace's Yjs documents through the realtime server (like the
  [public API](API.md#how-writes-work)), so everyone who has the workspace open sees it at once. Written pages and rows
  carry `createdBy` / `updatedBy` `api:<tokenId>`.
- **Content out** is Markdown: headings, paragraphs with bold / italic / strike / code / links, bulleted, numbered and
  to-do lists (nested), quotes, code blocks, dividers, tables, toggles (`<details>`), callouts (`> [!NOTE]`), math,
  Mermaid, images, files, bookmarks, embeds, page links (`[Title](#/p/<id>)`), @-mentions, database blocks, tabs,
  synced blocks and meeting notes (with transcript). Comments never leave; buttons show their label only.
- **Content in** is the API's [markdown-lite](API.md#content-markdown-lite) (headings, paragraphs, lists, to-dos,
  quotes, code, dividers, marks, links); other Markdown stays text. `one_update_page` appends after the last block or,
  with `mode: "replace"`, replaces everything — editors open on that page follow along live.
- **Beyond the REST API**: `one_update_page` (content, title, icon), `one_create_database`, `one_create_property`
  (options, two-way relations, unique ids numbered for the existing rows, the property shown in every view), new
  select options from `one_create_row` / `one_update_row`, and `one_trash_page` — a **soft delete** exactly like the
  app's (`trashed: true`, `trashedAt`): the page (with everything below it) is in the app's trash and can be restored.
  A **locked** database takes rows and values but no new properties or options.
- **Backlinks** in `one_get_page` come from the stored content of every page (page links, @-mentions, `#/p/` links,
  database blocks). Content is stored a few seconds after typing stops (at most 10 s), so a link made in that moment
  may be missing.
- **No approval step**: the token is the permission. Give an agent a **read** token when it should only look.

### Protocol

| | |
|---|---|
| Endpoint | `POST https://<your server>/mcp` — the [Streamable HTTP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#streamable-http) transport |
| Sessions | none (stateless): every request carries the token and is answered on its own, so restarts and several server processes don't break a client |
| Answers | `application/json` (no event stream); notifications get `202` |
| `GET` / `DELETE /mcp` | `405` — there is no server-to-client stream and no session to end |
| Auth | `Authorization: Bearer one_…` only; missing or unknown → `401` with `WWW-Authenticate: Bearer`. The session cookie is never read |
| Origin | requests that carry an `Origin` header of another site are refused (`403`); MCP clients don't send one |
| CORS | none: MCP clients are programs, not web pages. A browser-based client needs a server-side proxy (the MCP Inspector's proxy works) |
| Limits | shared with `/api/v1`: 120 requests per minute per token (`API_RATE_LIMIT`; every JSON-RPC request counts — a client's start is 2–3 of them), 30 failed authentications per minute per client address, 256 KB per request, 100 rows per query answer |
| Reverse proxy | nothing to configure (no streaming); Caddy from `docker-compose.yml` works as it is |
| Logs | tool calls that change something are logged (`mcp page updated` …) with the token id — never the token |

The static file `/mcp/one-mcp.mjs` (the local bridge, part of the app build) is served next to the endpoint as usual.
