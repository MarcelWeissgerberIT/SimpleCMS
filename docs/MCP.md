# One MCP — agents in your workspace

One speaks the [Model Context Protocol](https://modelcontextprotocol.io). Claude Desktop, Claude Code or any other
MCP client can search, read and write your workspace — pages, sub-pages, databases, boards, rows and properties — and
tidy it up: move, reshape, trash and restore. A page reads in full (every block with its data, long pages in parts);
a tree of sub-pages, a board with its rows or 50 row changes are **one call and one approval card**. There are two
ways in, with **one tool set** — the same names, arguments, result shapes and error codes (one contract,
[`src/shared/mcp/`](../src/shared/mcp/)):

| | Local bridge | Team server |
|---|---|---|
| Workspace | the local workspace and any team workspace **open in your browser tabs** — several at once, each by its id | the token's team workspace on your own server — only that one |
| Transport | stdio — your MCP client starts `one-mcp.mjs` on your computer | Streamable HTTP — `https://<your server>/mcp` |
| Needs | One open in a tab, *Settings → Agents · MCP* switched on | an API token (*Workspace settings → Automation → API tokens*) |
| Data path | MCP client ⇄ `one-mcp` (localhost) ⇄ your One tab ⇄ IndexedDB — nothing leaves your computer | MCP client ⇄ your server ⇄ the workspace's live documents |
| Changes | wait for your approval in the app (*Ask first*, the default) or apply directly; *read only* switch | apply at once; a **read** token only gets the read tools |

Contents: [Tools](#tools) · [Results, errors, repeats](#results-errors-repeats) ·
[Reading a page in full](#reading-a-page-in-full) · [Sub-pages and batches](#sub-pages-and-batches) ·
[Boards in one call](#boards-in-one-call) · [Comments](#comments) · [What MCP never changes](#what-mcp-never-changes) ·
[Two-way relations](#two-way-relations) · [Tidying up](#tidying-up) · [Tasks](#tasks) · [One Script](#one-script) · [The codeword "one:"](#the-codeword-one) ·
[Workspaces](#workspaces) · [Local bridge](#local-bridge) · [Team server](#team-server)

## Tools

**B** = the local bridge, **S** = the team server's `/mcp`. ✓ = served; *local only* = the bridge alone (the team server
does not list the tool, or answers `local_only` for that argument).

| Tool | | B | S | What it does |
|---|---|---|---|---|
| `one_overview` | read | ✓ | ✓ | workspace name and id, today's date, the page tree (cut: `tree: { more: true, use: "one_list_pages" }`), every database with its row count, the people (B: also the page open in One and the saved `scripts`) |
| `one_list_workspaces` | read | ✓ | ✓ | the connected workspaces: id, name, kind (`local` / `team`), access, change mode, which tab connected last — no content ([Workspaces](#workspaces)) |
| `one_search` | read | ✓ | ✓ | `{ query, limit? }` — titles, text and row values; per hit id, title, kind, path, a row's database, last edit, a snippet; a link is `urlBase` + id |
| `one_get_page` | read | ✓ | ✓ | `{ id \| title, format?: 'markdown' \| 'blocks', refs?, cursor?, comments?, transcript? }` — a page, row or database page **in full**: the head once (title, icon, cover, path, `rev`, `class`, a row's values, sub-pages, backlinks), then the content as Markdown or as every block with its data, in parts ([Reading a page in full](#reading-a-page-in-full)). B: mentions read `[@Name](one:person/<id>)` / `[@date](one:date/YYYY-MM-DD)`, task blocks `> [!TODO] Title {#wi_…}` with their field line — keep both when you write the text back |
| `one_list_pages` | read | ✓ | ✓ | `{ parentId?, depth? (1–3), kinds?, cursor?, limit? (≤ 200) }` — pages and databases in sidebar order, at the top level or below a page; rows only with `kinds: ["row"]`; paged |
| `one_list_databases` | read | ✓ | ✓ | every database: id, title, path, `parentId`, row count, property names and types, `inline` (shown inside a page's text), `system` (One's own: read-only over MCP) |
| `one_get_database` | read | ✓ | ✓ | `{ id }` — the schema (types, options, relations, read-only flags — `onlyByHand` properties are read-only for MCP clients, `key` marks the database's key) and the views in full (grouping, filters, sorts, visible properties) |
| `one_query_database` | read | ✓ | ✓ | `{ databaseId, filter?, sort?, limit?, cursor? }` — rows with friendly values, filtered and sorted, paginated |
| `one_create_page` | write | ✓ | ✓ · `private` local only | `{ title, parentId?, markdown?, icon?, before? \| after? \| index?, private?, linkInParent? }` — a page, or a sub-page under a page **or a row**; or `{ pages: [≤ 50] }` — a whole tree in one call ([Sub-pages and batches](#sub-pages-and-batches)) |
| `one_update_page` | write | ✓ | ✓ | `{ id, title?, icon?, markdown?, mode: 'append' \| 'replace' }` — a task block of the page written back as it was read (`> [!TODO] … {#wi_…}`) stays that task: its title and notes from the Markdown, its fields as the app has them. B: new `> [!TODO]` quotes become tasks through the same gate as the app ([Tasks](#tasks)); a replace that removes tasks is always asked; a page that changed while the call waited for approval is not replaced (call again); a replace keeps page links as links. S refuses a `replace` of a page holding a task or a page whose blocks its Markdown cannot carry (both `lossy_replace`) and a locked page's content (`locked`). Both: no `title`, `icon` or `markdown` — or an empty append — is `bad_argument`; a call that changes nothing writes nothing (S answers `changed: []`, B answers without a card) |
| `one_create_row` | write | ✓ | ✓ | `{ databaseId, title, properties?, markdown? }` or `{ databaseId, rows: [≤ 50] }` — all or none; a key another row holds and an `onlyByHand` property are refused |
| `one_update_row` | write | ✓ | ✓ | `{ id, properties }` or `{ rows: [{ id, properties }] ≤ 50 }` — only what you pass changes, `null` clears; all or none; the same refusals |
| `one_upsert_rows` | write | ✓ | ✓ | `{ databaseId, keyProperty, rows: [{ key, title?, properties?, markdown? }] ≤ 50 }` — keep a database in step with items from elsewhere, by a key: per row `created`, `updated` (only the values that differ) or `unchanged` |
| `one_create_property` | write | ✓ | ✓ | `{ databaseId, name, type, options?, relation?: { databaseId, twoWay?, reverseName? } }` — a relation is one-way: `twoWay: true` is `refused_type` ([two-way relations](#two-way-relations)) |
| `one_update_property` | write · destructive | ✓ | ✓ | `{ databaseId, property, name?, description?, type?, options?: { add?, update?: [{ name, newName?, color?, group? }], remove? } }` — removing an option clears it from rows (`cleared`); only [safe type changes](#tidying-up) |
| `one_delete_property` | write · destructive | ✓ | ✓ | `{ databaseId, property }` — the property and its values; not the title (`rowsWithValue`) |
| `one_create_database` | write | ✓ | ✓ | `{ title, parentId? \| inline?: { pageId, afterBlock? }, icon?, properties? (≤ 40), views? (1–5), rows? (≤ 50) }` — a database or a **board** with its views and rows in one call, as a sub-page or inside a page's text ([Boards in one call](#boards-in-one-call)) |
| `one_update_database` | write | ✓ | ✓ | `{ id, title?, icon? }` — `locked` is refused (the person's decision) |
| `one_create_view` | write | ✓ | ✓ | `{ databaseId, type, name?, groupBy?, dateProperty?, filter?, sort?, properties? }` — `table`, `board`, `list`, `gallery`, `calendar`, `timeline`, `feed` |
| `one_update_view` | write | ✓ | ✓ | `{ databaseId, view, …the same }` — only what you pass changes; `null` clears grouping, filter, sorts |
| `one_delete_view` | write · destructive | ✓ | ✓ | `{ databaseId, view }` — not the last one; the rows stay |
| `one_move_page` | write | ✓ | ✓ | `{ id, parentId?, before? \| after? \| index? }` — pages and databases; `parentId: null` = top level |
| `one_move_row` | write | ✓ | ✓ | `{ id, databaseId }` — a row into another database whose properties fit (never onto a key another row holds there, never into an `onlyByHand` property) |
| `one_trash_page` | write · destructive | ✓ | ✓ | `{ id }` or `{ ids: [≤ 50] }` — to the trash (a database with its rows: `rows`), never for good |
| `one_restore_page` | write | ✓ | ✓ | `{ id }` or `{ ids: [≤ 50] }` — back from the trash |
| `one_run_query` | read | ✓ | — | `{ code, limit? }` — a read-only [One Script](#one-script) query: `{ count, columns, rows: [{ id?, <column>: text }] (≤ 100), truncated? }` or `{ value }` |
| `one_run_script` | write | ✓ | — | `{ script (id or name), pageId?, dryRun? }` — a saved script's **dry run** only: `ran: false`, nothing written or sent ([One Script](#one-script)) |
| `one_list_work_items` | read | ✓ | — | `{ status?, person?, pageId?, blocked?, overdue?, dueBefore?, query?, limit? }` — task blocks as JSON ([Tasks](#tasks)) — team server: later |
| `one_update_work_item` | write | ✓ | — | `{ updates: [{ item, status?, due?, reminder?, people?, blocked_by?, related? }] }` — a task's fields ([Tasks](#tasks)) — team server: later |

Every tool but `one_list_workspaces` also takes **`workspace`** (optional): the id (`"local:…"`, `"team:…"`) or the
exact name of the workspace the call is meant for. Every result names the workspace it came from:
`"workspace": { "id": "team:…", "name": "Acme" }`. Arguments mean one thing in every tool (page and row ids `id`,
`pageId`, `rowId`, `parentId`, `databaseId`; a block ref ends in `Block` — `afterBlock`; paging `cursor` in, `next`
out), and a tool takes **only** the arguments it declares: anything else is refused (`bad_argument`), never dropped.

## Results, errors, repeats

- **Results** are compact JSON. A single item carries its `url`; lists carry `urlBase` once (a link is `urlBase` +
  id). Paged answers end with `next` — pass it back as `cursor` (null = the end). Every answer holds what the next call
  needs: new ids, a database's views and rows, a block's ref.
- **Limits** are the same on both ways in ([`MCP_LIMITS`](../src/shared/mcp/tables.ts)): a title (page, row,
  database) at most 300 characters — whitespace collapsed, never empty (a row without a title is refused, also one
  given only through `properties` that names none) —, a property's or a reverse relation's name at most 100, an option's
  name cut to 60, one page's or row's Markdown at most 200,000 characters (an upserted row's 100,000). An `icon` is an
  emoji, `"asset:<name>"` or `"lucide:<Name>"`; a word (`"rocket"`) is `bad_argument`.
- **Errors** are MCP tool errors (`isError: true`) whose first line has one shape on both ways in:
  `<code>: <argument path>: <what happened>. Nothing was changed. <next step>` — the path names the argument
  (`rows[12].properties.Status`, `inline.afterBlock`), the next step is the code's remedy
  ([`src/shared/mcp/errors.ts`](../src/shared/mcp/errors.ts)). **Every** refusal starts with its code — the tab's own
  checks too (a value, a filter, a cursor, a property spec): a message that names none gets the one it means
  (`withCode`: changed while the call waited → `page_changed`, gone meanwhile → `not_found`, locked meanwhile →
  `locked`, anything about the arguments → `bad_argument`), as the team server's answers do; the bridge's own too — a
  card not approved in time `approval_timeout`, a tab that closed, reloaded or was replaced while a call waited and a tab
  that did not answer `rejected` (*whether the call was carried out is not known: read what it touches before you call
  again* — never "Nothing was changed"), the port in use or the bridge not running `rejected`, and every refusal of an
  older One tab (contract 1) gets its code from the bridge (its own words keep their meaning: rejected on the card,
  *Agents can only read*, view only, signed out, switched to read-only or cancelled → `rejected`; not approved in time or
  One gone while the card waited → `approval_timeout` — never `bad_argument`); an unknown property or view is
  `not_found` (several views of one name `bad_argument`) and locking a database `rejected` on both ways in; a fault of the team server's own is `rejected` with the
  same words (a batch may have written part of the call — S never says "not made" there, nor "try again").
  `one_list_workspaces` takes no argument: any is refused
  (`bad_argument`) on both ways in. Arguments are strict at
  every depth: a key a closed object of the contract does not declare — `rows[0].Status` beside `properties`,
  `pages[1].content`, `inline.afterblock`, `views[0].group_by` — is `bad_argument` with its path on both ways in (the
  team server's schemas are strict objects at every depth; its `tools/list` says `additionalProperties: false` there
  too). Codes in use:

  | Code | When |
  |---|---|
  | `workspace_mismatch` · `workspace_required` · `workspace_unknown` · `workspace_ambiguous` | the [workspace boundary](#workspaces) |
  | `not_found` | an unknown id — also a page in the trash (`one_restore_page`) and every template page, which reads exactly like an unknown id |
  | `bad_argument` | an argument the tool does not take, or a value of the wrong shape |
  | `app_outdated` | the One tab is older than the bridge and does not know that tool or argument yet: reload One — nothing reached the tab |
  | `locked` | a locked database's structure, a locked page's text |
  | `system_database` | a write into one of [One's own databases](#what-mcp-never-changes) |
  | `private_scope` | something private would land in a shared page |
  | `refused_type` | a value of the wrong kind (a web address into a files property) |
  | `stale_ref` | a block ref whose block changed since the read |
  | `page_changed` | a page changed between two parts of a read: read again from the start |
  | `lossy_replace` | S: a replace would lose blocks its Markdown cannot carry |
  | `local_only` | S: an argument only the local bridge serves (`private`) |
  | `comments_off` | `comments: true` while comments are off ([Comments](#comments)) |
  | `rejected` · `approval_timeout` | B: the person rejected the card, or did not answer within 2 minutes — do not retry on your own |

- **A repeat within 2 minutes makes nothing twice.** A creating call (`one_create_page`, `one_create_database`,
  `one_create_row`) whose tool and arguments equal one that is still **waiting** for approval joins that card — both
  calls get its answer. One equal to a call **applied in the last 2 minutes** is answered with that result plus
  `duplicateOf` and the note "already applied N s ago; nothing new was made — to make another, change something (e.g.
  the title)". Argument order and `workspace` do not matter; rejected and failed calls are not remembered, and neither
  is a call taken back (B: its Undo in Agent activity or an eject; S: a Restore in Workspace → API) — repeating it
  makes the thing again. B keeps a map per MCP session in the tab (≤ 50 entries, forgotten on a reload or a reconnect);
  S uses its idempotency store per token. Outside that window, or after a reconnect, a repeat is a new call. An
  **older One tab** (contract 1) joins no repeats: the bridge adds `repeatsJoined: false` and a note to every creating
  call it answers there — read what the call made before you repeat it.
  `one_upsert_rows` only **joins** a waiting call: a keyed upsert makes no duplicate on its own, so a repeat after it
  was applied runs again and brings the rows in step (answering `updated` / `unchanged` as they are now).

## Reading a page in full

`one_get_page` reads a page, a row (its values and its page) or a database page.

- **By title.** `{ title }` reads the most recently edited live page of that title; the head names every other one
  carrying it as `alsoTitled: [{ id, path }]` (≤ 10) — on both ways in — so the next call can take the right `id`.

- **Parts.** A long page comes in parts of at most 40,000 characters of serialized JSON (and 400 blocks): the first
  part carries the head — `id`, `title`, `icon`, `cover`, `path`, `url`, `parentId`, `rev`, `class`, a row's values, a
  database's schema hint, `children: { items (≤ 50), more }` (the rest: `one_list_pages`), backlinks, comments — the
  next parts only `{ id, rev, markdown | blocks, next }`. A cursor carries the `rev` it was cut at: a page that changed
  between two parts answers `page_changed`. A block too big for one part continues in the next (`continued: true`).
  Every part but the last says `truncated: true`. **Putting Markdown parts back together:** join them with a blank
  line — except after a part that says `continues: "line"` (it ended inside a block, at the end of a line: join with
  one line break) or `continues: "text"` (it ended inside a line — a paragraph longer than a part: join directly). A
  part never cuts a line that fits in a part, so a table, a code block or a list read in parts is the same block again
  when the joined Markdown is written back. A bridge older than 1.12.0 (no cursor in its schema) gets contract 1's
  answer instead: the whole page's Markdown, cut at 60,000 characters with a last line *[Truncated: 60,000 of N
  characters — the rest needs the updated One bridge]* and `truncated: true`, and `children` as contract 1 listed them
  (up to 100 sub-pages, no `more`); its one_overview never points to one_list_pages (the old bridge has none — a cut tree
  says to use one_search). Settings → Agents · MCP asks for the update.
- **`rev`** — the content's revision, an opaque string (B: the page's content counter; S: a hash of its document state —
  state vector and delete set, so a member who only deletes moves it too).
- **`format: "blocks"`** — every block nested: `{ ref, type, markdown?, attrs?, data?, children? }`. Leaves carry their
  own Markdown, containers (quotes, callouts, toggles, columns, tabs, synced blocks, meeting notes) their children;
  `attrs` is an allow-list (heading level, code language, callout icon / colour, toggle heading, media width / align /
  alt / caption, to-do checked, list start). `data` per type:

  | Type | `data` |
  |---|---|
  | `databaseBlock` | `{ databaseId, viewId, title, viewType, rows }`; a database out of reach → `{ databaseId: null, title: "(No access)" }` |
  | `pageLink` | `{ pageId, title }` |
  | `spreadsheet` | `{ title, active, sheets: [{ name, rows, cols, frozenRows, cells: { A1: { input, value } } }] }` — cells count into the part and continue in the next; S: `value: null` (no formula engine on the server) |
  | `chart` | `{ spec, data }` — S: data only for manual charts |
  | `button` | `{ label, variant, actions: [{ kind }] }` — the kinds only, never addresses or payloads |
  | `syncedBlock` | `{ syncId, original, sourcePageId }` + children |
  | `meetingNotes` | `{ title, status, startedAt, endedAt, duration, language, transcriptLines }`; `transcript: true` adds the lines, paged |
  | `image` · `video` · `audio` · `fileBlock` | `{ file: { ref, name, mime, size } \| null, url \| null, display }` — nothing is loaded |
  | `bookmark` · `embed` | `{ url, title?, description?, provider? }` |
  | `blockMath` · `mermaid` | `{ latex }` · `{ code }` |
  | `workItem` | B: the task's fields (status, due, people by name, links); S reads it as its title line and notes |

- **Refs.** Every block has a ref computed from the page itself, so it survives reloads and needs no session:
  `#<id>~<hash>` (the shortest unique prefix, ≥ 6 characters, of the block's id, and 6 hex of a hash over the block's
  content) or `@<path>~<hash>` for a block without an id (`@3.0.1` = child indexes). `refs: true` labels each block of
  the Markdown with its ref (`⟦#k3f9a1~2c7e0b⟧` on a line before it); every writing tool drops labels a client copies
  back. A tool that takes a block (`one_create_database { inline: { afterBlock } }`) refuses a ref whose block changed
  since the read (`stale_ref`, naming the block's ref now); a ref without its `~hash` part is taken as it is. A ref of a
  block inside another one (a column, a toggle, a list item) where a top-level block is needed is `bad_argument`
  naming the top-level block's ref to pass instead.
- **`class`** (single reads): `page`, `rows`, `private`, `mail` or `memory` — the last three mark personal data; the
  instructions tell the agent not to copy it into shared pages or other tools without asking.
- **Context marks** (B): when the person marked which blocks of a page Claude may read, MCP reads only those (and
  `one_search` searches and quotes only those; such a hit says `limited: true`; `one_run_query` / `one_run_script`
  read a page's `.markdown` / `.text` only from those blocks; `one_list_work_items` lists no task in an excluded block,
  `one_update_work_item` refuses one as unknown, and a listed task's link to one carries no title) —
  their text, block data, files and comment threads; `limited: { blocks, files, comments, note }` counts what was left
  out. Writes respect them too: `one_update_page { mode: "replace" }` of a page with marks is refused (`rejected` — it
  would overwrite blocks Claude may not read; an append stays allowed — a script's `replace()` alike), every text a call
  writes — a replace, an append, the rows of `one_create_row`, `one_create_database` and `one_upsert_rows` — resolves
  its task links only in what may be read (an excluded task is no link target and never named), and `one_create_database { inline: { afterBlock } }`
  refuses a block that may not be read without ever saying its ref (its content hash).
- `one_list_pages` lists pages and databases (and rows on request) in sidebar order — shared before private, never
  templates or hidden pages; S never lists private pages.

## Sub-pages and batches

- **One page:** `one_create_page { title, parentId?, markdown?, icon? }`. `parentId` may be a page or a database
  **row** — the new page is a sub-page inside it (a new row: `one_create_row`). `before` / `after` (a sibling's id) or
  `index` (0 = first) place it; default last.
- **A tree in one call:** `pages: [{ title, parentId?, markdown?, icon? }]` (≤ 50, ≤ 600,000 characters of Markdown in
  all). A page's `parentId` may be `"$<index>"` — an earlier page of the same list —, an existing page, or left out
  (the call's `parentId`). Everything is checked before anything is written; the answer lists
  `pages: [{ index, id, title, url, parentId }]`.
- **`linkInParent`:** `"block"` adds a page link block for each new page at the end of its parent's text, `"mention"`
  a line with a page mention; the same call, the same Undo; refused for a locked parent page.
- **`private: true`** (B, team workspace): the page goes into the person's *Private* section (top level or under a
  private page). In a local workspace there is nothing private: the page is made and the answer says so. S answers
  `local_only`.
- **Rows in bulk:** `one_create_row { rows }` and `one_update_row { rows }` take up to 50 rows — all or none ("set Status
  = Done on these 20 cards" is one call); every row that does not fit is named in one refusal (`rows[i] ("title"): …`
  per line). `one_upsert_rows` mirrors items by a key: `keyProperty` names the database's
  key or a text / number / url property; a row whose key holds `key` gets only the values that differ, no such row →
  a new one (its `markdown` is written only while its page is empty — every top-level block an empty paragraph, on B and
  S alike); a key listed twice in one call is refused (`rows[1] (key "7"): listed twice (rows[0] has it too)`) on both;
  any refused row fails the whole call with the list.
- **One card per call** (B, *Ask first*): *Create 50 pages in “Launch plan”* with a line per page, *Change 20 rows in
  Cards* with each value before → after. Every line shows **everything** the entry writes — each value (never only the
  first ones) and, under it, the text it writes into its page (*Content of “Kick-off” · 1,204 chars* with its first
  lines). An upsert line names the key (*New · T-4100*), then the title and its values, or for a changed row *old title
  → new title* and each value before → after; the key is not repeated. The scroll hint counts the entries (*30 entries —
  scroll to see all*), never the card's other lines. A row batch names what it would start — *Starts: autofill on 5 rows (Summary) ·
  automation “Notify” · agent “Triage”* — and a call whose rows that start paid AI work or send something out of One
  (autofill that updates by itself, a webhook or script automation, a row-triggered agent) add up to **5 or more** —
  new and changed rows together, over every database it touches, a new title counting as a change of the title
  property — is **always asked**, also in *Apply directly*. The card fits the screen: its lines scroll, the summary and
  the keys stay in view. **Undo** is all or nothing (see *Agent activity* below): the whole call goes back — what it
  made into the trash, what it changed (values, a parent's text with its link or database block) as it was — or,
  when anything of it changed since, nothing at all. A call that fails as a whole takes back what it made for good —
  nothing of it waits in the trash. A link written into a **row's** text (`linkInParent` under rows) and a task changed in a row
  (`one_update_work_item`) change that row's text: what fills again on it is named, and 5 or more such rows are always
  asked. `one_upsert_rows` writes no text into a locked row page (`locked`, also when it was locked while the card
  waited).
- **Files values** (`files` properties) take only `onefile:` refs of this workspace that a live page uses — never a web
  address (`refused_type`), never a private file into a shared row (`private_scope`).

## Boards in one call

`one_create_database` makes the database, its properties, its views and its rows in one call — and one card. Without
`properties` it makes **Name, Status (Not started · In progress · Done), Tags, Date** — these English words in every
workspace language, on the bridge and the team server alike (`MCP_DEFAULT_PROPERTIES`, `MCP_DEFAULT_STATUS` in
`src/shared/mcp/tables.ts`); a status property made without options gets the same three. The answer's `properties`
names what was made. The
German walk-through *„Lege unter Projekt Nordlicht eine Unterseite mit einem Board Todo / Doing / Done an und trage
diese fünf Aufgaben ein“* is two calls — `one_search { query: "Projekt Nordlicht" }`, then:

```json
{
  "title": "Board",
  "parentId": "<the project's id>",
  "views": [{ "type": "board", "groupBy": "Status" }],
  "properties": [{ "name": "Status", "type": "status", "options": ["Todo", "Doing", "Done"] }],
  "rows": [{ "title": "Kick-off mit Mara Lind", "properties": { "Status": "Todo" } }, "… four more"]
}
```

→ `{ id, title, url, parentId, properties, views: [{ id, name, type, groupBy }], rows: [{ index, id, title }], note }`.

- **`parentId`** makes a full-page database as a sub-page; **`inline: { pageId, afterBlock? }`** puts it inside that
  page's text — after the block `afterBlock` names (a ref from `one_get_page`) or at the end. The page must be live,
  unlocked, not a template, in the same privacy scope and not part of One's own databases.
- **A board** groups by `groupBy` or the first status / select / multi-select / person / checkbox property; with none,
  a `Status` property (*Not started*, *In progress*, *Done*) is added. A **table view** follows a first
  view that is not a table, so the rows stay editable in a grid. `note` says what was added.
- Rows are checked against the new schema before anything is written; the coercion is `one_create_row`'s. Give each row
  its lane (`properties: { "Status": "Todo" }`): a row without a value for the grouping property waits in the board's
  *No value* lane, as a row made in the app's table does (the description's example says so; moving them later is one
  `one_update_row { rows }` call and one card).
- **Undo** (B) puts the database with its rows into the trash and takes its block out of the page's text — refused
  whole once a row was added or changed, the database set up or the page written in since. S: when the
  database block or a row cannot be written, the database it made goes to the trash again and the error stands.

## Comments

**Off unless the person switches them on.** B: *Settings → Agents · MCP → Comments*: **Off** (default) · **Read** ·
**Read + write**, per device. S: per token, chosen when an owner or admin creates it (*Comments (MCP)*: off · read ·
read + write; a read token never writes). While on, `one_get_page { comments: true }` adds the threads:
`[{ id, quote, body, author, createdAt, resolved, ref, replies: [{ id, body, author, createdAt }] }]` — `ref` is the
block that holds the comment's mark, resolved threads come with `resolved: true`. While off, `comments: true` answers
`comments_off` (ask the person; do not retry — S: the flag is set when a token is made and stays as it is, so the
next step there is a token with comments on, made by an owner or admin). Writing comments over MCP comes with a later version.

## What MCP never changes

- **One's own databases are read-only over MCP** — the memory and its log, Mails and the mail directories, the coding /
  business-analysis / QA pipelines and test cases (`Database.system`; `one_list_databases` / `one_get_database` say
  `system`): no rows created, changed, mirrored, moved or trashed, no sub-pages or text in their rows, no schema or view
  change, no inline block of one, no trash of a page whose tree holds one — `system_database`. Reading stays allowed
  (mail and memory rows carry their `class`).
- **Templates** are invisible: a template page's id is `not_found` for every tool, also as a `parentId`.
- **One Script over MCP** (`one_run_script`) is a dry run only; one that would write into those databases is refused
  all the same (`system_database`; also a value of a two-way relation whose other side is one of them).
- **A two-way relation into one of them** takes no value over MCP — as no two-way relation does
  ([two-way relations](#two-way-relations)).
- **Their schema stays** also when another database is reshaped: `one_delete_property` of a property a rollup there
  rolls up is refused (`system_database`; a locked database's rollup `locked`); a template's rollup is not looked at.
  B checks every structure tool (database, property, view) again when the card is approved.
- **Private stays private** (B, team workspace): Markdown written into a shared page never links a private page (a
  `#/p/<id>` link of one is `private_scope`), as a file or a mention would not.
- **Coding tasks** never take trust from an MCP write (nor from what it set off — an automation, autofill): a pipeline task whose version an MCP write moved (its row, its
  pipeline, a page it takes along) waits for *Confirm* in One before the worker runs it.
- **Text from a client** goes through the same gate as every Claude answer in One: raw HTML only as One's own file form
  writes it (any other tag stays text), `data:` images become the text "[inline image removed — add the picture in One]" (nothing is decoded),
  a `onefile:` ref stays only when it is this workspace's file, a page the client may read uses it, and it is not
  private while the target is shared (else `private_scope`). Web images become links.
- **Web images in a files property** never load by themselves on gallery or board cards: a chip names the host and the
  picture loads after a click.
- Still not offered: deleting for good, locking, settings, members, agents, automations, scripts' code, buttons,
  synced blocks, embeds, meeting notes, chart and form views, formula and rollup properties, Private ⇄ shared moves.

**One gate for every write** ([`src/shared/mcp/targets.ts`](../src/shared/mcp/targets.ts)). Every write tool names
what its call touches — the pages whose text it writes, the databases whose schema it changes (also another database
whose rollup a delete clears), the rows it writes values into (and how many it makes), the pages it puts something
under, moves, renames or trashes, a replaced page, a page coming back from the trash, a move between parents. ONE
check refuses the call when any of them is a template's (`not_found`, never named), in the trash (`not_found`), One's
own (`system_database`), a locked page's text or a locked database's schema (`locked`; rows, titles, icons and places
stay writable), a replace under the person's context marks (`rejected`, B) or a Private ⇄ shared move
(`private_scope`, B team) — naming the argument it came from (`locked: linkInParent: …`) and every target that fails
the same check. B runs it when the call is planned (before any card) and again right before it writes (a page locked
or trashed, a database made One's own while the card waited: `… was locked meanwhile`, `… went to the trash since the
call was made`; nothing is written); S runs it before each write tool (server/src/mcp/gate.ts). The tools' own checks
stay behind it as a backstop. B also decides "always asked" from the same targets: 5 or more rows in databases that
fill by themselves, send something out of One (a webhook or script automation) or start a row-triggered agent.

**Values** are the friendly ones of the public API ([API.md § Property values](API.md#property-values)): option
names, dates `"YYYY-MM-DD"` / `"YYYY-MM-DDTHH:mm"` (wall-clock time) or `{ start, end }`, people by email or name,
relations by row id or title, `true` / `false`, numbers, `null` to clear. A select or multi-select option that doesn't
exist yet is added to the property — except on a property that takes its options from a **shared list** (Building
blocks): there a new option is `bad_argument` naming the list (it is added to the list in One), on rows, in
`one_update_property { options }`, a row `one_move_row` brings along and through agents alike; a script the person runs
in One puts such an option into the list (as the option picker does), and `one_run_script`'s dry run names it
(`addsToList: { list, options }`); a type change makes such a property a plain one (as the app's). **Options** a call
names (`one_create_property`, `one_create_database`, `options.add`) are read the same way on both sides
([`src/shared/mcp/options.ts`](../src/shared/mcp/options.ts)): a colour is lower-cased (`"Red"` = red), an unknown
colour, a status group other than todo / in_progress / done, an empty name or a name listed twice is `bad_argument`
with its path (`options[1].name`); a name longer than 60 characters is cut (also `options.update.newName`). A database
made over MCP has a title property "Name" unless one of type `title` is given — a property of another type named
"Name" is then refused (`properties[0].name: "Name" is the name of the title property …`) on both. A value of a
**two-way relation** is refused ([two-way relations](#two-way-relations)); a one-way relation takes row ids or titles.
Everything else that doesn't fit fails the whole call and names every problem (with the allowed values). **Filters** (`one_query_database`) are `[{ property, op, value }]`, all must hold; `op` is
`equals`, `not_equals`, `contains`, `not_contains`, `is_empty`, `is_not_empty`, `gt`, `gte`, `lt`, `lte` (numbers and
dates). **Sort** is a property name, `createdAt`, `updatedAt` or `order` (the table's order, the default); `-` in
front sorts descending (`"-Due"`). Results are JSON; failures are MCP tool errors (`isError: true`) with a message an
agent can act on.

## Two-way relations

Two-way relations stay out of MCP until T-b (the owner's decision), on the local bridge and the team server alike: a
value of a two-way relation — an explicit pair (the related database has the reverse property), a database's
**sub-items** pair (*Parent item* / *Sub-items*) or its **dependencies** pair (*Blocked by* / *Blocking*) — would write the
linked rows as well, so `one_create_row`, `one_update_row`, `one_upsert_rows` and the rows of `one_create_database`
refuse it before anything is written, clearing it (`null`, `[]`) too:

    refused_type: properties.Parent item: "Parent item" is two-way (or a sub-items / dependencies pair); set it in One.
    Nothing was changed. A one-way relation is fine; leave this property out, or ask the person to set it in One.

The bridge checks again when the card is approved (a relation made two-way while it waited is refused the same way).
`twoWay: true` in `one_create_property` or `one_create_database` is refused too (`refused_type: relation.twoWay: …`) —
a relation made over MCP is one-way; the person makes it two-way in One. A one-way relation (and `twoWay: false`) is
fine. The words and the rule are shared ([`src/shared/mcp/twoWay.ts`](../src/shared/mcp/twoWay.ts)); reads still say
`twoWay: true` for a pair (`one_get_database`). The AI terminal and custom agents keep their own rules.

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
  colour rules), and a rollup in another database that rolls it up is cleared (the card says *Also clears the rollup
  “Total” in Reports*) — refused while that database is locked or One's own. Views take the friendly names: `groupBy` (a board needs a status, select, multi_select, person or
  checkbox property), `dateProperty` (calendar and timeline need one; a feed orders by it), `filter` in the shape of
  `one_query_database` (ANDed; dates also `today`, `tomorrow`, `yesterday`, `one_week_ago`, `one_week_from_now`;
  people by name or `me`), `sort`, `properties` (the visible ones, in order). Chart and form views are set up in the
  app.
- **Locked databases** take rows and values but no structure change (properties, options, views). Locking and
  unlocking is the person's decision: `one_update_database` refuses `locked`. B checks again when a card is approved:
  a database locked while the card waited takes no property and no new option (`one_create_property`,
  `one_move_row`: `locked`); a relation made two-way meanwhile takes no value (`refused_type`); a page that became one of One's own
  databases' meanwhile (moved into the memory) takes no text, title, icon, move or trash (`system_database`).
- **Reorganising.** `one_move_page` moves pages and databases under another page or to the top level and places them
  `before` / `after` a sibling or at an `index` (0 = first) among the siblings people see. Refused: into itself or its
  own sub-pages, into a database (a page does not become a row here), template pages. Rows stay in their database:
  `one_move_row` moves a row (with its content) into another database only when every value it has fits a property
  of the same name and type there — select / multi_select options are matched by name and missing ones added, status
  options must exist, relations must point to the same database and not be two-way, and no other row may link to it.
  The target's key stays unique (a row whose key value another row there holds is refused) and its `onlyByHand`
  properties stay the person's (a value that would land in one is refused) — bridge and team server alike.
  Otherwise the answer lists what does not fit. Unique ids are numbered anew in the target. A row with a **record
  type** takes it along: the target gets the type and its properties (the answer says `recordType: { name,
  addedProperties }`); a locked target refuses that (`locked`), and a type that is gone leaves a plain row — bridge and
  team server alike.
- **Not offered:** turning a page into a database entry or back (the sidebar's drops — they ask the person on the
  way), and, in a team workspace, moving between *Private* and the workspace. Both stay in the app.
- **What they start.** Rows going to the trash start their *row deleted* automations; a property change or delete that
  clears values starts *property changed* automations and autofill on those rows; a row moved with `one_move_row`
  starts the target database's *property changed* automations, row-triggered agents and autofill (its values land
  there), and `one_update_page` on a row names what a rename starts (the title property) and the autofill its text
  feeds. The card names it (*Starts: …*) and
  5 or more such rows that start paid AI work or send something out of One are **always asked**, also in *Apply
  directly* — as for row batches.
- **Safety.** The destructive tools (`one_trash_page`, `one_delete_property`, `one_update_property`, `one_delete_view`)
  carry `destructiveHint`, so clients ask before running them. Local bridge: *Ask first* shows a card for each —
  *Database “Projects” with 8 rows → trash*, *Delete property “Budget” from Projects* with *Values · 8 rows lose their
  value*, the options a change removes with the rows that lose them; *Apply directly* logs every change with an
  **Undo** (a trashed database comes back with its rows, a moved page goes back, a deleted property comes back with
  its values and view settings, view changes are reverted, a restored page goes back into the trash — all or nothing:
  refused whole when anything of it changed since); *Read only* refuses them.
  Team server: a **write** token is needed; changes carry `api:<tokenId>` as `updatedBy`.

## Tasks

Task blocks (`workItem`, UI "Task") through the **local bridge** — the team server learns them later (server parity).

- **The form.** A task is a quote: `> [!TODO] Title {#handle}` — the title line, an optional `{#handle}` (`[A-Za-z][A-Za-z0-9_-]{0,23}`,
  for links within the same call) — then a field line, fields separated by ` · `, all optional: `Status: todo | in
  progress | done` · `Due: YYYY-MM-DD` or `YYYY-MM-DDTHH:mm` · `Reminder: at | -15m | -1h | -1d` (needs a due date) ·
  `Owner: names, comma-separated` · `Blocked by: …` · `Related: …` · `Blocks: …` (a link is a `#handle` of this
  write, a task id `wi_…` or an exact task title). Notes follow as lines and blocks of the quote. `one_get_page` reads
  existing tasks as `> [!TODO] Title {#wi_…}` with their field line.
- **Ids are One's.** Every new task gets its id from One, minted per call — the result lists the id each new task got;
  use those ids later. A `{#wi_…}` is kept only for the task the replaced content holds (a replace of a page that
  keeps a task's quote with its id keeps the task); an id of a task elsewhere makes a new task.
- **Existing tasks change only through `one_update_work_item`.** Editing a task's field line in text changes nothing
  (the result says so); its title and notes follow the text.
- **People are never created.** An owner must be a person of the workspace — by name (exact, any case), a member's
  email or `me`; an unknown name refuses the call with the list of names (never emails).
- **Links** reach only live tasks of the workspace (never a template's, never one in the trash), never so that a
  shared task waits for a private one; a link that would close a loop — also through changes still waiting for approval
  — is refused (in Markdown: left out, and said so). ≤ 100 new tasks per write, ≤ 50 updates per call (and ≤ 50 existing tasks a write's `Blocks:` reaches),
  ≤ 12 people and ≤ 20 links per task (`Blocks:` included).
- **Reminders and assignments are always asked** — see *Apply directly* below.
- `one_list_work_items` — filters: `status` (`open` = todo + in progress, the default · `todo` · `in_progress` ·
  `done` · `any`), `person` (a name, a member's email, `me`, `none`), `pageId` (that page and below), `blocked`,
  `overdue`, `dueBefore`, `query` (part of the title), `limit` (1–100, 50). Answer: `{ count, items: [{ id, title,
  status, due, reminder, people: [{ id, name }], blocked, overdue, blockedBy: [{ id, title, status }], related: [{ id,
  title }], page: { id, title, path }, url }], truncated?, loading? }` — overdue first, then by due date.
- `one_update_work_item` — `updates: [{ item: "wi_…", status?, due? (null clears), reminder? (null clears), people?:
  { add?, remove? }, blocked_by?: { add?, remove? }, related?: { add?, remove? } }]`; everything is checked before
  anything is written (one bad entry changes nothing). The card shows each task's fields before → after; the answer
  lists the tasks as they are afterwards (the list's shape). A call that would change nothing is answered without a
  card.

## One Script

The local bridge offers the person's [One Script](../src/app/help/articles/en/one-script.md) (the tab runs it; the
team server does not have these two tools — its workspace model would need the script runtime ported):

- **`one_run_query`** runs code in the script engine's *query* mode: it only reads — writes, effects (mail, Claude,
  web) and dialogs are refused with an error. The answer is the value of the last expression: a table result
  (a query, a list of rows or records) as `rows` with the row `id` (keep it with `.select(id, …)`), at most 100,
  `count` = how many matched; anything else as `value`. Syntax and run errors say where (`line:col`). The tool
  description carries the language reference.
- **`one_run_script`** is a **dry run** of a saved script (by id or exact name; `one_overview` lists them) — over MCP
  a script never runs (the owner's decision until T-b): the script's dialogs answer their defaults, nothing is
  written, sent, trashed or asked, and no card is shown (also in *Ask first*). The answer is the dry run's report —
  `{ script, ran: false, mode: "dry", status, changes, effects, printed, result, note }`, every change
  (*set · Angebot schreiben · Aufgaben — Priorität: Niedrig → Hoch*; a new option of a select bound to a shared list as
  `addsToList`) and every effect (*mail · to …*) — and `note` tells the agent to ask the person to run it in One →
  Scripts. Agent activity notes *Dry run only — the person runs it in One → Scripts*. *Read only* refuses it, as every
  write tool. The dry run stops where a run would write into One's own databases (`system_database`), into the text of
  a page locked in One (`locked`) or `replace()` a page with context marks (`rejected` — it would overwrite what Claude
  may not read; `append()` stays allowed); there is no Undo because nothing changed. `dryRun: true` is kept for older
  clients and answers the same; a saved *query* answers at once (read-only).

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

Is it connected? In One, ⌘K **MCP · Connections** (`#/mcp`) shows this tab's bridge (client, change mode, calls) next to
every other MCP connection One knows of — its own Claude's MCP servers, the coding worker, the team server's `/mcp`. The
page reads only what the tab already knows: opening it sends nothing.

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
| **Apply directly** | answered at once | written right away — except a change that assigns someone, sets a reminder, changes a task someone is assigned to, adds a blocker to an existing task or removes tasks, and a batch of 5 or more rows that starts paid AI work or sends something out of One (also counted from the rows a call touches in databases that can — [one gate](#what-mcp-never-changes)): that one is **always asked** (the card says why: *Always asked: Names a person*) |
| **Read only** | answered at once | refused: *One is set to "Agents can only read"* |

- **One call, one card** — also for a batch: 50 sub-pages, a board with its rows, 20 rows changed at once are one
  card with a line per page or row, one Approve, one Undo.
- Every call — read or write, and how it ended (OK, error, refused, expired, cancelled; a repeat answered from an
  earlier call says so) — is listed in the **Agent activity** log of the settings tab. Applied writes have an **Undo**
  there (approved ones also get an Undo toast). **Undo is all or nothing** (features/mcp/undo.ts): while the call
  applies, the tab notes every page and database it writes under its own writer and what each was before; when it
  ends, it keeps them as the call left them — and the live pages below every page the Undo would trash (what the call
  made, what it brought back from the trash), and the row values and uses (rollups, formulas, views, forms) of every
  property it added to an existing database. The Undo compares: if **anything** of it differs now — whoever changed
  it, the call's own *row created* automations and autofill included —, a page sits below one it would trash, or
  someone else wrote one of them while the call ran, it writes **nothing** and says what changed: *Not undone:
  “Kick-off” changed since (values). Nothing was put back.* — *Take it back by hand with Versions or the trash* (in
  the local workspace also *Eject in the flight recorder*); the entry keeps no Undo key. Otherwise everything goes back
  in **one** store update as the person's Undo (`you~undo`): what the call made to the trash (never deleted for good),
  what it changed as it was (an option a row still holds stays; counters and last-run stamps are bookkeeping and stay
  as they are). The answer to a repeat of an undone call is forgotten: repeating it makes the thing again.
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
  prompt need bridge **1.2.0** or newer, the task tools (`one_list_work_items`, `one_update_work_item`) **1.8.0**, the
  T-a contract **1.12.0** — reads in full (`format`, `cursor`, `refs`, `comments`), `one_list_pages`, sub-page trees,
  boards with views and rows, rows in bulk, `one_upsert_rows`, strict arguments, repeats answered once. An older bridge
  lists only the tools it was built with; One shows *Bridge 1.x — update to 1.12.0 for the newest tools* in *Settings →
  Agents · MCP* and on `#/mcp` (it keeps working as before). The other way round — a newer bridge, a One tab not
  reloaded since an update — the bridge refuses a tool or argument the tab did not announce (`app_outdated`: reload
  One) instead of sending it to a tab that would drop it.
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
- **Two layers against version skew.** The bridge refuses an argument its own contract does not declare
  (`bad_argument`) and anything the tab did not announce in its hello (`app_outdated`; a tab that announces nothing is
  held to contract 1, so a newer argument such as `private: true` never reaches an older tab, which would ignore it and
  make a shared page). The tab refuses undeclared arguments once more itself.
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
| **Chrome, Edge** (Chromium) | Works. Loopback addresses are *potentially trustworthy*, so `ws://127.0.0.1` from an `https` page is not mixed content. Checked with Chromium 141: an `https` page connects and gets the bridge's `welcome` — also with the page forced into the *public* address space and the Local Network Access checks switched on by flag. Chrome 142+ ships **Local Network Access**: a site that reaches *apps and services on this device* may have to ask once — choose **Allow**. While the browser reports the permission as pending the tab says so; if it was **blocked**, the tab shows *Blocked by the browser* and the way back (the icon left of the address → site settings → allow local network access, then *Retry now*; in an installed app's window, which has no address bar, the text names ⋮ → *App info*). There is no server opt-in header for this — the old *Private Network Access* preflight headers never applied to WebSockets — so the bridge sends none. |
| **Firefox** | Expected to work: Firefox also treats `127.0.0.1` / `localhost` as potentially trustworthy (not tested here). |
| **Safari** | May refuse `ws://` from an `https` page as mixed content even for loopback (not tested here). The constructor then throws and the tab shows *This browser does not let a secure (https) page talk to the bridge* — use Chrome, Edge or Firefox for agents, or a local build (`npm run dev` / `vite preview` on http://localhost). |

Self-hosted builds served from `http://localhost` / `http://127.0.0.1` have none of these restrictions.

### The tab protocol

For other implementations: JSON text frames, subprotocol `one-mcp.v2`, defined in
[`src/shared/mcp/contract.ts`](../src/shared/mcp/contract.ts) (shared by the bridge, the app and the team server;
tables, error codes and duplicate keys beside it in `src/shared/mcp/`).

| Direction | Message |
|---|---|
| tab → bridge | `{ type: "hello", app: "one", version, workspace: { id, name, kind, readOnly }, mode, tools?, contract? }` — first message (contract 2: `tools` = each tool the tab runs with its argument names; a bridge refuses anything else with `app_outdated`, a tab without `tools` is judged against contract 1); then `status` with the same fields when they change (another `id` = the tab now shows another workspace) |
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
   things, **read** gives it only the eight read tools (the write tools are not even listed) — and the `one` prompt.
   **Comments (MCP)** (off · read · read + write — a read token never writes) decides whether
   `one_get_page { comments: true }` gets the comment threads ([Comments](#comments)); off by default.
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
  synced blocks and meeting notes (with transcript); a task block (`workItem`) as its title line and notes (its fields
  stay the app's for now — the team MCP never writes the `> [!TODO]` form). Comments only with the token's comments
  flag; buttons show their label only. `format: "blocks"` reads every block with its data and the same refs as the
  bridge ([Reading a page in full](#reading-a-page-in-full)) — spreadsheet cells come with their input and
  `value: null` (the server has no formula engine), charts with data only when it is typed in.
  The task tools (`one_list_work_items`, `one_update_work_item`) are local-bridge only until server parity.
- **Content in** is the API's [markdown-lite](API.md#content-markdown-lite) (headings, paragraphs, lists, to-dos,
  quotes, code, dividers, marks, links); other Markdown stays text. `one_update_page` appends after the last block or,
  with `mode: "replace"`, replaces everything — editors open on that page follow along live. A page that holds a
  task block is never replaced: the server cannot read or write a task yet (its Markdown prints one as plain blocks,
  so a read → edit → replace round trip would turn every task into paragraphs) — `replace` answers
  `lossy_replace` (*… holds tasks; a replace over the team server would turn them into plain text*) and changes
  nothing (a server agent's report in replace mode notes it in its run); `append` works as always, until server parity.
- **Beyond the REST API**: `one_update_page` (content, title, icon), `one_create_database`, `one_create_property`
  (options, one-way relations — `twoWay: true` is refused —, unique ids numbered for the existing rows, the property shown in every view), new
  select options from `one_create_row` / `one_update_row`, the [tidy-up tools](#tidying-up) (properties, options,
  views, moves) and `one_trash_page` — a **soft delete** exactly like the app's (`trashed: true`, `trashedAt`): the
  page (with everything below it) is in the app's trash and `one_restore_page` (or the app) brings it back. A
  **locked** database takes rows and values but no new properties, options or views; a **locked page** keeps its text
  (title and icon may change). Sub-page trees, boards with views and rows, rows in bulk and `one_upsert_rows` work as on
  the bridge ([Sub-pages and batches](#sub-pages-and-batches), [Boards in one call](#boards-in-one-call)): every row
  and page is checked before the first write; a batch that fails mid-way takes back what it wrote, and a database whose
  block or rows could not be written goes to the trash again.
- **Checked before it writes.** All checks — locked, template, trash, One's own databases, tasks, a replace its Markdown
  cannot carry — run before any content is written; a check that fails only after the write (a race) puts the content
  back from the call's copy. A `replace` of a page holding blocks the server's Markdown cannot write (columns, a
  database, a callout …) is refused (`lossy_replace`) — use the local bridge with *Ask first* for those.
- **Backlinks** in `one_get_page` come from the stored content of every page (page links, @-mentions, `#/p/` links,
  database blocks). Content is stored a few seconds after typing stops (at most 10 s), so a link made in that moment
  may be missing.
- **No approval step**: the token is the permission. Give an agent a **read** token when it should only look.

### What the server does without a card (pre-images, restore)

The team server has no approval card and no Undo of its own, so it keeps, **for the calls that make or overwrite
something**, what it needs to put that call back — a *pre-image*: the rows it made (with their values), each row field
it changed (before → after), the pages and databases it made, and a page's content right before a `replace` (or before
a link or database block was written into it, or before `one_upsert_rows` wrote a row's body). Kept for
`one_create_page`, `one_create_row`, `one_update_row`, `one_upsert_rows`, `one_create_database` and a replace of
`one_update_page` — **not** for property, option or view changes (`one_create_property`, `one_update_property`,
`one_delete_property`, `one_update_database`, the view tools), moves, trash and restore, a page's title or icon, or a
plain `append`: those are not listed and are undone in One (the page history, the trash). Pre-images are sealed with the workspace's key, kept **14 days** and deleted with the workspace; REST
API writes keep none.

**Workspace settings → Automation → API → Recent MCP writes** (owners and admins) lists the last 100 calls — the
tool in words, the token, what it made and changed, the first titles, its age — each with **Restore**. Restore is
**all or nothing** (the owner's decision; the bridge's Undo follows the same rule):

- **nothing the call made or changed was touched since** → it all goes back in one Restore: each field it wrote gets
  its earlier value (a two-way relation as the app sets it, its partner rows in step), each text it replaced — or wrote
  a link (`linkInParent`) or an inline database's block into — gets its earlier text, and the pages, databases and rows
  it made go to the **trash** (what lies below a made page or database goes along with it, as in One);
- **anything moved since** → refused `409 changed_since`, and **nothing is written**; the answer and the row name each
  thing and what moved: a field it wrote (named), a text it wrote into — added to or only deleted from —, a made page's
  or row's title, text, stored values (a field filled in that was empty too), icon, cover or comment threads (a made
  database's properties and views), its place (moved), the trash, a page or row someone put below it, and a page whose
  text would go back that was locked in One since. Whoever changed it counts — a member, the REST API, a server agent.
  Undo it in One instead (version history, the trash). "Changed" means the text: a member who only
  opened the page (the editor's empty paragraph after a closing list, heading, table or database block, the block ids it
  fills in) changed nothing;
- **Restore anyway** (`force`, offered only when it can help) puts back the texts the call replaced and the fields it
  wrote, whole — what was changed there since goes (the dialog says so) — and **never trashes anything**: what the call
  made stays, with the link or database block it wrote for it, and is listed (`left`) to trash by hand. A call that only
  made things has nothing it could put back, and a page locked since is never written: both stay refused;
- a call goes back as a whole, once: the row says *Put back*, a second Restore changes nothing; a call put back is
  forgotten for repeats (the same call again makes the thing again);
- `one_upsert_rows` keeps the pre-image of the fields it wrote only (never the row's other fields), and a call that
  fails mid-way takes everything back — the rows it made, the values and the texts it wrote;
- restoring twice changes nothing. Routes: `GET /api/workspaces/:id/mcp-calls`,
  `POST /api/workspaces/:id/mcp-calls/:callId/restore { force? }` ([API.md](API.md#recent-mcp-writes)).

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
| Limits | shared with `/api/v1`: 120 requests per minute per token (`API_RATE_LIMIT`; every JSON-RPC request counts — a client's start is 2–3 of them), 30 failed authentications per minute per client address, 256 KB per request for a read token and 512 KB for a write token (a tool call over it is answered `too_large` — split it), 100 rows per query answer |
| Reverse proxy | nothing to configure (no streaming); Caddy from `docker-compose.yml` works as it is |
| Logs | tool calls that change something are logged (`mcp page updated` …) with the token id — never the token |
| Version | `serverInfo.version` = `<server version>+mcp.2`; `GET /api/config` lists `mcp:2` in `supports` while the server serves contract 2 (T-a). The team server and the app update together: an older server keeps its tools as they were; the app reads `supports` and, on a server without `mcp:2`, shows no *Recent MCP writes* and no token *Comments* choice, but one line: the team server needs an update |

The static file `/mcp/one-mcp.mjs` (the local bridge, part of the app build) is served next to the endpoint as usual.
