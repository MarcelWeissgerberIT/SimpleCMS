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
  pick-up, 'template' = a template copy …). Editors must apply external updates when
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
  servers; client.ts decides centrally. No server is preset in the app.
- Database views: table | board | list | gallery | feed | calendar | timeline | chart | form. Feed settings live in
  `View.feed` (dateProperty — null = created time, order newest | oldest, content); without sorts of its own a feed
  orders newest first. Rows in view order come from `orderRows()` (database/model/feed.ts), used by `rowsOfView()` too.
- Sidebar: a database expands to its entries in first-view order (shell/lib/tree.ts, computed only while open); page ⇄
  entry only via `shell/sidebar/entries.ts` (`parentId` / `databaseId` = the database, properties emptied, with Undo).
- Mail (features/mail): Gmail → a "Mails" database with the user's own Google OAuth client ID (`settings.mail`, per
  device, no secret). Google Identity Services token client, scope `gmail.readonly`; the access token lives in memory only.
  Sync state per device + workspace in IndexedDB `one-mail`, never synced. Rows dedupe by the Gmail message id; re-syncs
  write only Labels / Unread; bodies are written with origin `'mail'`. Team workspaces: the database is created private
  (`createPrivateDatabase`); a shared one pauses the sync. Mail content reaches Anthropic only with "Organise with Claude".
- Team-cloud agents (server/src/agents): agents with `runner: 'server'` run on the server (scheduler, row triggers,
  webhooks) with a per-workspace Claude key + MCP tokens encrypted at rest; their writes carry `agent:<agentId>` as
  createdBy / updatedBy; `AGENTS=off` disables them; the server needs outbound HTTPS to api.anthropic.com.
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
