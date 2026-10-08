# One MCP — agents in your workspace

One speaks the [Model Context Protocol](https://modelcontextprotocol.io). Claude Desktop, Claude Code or any other
MCP client can search, read and write your workspace — pages, databases, rows and properties — and tidy it up:
move, reshape, trash and restore. There are two ways in, with **one tool set** — the same names, arguments and
result shapes:

| | Local bridge | Team server |
|---|---|---|
| Workspace | the local workspace and any team workspace **open in your browser tabs** — several at once, each by its id | the token's team workspace on your own server — only that one |
| Transport | stdio — your MCP client starts `one-mcp.mjs` on your computer | Streamable HTTP — `https://<your server>/mcp` |
| Needs | One open in a tab, *Settings → Agents · MCP* switched on | an API token (*Workspace settings → Automation → API tokens*) |
| Data path | MCP client ⇄ `one-mcp` (localhost) ⇄ your One tab ⇄ IndexedDB — nothing leaves your computer | MCP client ⇄ your server ⇄ the workspace's live documents |
| Changes | wait for your approval in the app (*Ask first*, the default) or apply directly; *read only* switch | apply at once; a **read** token only gets the read tools |

Contents: [Tools](#tools) · [Tidying up](#tidying-up) · [One Script](#one-script) · [The codeword "one:"](#the-codeword-one) · [Workspaces](#workspaces) ·
[Local bridge](#local-bridge) · [Team server](#team-server)

## Tools

| Tool | | What it does |
|---|---|---|
| `one_overview` | read | workspace name and id, today's date, the page tree, every database with its row count, the people (local bridge: also the saved `scripts`) |
| `one_list_workspaces` | read | the connected workspaces: id, name, kind (`local` / `team`), access, change mode, which tab connected last — no content ([Workspaces](#workspaces)) |
| `one_search` | read | `{ query, limit? }` — titles, text and row values; ids, paths and a snippet per hit |
| `one_get_page` | read | `{ id }` or `{ title }` — title, icon, path, row properties, the content as **Markdown**, sub-pages, backlinks |
| `one_list_databases` | read | every database: id, title, path, row count, property names and types |
| `one_get_database` | read | `{ id }` — the schema (types, options, relations, read-only flags — `onlyByHand` properties are read-only for MCP clients, `key` marks the database's key) and the views |
| `one_query_database` | read | `{ databaseId, filter?, sort?, limit?, cursor? }` — rows with friendly values, filtered and sorted, paginated |
| `one_create_page` | write | `{ title, parentId?, markdown?, icon? }` |
| `one_update_page` | write | `{ id, title?, icon?, markdown?, mode: 'append' \| 'replace' }` |
| `one_create_row` | write | `{ databaseId, title, properties?, markdown? }` — a key another row holds and an `onlyByHand` property are refused |
| `one_update_row` | write | `{ id, properties }` — only what you pass changes, `null` clears; the same refusals |
| `one_create_property` | write | `{ databaseId, name, type, options?, relation?: { databaseId, twoWay?, reverseName? } }` |
| `one_update_property` | write · destructive | `{ databaseId, property, name?, description?, type?, options?: { add?, update?: [{ name, newName?, color?, group? }], remove? } }` — removing an option clears it from rows (`cleared`); only [safe type changes](#tidying-up) |
| `one_delete_property` | write · destructive | `{ databaseId, property }` — the property and its values; not the title (`rowsWithValue`) |
| `one_create_database` | write | `{ title, parentId?, properties? }` — a database with a table view |
| `one_update_database` | write | `{ id, title?, icon? }` — `locked` is refused (the person's decision) |
| `one_create_view` | write | `{ databaseId, type, name?, groupBy?, dateProperty?, filter?, sort?, properties? }` — `table`, `board`, `list`, `gallery`, `calendar`, `timeline`, `feed` |
| `one_update_view` | write | `{ databaseId, view, …the same }` — only what you pass changes; `null` clears grouping, filter, sorts |
| `one_delete_view` | write · destructive | `{ databaseId, view }` — not the last one; the rows stay |
| `one_move_page` | write | `{ id, parentId?, before? \| after? \| index? }` — pages and databases; `parentId: null` = top level |
| `one_move_row` | write | `{ id, databaseId }` — a row into another database whose properties fit |
| `one_trash_page` | write · destructive | `{ id }` or `{ ids: [≤ 50] }` — to the trash (a database with its rows: `rows`), never for good |
| `one_restore_page` | write | `{ id }` or `{ ids: [≤ 50] }` — back from the trash |
| `one_run_query` | read | `{ code, limit? }` — a read-only [One Script](#one-script) query: `{ count, columns, rows: [{ id?, <column>: text }] (≤ 100), truncated? }` or `{ value }` — local bridge only |
| `one_run_script` | write · destructive | `{ script (id or name), pageId?, dryRun? }` — a saved script, [always approved first](#one-script) — local bridge only |

Every tool but `one_list_workspaces` also takes **`workspace`** (optional): the id (`"local:…"`, `"team:…"`) or the
exact name of the workspace the call is meant for. Every result names the workspace it came from:
`"workspace": { "id": "team:…", "name": "Acme" }`.

**Values** are the friendly ones of the public API ([API.md § Property values](API.md#property-values)): option
names, dates `"YYYY-MM-DD"` / `"YYYY-MM-DDTHH:mm"` (wall-clock time) or `{ start, end }`, people by email or name,
relations by row id or title, `true` / `false`, numbers, `null` to clear. A select or multi-select option that doesn't
exist yet is added to the property; everything else that doesn't fit fails the whole call and names every problem
(with the allowed values). **Filters** (`one_query_database`) are `[{ property, op, value }]`, all must hold; `op` is
`equals`, `not_equals`, `contains`, `not_contains`, `is_empty`, `is_not_empty`, `gt`, `gte`, `lt`, `lte` (numbers and
dates). **Sort** is a property name, `createdAt`, `updatedAt` or `order` (the table's order, the default); `-` in
front sorts descending (`"-Due"`). Results are JSON; failures are MCP tool errors (`isError: true`) with a message an
agent can act on.

## Tidying up

The tools that delete, adjust, create and reorganise follow the same rules on both ways in:

- **Nothing is deleted for good.** `one_trash_page` moves pages, rows and whole databases to the trash — a database
  with all its rows (the answer says how many: `rows`), a page with its sub-pages (`alsoTrashed`). `ids` takes up to
  50 at once; a listed page below another listed one simply goes along. `one_restore_page` brings things back (a page
  whose parent is gone comes back at the top level); an id that is not in the trash fails with the most recently
  trashed items listed, so the agent can find what to restore. Emptying the trash stays in the app.
- **All or nothing.** Every call is validated first; one id, property, option or value that does not fit fails the
  whole call, names every problem, and nothing changes.
- **Databases.** `one_update_property` renames a property or its description, adds / renames / recolours / removes
  select, multi_select and status options (removing one clears it from the rows that had it — `cleared`), and changes
  the type only where the values carry over: text ⇄ url / email / phone, text → select / multi_select (an option per
  distinct value), select → multi_select / status / text, status → select / multi_select / text, multi_select → text,
  number → text. Anything else is refused with that list. `one_delete_property` removes a property with its values
  (not the title); views forget it the way the app's delete does (filters, sorts, grouping, calculations, chart axes,
  colour rules). Views take the friendly names: `groupBy` (a board needs a status, select, multi_select, person or
  checkbox property), `dateProperty` (calendar and timeline need one; a feed orders by it), `filter` in the shape of
  `one_query_database` (ANDed; dates also `today`, `tomorrow`, `yesterday`, `one_week_ago`, `one_week_from_now`;
  people by name or `me`), `sort`, `properties` (the visible ones, in order). Chart and form views are set up in the
  app.
- **Locked databases** take rows and values but no structure change (properties, options, views). Locking and
  unlocking is the person's decision: `one_update_database` refuses `locked`.
- **Reorganising.** `one_move_page` moves pages and databases under another page or to the top level and places them
  `before` / `after` a sibling or at an `index` (0 = first) among the siblings people see. Refused: into itself or its
  own sub-pages, into a database (a page does not become a row here), template pages. Rows stay in their database:
  `one_move_row` moves a row (with its content) into another database only when every value it has fits a property
  of the same name and type there — select / multi_select options are matched by name and missing ones added, status
  options must exist, relations must point to the same database and not be two-way, and no other row may link to it.
  Otherwise the answer lists what does not fit. Unique ids are numbered anew in the target.
- **Not offered:** turning a page into a database entry or back (the sidebar's drops — they ask the person on the
  way), and, in a team workspace, moving between *Private* and the workspace. Both stay in the app.
- **Safety.** The destructive tools (`one_trash_page`, `one_delete_property`, `one_update_property`, `one_delete_view`)
  carry `destructiveHint`, so clients ask before running them. Local bridge: *Ask first* shows a card for each —
  *Database “Projects” with 8 rows → trash*, *Delete property “Budget” from Projects* with *Values · 8 rows lose their
  value*, the options a change removes with the rows that lose them; *Apply directly* logs every change with an
  **Undo** (a trashed database comes back with its rows, a moved page goes back, a deleted property comes back with
  its values and view settings, view changes are reverted — parts edited since are kept); *Read only* refuses them.
  Team server: a **write** token is needed; changes carry `api:<tokenId>` as `updatedBy`.

## One Script

The local bridge offers the person's [One Script](../src/app/help/articles/en/one-script.md) (the tab runs it; the
team server does not have these two tools — its workspace model would need the script runtime ported):

- **`one_run_query`** runs code in the script engine's *query* mode: it only reads — writes, effects (mail, Claude,
  web) and dialogs are refused with an error. The answer is the value of the last expression: a table result
  (a query, a list of rows or records) as `rows` with the row `id` (keep it with `.select(id, …)`), at most 100,
  `count` = how many matched; anything else as `value`. Syntax and run errors say where (`line:col`). The tool
  description carries the language reference.
- **`one_run_script`** runs a saved script (by id or exact name; `one_overview` lists them). The tab dry-runs it
  first (the script's dialogs answer their defaults, nothing happens) and shows the result on the approval card —
  every change (*Change · Angebot schreiben · Aufgaben — Priorität: Niedrig → Hoch*) and effect (*Mail · to …*). It is
  **always asked**, also in *Apply directly*; *Read only* refuses it. Approved, it runs with the app's dialogs: the
  list of effects the card showed is not asked again, anything else (a web request — off unless ticked —, something
  the dry run did not show, the script's own questions) is asked in the app. The answer lists the changes, effects,
  printed lines and the result; the activity log has **Undo** (the script's own undo of the run). `dryRun: true`
  answers the dry run without asking; a saved *query* answers at once.

## Coding tasks (one-worker)

The [coding pipeline](CODING.md) hands tasks to Claude Code on the person's machine through **`one-worker.mjs`**
(next to the bridge in `public/mcp/`, same door: loopback, Host check, Origin allow-list, a workspace id per
connection — on its own port, 47322, subprotocol `one-worker.v1`). While it runs a task, Claude Code gets three
**task tools** from `node one-worker.mjs task-mcp` (`MCP_TASK_TOOLS` in the contract; not offered by this bridge):
`one_task_read`, `one_task_note`, `one_task_ask` — scoped to that one task by a token of that run; nothing else in
One is reachable through them.

## The codeword "one:"

A message to Claude that starts with **`one:`** is meant for the One workspace — *“one: tidy up my Projects
database”*. The server instructions of both ways in say so: the agent uses the One tools for it, not web search or
other connectors. Without the codeword it uses them when the person clearly talks about their One pages.

Both also offer it as an MCP **prompt** named `one` (argument `task`, required): Claude Desktop lists it in the
prompt menu (**+** → *One*), Claude Code as `/mcp__one__one <task>`. It expands to `one: <task>` plus the hint to
start with `one_overview` or `one_search`; an empty task or another prompt name is refused.

## Workspaces

A **name** is for people; an **id** routes. You name your workspace once — click the workspace name at the top of
the sidebar → *Rename workspace* (or double-click the name, or <kbd>F2</kbd> on it), ↵ saves, Esc cancels; or
*Workspace settings → Overview → Workspace name*. 1–60 characters, trimmed, no control characters. The same name shows in the
sidebar, the workspace switcher, the window title (*Page — Workspace*), export and site-title defaults and to agents.
A **team** workspace's name is the server's: its owners and admins rename it (everyone sees the new name at once);
for everyone else it is read-only. Two workspaces may share a name, so the MCP tools address them by id:

| Workspace | Id | Stable … |
|---|---|---|
| this browser's local workspace | `local:` + 11 characters — a hash of a random per-browser device id (`localStorage` `one.mcp.device`) and the workspace's epoch | across reloads and for every tab of this browser (and site); a new id after the workspace is erased. Not a secret, nothing of the content |
| a team workspace | `team:` + the server's workspace id | everywhere — the team server's `/mcp` uses the same id |

**The boundary** — what the local bridge guarantees:

- **Several workspaces at once, one tab each.** Every tab tells the bridge its workspace id. A second tab of the
  **same** workspace replaces the older one (newest wins); tabs of **other** workspaces stay connected next to each
  other. `one_list_workspaces` lists them (newest first, `newest: true` on the tab that connected last).
- **Addressing.** `workspace` resolves: an exact id → else the exact name (case-insensitive, spaces trimmed). A name
  two connected workspaces share is an error listing their ids (`workspace_ambiguous`); a name or id nobody has is an
  error listing what is connected (`workspace_unknown`). Something shaped like an id only ever matches ids — a tab
  *named* `team:…` never receives that workspace's calls. Nothing is ever guessed:
  - one workspace connected, no `workspace`: that one — as long as it is the workspace this MCP session last worked
    in. If the tab switched to another workspace since (or another one took its place), the call is refused with
    `workspace_mismatch` until the agent names the workspace — after asking the person;
  - several connected, no `workspace`: refused (`workspace_required`).
- **Binding.** The bridge sends each call to the resolved tab **with the expected workspace id**. The tab runs it
  only while it shows exactly that workspace — checked when the call arrives and again right before a change is
  written; otherwise it answers `workspace_mismatch` and nothing happens (the person switched meanwhile, or the tab is
  between workspaces: a team workspace still loading, signed out, removed). A tab that switches workspace while a
  call is open fails that call on the bridge too, and a result that names another workspace than the call's is
  dropped. Changes waiting for approval are **cancelled** the moment the tab's workspace changes; the approval card
  names the workspace the change is for.
- **No cross-resolution.** A tab only ever holds its own workspace's data, so ids from one workspace used in another
  are simply "not found" — never another workspace's page. A team workspace tab holds only what its member may see
  (other members' private pages never reach the browser).
- **Errors** start with a code: `workspace_mismatch` (nothing was done — ask the person which workspace),
  `workspace_required`, `workspace_unknown`, `workspace_ambiguous`. The server instructions tell agents to ask, never
  to retry in another workspace on their own.

*Settings → Agents · MCP* shows **Connected as** *name* with the id's short form, and a note when another workspace is
connected in another tab too.

## Local bridge

*Drives the One tab you have open — the static app at [getonecms.com](https://getonecms.com/app/), your own build,
or a team workspace open in that tab. No server, no account, no token.*

```
Claude Desktop / Claude Code ──stdio──▶ one-mcp.mjs ──ws://127.0.0.1:47321──▶ your One tab ──▶ IndexedDB
        (MCP client)                    (the bridge, on your computer)        (runs the tools)
```

The bridge is one file, [`one-mcp.mjs`](https://getonecms.com/mcp/one-mcp.mjs) (Node.js 20 or newer, no install).
The MCP client starts it; it lists the tools, and forwards every call to the tab of the workspace it is meant for,
which runs it against that workspace in the browser — the same code paths as the in-app agent — and answers. For Claude Desktop it also comes
packed as an extension, [`one.mcpb`](https://getonecms.com/mcp/one.mcpb), installed with one click.

### Set up

1. **Add it to your client.** *Settings → Agents · MCP → Setup* in One has all of this ready (download buttons, snippets
   with copy keys); so does the MCP section of [getonecms.com](https://getonecms.com/#mcp).

   *Claude Desktop (macOS, Windows) — one click.* **Add to Claude Desktop** downloads
   [`one.mcpb`](https://getonecms.com/mcp/one.mcpb), a Claude Desktop extension
   ([MCP Bundle](https://github.com/modelcontextprotocol/mcpb)). Open the file — Claude Desktop shows *SimpleCMS One*
   with its tools and asks to install it. No terminal, no config file, no Node.js: Claude Desktop runs the extension
   with the Node.js it ships. Its settings (*Settings → Extensions → SimpleCMS One → Configure*): **Port** (47321, see
   [Details](#details)) and **Extra allowed origins** (only for One served from your own domain, like `ONE_ORIGINS`).

   *Claude Code*

   ```bash
   curl -fsSL https://getonecms.com/mcp/one-mcp.mjs -o ~/one-mcp.mjs
   claude mcp add one -- node ~/one-mcp.mjs
   ```

   *Claude Desktop by hand* (instead of the extension; needs Node.js 20 or newer) — download `one-mcp.mjs` as above,
   then *Settings → Developer → Edit Config* (`claude_desktop_config.json`), with the **full** path (Claude Desktop
   does not expand `~`), then restart Claude Desktop:

   ```json
   {
     "mcpServers": {
       "one": { "command": "node", "args": ["/Users/you/one-mcp.mjs"] }
     }
   }
   ```

   *Any other MCP client* (Cursor, VS Code, Windsurf, Zed, your own agent with the MCP SDK): a **stdio** server,
   command `node`, argument the path of `one-mcp.mjs`.

2. **Switch it on in One**: *Settings → Agents · MCP → Allow AI agents on this computer*. The panel's LED turns
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

- **One tab per workspace, the newest wins.** Opening a second tab of the same workspace (with the switch on) moves
  the agent there; the older tab says *Another tab is connected* and offers **Use this tab**. It does not reconnect
  on its own, so two tabs never take turns. Tabs of other workspaces (another browser, a team workspace) connect
  next to it — see [Workspaces](#workspaces).
- **Reconnects by itself**: while no bridge answers (*Waiting for an agent · start Claude Desktop*) the tab retries —
  every few seconds, every 30 s after two minutes, at once when the tab comes back into view. Chrome logs each
  refused attempt in the developer console (*WebSocket connection … failed*); that is expected while no MCP client
  runs.
- **Port**: 47321. Another port: the same number in *Settings → Agents · MCP → Port* and for the bridge — the
  extension's **Port** setting, or `ONE_MCP_PORT` (the copied snippets then include it: `"env": { "ONE_MCP_PORT":
  "47400" }`, `claude mcp add one -e ONE_MCP_PORT=47400 -- node ~/one-mcp.mjs`).
- **Updates.** Extension: download `one.mcpb` again (same button) and open it — Claude Desktop updates the installed
  extension in place when the new version is higher. File: download `one-mcp.mjs` again and restart the client.
  `--version` (or the extension's page in Claude Desktop) shows the version you run. The tidy-up tools and the `one`
  prompt need bridge **1.2.0** or newer — an older bridge lists only the tools it was built with.
- **Two MCP clients** (say Claude Desktop *and* Claude Code) each start a bridge; only the first gets the port. The
  second answers every call with *Another One MCP bridge is already using port 47321 …* and takes the port over when
  the first one quits. Use one client at a time, or give the second one another port (and switch the tab to it).
- **Logs** go to stderr (Claude Desktop: *Settings → Developer → Open Logs Folder*, the `mcp-server-…` file); stdout is
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
- **Versioned handshake.** The tab must speak the subprotocol `one-mcp.v2` (or `one-mcp.v1`, older apps) and
  introduce itself — with a valid workspace id — within 5 s; a connection that never does cannot push the real tab
  out. A tab of another site that claims a connected workspace's id does not replace it either: both stay, and
  calls for that id are refused as ambiguous. Plain HTTP gets `426` and nothing else (no CORS headers,
  no information). Messages are capped at 16 MB; dead connections are dropped after a missed ping.
- **The workspace boundary** ([Workspaces](#workspaces)): calls are bound to a workspace id and run only there.
  Tabs learn only the **names** of the other connected workspaces (for the settings note) — never their ids, and
  nothing of their content; ids are random (a hash for local workspaces, the server's id for team workspaces), so a
  page cannot claim another tab's workspace.
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

For other implementations: JSON text frames, subprotocol `one-mcp.v2`, defined in
[`src/app/features/mcp/contract.ts`](../src/app/features/mcp/contract.ts) (shared by the bridge and the app).

| Direction | Message |
|---|---|
| tab → bridge | `{ type: "hello", app: "one", version, workspace: { id, name, kind, readOnly }, mode }` — first message; then `status` with the same fields when they change (another `id` = the tab now shows another workspace) |
| bridge → tab | `{ type: "welcome", bridge, client: { name, version } \| null }` — the MCP client from its `initialize` (later changes: `client`) |
| bridge → tab | `{ type: "call", id, tool, args, workspace }` — `workspace` = the id the call is meant for; the tab answers `workspace_mismatch` unless it shows exactly that workspace |
| tab → bridge | `{ type: "result", id, result }` (an object with `workspace: { id, name }` — checked against the call's) · `{ type: "error", id, error }` · `{ type: "pending", id, timeoutMs }` (waiting for approval: the bridge extends the deadline) |
| bridge → tab | `{ type: "cancel", id }` (the client cancelled, the bridge gave up, or the tab switched workspace) · `{ type: "replaced" }` + close `4001` (a newer tab of the same workspace took over) · `{ type: "peers", workspaces: [{ name, kind }] }` (the other connected workspaces) |

**Older versions.** The bridge also speaks `one-mcp.v1` with apps from before workspaces: such a tab (no id) is the
only one, as before — it replaces every tab, any newer tab replaces it — its calls carry no `workspace`, and its
answers get `workspace: { id: null, name }`. A new app offers `one-mcp.v2, one-mcp.v1`; an older bridge picks v1 and
the app works as before (one tab, unbound calls) and asks for an update in *Settings → Agents · MCP*.

The bridge's own code is in [`mcp/`](../mcp) (`npm --prefix mcp install`, `npm run build:mcp` rebuilds
`public/mcp/one-mcp.mjs` and packs the extension around it, `public/mcp/one.mcpb` — both committed, the Pages build
just copies them; `npm run test:mcp` runs its tests). The extension's manifest (MCPB spec 0.3: `server.type: "node"`,
the tool list from the contract, the *Port* / *Extra allowed origins* settings mapped to `ONE_MCP_PORT` /
`ONE_ORIGINS`) is generated by `mcp/src/mcpb.ts`; packing is deterministic (fixed order, timestamps and modes), so a
rebuild without changes gives the same bytes. Check a bundle with the official CLI:
`npx @anthropic-ai/mcpb info public/mcp/one.mcpb`, or `unpack` it and `validate` its `manifest.json`.

## Team server

A team server (`server/`, [CLOUD.md](CLOUD.md)) has a **remote MCP endpoint** at `https://<your server>/mcp`. It works
with the API tokens of the [public API](API.md#tokens) — no extra setup on the server.

### Connect

1. An owner or admin creates a token in **Workspace settings → Automation → API tokens**: scope **write** lets the agent change
   things, **read** gives it only the seven read tools (the write tools are not even listed) — and the `one` prompt.
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
  (another workspace, a page in the trash, a template's page) is "not found". `one_list_workspaces` lists just that
  workspace (`team:<id>`, its name, `read-only` for a read token); every answer names it in `workspace: { id, name }`.
  The `workspace` argument may name it — by `team:<id>`, the bare id or its current name (any case) — and anything
  else is refused before the tool runs (`workspace_mismatch`: nothing was done). Another workspace needs its own
  token.
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
  select options from `one_create_row` / `one_update_row`, the [tidy-up tools](#tidying-up) (properties, options,
  views, moves) and `one_trash_page` — a **soft delete** exactly like the app's (`trashed: true`, `trashedAt`): the
  page (with everything below it) is in the app's trash and `one_restore_page` (or the app) brings it back. A
  **locked** database takes rows and values but no new properties, options or views. There is no undo log on the
  server: give an agent a read token, or the local bridge with *Ask first*, when every change should be checked.
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
