# SimpleCMS One — project guide

A local-first rebuild of Notion "on steroids", plus a landing page with a one-time
"1997 spreadsheet gets smashed by a 3D hammer" intro. Static site on GitHub Pages
(`/SimpleCMS/`), no backend. Submission for the "Ninja Armory" challenge (AI Automations
by Jack, Skool) — judged on: effectiveness, how great it looks, creativity, simplicity, value.

## Commands

- `npm run dev` — Vite dev server (landing at `/`, app at `/app/`). Use a fixed port: `npx vite --port <p> --strictPort`.
- `npm run typecheck` — `tsc --noEmit -p tsconfig.app.json` (must be clean before you finish).
- `npm run build` / `npm run build:pages` (base `/SimpleCMS/`).
- `node scripts/shot.mjs <url> <out.png> [--w --h --dark --full --mobile --wait --eval --click --clear-storage]`
  — Playwright screenshot + page error dump. Put screenshots in `.shots/` (gitignored). LOOK at them (Read tool).
- Playwright 1.56.1 with the preinstalled Chromium (`PLAYWRIGHT_BROWSERS_PATH` is set). Never run `playwright install`.
- Do not add npm dependencies without a strong reason; everything listed in package.json is available
  (react 19, zustand+immer, tiptap v3 + extensions, @floating-ui/react, lucide-react, cmdk, frimousse, @dnd-kit,
  date-fns, three, gsap, d3-delaunay, d3-force, katex, mermaid, lowlight, fuse.js, fflate, dompurify, html2canvas-pro,
  @anthropic-ai/sdk, idb-keyval, nanoid).

## Structure & ownership

```
index.html, src/landing/main.ts      landing entry (orchestrates site + intro)
src/landing/intro/**                 1997 spreadsheet page + idle detection + Three.js hammer smash
src/landing/site/**                  the new marketing site (revealed under the smashed page)
app/index.html, src/app/main.tsx     workspace app entry (boot: load IndexedDB → seed → persistence)
src/app/store/**                     data model (types.ts = CONTRACT), zustand store, persistence, selectors, ui store
src/app/lib/**                       router (hash), ids, files (IndexedDB blobs), colors, theme
src/app/ui/**                        shared primitives: Popover, Menu/MenuList/useMenu, Modal, Tooltip, Switch/Kbd/Led,
                                     PageIcon, IconPicker; ui.css = base + primitive classes
src/app/i18n/**                      t()/useT(); per-area strings in src/app/<area>/messages.ts
src/app/shell/**                     layout, sidebar, topbar, page view, command palette, settings, modals host …
src/app/editor/**                    TipTap block editor (public API: editor/index.ts)
src/app/database/**                  databases & views (public API: database/index.ts)
src/app/features/**                  AI (+ workspace agent), history, graph, share, import/export, present, automations,
                                     templates (+ repeating, own templates), journal, inbox + reminders, sync (folder /
                                     GitHub Markdown, per-device IndexedDB `one-sync`), mcp (local bridge UI), sheets
                                     (spreadsheet engine + grid; functions/ = custom functions built by clicking), charts
                                     (SVG renderer, chart builder, data sources) (public API: features/index.ts)
src/app/help/**                      help centre: panel (?, status bar, ⌘K, workspace menu), 63 articles EN+DE twins
                                     (help/articles/{en,de}/<id>.md, `help:<id>` links), Ask (Claude over the articles);
                                     link UI to an article with `<HelpLink id="…" />` (public API: help/index.ts)
src/help-site/**                     build-time public /help pages (prerendered from the same articles, hreflang)
src/app/features/agents/**           custom agents (#/agents, editor, browser runner, review, server-agent settings)
src/app/features/script/**           One Script: lang/ (lexer, Pratt parser, AST, async interpreter — no eval / new Function),
                                     runtime/ (One objects, effects, run / dry / query, trust, run log), editor/, builder/
                                     (visual query builder), #/scripts (public API: script/index.ts; engine lazy via
                                     loadScriptEngine())
src/app/features/commands/**         database commands (sidebar ⌘ key, toolbar, ⌘K; registerCommandKind)
src/app/features/mail/**             Gmail sync → "Mails" database (own Google client ID)
src/app/cloud/**                     team-cloud client: store ⇄ Yjs binding, page documents, private pages, files
                                     (public API: cloud/index.ts; protocol + meta-document schema: docs/CLOUD.md)
server/**                            team-cloud server (Node, Hono, Hocuspocus, SQLite; AGPL) + public API (docs/API.md)
                                     + team MCP at /mcp (docs/MCP.md); content encrypted at rest (docs/CLOUD.md § Tenancy)
mcp/**                               local MCP bridge (Claude Desktop / Code ⇄ the open tab), bundled to public/mcp/
                                     one-mcp.mjs + the Claude Desktop extension one.mcpb (`npm --prefix mcp test`)
mcp/src/worker/**                    one-worker (coding pipeline, Claude Code + git on the person's machine), bundled to
                                     public/mcp/one-worker.mjs; src/app/features/coding/** = #/coding, task panel, Settings →
                                     Coding worker (public API coding/index.ts; protocol.ts shared with the worker; docs/CODING.md)
public/assets/icons|covers           generated art (OpenArt) + manifest.json
```

Areas talk to each other ONLY through their `index.ts` public API, the store (`useWorkspace`),
and the UI store (`useUI`: openModal/openPeek/openPalette/toast …). Keep exported names/props of
the public APIs stable — other areas are built against them in parallel.

## Data rules

- All persistent data goes through `useWorkspace` actions in `src/app/store/store.ts`. Never mutate state directly.
- Page content is TipTap JSON. Write it ONLY with `setContent(pageId, json, origin)`; `origin` is the writer
  (editor instance id, 'history', 'ai', 'sync', 'import', 'synced' = synced-block service, 'file' = folder / GitHub
  pick-up, 'template' = a template copy, 'split' = blocks turned into a page …). Editors must apply external updates when
  `page.contentOrigin !== <own id>` and `contentRev` changed.
