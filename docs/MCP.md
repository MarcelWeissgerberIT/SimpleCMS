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

*Drives the One tab you have open — the static app at [getonecms.com](https://getonecms.com/app/) or your own build.*
<!-- This section belongs to the local bridge (mcp/, src/app/features/mcp/). -->

```bash
curl -fsSL https://getonecms.com/mcp/one-mcp.mjs -o ~/one-mcp.mjs
claude mcp add one -- node ~/one-mcp.mjs          # Claude Code
```

Claude Desktop (`claude_desktop_config.json`):

```json
{ "mcpServers": { "one": { "command": "node", "args": ["/ABSOLUTE/PATH/one-mcp.mjs"] } } }
```

Then open One and switch on **Settings → Agents · MCP**. Without a connected tab every tool answers: "Open One
(https://getonecms.com/app/) and switch on Settings → Agents · MCP."

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
