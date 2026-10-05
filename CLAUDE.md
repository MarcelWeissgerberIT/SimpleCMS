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
src/app/help/**                      help centre: panel (?, status bar, ⌘K, workspace menu), 54 articles EN+DE twins
                                     (help/articles/{en,de}/<id>.md, `help:<id>` links), Ask (Claude over the articles);
                                     link UI to an article with `<HelpLink id="…" />` (public API: help/index.ts)
src/help-site/**                     build-time public /help pages (prerendered from the same articles, hreflang)
src/app/features/agents/**           custom agents (#/agents, editor, browser runner, review, server-agent settings)
src/app/features/mail/**             Gmail sync → "Mails" database (own Google client ID)
src/app/cloud/**                     team-cloud client: store ⇄ Yjs binding, page documents, private pages, files
                                     (public API: cloud/index.ts; protocol + meta-document schema: docs/CLOUD.md)
server/**                            team-cloud server (Node, Hono, Hocuspocus, SQLite; AGPL) + public API (docs/API.md)
                                     + team MCP at /mcp (docs/MCP.md); content encrypted at rest (docs/CLOUD.md § Tenancy)
mcp/**                               local MCP bridge (Claude Desktop / Code ⇄ the open tab), bundled to public/mcp/
                                     one-mcp.mjs + the Claude Desktop extension one.mcpb (`npm --prefix mcp test`)
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
- What's new (src/app/help/changelog): every user-visible release adds an entry EN + DE with a real screenshot
  (changelog/README.md, `scripts/changelog-shots.mjs`); the build fails without a twin or an image.
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