- Database rows are pages with `databaseId` set (parentId = database page id). Title lives in `page.title`.
- Binary files (images, attachments) go to IndexedDB via `saveFile()` → `"onefile:<id>"`; display with `useFileUrl()`.
- Public assets are referenced WITHOUT leading slash (`assets/covers/dunes.webp`) and resolved with `resolveAssetUrl()`
  so they work under the `/SimpleCMS/` base.
- Internal links: `#/p/<pageId>` (see lib/router.ts). Hash routing only (GitHub Pages).
- Computed, never stored: property types `created_time`, `last_edited_time`, `created_by`, `last_edited_by`
  (from `page.createdBy` / `updatedBy` — account ids in team workspaces, `api:<id>` / `hook:<id>` for the public
  API; absent locally), `formula`, `rollup` (`unique_id` is assigned once and stored). Filter value token `'@me'` = the
  signed-in member (team) / the local user. `Database.locked` blocks schema and view edits, rows stay editable.
- `DateValue.reminder` and the date `mention`'s `reminder` attr hold a reminder code (`'at'` | `'-<n><m|h|d|w>'`,
  see features/inbox/reminders.ts); inbox state is per device (IndexedDB `one-inbox`), never synced.
- Team workspaces: `Page.private` is a local marker set by the cloud binding (the page lives in the member's
  private documents); move pages between Private and the workspace ONLY with `movePagePrivacy()` (cloud/index.ts).
- Local persistence (store/persistence.ts, layout v2): one IndexedDB record per page (`one.page.v2:<id>`) and per
  database (`one.db.v2:<id>`) plus `one.ws.v2`; the old single record `one.workspace.v1` is converted on first save.
- `Page.template` marks a template root (hidden subtree, features/templates): keep template pages out of normal lists
  with `inTemplate()` and out of pickers with `templateScope()`; the server API / MCP treat them as not found.
- Custom functions: `Workspace.functions` (body = an `FnExpr` tree, never code) — write only with `upsertFunction` /
  `deleteFunction`; synced through the meta map `functions`; every reader sanitizes (store/functions.ts); database
  formulas reach them through lib/formulaFunctions.ts. No eval / `new Function` anywhere in formula code.
- Secrets: `settings.aiApiKey` / `GitHubConfig.token` hold vault markers (`vault:<id>:<last4>`), the secrets are sealed
  in IndexedDB `one-vault` (lib/vault.ts). Read the Claude key only via `getAIKey()` (store/secrets.ts), the GitHub
  token only via `openGitHubToken()`.
- Markdown files One reads back (Markdown export, folder / GitHub sync) write date / person mentions as
  `[@label](one:date/<id>?r=<code>)` / `[@label](one:person/<id>)` (features/io/import/mentions.ts); share / site /
  HTML exports never do.
- Team cloud: every account gets a personal workspace (`CloudWorkspace.personal`); server content is encrypted at rest
  with a key per workspace wrapped by `DATA_KEY` (docs/CLOUD.md § Tenancy & encryption at rest).
- Team cloud invites: workspace invites can be reusable (`max_uses`, validity, allowed domains; never admin) or sent to
  several addresses; server admins (`ADMIN_EMAILS`, Settings → Server) create registration links `#/signup/<token>`
  for invite-only servers (docs/CLOUD.md § Invites & registration links).
- External MCP servers for One's own Claude (features/ai/mcp-servers, Messages API MCP connector — Anthropic connects
  to the server): `settings.mcpServers` is per device; `token` holds a vault marker, the token is sealed as
  `mcp-token:<serverId>`. Write the list only with `updateSettings({ mcpServers })`; open a token only via
  `getMcpToken()` (store/secrets.ts) at request time — it goes only into `mcp_servers[].authorization_token`. Free-form
  requests (agent, own AI-menu requests, ⌘K "?") get every enabled server, other requests only `scope: 'all'`
  servers; client.ts decides centrally. No server is preset in the app. `McpServerConfig.codeword` (1–24 `[a-z0-9_-]`,
  unique, never `one`; sanitised in `readServers`): a free-form request starting with `<codeword>:` gets that server
  (`codewordsIn()` + `attachMcp(…, { forced })` in client.ts; the AI terminal via `codewordTask()`), the prefix is
  stripped and Claude told it was addressed; a switched-off server stays off and shows as a `skipped` McpCall.
  A server whose token an API error said was rejected (`noteRefused`, config.ts; in memory, per tab, until its token
  marker changes or a connection test passes) is left out of requests that did not address it (skipped 'refused', a
  note); a request that fails with `mcp_auth` for an unaddressed server runs once more without it (client.ts
  `retryWithout`, the terminal's `attempt()`). Codeword-addressed servers, custom agents' servers and tests are forced.
- MCP media (features/ai/media): cards for media in `mcp_tool_result` blocks and the links Claude wrote to the same
  hosts — never loaded by themselves. Save to One / Preview fetch only on a click (credentials 'omit', ≤ 50 MB images /
  200 MB video + audio, type and magic numbers must agree, SVG kept as a download), then `saveFile()` and a block with
  origin 'ai'; the terminal stages ChangeKind 'media'. CORS refused → Open / Upload a copy; team: `POST
  /api/workspaces/:id/files/fetch` (SSRF guard, docs/API.md). `/generate image|video` = a forced request to ONE server
  (no memory, no page text unless ticked); the chosen server per device in localStorage `one.generate.server`.
- MCP sign-in (mcp-servers/oauth.ts, `McpServerConfig.oauth`): protected-resource metadata → the first listed
  authorization server that is CORS-readable with PKCE S256 (self-registration preferred; the host's own only when none
  is listed) → DCR → PKCE in a window → return to `<app>/?oauth=mcp` (no `#`; main.tsx → `#/oauth/mcp`); state + verifier
  per attempt in sessionStorage; sign in with a code (RFC 8628) when the return is refused or never comes. Access token =
  the server's `token` (vault marker), refresh `mcp-refresh:<id>`, client `mcp-client:<id>`; `tokenFor()` refreshes before
  expiry; never in backups / exports. No service is preset or named in the app.
- AI-menu runs (features/ai/runs.ts) live outside the panel: closing it or leaving the page never aborts a run — only
  Stop / Discard; targets are mapped through doc changes (runsTarget.ts). Mount `AIRunsSlot` once per editable editor.
  Results are per device in IndexedDB `one-ai-runs` (key `<scope>|<runId>`, scope `local:local` / `cloud:<id>`), never
  synced or exported, wiped with the workspace copy (cloud/device.ts). "Turn into database" (features/ai/todb) writes
  rows and their bodies with origin `'ai'`.
- AI terminal (features/ai/agent; the ⌘J dock, full screen at phone width): a task keeps running while the terminal is
  hidden — only Stop / ⌘. / `/stop` ends it; every write is staged and reviewed (incl. `create_database` / `add_property`,
  applied pages → databases → properties → rows; `TERMINAL_TOOLS` = `AGENT_TOOLS` + those two — custom agents keep
  `AGENT_TOOLS`); prompt history per device + workspace in localStorage `one.term.history:<kind>:<id>`, never synced;
  references (⌘⇧J / bubble "Add to terminal") send the selection as Markdown with page title + id.
- AI terminal `edit_page` (features/ai/agent/edit.ts): `read_page { refs: true }` labels top-level blocks and list / to-do
  items `⟦b3⟧` (per tab, by block id; every write tool strips refs). Ops replace / delete (from, to?) · insert_after ·
  replace_all, ONE staged change per edit (ChangeKind 'edit'); refs of blocks the context marks exclude are refused. Apply:
  `snapshotNow 'ai'`, then all applied edits of a page in ONE transaction, origin 'ai'; an edit whose blocks changed since
  staging is skipped. Custom agents' edits always wait for review; server-runner agents have no `edit_page`. Terminal
  commands: `/new` = `/clear` (`/neu`, `/leeren`); `/clear-history` (`/verlauf-leeren`) asks y / n, then removes
  `one.term.history:<kind>:<id>`.
- AI terminal `create_pages`: one page per item in ONE call (≤ 50, each its own staged `create_page`, ids back in order;
  a pending page with the same parent + title is updated). `TERMINAL_TOOLS` = `AGENT_TOOLS` + create_database / add_property /
  write_script / create_pages. `MAX_TOOL_CALLS` = 40 per task (MCP calls don't count; backstop +12); hitting it ends as
  'limit' with Continue (key, ↵ on the empty prompt, `/continue` = `/weiter`, `continueTask()`: same conversation + staged
  changes, fresh budget). Applied content (agent/links.ts `withPageNodes`): `[Title](#/p/<id>)` whose text is the page
  title → a page `mention`; a paragraph holding only one → `pageLink`.
- AI-menu intent routing (features/ai/intent.ts `requestIntent`, EN + DE, no Claude call): 'topage' → Turn into page,
  'pagesPerItem' → Sub-page per item, 'todb' → Turn into database first, 'terminal' → "This needs the AI terminal — run
  it there" (`runInTerminal`, agent/refs.ts). Sub-page per item (editor/split/items.ts `pagesPerItem` / `itemCount`): list
  items / heading sections / table rows → sub-pages (origin 'split', private when the page is) + ONE table of page
  mentions with ≤ 3 fields, one transaction; grip Turn into, AI menu 'pagesPerItem', Transform into → "Pages + table".
- Word-level diff: features/history/docDiff.ts (pure) + `DocDiff` (history/DiffDoc.tsx) — History "Changes" and every
  edit review use them. Row history (features/history/props.ts): a snapshot holds content + title + icon and, for a row,
  `props` = { databaseId, stored values (never computed), defs then }; snapshots without `props` = content only. AI /
  agent / automation / MCP / autofill writes to rows run inside `aiWrite(fn)` (one "AI" version per page per call). Restore
  writes values with `writePropertyValue` only for properties that still exist with a compatible type.
- Transform into … (features/ai/transform; run kind 'transform'): selected blocks → Auto (classification call, then the
  form) · Board / Table / Timeline (todb machinery) · Diagram (`mermaid`, checked with `mermaid.parse`, one repair round) ·
  Chart (`chart`, manual ChartSpec via `normalizeSpec`; only numbers the text states) · Columns / Tabs / Toggles / Cards
  (TipTap JSON built by code, never HTML). Preview first (cached per form in `AIRun.transform`); applied in ONE
  transaction after `snapshotNow`, origin 'ai'; "Keep the original" = a closed `details` below. Only the selection goes
  out (no memory; MCP `scope: 'all'` only).
- Context marks (editor/context; per tab, in memory, never saved or synced): an AI request reads a page's text only
  through `readableContent(pageId)` (AI menu: features/ai/reads.ts `pageRead()`; ⌘K "?"; AI terminal: `withReadLimit`)
  — never send `page.plain` for a page-level request. While picking, the editor's DOM is `inert`; never pause typing
  with the `editable` prop (TipTap's useEditor copies `isEditable` into its options on re-render).
- Redo with instructions (features/ai/redo): run kind `'redo'`; presets per device in localStorage `one.redo.presets`
  (≤ 20); accepted passages are applied by block id in ONE transaction after `snapshotNow`; a changed passage is skipped.
- Claude for images (features/ai/image): run kind `'image'` (describe → alt + caption, read → Markdown, table → table /
  spreadsheet / database, ask); the picture goes to Anthropic only on these actions, as a base64 image block (≤ 1568 px,
  ≤ 5 MB) loaded in the browser (no proxy; CORS → "Upload a copy"); AI-terminal image references `TermRef.image`.
- Claude for files (features/ai/file): run kind 'file' on any `fileBlock` (uploads, mail attachments, web files). Claude
  actions (summarize / extract → page / tables → table · spreadsheet · database / ask): a PDF as a base64 `document`
  (≤ 23 MB raw, ≤ 600 pages, 100 on Haiku 4.5 — counted locally, refused before sending), other files as a text document
  (≤ 400k chars). Local actions (nothing sent, marked LOCAL): page (docx via fflate + DOMParser, HTML via the import's
  DOMPurify converter, md, RTF, txt) and database / sheet (CSV / TSV / xlsx, types via `inferColumns`). Preview first; one
  transaction after `snapshotNow`; origin 'ai' / 'import'; private parent → `createPrivatePage` / `createPrivateDatabase`;
  web images in converted pages and in every Claude answer about a file or image become links (`withoutWebImages`).
  AI-terminal file references `TermRef.file`; runs keep `AIRun.file` (meta, never content).
- PowerPoint import (features/io/import/pptx.ts → deck.ts, pure; `ImportSource` 'pptx'): layout 'page' (one presentable
  page: an H2 per slide, notes as a closed toggle, dividers; a clean title slide → page title + lede) or 'pages' (parent +
  a sub-page per slide); pictures saved by apply.ts, one store update = one Undo. File kind `pptx` in Claude for files.
- "Take over from Claude Design" (import/design.ts, `ImportSource` 'design'; Claude Design has no API / MCP): its HTML
  export (or ZIP) + deck + screenshots → one page with a style note (import/style.ts: palette, fonts, type scale, radii,
  spacing); screenshots reach Claude only after asking; "keep as pattern" → `savePatternExample()` (memory/example.ts).
  Shared Claude Design links (`isClaudeDesignUrl`, editor/lib/embeds.ts) are never framed — a bookmark card.
- Turn into page (editor/split, Mod+Alt+9): blocks of one container move into a new sub-page (content written with
  origin `'split'`), one `pageLink` in their place; inline databases, linked sub-pages and comment threads move along;
  private parent → `createPrivatePage`. Turn into database: `TableDraft.placement` 'inline' (default) | 'page'.
- Block selection (editor/select + `BlockSelection` in extensions/behaviors.ts): a pinned grip with a count chip while
  blocks are selected; the grip / right-click menu acts on the whole selection in ONE transaction. One grip at a time:
  while blocks are selected the hover handle stays hidden for other blocks (Shift shows it for extending). Handles sit in
  one gutter column left of the page content for every block at any depth (editor/select/gutter.ts) — never on a list
  marker; the target is the deepest block whose own line holds the pointer; columns get a grip-only handle at their edge.
- One memory (features/ai/memory): `Database.system` 'memory' / 'memory-log' marks the memory database and its usage
  log (private in teams via `createPrivateDatabase`; the oldest live one counts; dormant until one exists). Memories are
  saved only after the person confirms (proposal cards, `/remember`, "remember …", the `remember` tool → staged change
  kind 'memory'); write them only through memory/save.ts / example.ts and log rows through memory/log.ts (origin 'ai'; the
  log keeps 500 rows, older ones go to the trash, never page content or answers). Free-form requests take
  `memoryFor(task).block` (`<one_memory>`) along — `runAI({ memory })` or the agent's context — then `noteUse(answer, use,
  ctx)`. Examples: Type Example + Tag; `#tag` (or the bare tag as a word) forces that example in full. Switches per device
  in `settings.memory`. Team server-runner agents get no memory.
- One Script (features/script): `Workspace.scripts` (`OneScript` { id, name, icon?, description?, code, kind 'script' |
  'query', createdBy, updatedBy, createdAt, updatedAt }) — write only with `upsertScript` / `deleteScript` (or `saveScript`);
  every reader sanitizes (store/scripts.ts); team: meta map `scripts` (server stamps updatedBy / createdBy like agents').
  `@` refs in code are stable tokens `@[Label](p|u|a|s:<id>)`. Writes go through store actions with origin 'script'; a
  version is kept before the first change of each page; "Undo run" restores. Modes: run · dry (records every write and
  effect, executes none) · query (read-only; writes, effects and dialogs refused). Effects `mail.send` / `claude` /
  `http.post` (replaceable with `registerScriptEffect`) and trash are asked once per run (http unticked by default). Team:
  a version this device did not save or confirm asks first (code SHA-256 per device; never trust `updatedBy`). Runs in
  IndexedDB `one-scripts` (last 50), never synced, wiped with the workspace copy. Routes `#/scripts`, `#/scripts/<id>`.
  Object members answer own entries only (no prototype access).
- One Script integrations (features/script/integrations): database command kind 'script' (rows selected → once per row,
  else for the database page); button action `run_script` (`scriptId`) + slash `/script`; automation action `run_script`
  (automations pause while it runs); ⌘K "Run script: <name>". Tools use `runQueryForTool` (query mode, rows as JSON,
  optional `scope`); Claude's language reference is features/script/reference.ts (no imports — the MCP contract bundles
  it). AI terminal `run_query` (read-only; refuses `.markdown` / `.text` while pages have context marks) and
  `write_script` (parsed, staged as change kind 'script', saved on Apply, never run); custom agents get `run_query`
  inside their scope. MCP `one_run_query` / `one_run_script` (local bridge only): `one_run_script` dry-runs first and is
  always asked (`WritePlan.alwaysAsk`; Read only refuses); the card's list is pre-approved for that run. `mail.send` via
  Gmail (features/mail/scriptMail.ts): asks for `gmail.send` once (incremental consent), RFC 822 + RFC 2047 subject,
  token in memory only; without Gmail a mailto draft.
- Capture (shell/capture): share target POST → service worker → IndexedDB `one-share` → `#/clip?share=<id>`, always asked
  (ClipConfirm), a Clippings page via `saveFile()`, origin 'clip' (the old GET share flow stays for older installs); quick
  capture (Mod+Shift+K, phone floating key, ⌘K, `?launch=capture`) writes only through quick.ts (draft per device in
  localStorage `one.capture.draft`); "Install One" via install.ts; manifest shortcuts `?launch=capture|new-page|search|
  terminal`; `Toast.more` = extra toast keys.
- Foreign links (lib/foreignLinks.ts): a relative href in page content ("/r/11900", copied by Claude from an MCP result)
  never opens One's own site — it resolves against the first enabled MCP server's `linkBase`, else the only enabled
  server's origin (hover card, Mod+click, read-only copies); unknown → a toast pointing to the setting. Every MCP server's
  guide tells Claude to write absolute record links.
- One Script editor + templates: completion in features/script/editor/complete.ts (pure; workspace via `WsInfo`), member
  result types / args in catalog.ts (`ret` / `args` / `named`), snippets in snippets.ts; templates in
  features/script/templates (`TEMPLATES`, each `build()` adapts via pick.ts or returns a ⚠ stub with `ready: false`;
  every template must dry-run on the seeded workspace — one-script-templates.spec lists the ids); library `md_table` /
  `md_chart` (a ```chart fence becomes a `chart` node only when a script writes it), `page.here`.
- Guided tour (shell/tour): per-device `one.tour` in localStorage (offer / off / done / page), never synced; `offerTour()`
  only from main.tsx after seeding; it writes only on its practice page ("Tour — try things here"; private in teams);
  steps in steps.ts (`TOUR_STEP_COUNT` in state.ts must match). Screenshot / recording scripts set `one.tour={"off":true}`.
  Discover (`#/discover`, shell/discover/cards.ts): "Try it" keys go through help `runTry` + the `CHANGELOG_TRIES`
  allow-list; shell actions register with `registerTry`. AI menu: `TOP_ACTIONS` per selection type + "More …"; row ids
  `ai-row-<id>` stay stable; `openAIPanel()` is the only way to open the AI menu from outside the editor.
- Diagram viewer (ui/viewer): `openDiagramViewer(source, { from })` with a `ViewerSource` { kind 'diagram' | 'chart', type,
  title, render(stage) → SVG markup, themed, fileName } — vector SVG, zoom / pan / minimap / Download SVG; Mermaid via
  `openMermaidViewer(code)` (editor/lib/mermaid.ts), charts via `openChartViewer(spec, data?)` (features/charts, drawn again
  for the canvas). Never opened from a presentation or a popover (`VIEWER_OFF` / `useViewerAllowed`).
- What's new (src/app/help/changelog): every user-visible release adds an entry EN + DE with a real screenshot
  (changelog/README.md, `scripts/changelog-shots.mjs`); the build fails without a twin or an image.
- Workspace settings (shell/workspace, `#/workspace[/overview|people|blocks|automation|data|danger]`): what belongs to the
  workspace; Settings (the modal) = this device + account. Open with `openWorkspaceSettings(section?)`; team members,
  invites, API and Leave / Delete live there (parts in shell/cloud/Team.tsx). People: write only with `addPerson` /
  `updatePerson` / `removePerson` / `restorePerson`; merge and rename through shell/workspace/people.ts (person values +
  `mention` nodes via `setContent(…, 'people')`, a version first, one Undo); remove only someone unused; team members
  (account ids) are never merged, renamed or removed there. Last full backup per device: localStorage `one.backup.last`.
- Building blocks (store/kit.ts, features/kit): `Workspace.kit` = { lists, propTypes, recordTypes } — write only with
  upsertList / deleteList / upsertPropType / deletePropType / upsertRecordType / deleteRecordType / attachRecordType /
  setRecordType; every reader sanitizes (`sanitizeKit`); team: meta maps `lists`, `propTypes`, `recordTypes`.
  `PropertyDef.listId` = options copied from a shared list (upsertList keeps every bound property in step, locked
  databases too); `PropertyDef.custom` = an own property type (`type` = its base, 'free' → 'text'; the base is fixed once
  created); `PropertyDef.fromType` = from a record type (upsertRecordType adds / renames in every database holding it,
  never in a locked one, never deletes — a removed record property becomes a plain property, values stay);
  `Database.recordTypes`; a row's `Page.recordType` (cloud page field). Own types' scripts (value / validate / options /
  format / onChange) are One Script code run only by features/kit — in teams only a version this device saved or
  confirmed. `View.free` = a free board (lanes = its groupBy select, cards of any record type).
- Building blocks UI (features/kit, `#/kit`, `#/kit/<lists|types|records>/<id>`): own types' bindings run only through
  `runScript` with `vars` (`value` / `old` read like `row.<Prop>`, plus `row`); query mode, onChange in run mode. A value a
  person enters goes through `writeUserValue()` (validate → write → onChange). Value scripts write with `setRowProperty`
  only when the value differs, never because of their own writes, ≤ 500 rows per pass; `isKitComputed()` makes the cell
  read-only. Team: a binding runs only once this device trusts that exact code (saved in the editor, `createPropType`, or
  Confirm); value / onChange scripts on shared rows see shared pages only. A list-bound select's new option goes into the
  list. `typeEntries(…, kit)` appends the kit's entries; `changePropertyToOwn()` binds a property (values by option name).
- Record types in databases (database/model/recordTypes.ts): a row shows the database's own properties plus its own type's
  (`rowProps` / `foreignTo`); another type's field is hidden on that row and a dim, non-editable "—" in tables. The Type
  column is computed and view-level (`TYPE_PROP_ID = '__type__'` in visibleProperties / filters / sorts / groupBy, never
  stored; the resolver reads `page.recordType`, `writeValue` routes to `setRecordType`). Typed rows via `createTypedRow()`
  (the type's content, origin 'template'); `detachRecordType` (properties stay, rows lose the type); rows arriving from
  elsewhere (sidebar drop, MCP `one_move_row`) go through `adoptRowType()`; exports add "Type" via `withTypeColumn()`.
- Free board (`View.free`, database/views/free): lanes = the options of its `groupBy` select (lanes.ts; a shared list via
  `upsertList`); cards show their type's colour bar + fields (`View.typeFields[typeId | '__plain__']`, default the first 3
  filled). Slash `freeBoard`, `createFreeBoardAndOpen`, "+ Add view → Free board" (`addFreeBoard`). Turn into free board
  (features/ai/freeboard, transform form 'freeboard'): only the selection + existing record type names go out (no memory);
  new types via `upsertRecordType`, then ONE store update (origin 'ai'), then one editor transaction; Undo removes the board
  and the types it added.
- Coding pipeline (features/coding + mcp/src/worker): `Database.system: 'coding'` + `Database.pipeline` (one stage per
  Stage option; write only with savePipeline, read with readPipeline; `locked` blocks it). Worker outcomes go into the
  page with origin 'coding'; logs, diffs and trust per device in IndexedDB `one-coding`, never synced. One sends the worker
  only task data and the fixed verbs in GIT_VERBS — never a path or a command; the worker runs git as argument lists,
  only on repos in its own config, creates / cleans only its own branches + worktrees, never skips Claude Code's
  permissions. Team: the worker takes only tasks whose version (SHA-256) was written or confirmed on this device. Version =
  title + page + Repo / Branch / Stage + the pipeline (names, kinds, Auto, mode, turns, git action, next, instructions);
  trust carries only for changes made in this tab (never `isApplyingRemote` / `isAgentWriting`); locally a task an agent
  created or changed last (`agent:`) waits for Confirm too; nothing is written for an unconfirmed task. Prompt data blocks
  end only at markers with a random code; the worker never uses the base branch and never reads through untracked
  symlinks; Claude Code's output goes into the page through `claudeDoc`.
  Worker download (features/coding/download.ts): the site's mcp/one-worker.mjs plus ONE preset line after the shebang
  (`globalThis.ONE_WORKER_PRESET`, protocol.ts `WorkerPreset`); the pairing secret is per download, kept per device and
  workspace in localStorage `one.coding` → `pairs` (never synced or backed up; a new download replaces it); the hello
  carries `pair`, a preset worker refuses without it (`reason: 'pair'`). Repos are ticked ONLY on the worker's local setup
  page (mcp/src/worker/setup.ts: 127.0.0.1, token in the fragment sent as a header, Host + Origin checks, CSP); One only
  sends `open-setup` and never learns the page's address or key; scan.ts reads nothing beyond branch, base, remote host,
  last commit date, dirty / clean and the test-command guess.
  The worker announces each ticked repo's local branch NAMES (`WorkerRepo.branches`, newest first, ≤ 100); the task
  panel's setup strip (coding/TaskSetup.tsx) picks Repo + Branch before a run (default "new branch", never the base
  branch) and offers "Insert outline" on an empty task page (origin 'template').
  Approvals per task and device (`TaskLocal.approvals` 'all' | 'review' | 'none', default localStorage
  `one.coding.approvals`): finishStage passes skipped gates (logged), failing tests still stop at the review gate. Worker
  git runs without a terminal (never waits for a password); a failed / slow (60 s) fetch is logged, not fatal.
- Claude's Markdown goes into or is shown in a page only through `claudeDoc` / `claudeBlocks` (features/ai/claudeDoc.ts):
  web images become links, frames / media / web files never load. In shared pages Claude's change is its own undo step
  (`startUndoStep(view)` / `endUndoStep(view)`, editor/index.ts). History `SnapshotReason 'script'` ('Script · <name>').
  UI: Popover is hidden until placed and focuses at once; Menu activates only on real pointer movement
  (ui/pointer.ts `usePointerIntent`); use ui/focus.ts `restoreFocus` / `useFocusWhenShown`.
  Popover is clamped to the viewport (never partly off-screen); `resizable="<kind>"` = a corner grip for form popovers
  (localStorage `one.popover.size:<kind>`, never below the natural size, `[data-resized]`). The base `.popover` chrome
  is in `@layer one-popover-base`. In production ui.css loads AFTER the features chunk's CSS: an area rule that must
  beat `.input` / `.btn` needs two classes. Long labels cut with "…" get a title (ui/clip.ts).
- Text size (lib/textScale.ts): per device localStorage `one.textScale` (step 1–4: Standard · M · L · XL) →
  `--text-scale` + `data-text-size` on `<html>` before first paint; controls in Settings → Appearance and Workspace →
  Overview → Display (shell/settings/TextSize.tsx). App CSS font sizes are `--text-*` tokens or
  `calc(<n>px * var(--text-scale))` — never raw px (ui-fit.spec checks; features/present exempt). The landing page, the
  help site, exports and presentation slides are not scaled.
- Database views: table | board | list | gallery | feed | calendar | timeline | chart | form. Feed settings live in
  `View.feed` (dateProperty — null = created time, order newest | oldest, content); without sorts of its own a feed
  orders newest first. Rows in view order come from `orderRows()` (database/model/feed.ts), used by `rowsOfView()` too.
- Sidebar: a database expands to its entries in first-view order (shell/lib/tree.ts, computed only while open); page ⇄
  entry only via `shell/sidebar/entries.ts` (`parentId` / `databaseId` = the database, properties emptied, with Undo).
- Mail (features/mail): Gmail → a "Mails" database. Client: One's built-in Google OAuth client (`BUILTIN_CLIENT_ID` /
  `BUILTIN_ORIGINS`, features/mail/builtin.ts; only on those origins; e2e seam `__oneMail.builtin(id)` under `?e2e` only),
  overridden by the person's own client ID (`settings.mail.clientId`, '' = none) — read it only through `effectiveClient()`
  / `effectiveClientId()`. Google Identity Services token client, scope `gmail.readonly`; the access token lives in memory
  only. Sync state per device + workspace in IndexedDB `one-mail`, never synced. Rows dedupe by the Gmail message id;
  re-syncs write only Labels / Unread; bodies are written with origin `'mail'`. Team workspaces: the database is created
  private (`createPrivateDatabase`); a shared one pauses the sync. Mail content reaches Anthropic only with "Organise with
  Claude".
- Mail directories (features/mail/people.ts): Contacts / Companies / Conversations, found by `Database.system`
  'mail-contacts' | 'mail-companies' | 'mail-conversations' (oldest live one; team: private only; a deleted one is created
  again and every mail linked again); matched only by stored addresses / domains / thread id, never names; the Mails
  relations by role `contact` / `company` / `conversation`, written only into empty fields; switch + freemail list in
  `settings.mail.people` (per device); merge only with `mergeRows()` (Undo).
- Mail attachments (features/mail/attachments.ts): Load keys write the hidden role `load`; loading uses
  `messages.attachments.get` → `saveFile()` and replaces the list item with image / fileBlock (PDF 'viewer') / audio /
  video, origin 'mail'; HTML / SVG / XML / message parts are stored as application/octet-stream (download only); ≤ 25 MB;
  `settings.mail.attachments` 'off' | 'media' (PDFs + images ≤ 10 MB) | 'all' (≤ 25 MB) loads on sync.
- Database commands (features/commands, public API commands/index.ts): every database has a command menu — the ⌘ key on
  its sidebar row (touch: the row's ⋯ menu), a section on top of its right-click menu, the toolbar's ⌘ key, ⌘K
  "<db>: <command>" (by typing only). Defaults (defaults.ts) are computed, never stored. `Database.commands?: DbCommand[]`
  holds only order, switched-off defaults (`kind: 'default'`) and own commands (`kind` 'actions' | 'agent' | 'view' | a
  registered kind). Write only with `saveDbCommands()` (refuses a locked database — running stays allowed); readers
  sanitize with `readDbCommands()`; page backups empty webhook URLs (`withoutCommandSecrets`). New kinds only via
  `registerCommandKind(def)` from a module loaded at boot; an unknown kind is kept and hidden.
- Custom agents: `Workspace.agents` (`CustomAgent`, store/types.ts; `createdBy` / `updatedBy` = account ids in a team,
  null locally — `upsertAgent` stamps `updatedBy` with the saver; a team browser agent runs only while `updatedBy` is its
  creator, otherwise it waits for the creator to confirm, features/agents/confirm.ts; on the team server `updatedBy` is
  stamped and `createdBy` kept by the server, server/src/collab/agent-authors.ts) — write only with `upsertAgent` / `deleteAgent`;
  every reader sanitizes (store/agents.ts); team: meta map `agents`. Runs are per device (IndexedDB `one-agents`, last
  100 per agent), never synced; server runs come from `GET agent-runs`. Browser agents (features/agents/runner.ts) run in
  one leader tab per workspace (Web Lock), in team workspaces only in their creator's browser; one run per agent at a
  time. Agent writes are stamped `agent:<agentId>` (team: `writeAsAgent()`, cloud/index.ts) and never trigger agents;
  render `agent:` ids with `agentLabel()` ("Agent · <name>"). Routes `#/agents`, `#/agents/<id>`. Team workspaces: a
  browser agent's "everything" scope is the shared pages; private pages only when named in its scope. Anything an
  agent writes turns web images into links (features/agents/images.ts) — no auto-loading pixels from injected text.
- Team-cloud agents (server/src/agents): agents with `runner: 'server'` run on the server (scheduler, row triggers,
  webhooks) with a per-workspace Claude key + MCP tokens encrypted at rest; their writes carry `agent:<agentId>` as
  createdBy / updatedBy; `AGENTS=off` disables them; the server needs outbound HTTPS to api.anthropic.com.
- MCP tidy-up tools (trash / restore ≤ 50 ids, move page / row, update database / property, delete property, view
  create / update / delete) live in `features/mcp/{tidy,structure}.ts` and `server/src/mcp/{tidy,structure}.ts` with
  the same rules: never delete for good, locked databases refuse structure changes, no page ⇄ entry or Private ⇄ shared
  moves; keep `MCP_TYPE_CHANGES` / `MCP_VIEW_TYPES` (contract.ts) in step with the server's `TYPE_CHANGES` /
  `VIEW_TYPES`. The codeword `one:` (instructions line) and the prompt `one` are served by the bridge and by `/mcp`.
- MCP addresses workspaces by id (`local:<hash>` / `team:<id>`, features/mcp/identity.ts; per-browser localStorage
  `one.mcp.device`); every bridge call is bound to that id and refused on a mismatch — never act in another workspace.

## TipTap node names (shared contract — seed, export, share, history all rely on these)

StarterKit: `paragraph`, `heading` (levels 1–3), `bulletList`, `orderedList`, `listItem`, `blockquote`,
`codeBlock` (attrs: language), `horizontalRule`, `hardBreak`; marks `bold`, `italic`, `strike`, `code`,
`underline`, `link`. Plus: `taskList`/`taskItem` (attrs: checked), `details`/`detailsSummary`/`detailsContent`
(toggle; attrs: heading 0|1|2|3 — 1–3 = toggle heading H1–H3), `callout` (attrs: icon, color), `image` (attrs: src, alt, caption, width, align), `table`/`tableRow`/
`tableHeader`/`tableCell`, `columns`/`column` (2–5 columns), `blockMath`/`inlineMath` (attrs: latex), `mermaid` (attrs: code),
`pageLink` (attrs: pageId), `mention` (attrs: id, label, kind: 'page'|'date'|'person', reminder — date mentions only;
a date id is `yyyy-MM-dd` or `yyyy-MM-ddTHH:mm` local time; mentions of private pages carry no label), `databaseBlock`
(attrs: databaseId, viewId), `bookmark` (attrs: url, title, description, image), `embed` (attrs: url, provider),
`toc`, `breadcrumb` (atom; attrs: path = null — live: the path of the page it sits on, workspace › ancestors › page;
`stripPrivate()` / `docToHTML` / `docToMarkdown` freeze it into titles; Markdown `<!-- breadcrumb -->` + the path line, read
back as the block), `fileBlock` (attrs: src, name, size, display 'viewer'|'file'|null — a PDF shows in the browser's own
viewer unless 'file'), `video` (attrs: src, name, caption, width, align) and `audio` (attrs: src,
name, caption) — src = `onefile:<id>` or an http(s) URL, `syncedBlock` (attrs: syncId, sourcePageId — null = the
original, else a reference holding a cached copy; content: blocks; never nested; the sync service writes with origin
'synced'; `stripButtonActions()` unwraps it to plain blocks), `meetingNotes` (content: the notes as normal blocks; attrs:
title, status 'idle'|'recording'|'paused'|'summarizing'|'done', language, startedAt, endedAt, duration, transcript =
[{ t: ms offset, text }], recordedBy; never nested; runtime + Claude in features/ai/meeting), `button` (attrs: label, variant 'signal'|'ink'|'ghost', actions = JSON
array, see editor/schema/button.ts — strip with `stripButtonActions()` before a doc leaves the workspace),
`tabs` (container of `tab`, no tabs inside tabs; the shown tab is editor view state) / `tab` (attrs: title; content:
blocks), `icon` (inline atom; attrs: kind 'asset'|'lucide', name, color — glyphs only; editor/schema/icon.ts),
`spreadsheet` (atom; attrs: id, title, sheets = [{ id, name, rows, cols, cells: { A1: { v = raw input, fmt, b, i,
align } }, colWidths, frozenRows }], active = sheet id, datasets = [{ id, name, color, ranges: [{ sheet, ref }] }],
charts = [{ id, sheet, spec }]; values are computed by features/sheets, never stored), `chart` (atom; attrs: spec =
ChartSpec JSON, features/charts/types.ts — source sheet | database | system | manual; `stripPrivate()` freezes live
sources into manual data before a doc leaves the workspace); marks `highlight` (attrs: color = ColorName), `textStyle` + color
(attrs: color = ColorName), `comment` (attrs: id = a `Page.comments` thread id; never leaves the device —
`stripButtonActions()` / `docToHTML` / `docToMarkdown` strip it). Colours are ColorName strings, rendered via CSS vars `--c-<name>-text|bg`.

## Language

All UI text is bilingual (EN + DE), auto-detected (`detectLang()`), switchable in settings.
Every visible string goes through `t('<area>.<key>')` with BOTH `en` and `de` entries in that area's
`messages.ts`. Code, comments and identifiers are English.

## Design language — "INSTRUMENT" (read before writing any UI)

The user explicitly demands: NO AI slop, it must look unlike everything else, innovative yet usable.

- Inspiration: precision instruments, Braun / Dieter Rams, Teenage Engineering, Swiss technical manuals,
  aviation placards. Warm paper `--bg`, black ink `--ink`, ONE signal colour `--signal` (international orange).
- Tokens live in `src/shared/tokens.css` — always use them (colours, radii, spacing, motion, z-index). No raw hex
  in components except inside tokens.css. Light theme "Paper", dark theme "Carbon" (`html[data-theme]`).
- Type: Archivo variable (width axis!). UI 13–14px; display headings use `font-stretch: 125%` (class `.display`),
  heavy weight, tight tracking. Micro-labels: JetBrains Mono, 10.5px, UPPERCASE, letter-spacing .08em (class `.label`).
- Shape: radius 2px controls / 4px menus+cards / 8px modals. Hairline 1px rules (`--rule`). Pills only for LEDs/switches.
- Signature details: orange text caret, orange focus ring, keycap-styled shortcuts (`.kbd`), LED status dots
  (`.led`), mono spec labels (e.g. "§ 02 — DATABASES", "REV 14 · 1,204 WORDS"), physical button press (translateY 1px).
- Motion: fast & mechanical (90–260ms, `--ease-out`). No bouncy springs, no floating blobs.
- BANNED: purple/blue gradients, gradient text, glassmorphism/backdrop blur cards, glowing orbs, neon, sparkle-emoji
  for AI, "bento grid with glow", rounded-2xl everything, generic stock illustrations, Inter, centered-everything
  hero with gradient blob. Copy: no "supercharge / unleash / revolutionize / seamless / elevate".
- Usability first: familiar Notion interaction model (sidebar tree, slash menu, drag handles, ⌘K), generous
  hit targets, keyboard support everywhere, visible focus, works at 390px width, respects prefers-reduced-motion.
- Icons: lucide-react for UI chrome (stroke 1.6–1.75, 14–18px). The generated OpenArt icons
  (`public/assets/icons/*.webp`, see manifest.json) are for marketing/feature illustration and page icons only.

## Quality bar

- `npm run typecheck` clean; no console errors in the browser (check with scripts/shot.mjs output).
- Verify visually with screenshots at 1440×900 and 390×844, light AND dark.
- Keep components small and readable; match the surrounding code style (2-space, no semicolons, single quotes).
