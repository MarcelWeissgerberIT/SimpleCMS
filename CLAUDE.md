# SimpleCMS One — project guide

A local-first rebuild of Notion "on steroids", plus a landing page with a one-time
"1997 spreadsheet gets smashed by a 3D hammer" intro. Static site on GitHub Pages
(`/SimpleCMS/`), no backend; teams use an optional, self-hostable server (`server/`). Prices: src/shared/pricing.ts.

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
src/app/ui/**                        shared primitives: Popover, Menu/MenuList/useMenu, Modal, Tooltip, Switch/SwitchFace/
                                     Kbd/Led, Screws (ui/screws.ts), roving.ts (radiogroup keys), PageIcon, IconPicker,
                                     gesture.ts (closing-gesture guard), focus.ts (focus back after a close), keys.ts
                                     (`typing()`: single-letter keys belong to a field / menu / dialog;
                                     `typingWithin(el, root)` for keys of a plate inside a dialog);
                                     ui/code = the shared highlighted code area (CodeArea / CodeView, tokenizers, placeholders,
                                     brackets; public API ui/code/index.ts); ui.css = base + primitive classes
src/app/i18n/**                      t()/useT(); per-area strings in src/app/<area>/messages.ts
src/app/shell/**                     layout, sidebar, topbar, page view, command palette, settings, modals host …
src/app/editor/**                    TipTap block editor (public API: editor/index.ts)
src/app/database/**                  databases & views (public API: database/index.ts)
src/app/features/**                  AI (+ workspace agent), history, graph, share, import/export, present, automations,
                                     templates (+ repeating, own templates), journal, inbox + reminders, sync (folder /
                                     GitHub Markdown, per-device IndexedDB `one-sync`), mcp (local bridge UI), sheets
                                     (spreadsheet engine + grid; functions/ = custom functions built by clicking), charts
                                     (SVG renderer, chart builder, data sources) (public API: features/index.ts)
src/app/features/ai/core/**          the AI core: purposes, sources, the gate (prepare / precheck), metering (meter.ts: one ledger
                                     entry per response, receipts), status (public: features/ai/core/index.ts, via features/index.ts)
src/app/features/ai/providers/**     provider adapters (anthropic.ts = the only runtime SDK import, openrouter + Connect account)
src/app/features/ai/setup/**         "Set up AI": openAISetup / openAISettings (the only ways in), <AINeedsSetup> + offersAI +
                                     FixKeys, the assistant (AISetup.tsx + steps/ 01–06, lazy), Settings › AI (ProvidersTab, lazy)
src/app/features/ai/routing/**       route chip / picker, CatalogPicker (lazy), CapLamps, DataRules (the class matrix)
src/app/features/ai/decide/**        decision models (Jev via OpenRouter, slice SJ): questions + state, the run's Vorprüfung
                                     (checkRun.ts), "Belegt?" (verify.ts), the compare core (suggest.ts), calibration.ts; ui/ =
                                     the card line, section 06 "Check", the setup / Settings rows (public API decide/index.ts)
src/app/features/governor/**         the Regler (Governor, G1): the ledger (IndexedDB one-ledger), reservations, estimate
                                     bands (public API governor/index.ts); totals + the device line (IndexedDB one-governor),
                                     the book across tabs, the brake (install.ts registers it at the gate; limits / brake /
                                     mcpBand eager, loops / halt / steps lazy), held agent runs, paused work, the status cell,
                                     VERBRAUCH (lamp.ts), #/regler (ui/ReglerPage, lazy), Workspace › AI § 06 (BudgetSlot) and
                                     Settings › AI's own line (DeviceBrake), strings (messages.ts); src/shared/ai/** = the
                                     pure multi-provider contracts (app + server; governor.ts, generations.ts)
src/app/features/outbox/**           the Outbox: slips for another tool's send routes, drafted without tools, sent by hand
                                     (dock, #/outbox, receipts; public API outbox/index.ts; docs/OUTBOX.md)
src/app/features/mcp/connections/**  #/mcp MCP · Connections (lazy; openMcpConnections(): ⌘K "MCP", Settings › Agents · MCP and
                                     Settings › AI › MCP servers links, the Token lamp, What's new try 'mcp'): every MCP connection on one
                                     page — reads only what this tab knows (never a token, never a request on open; Test / Sign in /
                                     Retry / Read only on a press); § 01 lamps = tokenTrouble (ai/mcp-servers/health.ts, the Token
                                     lamp's rule), § 03 = the Worker lamp's (preflight/sources/workerRule.ts, its grace too); agents
                                     only those that run in this browser (a team: the member's own); openAISettings({ section: 'mcp',
                                     server | add }) lands on that server / the add form
src/app/features/preflight/**        Preflight ("Vorflug-Check"): the lamp panel on Start, MASTER CAUTION, the keyboard queue
                                     (lamps register through preflight/registry.ts; public API preflight/index.ts; sources/ =
                                     built-in lamps; queue/calls.ts = every call into another area)
src/app/features/recorder/**         flight recorder: writer journal (IndexedDB one-recorder) + the deck (Mod+Alt+Z); window
                                     reading + report (window/**); eject (eject/**: plan, commit, undo, boot, sources; the
                                     planner core model/plan.ts); ghost comes later (public API recorder/index.ts via
                                     features/index.ts); store/writer.ts = the writer context every store write runs under
src/app/features/workitems/**        tasks outside the editor: the workspace index (lazy, incremental), graph (blocked / loops),
                                     views, writeItems (origin 'items'), the unblock toast, members + reminder audience, the
                                     people / link pickers and cards, settle gate, facts, holds, query (public API
                                     workitems/index.ts, via features/index.ts)
src/app/features/patchbay/**         the Patchbay (#/patchbay, lazy; DE "Schaltplan"): what runs by itself as a rack (§ 01 sources
                                     · § 02 processing · § 03 targets) with a fuse on every path where content from outside, private
                                     data and an unattended way out meet — inputs.ts (the only store reader) → source.ts (pure input +
                                     memo) → model / tools / reach / chains / fuses / sig / plain (pure), layout / render, keys.ts (fuse
                                     keys + Undo), setup/ (profile drop, lamps 00–06, return chip), live/ (run bus, tally, live signal),
                                     patch.ts (pure) + patchApply.ts (patching); hint.ts = the one module other areas may import
                                     (public API patchbay/index.ts via features/index.ts; docs/PATCHBAY.md)
src/app/help/**                      help centre: panel (?, status bar, ⌘K, workspace menu), 81 articles EN+DE twins
                                     (help/articles/{en,de}/<id>.md, `help:<id>` links), Ask (Claude over the articles);
                                     link UI to an article with `<HelpLink id="…" />` (public API: help/index.ts)
src/help-site/**                     build-time public /help pages (prerendered from the same articles, hreflang)
src/app/features/agents/**           custom agents (#/agents, editor, browser runner, review, server-agent settings)
src/app/features/agents/trust/**     per-field trust: verdict book, meters, grants, direct runs, spot checks, lessons, cell
                                     provenance (public via features/agents/index.ts); S1 = reasons, book, read-only plate
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
                                     + coding relay for cloud workers (server/src/coding: relay.ts, frames.ts, routes.ts)
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
  pick-up, 'template' = a template copy, 'split' = blocks turned into a page, 'items' = a task written from outside its
  editor (features/workitems `writeItems`) …). Editors must apply external updates when
  `page.contentOrigin !== <own id>` and `contentRev` changed. Block ids alone are no change there (each editor fills
  in its own for blocks without one and writes them once): merges with unsaved typing diff ids aside and the blocks
  take the write's ids (editor/lib/idDiff.ts; the merge base is the content the editor took in, with its own ids).
  The rule is the editors' own (an editor taking in a write, also one from another tab), not the cross-tab save
  merge's (store/merge.ts).
- Database rows are pages with `databaseId` set (parentId = database page id). Title lives in `page.title`.
- Binary files (images, attachments) go to IndexedDB via `saveFile()` → `"onefile:<id>"`; display with `useFileUrl()`.
- Public assets are referenced WITHOUT leading slash (`assets/covers/dunes.webp`) and resolved with `resolveAssetUrl()`
  so they work under the `/SimpleCMS/` base.
- Internal links: `#/p/<pageId>` (see lib/router.ts). Hash routing only (GitHub Pages). A page's permalink = the app's
  address + `#/p/<id>` (lib/permalink.ts `permalink`; "Copy permalink" in the page ⋯ menu, sidebar row menu, ⌘K, the
  spec plate's key and the peek head — shell/lib/actions.ts `copyPageLink`); no stored field. ⌘K and `#/p/<x>` of a
  page this device lacks resolve `pagesAt()`: a permalink, `#/p/<id>`, the bare id in any case, or the spec plate's
  short ID "ABCD·1234" (the id's first 8 characters; several matches are all listed, never guessed); ⌘K never offers
  "Create page" for an address. A pasted permalink of a live page becomes a page mention (editor paste), "@Title" (AI
  terminal, coding fields); a link to the app's own permalink opens in place. A block link (`?b=<block>`, "Copy link to
  block") is never cut down to its page: pasted it stays a link, clicked / ⌘K it opens at the block (`PageAddress.block`).
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
  in IndexedDB `one-vault` (lib/vault.ts). Read an AI key only via `getAIKey(provider)` (store/secrets.ts; no default —
  'anthropic' for Claude, 'openrouter' for OpenRouter, '' for openai until its slice), the GitHub token only via
  `openGitHubToken()`. Keys are set only by the assistant's step 02 (a pasted key is sealed only after its free check
  passes — a 402 "no credit" counts as valid; Connect account = OAuth PKCE, providers/openrouterConnect.ts) and removed
  through setup/remove.ts (`dropKey`, optionally with this device's rules for that provider, Undo).
  `settings.aiKeys` (openai / openrouter) holds vault markers only — every reader drops anything else. Backups never
  carry a key or `settings.ai`, and a restore (merge or replace) never takes `aiApiKey` / `aiKeys` / `settings.ai` from
  the file: they stay this device's (features/io/backup.ts).
- AI requests (multi-provider S1; contracts in src/shared/ai — pure, app + server): every
  facade (`runAI`, `streamCompletion`, `completeStructured`, `runAgent`, `requestImage`, `requestFile`, `inspectServer`)
  takes a required `purpose` (features/ai/core/purposes.ts; `mayBeEmpty` purposes may send `sources: []`) and `sources`
  (core/sources.ts classifies them: private · mail · memory · rows · page; synced copies count as their source), plus
  `typed` where the person typed; in DEV / `?e2e` a missing purpose or source list (or `[]` for a page-derived purpose)
  throws. `prepare()` (core/gate.ts) is the only way to a request: policy generation (`AI_POLICY_GEN`; rules stamped with
  a higher `gen` → 'reload', nothing sent; `stampGen` / `stampDeviceGen` (src/shared/ai/governor.ts) are the only stamp of
  `ai.gen` / `settings.ai.gen`), a key typed into the request → 'key_in_text', AUS hook, classes, the legacy
  route (Claude + this device's model, an agent's own model), the brake `Brake { money, peek, round, start }`
  (registered only by features/governor/install.ts via `registerBeforeSend`) + an in-tab reservation of the band's upper
  end (`PrepareInput.size` = prompt chars + answer budget; features/governor), settled by `settle()`. Paths that load something first (a picture, a file, the terminal's MCP setup, workspace
  retrieval, the screenshot describe of a design import, an agent's MCP tokens, demo answers) call `precheck()` before
  loading — the request prepares again (`precheck(input, { backstop: true })` where the text is built already: "Belegt?"). Request branches ask the
  model's caps (`thinks(caps)`, `caps.pdf.maxPages`), never a model id; prices come only from src/shared/ai/prices.ts
  (`costOf`, `estimate()` in features/governor) — `resolveModel` / `AI_MODELS` only choose. Every response of every
  engine is ONE ledger entry (core/meter.ts `meterCall` → governor `meter()`; IndexedDB `one-ledger`, keys
  `<scope>|<day>|<id>`, scope `local:local` | `cloud:<ws>:u:<account>`, 90 days, ids / models / tokens / amounts only —
  never page text, never synced, exported, backed up or sent; wiped with the device copy and the local reset; opened on
  the first meter, never at boot; e2e seam `window.__oneLedger`): what reached the wire decides (client.ts SDK
  middleware, `reachOf(signal)`): never sent (stopped before it went out) = no entry; every attempt refused with a
  status (incl. a Stop during the retry wait) = zero; in flight or answered = a cut stream is an estimate (message_start
  + streamed characters, else the request's size incl. PDF pages `pdfChars`, pictures `imageChars`, tool definitions).
  A refusal fallback (`usage.iterations` `fallback_message`, else the served model) is a 'refusal-fallback' step and
  each hop is priced at its own model (a dated snapshot id is the same model); Claude's `thinking_tokens` are kept as
  `reasoning`; demo is never metered.
  Ledger sources are fixed ids (`ai:<run>:<what>` via `tapSignal`, `terminal:<conv>:<task>` — the task's rounds and its
  memory proposal request, never counted into another conversation after `/new`; a Continue keeps its task's —, `agent:<id>:<run>`, `autofill:<db>:<prop>`).
  Receipt surfaces: IN = the input outside the cache (writes / reads beside it), "≈" only for an estimate, token
  figures in the UI's decimal sign (`fmtTokens(n, lang)`). Receipts: AI run cards (`AIRun.route / served / usage / usd / costSource / steps`,
  features/ai/Receipt.tsx), terminal `/cost` per model (`AgentUsage.byModel`), agent runs (`AgentRunUsage.byModel`;
  `maxRunUsd` on the sum of entries; a response without a price stops a budgeted run). `memoryRef(block)` names the
  memory database as a source when a memory block goes along. `Workspace.ai` is written only through store/aiRules.ts
  (`setWorkspaceAI`, owners / admins — `aiRulesAllowed()`; stamps `gen`; a provider column nobody touched is never
  written, Claude's stays as it was) and `settings.ai` through `setDeviceAI` / `setDeviceRule` / `setDeviceDefault` /
  `setRoles` (this device), all under a writer (setup writes `you~setup`); `Workspace.ai` in a team: meta map
  `workspace` key `ai`, guarded by the server — server/src/collab/workspace-ai.ts. `CustomAgent.route / saverRule /
  applyOn / routeSig` are kept by every reader and written by nobody yet; `CustomAgent.review` only as v2 by the agent
  editor's section 06 (decision models below) through `upsertAgent` — team: meta map `agents` like every agent field (not
  the workspace-ai guard), kept by `sanitizeAgentAI`; the team server skips an agent that has one or one it cannot read
  (`decisionChecks` ≠ null → `VORPRUEFER_SKIP`). `Workspace.governor` (the Regler, src/shared/ai/governor.ts
  `WorkspaceGovernor | Unreadable`) is kept by every reader through `sanitizeGovernor` (the same value keeps its
  reference — `sameGovernor(…, { meta: true })`; assign `undefined`, never `delete`) and written only with
  `setGovernor()` (see Governor below); full backups carry it (never the marker `isGovernorMarker`), page backups never, a
  restore keeps this workspace's. Surfaces ask `useAIStatus(purpose)` and show `<AINeedsSetup>` up
  front only when `!offersAI(status)` (no key for that kind of work: 'no_key' / 'route'); newer rules, the off switch,
  a data rule, a capability or a removed model come back from the gate as the request's error with its fix keys
  (`FixKeys`: Check key · Choose models · Change rule → the assistant at that step; MCP fixes → `openAISettings({
  section: 'mcp' })`, never the assistant). OpenRouter names: only `src/shared/ai` (the Jev Router slug only in
  jev.ts), the AI core / providers / setup / routing and the help — tests/e2e/ai-names.spec.ts guards it.
  A rule with one pin a build cannot read is unreadable as a whole (never a pin dropped); an agent field it cannot read
  is kept as it was (`Unreadable`, src/shared/ai/route.ts) and blocks the agent (`agentAIReadable` / `runsOnClaude`). A
  browser agent whose route is not Claude (or names a provider this build cannot run, features/agents/routeBlock.ts
  `RUNNABLE_PROVIDERS`, or cannot be read) ends as an error run without a request; the server skips it with its reason. features/index.ts exports `aiStatus` and the AI
  types (`PurposeId`, `SourceRef`, `DataClass`, `FeatureClass`, `Route`, `RouteRule`, `ProviderId`).
- Decision models (Jev via OpenRouter, slice SJ; features/ai/decide, src/shared/ai/{decide,jev}.ts, wire/decisions.ts;
  developer notes docs/AI.md § Decision models):
  `POST /api/alpha/decisions` only, Jev family only, one request per staged change of a checked kind (`CHECKED_KINDS`; purpose
  `gate.precheck`, class `gate`, ledger role `decide`), the fixed question set QSET (versioned, hash-frozen, a data clause on
  every question); the state is built through `prepared.redact` / `visible` / `rowFactsFor` (no ids, links → visible titles).
  A decision model only adds caution: it marks, holds (`ChangeStatus 'held'` — out of every bulk apply, A is VON HAND, applied
  only as one change), makes an apply-mode run wait as a whole (Schreibschranke via `directSplit`; unchecked = wait), or
  suggests; it never applies, discards, supersedes, picks, writes a Vertrauen verdict or page content, and the agent model is
  never told; a run Jev made wait neither replaces nor is replaced (supersede). The run stays `running` in storage until the
  checks end — its 20 s deadline counts from the first read (catalogue / endpoint reads ≤ 8 s each, a stop is checked before
  the send, an answer after it is 'late'); the gate refuses before any catalogue read; with Zurückhalten an unchecked change
  is held; an open change Jev marked or held back, or one of a run Jev made wait, makes the agent's later changes to that target held (apply mode: the
  whole run waits). Three different "held", never counted as each other: `ChangeStatus 'held'` (Jev, "HELD BACK" — waits
  for the person like an open proposal: review badges, Preflight, pruning, an eject discards it like a pending one and
  its Undo makes it held again), `AgentRunStatus 'held'` (the run's own status: the Regler held the run — "Held", never a
  failure and never a change status; a 'stopped' hold keeps its proposals, which wait for review by their own
  ChangeStatus — Jev-held ones too — in `awaitsReview`, `openProposals`, Preflight and the eject; a 'notStarted' record
  has none) and `StagedChange.held` (an eject kept that applied change — "Held · changed since").
  Agent settings live in `CustomAgent.review` v2 (`{ v: 2, decider?, on, pre, gate? }`, never a top-level `route`; strict
  reader; older builds keep it Unreadable and do not run the agent); `on` = the dated Jev snapshot confirmed (stamped only
  from a read catalogue row) — another one, and for an undated `on` any dated one, holds until confirmed. `gate` resolves without device default or legacy; a chat purpose never gets a decision model; the
  router is never a Vorprüfer. Vorprüfer and "Belegt?" (`settings.ai.jev.verify`, purpose `gate.verify`, help Ask + Ask the
  workspace — only while a Vorprüfer is chosen; R = "Ask more thoroughly" on the deep role, only on a press inside the
  line's own panel) start off. The team server skips a v2 agent with
  its reason (`VORPRUEFER_SKIP`). Jev × the Regler: purposes `gate.precheck` (run mode = the run's, `caller`) and
  `gate.verify` (interactive) are structured, never capped, never offered E / B; a run with a Vorprüfer takes a decide
  reservation at its start while a line is set (features/governor/decide.ts `reserveDecide`: 50 × one check's band at
  the Vorprüfer's price this device holds — none known: none) and each check (`run.decide`) takes its band out of it in
  the money phase (install.ts `decision`), so the line it was counted against is not asked again; what it no longer covers
  is judged like any request; the start check counts the reservation into the first step (exec.ts `startFor`,
  `RunCtx.startExtra`). checkRun estimates every check first (nothing reserved; in order against the line's room, then
  the run's own budget on the sum) and prepares each right before it is sent (≤ 3 reserved at once); while a line is set
  the book never drops an open reservation at 200 (ledger.ts `setReserveLine`). A check the line refuses is not sent
  (JevWhy 'budget', `CheckRunResult.line`; no price → 'price', account unknown → 'scope' — no line) and an apply-mode run
  waits as a whole (`JevWait 'line'` — whatever "Bei Bedenken" says; never sticky; its step / report say "The run
  waits — …", never "Jev made …"). A run the Regler held (status 'held', stopped or a request refused at the line) gets
  NO checks, like a run over its own budget: every checked-kind change is unchecked 'budget' (held back with
  Zurückhalten) and it never writes directly (only 'ok' runs do). Held back for money (`moneySkipped`) is no finding:
  never sticky, replaced like an open proposal (supersede.ts `replaceable`), no Vorprüfung failure when every check of a
  run was (health.ts `sentNoneForMoney`). "Belegt?" meters on its answer's source (`help:<id>`, `ai:<run>:workspace`). Thresholds 0,70 / 0,90 are start values ("Startwerte") until the owner's calibration
  (`node scripts/jev-calibrate.mjs --real`, OPENROUTER_API_KEY in the environment; `--check` sends nothing). `typesafe/`
  slugs only in src/shared/ai/jev.ts.
- Governor / Regler (features/governor, public API index.ts; spec killer/6-governor; help `governor`): `Workspace.governor`
  (shared/ai/governor.ts WorkspaceGovernor: v, autonomy, moved, ceiling, day, month, savers, worker — G1 writes day /
  month only; team: meta map `workspace` key `governor`, owners / admins — server guard collab/workspace-governor.ts,
  written by the app only when `/api/config` `supports ∋ 'governor'`) — write only with `setGovernor()` (UI: Workspace ›
  AI § 06, `BudgetSlot`; `governorAllowed()` / `governorRefusal()`); every reader sanitizes (unknown keys kept, `v` > 1
  unreadable and never overwritten). The workspace budget is measured per device; the person's own line is device-wide:
  localStorage `one.governor.device` (`writeDeviceLimit` — the line + this workspace's device stamp; Settings › AI
  `DeviceBrake`; never synced / backed up), against every workspace of this browser (`one.governor.scopes` — noted on a
  scope's first meter of the day whether a line is set or not, `totals.ts noteMetered`; rebuilt from the ledger's keys
  when the line appears or moves; a line written in this tab signals `DEVICE_EVENT` — listen with `onDeviceLine()`); the
  lower line applies. ONE generation stamp: `stampGen` / `stampDeviceGen` run inside every store update that changes `ai`,
  `governor` or the device line (setters, load, replaceAll, cloudPatch, restore, upload) — older tabs refuse AI with
  'reload' while a limit they cannot enforce is stored (`AI_POLICY_GEN = GEN.budget`; generations named in
  shared/ai/generations.ts; DEV / ?e2e: an `ai.gen` below the governor's generation console.errors). The meter is the S1
  ledger (`one-ledger`); derived data in IndexedDB `one-governor` (`<scope>|day|<d>` closed days, immutable once
  computed), localStorage `one.governor.today:<scope>` (day + month cache) and `one.governor.paused:<scope>` (autofill
  rows paused at the line) — never synced / exported / backed up, wiped with the device copy and the local reset;
  nothing is read before first paint and nothing without a line (the status cell and VERBRAUCH show only with a budget;
  #/regler reads the day when it opens). Reservations are gossiped on BroadcastChannel `one-ledger-res` (never on
  `one-ledger`; a starting tab says `hello`, every tab answers with its list at once); ledger pings carry deltas. An MCP
  request's band counts every request the call may send (`PrepareInput.mcp.rounds` = 1 + its resumes; structured ones
  with "All AI calls" servers too); a loop's size counts pictures / PDFs by pixels / pages (`messagesChars`,
  ai/core/sizes.ts), never their base64. The brake: `money` only in prepare() (identity · cap — text one-shots without
  MCP may get `Prepared.maxTokens`, structured or MCP ones never — · refuse with the brake fix: E = `allowOnce`, B = the
  cheaper route as the person's pick, carried into the caller's retry by `armRetry`), `peek` in precheck, `round` =
  `beforeRound()` before every further loop request (tool_use, pause_turn, the eager retry; agent/run.ts), `start` =
  `startCheck()` before a run; the first loop request is braked on FIRST_STEP_OUT while the wire keeps its max_tokens;
  run modes per purpose in features/governor/modes.ts (caller-mode purposes pass `run.mode`); `prepare()` requires a
  size. Answer budgets on the wire and in estimates come only from shared/ai/wire/maxTokens.ts `wireMaxTokens()`. The
  loop verdicts are lazy (loops.ts / halt.ts / steps.ts — no eager module imports them statically; governor-core guards
  it). The owner's decisions (§ 20) each have one switch: `DEVICE_LINE_SPANS_BROWSER` (device.ts), `AGENTS_WAIT_MID_RUN`
  (false, halt.ts — with `H_ACROSS_THINKING`, false until the owner's real-key check), `LIMITS_RELOAD_OLDER_TABS`
  (shared/ai/governor.ts). At the line background work stops or pauses and NEVER waits for a key; agents never wait
  mid-run — a manual run asks before it starts (`runNow()`, wherever pressed), a stop is status `held` (one
  `held-<day>` record per agent per day when not started — also when the gate refuses a background run's first request,
  nothing sent —, one info toast + one inbox note per agent per day, no fail
  lamp, the old state kept; `AgentRun.regler` = the line at the run's end); the person's requests ask (BrakeNote via
  `BrakeSlot`; decisions (class 'gate') never ask — a run with a Vorprüfer holds its checks' band from its start, see
  Decision models; the terminal's halt card E · H · Mod+., nothing reserved while it waits; both take the keyboard only
  from nobody or from their own host — `[data-gv-home]`, a dialog, region or aside around them — and hand it back when
  they go; a refusal by the person's own line links to Settings › AI `openAISettings({ section: 'limit' })`; H only to a cheaper model of
  the same provider whose context and capabilities hold the conversation, switched through `reprepare()` +
  `paramsFor()` in place). `AIError` 'budget' never falls back. No price + any limit = refused. Every budget UI says
  "pre-brake in One" and names the hard limit per provider from `PROVIDERS[p].hardLimit` (ui/hard.ts `useHardLines`).
  One entry: `openRegler()` (#/regler); budgets: `openBudgets()`.
- Markdown files One reads back (Markdown export, folder / GitHub sync) write date / person mentions as
  `[@label](one:date/<id>?r=<code>)` / `[@label](one:person/<id>)` (features/io/import/mentions.ts); share / site /
  HTML exports never do.
- Task blocks (`workItem`, editor/workitem): every reader goes through `itemAttrs()` (one sanitizer; limits + formats);
  no titles or names are ever cached in attrs; `itemId` / `doneAt` are VOLATILE in the history diff (DiffDoc shows the
  fields before → after). P1 (the block): tasks are created ONLY by the editor (slash `/task`, `[!] `, Turn into, Enter
  after a title) and by copies of existing tasks. P2 (Claude writes): Claude makes tasks only through the settle gate
  (features/workitems/settle.ts `settleDoc`, pure over a `SettleWorld`, called by `claudeSettled` / `claudeDoc(md, keep,
  ctx)` with a `SettleContext`; no context = no new task and no person mention): people only existing ones (never created;
  names to Claude only with Make tasks or in refusals, never emails, never on a route whose data rules withhold names —
  owners `@Person n`, refusals list none, `SettleContext.names`), ids minted by One at staging and reused 1:1 at apply
  (a taken id fails the change — never re-minted; a change without `items` — older proposals, server runs — creates none;
  an id is kept only for the task a replace replaces), links in scope only (agent scope, context marks, never shared →
  private in either direction, no loops, titles of out-of-scope tasks never to Claude), never inside a task or a table.
  Text never changes an existing task's fields — `update_work_item` / `one_update_work_item` (ChangeKind 'workItem',
  fingerprint, `guardTask` + `onTask`, one `writeItems(…, { origin: 'ai' })` per page after `snapshotNow`). Task links
  between staged changes are `needs`: applyChanges orders a batch so a change follows every change it needs (`applyOrder`;
  an edit / task change whose need is not applied fails "needs change #n first"); staging PINS what it resolved per new
  task (`StagedItems.pins`: people + link ids — apply writes those, never names / titles resolved again); a text written
  again keeps an earlier task id only by handle or title (an append joined on: by position); a discarded change's tasks
  and a synced reference's tasks are never link targets / `known`; loops are checked through pending changes too
  (`pendingEdges`, one `writeItems` batch against its own earlier edits); `Blocks:` ≤ 20 per task, ≤ 50 existing tasks per
  write; a person mention counts as added (hold 'names') unless the replaced content had it under the same inbox key (the
  nearest block id); the terminal's read limit is memoised per page for one tool call (`withReadLimit`).
  `list_work_items` / `one_list_work_items` read the index in scope. Holds
  (features/workitems/holds.ts): names a person · sets a reminder · changes an assigned task (any field or its text) · adds
  a blocker to an existing task · removes tasks — custom agents in apply mode and MCP Apply directly never write such a
  change, or anything depending on it (`heldClosure`), without review; reminders are never stripped silently. Only `one:`
  links become mentions (date reminders only when the replaced content had them); raw-HTML mention nodes are text. AI reads
  Claude writes back use the file form (`docToFileMarkdown`, `readableContent(id, { form: 'file' })` — opt-in; coding /
  Outbox inputs keep `docToMarkdown`). The MCP replace re-checks the page's `contentRev` at apply. The global reader
  `WORK_ITEMS_FROM_MARKDOWN` stays OFF (imports, sync, paste, capture, scripts, templates keep quotes). ItemSession
  (features/ai/agent/workItems.ts): handles + staged ids per terminal conversation (reset by `/new`), agent run, MCP
  call. AI menu: "Make tasks" (`ai-row-workItems`) = Transform → Tasks on selected blocks (form 'items', its own <people>,
  ids minted in the result, re-checked at Transform) or the page-level action `make_tasks` at the cursor; every answer is
  settled with a menu context (`existing: 'skip'`) and inserted at `itemSafePoint` (tasks made → toast Undo); meeting
  notes "Make tasks" (features/ai/meeting/toItems.ts, local, one transaction, toast Undo; keyboard: Esc on a heading of
  the notes, Tab → the foot keys, editor/extensions/blockTools.ts). The workspace index (features/workitems: `getItemIndex()`, `useItemView()`) is lazy and incremental
  (`pageChanges`, no page-map scan per write); blocked / overdue / loops / duplicates are computed, never stored. Editor
  field writes go through `commitItem` (only the changed attr keys — y-tiptap compares attrs by reference); writes from
  outside an editor only through features/workitems `writeItems()` (writer: opts.writer, else the frame open, else
  you~ui; a live editor via editAs; its undo you~undo; live editor first, else `setContent(…, 'items')`;
  refuses locked / read-only / trashed / blind pages, loops and shared → private links). Copy = new itemId
  (`lib/itemIds.ts` `remintItems`: paste / drop via the `workItemIds` plugin, duplicate, duplicatePage, copyTree, row /
  type / recurring templates, unsync of a synced reference; "Use" resets to open without a date), move = same itemId;
  never re-minted on remote or external transactions; duplicates are shown (DUPLICATE · NEW ID), never auto-fixed. ONE
  creation gate: every path that makes a new itemId asks `itemLookup().canCreate()` and degrades to plain blocks when
  refused (team: only when `/api/config` `schema_min` ≥ 1). Button templates never hold a task (`cleanTemplate`). AI-menu
  Replace is off over a range holding a task unless every task lies wholly in the range and Claude's answer — settled
  again at Replace — brings each back by id; meeting-notes regenerate and a browser agent's 'replace' report keep the
  tasks; the team server refuses a Markdown replace of a page holding a task (`page_holds_tasks`). Bridge writes keep Y's
  attribute objects (`keepYRefs`, cloud/content.ts). Task titles in Markdown only inside `withItemLabels` (Markdown
  export); every other `docToMarkdown` writes ids. Item reminders: key `w:<itemId>:<due>:<code>` (one per itemId, at the
  index's winner); team: rings only for its people (`ringsHere`), unassigned for every member. The agenda shows tasks with
  a due date (moves write `due` through `writeItems`); people usage / merge count and rewrite task people (origin
  'people'). A person's finish in an editor writes that editor's pending content first (`flushEditor`,
  editor/lib/editAs.ts — the editor's registered flush; team: the content document's refresh) — the unblock toast
  reads the index, which reads the store. The relink after a cut + paste writes through `editAs` as system:repair.
  HTML becomes a task ONLY as the editor's own clipboard copy
  (workitem/clip.ts: the clipboard serializer stamps a per-device key, localStorage `one.clip.key`; raw HTML in Markdown,
  Claude's answers, imports and other sites never make one; `withoutWebLoads` unwraps one). Markdown that REPLACES content
  holding tasks (sync pickup, MCP replace, edit_page replace, record type / template text, script replace) goes through
  `keepItems(doc, known)`: a `> [!TODO] … {#wi_X}` quote whose X `known` holds is that task again (fields as One has them,
  title + notes from the Markdown) — never a new one. A task never sits inside a task or a table: paste / drop moves it out
  whole after the outermost one (toast), `sanitize()` does the same for JSON (workitem/place.ts); never repaired on mount.
- Schema gate (docs/CLOUD.md § Schema gate): an older tab DELETES nodes its schema does not know from a shared document,
  so every collab connection sends `?schema=<DOC_SCHEMA_VERSION>` (store/generations.ts, with `NODE_GENERATIONS`) and the
  server (server/src/collab/schema-gate.ts `MIN_CLIENT_SCHEMA`) makes a missing / lower one read-only — a lower one also
  gets the stateless "outdated" notice → `useCloud().outdated`, read-only until reload ("Reload to keep editing"). Page
  document copies in IndexedDB are per generation (`one:g<n>:ws:…`): an older generation's copy is never replayed (dropped;
  unconfirmed changes taken over only without its deletions — `restoreNewer`). Local workspace: page records carry a
  `_schema` stamp ({ g, rev, at } of the copy written, stripped on load) and pages with newer nodes a shadow
  (`one.page.g<n>:<id>`); a record an older build wrote (no valid stamp) is merged back at boot, from another tab's save
  or stash and before a save merges (persistence.ts `guardOlder`). A new node type or attr an older client would lose:
  bump DOC_SCHEMA_VERSION + `NODE_GENERATIONS` in a release that cannot create it yet, then raise the server minimum.
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
  Prompt caching: every request with MCP servers sets top-level `cache_control` (client.ts `mcpParams`: the server-side
  tool loop and paused turns re-read the prefix); the AI terminal and agents use automatic caching too; Claude for files
  marks the `document` block (system + file are the same for every question about it). One-shot requests stay uncached.
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
- "one:" picker: in page text a suggestion kind 'ref' (char `one:`, editor/menus/RefMenu.tsx — same level, inside, then a
  title search → a page `mention`); in the AI terminal `completionAt(…, here)` (agent/commands.ts): `one:` → @mentions, a
  codeword at the start → that server's `tools` (from its connection test); `pickedTool()` (codeword.ts) tells Claude the
  tool picked (terminal `codewordTask`, free-form requests via `Codewords.picked` → attachMcp).
- AI terminal `create_pages`: one page per item in ONE call (≤ 50, each its own staged `create_page`, ids back in order;
  a pending page with the same parent + title is updated). `TERMINAL_TOOLS` = `AGENT_TOOLS` + create_database / add_property /
  write_script / create_pages (`AGENT_TOOLS` includes `list_work_items` / `update_work_item`). `MAX_TOOL_CALLS` = 40 per task (MCP calls don't count; backstop +12); hitting it ends as
  'limit' with Continue (key, ↵ on the empty prompt, `/continue` = `/weiter`, `continueTask()`: same conversation + staged
  changes, fresh budget). Applied content (agent/links.ts `withPageNodes`): `[Title](#/p/<id>)` whose text is the page
  title → a page `mention`; a paragraph holding only one → `pageLink`.
- AI-menu intent routing (features/ai/intent.ts `requestIntent`, EN + DE, no Claude call): 'topage' → Turn into page,
  'pagesPerItem' → Sub-page per item, 'todb' → Turn into database first, 'items' → Make tasks (selection: Transform →
  Tasks; cursor: the page-level action `make_tasks`), 'terminal' → "This needs the AI terminal — run
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
  (TipTap JSON built by code, never HTML) · Tasks (form 'items', transform/items.ts; never picked by Auto). Preview first (cached per form in `AIRun.transform`); applied in ONE
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
  log keeps 500 rows, older ones go to the trash, never page content or answers; key-shaped text is scrubbed from a
  row's name and a request the gate refused for a key writes no row; AI-menu runs are stored with key-shaped text
  scrubbed). Free-form requests take `memoryFor(task).block` (`<one_memory>`) along — `runAI({ memory })` or the
  agent's context — then `noteUse(answer, use, ctx)`. Examples: Type Example + Tag; `#tag` (or the bare tag as a word)
  forces that example in full. Switches per device in `settings.memory`. Team server-runner agents get no memory.
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
- Workspace settings (shell/workspace, `#/workspace[/overview|look|people|blocks|automation|data|danger]`): what belongs to the
  workspace; Settings (the modal) = this device + account. Open with `openWorkspaceSettings(section?)`; team members,
  invites, API and Leave / Delete live there (parts in shell/cloud/Team.tsx). People: write only with `addPerson` /
  `updatePerson` / `removePerson` / `restorePerson`; merge and rename through shell/workspace/people.ts (person values +
  `mention` nodes via `setContent(…, 'people')`, a version first, one Undo); remove only someone unused; team members
  (account ids) are never merged, renamed or removed there. Last full backup per device: localStorage `one.backup.last`.
- Workspace look (store/look.ts, lib/look, shell/workspace/Look.tsx): `Workspace.look` (WorkspaceLook: preset, colors
  {paper, ink, signal}, dark?, fonts {ui, text, headings}, corners, updatedAt, updatedBy). Write only with `setLook(look |
  null)` (refused unless `lookAllowed()`; in teams owners / admins only — enforced by the server guard
  server/src/collab/workspace-look.ts with the member's CURRENT role). Every reader sanitizes with `sanitizeLook`; the
  standard look is no value. In the store assign `look = undefined`, never `delete` (zustand merges the next state into
  the old one); keep the reference when `sameLook`. Team: meta map `workspace`, key `look`. Full backups carry it, page
  backups never. Per device: localStorage `one.look` (cache for public/look-boot.js before first paint, plus "standard
  look on this device"). Colours come from the OKLCH engine (lib/look, WCAG AA enforced, text in the signal colour via
  `--signal-ink` / `--signal-on-ink`, never raw `--signal`); the generated style takes allow-listed token names and hex /
  rgba only. Fonts only Archivo / JetBrains Mono / Newsreader + system stacks (--font-sans / --font-doc / --font-head /
  --head-*). Exports, share links (#/s, #/f), the published site, help pages and diagram downloads use the stock tokens
  (tokens.css?raw / stockTokens, never getComputedStyle).
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
  permissions. Programs start ONLY through mcp/src/worker/exec.ts (no other worker file value-imports `node:child_process`
  — guard in exec.test.ts; never `shell: true`; on Windows a bare name from PATH only, never the cwd, system tools by
  absolute path, git only as git.exe, `.cmd` shims read, not run): Claude Code, git, gh and glab never run through
  cmd.exe — only the person's own worker.json `testCommand` / `analyzeCommand` and `ONE_WORKER_BROWSER` /
  `ONE_WORKER_PICKER` may, and nothing One sends or a repo holds ever reaches a cmd.exe line; on Windows every git call
  gets `-c core.longpaths=true` and worktree folders a short safe name, `ssh -o BatchMode=yes` only on Windows and only
  when no SSH command is set (a clone: any `includeIf` in the global / system config counts as set; macOS / Linux add
  nothing, as 1.8), a repo in a synced folder (iCloud, CloudStorage, OneDrive) keeps its worktrees in ~/.one-worktrees unless worktreeDir
  says otherwise (the warning's `worktrees` = home · own · synced, rendered by coding/logValues.ts);
  the worker needs Node 22+ (Windows from 1.9.0; start lines per shell: coding/startLines.ts — PowerShell spells the
  home `$env:USERPROFILE`, never `$HOME`). Team: the worker takes only tasks whose version (SHA-256) was written or confirmed on this device. Version =
  title + page + Repo / Branch / Stage + the pipeline (names, kinds, Auto, mode, turns, git action, next, instructions);
  trust carries only for changes made in this tab (never `isApplyingRemote` / `isAgentWriting`); locally a task an agent
  created or changed last (`agent:`) waits for Confirm too; nothing is written for an unconfirmed task. Prompt data blocks
  end only at markers with a random code; the worker never uses the base branch and never reads through untracked
  symlinks; Claude Code's output goes into the page through `claudeDoc`.
  Worker download (features/coding/download.ts): the site's mcp/one-worker.mjs plus ONE preset line after the shebang
  (`globalThis.ONE_WORKER_PRESET`, protocol.ts `WorkerPreset`); the pairing secret is per download, kept per device and
  workspace in localStorage `one.coding` → `pairs` (never synced or backed up; a new download replaces it); the hello
  carries `pair`, a local preset worker refuses without it (`reason: 'pair'`; a cloud tab sends none — its first sealed box is the proof). Repos are ticked ONLY on the worker's local setup
  page (mcp/src/worker/setup.ts: 127.0.0.1, token in the fragment sent as a header, Host + Origin checks, CSP); One only
  sends `open-setup` and never learns the page's address or key; scan.ts reads nothing beyond branch, base, remote host,
  last commit date, dirty / clean and the test-command guess.
  The worker announces each ticked repo's local branch NAMES (`WorkerRepo.branches`, newest first, ≤ 100); the task
  panel's setup strip (coding/TaskSetup.tsx) picks Repo + Branch before a run (default "new branch", never the base
  branch) and offers "Insert outline" on an empty task page (origin 'template').
  Approvals per task and device (`TaskLocal.approvals` 'all' | 'review' | 'none'; a new task gets this device's default —
  localStorage `one.coding.approvals`, written ONLY by `setDefaultApprovals` ("Use for new tasks"), never by a task's pick;
  createTask stamps it, and so does the watch (tasks.ts `startApprovalsWatch`) for a row that becomes a task here: new
  here = the default when it was created, a page dropped on / a row moved into a pipeline database = today's (never by
  `page.createdAt`). A task without one takes the default in effect when its row was created — `approvalsOf(local,
  row.createdAt)`, each change notes the default it replaces in `one.coding.approvals.history` (insertion order, `u` only
  grows) — and that level is frozen as its own once resolved here (the panel, finishStage; `stampApprovals`: one
  read-modify-write, a stored pick stays; `setDefaultApprovals` stamps rows whose `createdAt` is ahead of the change), so
  a new default never changes an existing task): finishStage passes skipped gates (logged), failing tests still stop at
  the review gate; a gate
  with `PipelineStage.hold` ("Always stop here"; sanitizeStage keeps it on gates only; joins the version only when set,
  like a stage's model) is never skipped (`skipsGate`) — the Review & merge template's approveMerge has it in NEW
  pipelines (stored ones are never changed). Worker
  git runs without a terminal (never waits for a password); a failed / slow (60 s) fetch is logged, not fatal.
  A repo in iCloud Drive (config.ts `inICloud`) is warned about in the log and its worktrees default to
  `~/.one-worktrees/<name>`; `git worktree add` (≤ 10 min, a line per 30 s) cleans up its folder + new branch on failure.
  Feedback: worker log lines carry a code + values (`LogLine.c` / `v`, shown via `features.coding.log.c.<code>`,
  coding/lines.ts `LOG_CODES`); a tool line of Edit / MultiEdit / Write carries its change (`LogLine.e` ToolEdit, ≤ EDIT_HUNKS ×
  EDIT_CHARS, scrubbed; coding/EditDiff.tsx shows it as a line diff when the call is opened); a `progress` event per Claude Code turn (turns / maxTurns / estimate from usage,
  mcp/src/worker/price.ts) lives only in `useCoding.progress`; a live `git` snapshot while a non-plan stage changes files
  (`ONE_WORKER_LIVE_GIT_MS`); browser notifications only via coding/notify.ts (per device `one.coding.notify`).
  New repos only from the worker's local setup page: clone (mcp/src/worker/clone.ts — `parseCloneUrl` refuses tokens in
  https addresses, ext::/file::, option-like and `..`; `git -c protocol.ext.allow=never … clone -- <url> <dir>`; projects
  from glab / gh) and ZIP import (zipimport.ts — fflate streaming; left out before any check: every part some disk reads
  as `.git` (`isDotGit` = git's is_ntfs_dotgit + is_hfs_dotgit: case, trailing dots / spaces, `:stream`, `GIT~n`, HFS+
  ignorables), `__MACOSX`, `.DS_Store`, `Icon\r`; a path outside / a control character refuses the ZIP, `:` / a device
  name only on Windows (`entryPath(name, platform)`); `gitDirIn` refuses any `.git` spelling or a folder git takes for a
  repository (HEAD + objects + refs or commondir, any file type; a ZIP that is one itself → "clone it") before any git
  step (`finishImport`); one commit against a fresh git dir outside the folder (`--git-dir` / `--work-tree`, fsmonitor
  off, empty hooksPath, --no-verify, gc.auto=0 + maintenance.auto=false — no config inside the folder is ever read, no
  detached gc runs), moved in as `.git` after a last check) into `cloneDir` (default ~/one-repos, never iCloud). Its
  `info/attributes` ends with `NO_DRIVERS` (`* -filter !diff merge`) for good: no filter / diff textconv / merge driver
  of the person's runs in an imported repo (import, repoFacts' status, worktrees, diffs, commits, updates); LFS files
  stay plain files; the worker's patch diffs use `--no-ext-diff` (never the person's diff.external).
  Clones and imports are marked `.git/one-worker-source` (`SOURCE_MARK`: clone · zip · folder; a clone of the same
  address added again only in the default ~/one-repos; once per config, `worker-marks.json`, an older import anywhere
  by its root commit `Import <file>.zip` in a folder named as imports are (`folderName(<file>)`, `-2` …; in ~/one-repos
  any name) → zip — never a person's own repo by its commit message alone —, an older clone only in the default
  ~/one-repos named after its origin → folder — never from a clone folder of the person's choice; the setup page names
  them until "Got it"); such a
  repo, or one inside `cloneDir` (`inFolder`: realpath, no case on darwin / win32), gets `claude.projectSettings` false
  unless worker.json says true (`sourceOf` → `RepoConfig.source`) → Claude Code runs with `--setting-sources user` (none
  of the repo's hooks, apiKeyHelper, .mcp.json, CLAUDE.md, nor the person's local-scope MCP servers — user scope only,
  log `mcpUserScope`; the log names the rule + how to trust: `projectSettingsOff{Cloned,Imported,Marked,Folder}` also
  when worker.json holds false, `…Set` only without a source; a CLI without the
  flag refuses the stage while the repo has `.claude/` or `.mcp.json`). The setup page's per-repo switch "Use this repo's
  own Claude Code settings" (`PageRepo.ownSettings` / `source` = the reason; on against the default → a one-line warning)
  is the only UI for `projectSettings`; Save (same key / Host / Origin door) writes it only where it decides something
  (≠ default, an "off" resting on cloneDir alone, or a key already there — saveRepos). `claude.mcpServers` per repo =
  the person's own Claude Code MCP servers (tools allowed, no --strict-mcp-config). GitLab: `glab mr create`. After an
  import the page offers "Create it on GitLab / GitHub" (publish.ts: name from the code, the person's glab / gh api,
  origin + push; only for a repo without a remote). Pipeline
  templates (schema.ts `templatePipeline`: standard | modernise | explain | reviewmerge · spec | stories · qa); with
  several plan stages each writes its own section. Stage kind 'analyze' runs the repo's `analyzeCommand` (argv) in the
  task's worktree or main checkout — its output is the section, findings never fail. Doc outputs (outputs.ts / tasks.ts):
  'testcases' · 'pages' (## sections → a page tree under "<task> · <stage>", inside aiWrite) · 'review' (TaskLocal.review
  → payload `review`, git action 'comment', verb 'comment-pr') · 'stories' (a NEW coding project via `createProject`).
  Doc stages on a task's branch run in its worktree with the branch diff as a DIFF data block. Git action / verb 'merge' /
  'merge-pr' merge the request with the person's glab / gh (confirmed; never dirty or unpushed work). Projects: several
  pipeline databases per kind (`pipelineDbIdsOf`, `currentProjectId` per device localStorage `one.coding.project.<kind>`,
  `createProject` / `trashProject` with Undo); the worker takes tasks from every project. Stages that need a newer worker
  (`stageNeeds` → `WORKER_CAN` incl. 'doc', sent with every `next` as `can`; `workerCan(can, docs)`: any `can` or `docs: true`
  implies 'doc') go only to a worker that names them — never to an older one (the task fails with err.oldWorker; the #/coding
  plate shows `OutdatedWorker` from `useCoding.can`; a worker whose welcome names a version with the ZIP-import gap —
  `workerUnsafe`: `WORKER_IMPORT_SINCE` ≤ v < `WORKER_SAFE`, protocol.ts; an unreadable version never — gets the security
  notice instead, also in the setup cards; through the relay its key opens Settings → Coding worker, never the local file;
  next a worker < 1.9.0 over Local from a browser on Windows — `workerOldHere` / winWorker.ts: the browser's platform,
  never the start-line switch, never Cloud — gets a Windows security notice, also as the Preflight lamp `worker:windows@`). The worker reports a task it cannot read back as 'refused' (`taskIds`),
  never drops it silently; bump mcp/package.json for every worker change (the site's download = the newest version).
  Models: `PipelineStage.model` only on stages that run Claude Code (plan · implement · doc; `claudeRuns()`) — an alias
  ('opus' · 'sonnet' · 'haiku'), a full id or an own name; per task per device `TaskLocal.model` (never synced, never hashed).
  ONE rule `MODEL_NAME` / `cleanModel()` (protocol.ts; first char a letter or digit, so never a flag) for One and worker.json
  `claude.model`; payload `stage.model` = task pick ?? stage ?? null (`modelFor`); a stage with a model needs capability
  'model'; worker `--model` = One's > repo claude.model > none, one argv entry. A stage's model joins the task version
  only when set (old hashes stay valid). Pickers use `MODEL_CHOICES` / `modelLabel()`.
  Run end (worker 1.11.0, every model; claude.ts + proctree.ts): at Claude Code's `result` the heartbeat stops and its
  process tree is noted (`RunTree`: the tree, its own group, its shells' groups (read only around Bash commands —
  `bashStart` / `bashEnd`; an emptied group forgotten), the env mark `ONE_WORKER_RUN`; Windows: ONE PowerShell per run
  answers the readings, below an ended parent only what was born while it lived — `goneBy`, `rootBorn` / exit); the
  stage finishes on its process's 'exit' + a short grace (none after Stop; never waits for 'close'), ends what it left
  running on every OS (one coded line `claudeLeftovers`) — never a server the person's tools share (`sharedServer`) or
  a daemon's own group (named: `claudeSpared`); Claude Code's env gets `RUN_ENV` (no MSBuild node reuse / shared
  compiler); kills a Claude Code still alive 30 s after its result (`claudeLingered`); Stop as before; a worker shutting
  down waits `STOP_WAIT_MS` for its stopped runs (index.ts exits after `STOP_HARD_MS`). The JETZT
  line clears with the stage (`setBusy` prunes progress; a dropped link = GONE). Scratch folder per task
  (`scratchPath`, `<config dir>/scratch/<task>`, `--add-dir` from `--help`, else one `addDirOff` line; scrubbed to
  `<scratch>` — the path never goes to One; cleaned with the branch / worktree); the prompt says Edit / Write, never
  `sed -i` or redirection. Permissions (`can` 'permission'): `--permission-prompt-tool mcp__one-task__one_task_permission`
  (task-mcp over node:http; `--help` or version ≥ `PERMISSION_TOOL_SINCE`) — the repo's allowed / disallowedTools
  decide first (permissions.ts `ruleDecision`), else the worker holds the call (≤ 15 min `PERMISSION_WAIT_MS`, then
  deny; Stop / run end deny) and sends a `PermissionAsk` (event + `BusyTask.ask`; only to its own tab); the tab answers
  `{ op: 'permission', taskId, ask, verb }` (ONLY the id + a `PERMISSION_VERBS` verb). "always" stores the rule the ask
  showed in worker.json BY THE WORKER (`addAllowedTool`, ≤ 100; `alwaysRule` never offers shells / interpreters (any
  version) / runners of other programs (npx, uvx, `npm exec`, `yarn dlx`, `uv run` …) / installs / a runner without its
  real subcommand / path readers / rm / sed / git / curl …, quotes, globs or outside paths; file tools and reads outside
  → once only); the setup page lists and removes them (save removes only what the page removed — `allowedWas`). Never
  judged on a cut copy: taskmcp sends each judged field whole (an MCP tool's input as JSON `args`, ≤
  `PERMISSION_FIELD_MAX`) and refuses a longer one whatever the worker says; the card's `what` is never cut
  (`PERMISSION_WHAT_MAX`; longer → refused, `how: long`); the allow returns Claude Code's input untouched. ExitPlanMode /
  AskUserQuestion / EnterPlanMode are answered by the worker (permissions.ts `HANDLED`), never a card. The tab's hello
  says `can: TAB_CAN`; without a connected tab that names 'permission' a request is refused at once (`how: away`), and
  waiting ones 60 s after the last such tab went. The card is keyed by the ask id and its keys wake after `ARM_MS`. Card "Claude wants" (coding/PermissionCard.tsx, `useCoding.asks`), Preflight lamp
  `permission` (sources/permission.ts, ids `perm:<task>:<ask>`, every key VON HAND, bulk false), a browser notice; log
  codes permissionAsked / Allowed / Denied / Always / AlwaysFailed / Needed; `StageOutcome.permissions` counts. Step limit
  (`can` 'continue'): error_max_turns → `StageOutcome.stepLimit` → `TaskLocal.stepLimit`; Continue (`continueTask`, the
  terminal's task_action `continue`, Preflight failed card A — VON HAND) sets `resume` and pickNext sends
  `TaskPayload.resume` only to a worker naming 'continue' (`canContinue()`: none connected counts as yes); "+N" =
  `stageSteps(stage)` (the pipeline's Step limit now — what pickNext sends), never the stopped run's; Start over =
  `runTaskNow` (same worktree, original instructions). Windows leftovers: identity by pid + creation time, the tree
  sampled while Claude Code runs (`RunTree.sample`), `taskkill /F` per pid (never /T).
  Ship log (worker 1.10.0, `can` 'ship'): git stages (`StageOutcome.ship`, also a failed outcome after its commit) and
  the git keys (`GitResult.ship`; `GitResult.error` = key 'pr' whose request failed after the push — it resolves, never
  throws) return a `ShipRecord` (protocol.ts: action, from, at, branch, commit, head, pushed, pushOff, request { url,
  how } (the address as a URL writes it — host lower-cased, no default port), `web` = the repo's web address — scheme +
  host + project path, `cleanWeb` on both sides, never credentials or a local path; an ssh alias host as `ssh -G` names
  it (nothing connects; git.ts `sshWebHost`: never over github.com / gitlab.com as written, an IP literal or a host below the
  written one; the ssh-only fronts ssh.github.com / altssh.gitlab.com → their forge's web host); from a request's own address when gh / glab gave one —, failed step); One checks it again
  (coding/ship.ts `cleanShip`; a branch by git's own rules) and writes ONE grey callout per record (`shipNote`, "<stage | Git (by hand)> · <date>" — links only to
  what is on the remote; a record that says nothing writes none, never the English summary) inside keepTrust: the stage
  run's writer in finishStage's aiWrite, `you~ui` for a key; PR / Commit = `prFieldNext` (the request's address, else
  the pushed commit's link — never over a request link); an older worker keeps the summary note. Commit messages and
  request bodies end with `One-Task: <task id>` (run.ts `withTaskTrailer` / `requestBody`, text only — never `git
  interpret-trailers` / `--trailer`: `trailer.*.cmd` runs commands). worker.json `forge` per repo ('auto' | 'github' |
  'gitlab'; the setup page's "Host type") decides links and gh / glab; GitLab finds an open MR first (`requestOf`). A
  rejected push logs `pushRejected`; Update from base merges `<remote>/<branch>` in first; never a force in a stage.
  `WorkerRepo.push` / `pr` announce worker.json's flags (the pipeline editor warns, `gitStageWarnings`; older workers:
  none). The Git tab links a commit only when the worker marks it pushed (`GitCommit.remote`, never by list position)
  and shows the task's `One-Task:` line to copy; git keys wait as long as the worker may take (service.ts `GIT_KEY_MS`).
  Pipelines (docs/CODING.md § Pipelines): `Database.system` 'coding' | 'spec' (Business analysis) | 'qa', each its own
  board (#/coding, #/coding/spec, #/coding/qa), each usable alone; find them only with `pipelineDbId(kind)` /
  `kindOfDb()`; "Then" (`followUps` multi-select) spawns follow-ups when a task is done (`spawnFollowUp`). Stage kind
  'doc': Claude Code reads only (main checkout, or `<config dir>/scratch/<task>` without a repo; Edit/Write/Bash denied;
  worker-level `mcpServers`), its last message = a page section; `output: 'testcases'` → rows of the Test cases
  database (`system: 'testcases'`). Stage kind 'import': the task panel hands the worker a ZIP (chunked `intake-*`) or a
  clone address → a new repo in `cloneDir` added to worker.json (intake.ts; `"intake": false` refuses), then the task
  takes it as Repo (`intakeDone`). Pages a task mentions (@ / links / a pasted One address, also in answers and rework
  notes) and the pages linked in THOSE (one level deeper) go to the worker as read-only text (coding/refs.ts `refPlan`:
  the turn's answer / rework note first, then the task's readable part, then the nested ones; ≤ 8 in all, context marks
  per page; one level deeper only each page's first 8 links (`deeperOf`) and never a page kept back — mail / memory /
  a row of a `Database.system` database, a private page for a shared task; what Claude sees named but does not get is
  listed under them, `left`, ≤ 20 names, a page outside the version by its id only); the version hashes every live page
  the task's whole content points to (no cap) and `deeperOf` each of those (`refIdsOf`) — ONE list with the hand-out,
  whatever its order — and only pages of the checked version go along (`within`; "Goes along" and "Give the page" use
  the same plan, `nextPlan`). A Markdown link's label is never an address (`idsInText`; a link-marked text node counts
  by its href only). Coding text fields (answer, rework note, new-task goal / criteria) are `RefField` (coding/RefField.tsx):
  "@" / "one:" = the editor's page search (editor/lib/pageSearch.ts `mentionPages` / `refPages`, shared with
  MentionMenu / RefMenu), a pick shows "@Title" and is sent as `[@Title](#/p/<id>)` (refDraft.ts `draftText`; taskBody
  turns it into a page mention), private pages (team) only for a private task (`privateAllowed`); "Give the page" chips
  under Claude's question (GivePages.tsx, pagePick.ts `suggestPages`: quoted names = exact live titles, ambiguous →
  every candidate with its path; never sent by themselves); "Goes along" (RefsLine) is live with the draft, opens a page
  in the peek, and unsent answers / rework notes are kept per task + stage in this tab (TaskPanel `drafts`). "Copy for AI
  context" (shell/lib/aiContext.ts `pageForAI`, page menu / sidebar row menu / ⌘K) = a page as Markdown on the clipboard. The task tools are read-only for Claude Code (plan mode may ask);
  without ExitPlanMode the plan file (`~/.claude/plans`) is the plan.
- Claude's Markdown goes into or is shown in a page only through `claudeDoc` / `claudeBlocks` (features/ai/claudeDoc.ts):
  web images become links, frames / media / web files never load. With a `SettleContext` (`claudeSettled`) its `> [!TODO]`
  quotes go through the settle gate and `one:person` / `one:date` links become mentions; without one, no task and a
  person link stays "@Name" text. In shared pages Claude's change is its own undo step
  (`startUndoStep(view)` / `endUndoStep(view)`, editor/index.ts). History `SnapshotReason 'script'` ('Script · <name>').
  UI: Popover is hidden until placed and focuses at once; Menu activates only on real pointer movement
  (ui/pointer.ts `usePointerIntent`); use ui/focus.ts `restoreFocus` / `useFocusWhenShown`.
  Popover is clamped to the viewport (never partly off-screen); `resizable="<kind>"` = a corner grip for form popovers
  (localStorage `one.popover.size:<kind>`, never below the natural size, `[data-resized]`). The base `.popover` chrome
  is in `@layer one-popover-base`. In production ui.css loads AFTER the features chunk's CSS: an area rule that must
  beat `.input` / `.btn` needs two classes. Long labels cut with "…" get a title (ui/clip.ts).
  Closing gesture (ui/gesture.ts): a dialog closed by a pointer press — and a toast's key, which removes its toast —
  swallows the rest of that gesture for 450 ms (`armClosingGesture`; mouse: click count ≥ 2 within 16 px only; touch /
  pen: a tap on the closing key's box + 8 px, or within 32 px on a spot that acts on nothing — a tap on another key,
  field or text is the person's own however near) — single clicks are never touched. Only presses inside an
  open MODAL dialog (`[aria-modal="true"]`) are exempt, and only for a dialog's close (a toast exempts nothing) — never
  the side peek or other non-modal panels. Opening gesture: a dialog opened by a touch / pen tap (`armOpeningGesture`
  from ui/Modal.tsx — the tap still down, its click being handled or ≤ 150 ms after; a dialog that opens on its own later
  is not) swallows for 450 ms taps inside its scrim within 32 px of that tap or on its key's box + 8 px (a double tap's
  second click counts 1 on touch). Scripted touch tests wait ~500 ms before tapping into a dialog a tap just opened.
  Outside-press handlers on pointerdown (Popover, Peek, CellMenu) go through
  `outsidePress(e, close)`: a mouse pointerdown carries no click count, so one near the closing press waits for its
  mousedown (a double-click's second closes nothing). A toast key ignores a click count ≥ 2 whose sequence began elsewhere.
  Focus (ui/focus.ts) never ends on the body: a menu (a popover holding `[role="menu"]`) closed by Esc or a pick gives it
  back to its Element anchor (`returnFocusAfterClose`, two frames later, unless a dialog / field took it or the route
  changed; a trigger gone → main region). A pick that changes the route — compared with the route `notePick()` noted
  before its action ran (ui/Menu.tsx) — leaves focus to the new view: the main region unless something there took it.
  `canFocus` refuses disabled and `aria-disabled="true"` elements (the fallbacks then apply, also for an opener disabled
  just after a dialog closed). A dialog opening as focus is lost takes the key handed over by a menu, the
  palette or a toast (`handFocusOver` / `takeFocusHandoff`) as its opener; an opener hidden now (a row's ⋯ shown on hover)
  → `focusNear` (its row's link); nothing at all → `mainRegion()`. A toast removed while it holds focus gives it back
  to where it was before the press / before the keyboard came in, else the main region. "Take the keyboard if nobody has
  it" checks use `focusIsNowhere()` (body or the main region itself), never `=== document.body`. Modal (ui/Modal.tsx): for
  600 ms after closing (renewed by a route change in that time) focus that falls to the body because the element it went
  back to is gone goes to the main region; the scrim's mousedown never moves focus. A `label` stays beside a title that
  fits on one line there; a title that would wrap goes below it when the column beside it is under ~13em or the label
  takes > 30 % of the row (`.modal__header[data-stacked]`, measured, cut with "…").
  Toasts: `toast({ background: true })` = raised by background work (agent runs, features/agents exec.ts `notify()`):
  never over a dialog — held in `waitingToasts` while one is open (on-screen ones step back too, their timer keeps
  running), shown when the last closes (`holdBackgroundToasts`, driven by ui/Modal.tsx) placed before the person's
  newest toast; dropped when dismissed meanwhile, raised > 2 min before, or (stepped back) with < 1 s of its time left.
  At most 4 on screen: the oldest background toast goes first; a toast the person raised only for a newer one of theirs.
  Agenda keys (shell/agenda): work with focus on a sidebar key too — only text fields, menus, dialogs and keys that use
  ← / → themselves (tree rows, tabs, separators …) keep theirs.
- Cloud worker (features/coding Local | Cloud, team workspaces only, `viaFor()`; server/src/coding relay; mcp/src/worker
  cloud.ts / link.ts / box.ts; docs/CODING.md § Cloud worker, docs/CLOUD.md § Coding relay): the worker dials the team
  server, the relay pairs one tab ⇄ one worker per (workspace, member) and forwards only `key` / `box` / `relay` frames,
  storing none (`CODING_RELAY=off` disables it; keep server frames.ts in step with protocol.ts). Every frame is AES-256-GCM
  sealed with HKDF(pair, tabNonce‖workerNonce, 'one-worker-relay v1'), AAD = direction + seq — relayBox.ts (WebCrypto) and
  box.ts (node:crypto) stay byte-compatible (fixed vectors in worker-box.test). The worker token `onew_…` lives ONLY in the
  downloaded file (server: HMAC in `coding_workers`); a new token is pending until its first connect, then the older one is
  revoked. Per device `one.coding` → `via[team:<id>]` and `cloudPairs[team:<id>]` (token ids only, ≤ 4); each download's
  pairing secret is a NON-extractable HKDF key in IndexedDB `one-coding` (`cloud:<ws>|cloudpair|<tokenId>`, cloudKeys.ts:
  `cloudKey()` / `keepCloudKey` / `dropCloudKeys`) — never synced or backed up, wiped by cloud/device.ts. A device holding only
  a pending download never takes the relay slot of the member's active worker (`pendingHere`); a tab closed as 'replaced'
  takes its worker back when it is online with no tab. Only log / progress / git events are droppable (`k: 'e'`); the outbox
  is coalesced and paced, the rest goes to a tab that pairs mid-flush. Cloud only on https (or loopback): `cloudContextOk()`
  / `cloudOriginAllowed()`; its local port `cloudWorkerPort(workspaceId)`. Tasks run only while a paired tab is open.
- AI terminal ⇄ pipelines (features/ai/agent/coding.ts → coding/terminal.ts via coding/index.ts): list_pipelines /
  list_tasks / read_task read (Claude Code's text inside `<task_output>`); create_task / task_action (approve · rework ·
  answer · run · continue · stop · then · hand_on) stage ChangeKind 'coding', applied last, only with `applyChanges(…, { terminal: true })`.
  Apply never confirms a task version: every action but stop is refused while `taskNeedsConfirm()`; every terminal write of
  a task goes through `guardTask` (apply.ts); update_row never sets Stage / Repo / Branch / Then (FREE_ROLES = priority +
  title). What starts the worker (`startsNow`) or goes to Claude Code (append / edit of a task → `StagedChange.refs`, the pages
  its text links, shown in full, tag GOES TO CLAUDE CODE) is never in a bulk apply. Task-action fingerprints chain across the
  terminal's own applied writes (`sigSteps`, cleared by /new); approve shows the plan only while the page's section still
  hashes to `TaskLocal.planSig`. Team: a writer that changed the open editor calls `flushPageContent(pageId)` before reading
  the store. `/pipelines [kind]`; `/connect` (`/verbinden`) lists MCP servers, adds one, or signs in (`signIn(id, { sameTab:
  false })` synchronously from the key press; a blocked popup → OAuthIssue 'blocked'); after an `mcp_auth` error the turn
  offers "Sign in to X".
- ⌘K filters (shell/palette: query.ts parser · filters.ts evaluator · suggest.ts — pure, no eval / RegExp from input):
  only exact (folded) property names make filters (a typed beginning of several names suggests the names, never another
  name's values); chips only through `takeChips()` (≤ MAX_CHIPS; past the cap the filter stays typed) and `setQuery()`;
  keywords in either language are one filter (is: = ist:, by: = von:, canonical `groupKey` / `filterKey`); each `in:`
  keeps its own ancestry memo; `me` = the signed-in member (team) / every change no agent made (local), never an agent;
  locally `by:` suggests Me and agents only. A valid alias suggests what it means (never every value). Filters walk
  `SearchIndex.pages` (never the page map — perf budget). Enter on a focused button inside the ⌘K `<Command>` clicks it.
  Visits: FREQUENT per device in localStorage `one.shell.visits:<kind>:<id>`, written only by `noteVisit()`; RECENT
  (`Workspace.recent`) is per device too — full backups write `recent: []`, a restore keeps this device's list; neither is
  synced, exported or sent to Claude. Sidebar RECENT | FREQUENT (shell/sidebar/Visited.tsx, `one.shell.visited`); tree rows
  carry `data-section` (pages | private | fav | recent | frequent) — scope sidebar test locators with it.
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
  Fixed block (places, TOOLS strip shell/sidebar/Tools.tsx — a WAI-ARIA toolbar, the Patchbay key = patchbay NavRow
  `variant: 'key'` —, 01 FAVORITES shell/sidebar/Favorites.tsx) above the seam; the tree scrolls below (sticky heads,
  reveal = the top-level ancestor under the head, one orange bar: `data-bar-in-favs`). Every star goes through
  `toggleStar()` (shell/lib/favorites.ts; removal = toast with Undo to its slot); favourite order per device +
  workspace in localStorage `one.shell.favorder:<kind>:<id>` (written only by `placeFavorite` / `moveFavorite` / the
  Undo; missing favourites join by title; wiped with the team copy), fold `one.shell.sections`, tools mode
  `one.shell.tools` (`{ mode, phoneOpen }` — the phone drawer folds TOOLS into one row) — never synced / backed up. Drops
  hit only what shows (collision.ts `visibleWithin`, a live hit test; the before / inside / after split and auto-scroll
  read the live pointer it records — `livePointerY()`, never the drag's scroll-shifted `delta`). Whole rows: each
  section's rows snap under its head's measured height (`--sb-head-h`) and `.sb-scroll__end` makes the end of the range
  land on a row (Sidebar.tsx `useWholeRows`). Entry lists of more than 7 peek (5, then "+N more"
  unfolding in place to 20 + Show all; `more:<section>:<db>[:<row>]` keys in `one.shell.expanded`, folded by Collapse
  all); `entryOrder` lists a calendar / timeline first view without sorts by its date, newest first (`entryOrderProps`
  is what re-sorts the memoised index). RECENT | FREQUENT starts folded where favourites exist (judged once per mount;
  the person's fold in `one.shell.visited` wins). Touch rows carry only ⋯ (its menu: add inside, then ☆); the open
  drawer publishes `--sb-foot` so toasts sit above its foot.
- Mail (features/mail): Gmail → a "Mails" database. Client: One's built-in Google OAuth client (`BUILTIN_CLIENT_ID` /
  `BUILTIN_ORIGINS`, features/mail/builtin.ts; only on those origins; e2e seam `__oneMail.builtin(id)` under `?e2e` only),
  overridden by the person's own client ID (`settings.mail.clientId`, '' = none) — read it only through `effectiveClient()`
  / `effectiveClientId()`. Google Identity Services token client, scope `gmail.readonly`; the access token lives in memory
  only. Sync state per device + workspace in IndexedDB `one-mail`, never synced. Rows dedupe by the Gmail message id;
  re-syncs write only Labels / Unread; bodies are written with origin `'mail'`. A database the sync made (or wrote into) is
  marked `Database.system: 'mails'` — its rows are the AI data class `mail` wherever it is, also once this device's sync
  points elsewhere (core/sources.ts). Team workspaces: the database is created
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
- Automations (features/automations, public API automations/index.ts): every reader of `Database.automations` goes through
  `readAutomations(raw)` (automations/read.ts, pure sanitizer: trigger, actions, http(s) URL only, POST / PUT, headers;
  unknown keys kept; NEVER shortens a value — beyond `AUTOMATION_READ` an automation is unreadable, kept as it is, never
  run or edited here and counted in the modal; the editor's own caps are `AUTOMATION_LIMITS`), every write through `saveAutomations(dbId, list, writer)` (model.ts; AutomationsModal writes as the
  person, its delete Undo `you~undo`); on a locked database only switching off and removals are saved — adds and
  re-wiring are refused (owner decision Q2), the modal says so.
- Integration profiles (store/integrations.ts, features/agents/integrations, `#/workspace/integrations`): `Workspace.integrations`
  (schema `one.integration/1`: id, name, match { tools · name glob · host glob }, unlocks ⊆ keys | onlyByHand | upsert |
  toolAllowList | agentState | notify, recipes = `RecipeConfig` kind 'mirror' — database / properties / views / agent as data).
  Write only with `upsertIntegration(profile, replaces?)` / `deleteIntegration`; ≤ 50 (the store refuses a 51st; the team
  binding and the server take the first 50 valid by id); every reader sanitizes; issue vars use `show()`, never `String()`.
  Team: meta map `integrations`, owners / admins only (server guard). Full backups carry them, page backups never. A profile is
  ACTIVE on a device while one ENABLED MCP server matches (team server runner: name / host only); read gates only through
  `useUnlocked(f)` / `unlocked(f)` (features/agents/index.ts). Flags and tool lists already set stay in force without one. A
  recipe without `agent.instructions` gets them composed from its OWN properties (integrations/instructions.ts). One presets,
  names and detects NO external service anywhere (code, UI, prompts, help, tests, worker) — integrations.spec has a source guard.
  PropertyFlags shows a SET "Only by hand" switch to everyone (switching off always allowed; on stays gated). The Patchbay's
  keys 2 / 2b ("„Field“ by hand only", "Disconnect write tools") need no `onlyByHand` / `toolAllowList` unlock — they only
  take capability away (owner decision Q1); the Patchbay is the only ungated way in (patchbay-keys.spec). Workspace ›
  Integrations "Set up in the Patchbay" opens a profile's setup lamps (it only reads).
- Outbox lock (features/ai/mcp-servers/lock.ts; the Outbox is features/outbox): a profile's `sends[].tool` are OUT on every
  server the profile matches by name / host (`outToolsOf`, store/integrations.ts — independent of unlocks, the server's
  switch and tested tool lists). Every toolset `toolsetFor` (app) / `toolsetOf` (server runner, `RunInput.out`) builds
  switches them off (`configs: { <tool>: { enabled: false } }`; an allow-list loses them, left empty → the server is
  left out); `forced`, codewords, a picked tool and allow-lists never lift it; the system prompt names them. A profile
  with `sends` must match by name or host (`sendsNeedsName`; the sanitizer drops its `sends`); a route the sanitizer
  leaves out keeps its tool OUT through `IntegrationProfile.outTools` (the server reads it too). A connection test keeps
  the OUT tools a server had (`mergeTestedTools`; `LISTING_SHOWS_DISABLED` = spike SP1). `ChangeKind 'send'` (+
  `send.slipId`) is never applied by `applyChanges` (applyOne throws), not even in write mode "apply". Only the Outbox
  calls an OUT tool, outside any Claude request. Route templates: `placeholdersIn` / `placeholderProblem`, paths
  `ROUTE_PATH`, keys `ROUTE_KEY`, limits `SEND_LIMITS`.
- Outbox (features/outbox, public API outbox/index.ts, docs/OUTBOX.md): the only place an OUT tool's call is prepared;
  slice 1 sends BY HAND only (Copy & open → "Sent in X?" → Mark as sent; a receipt "by hand · not checked") — worker
  sends, pre-read, read-back, probe, groups' plate, `fire` / `Arm` / `ui/Guard` are slice 2 and do not exist yet (a static
  guard in outbox-engine.spec). Slips live per device in IndexedDB `one-outbox` (`<scope>|slip|<id>`; team scope
  `cloud:<ws>:u:<account>` = the member's own; CAS via idb-keyval
  `update`, BroadcastChannel `one-outbox` between tabs); never synced, exported, backed up or sent to Claude; wiped with
  the workspace copy (cloud/device.ts); storage refused → nothing staged (fail closed). Write slips only through
  `stageSlip` / `stageGroup` / `draftSlip` / `replaceDraft` / `setIncluded` / `withdrawSlip` / `withdrawGroup` and the
  Outbox's own actions; states only via machine.ts `next()` (no ready → sent except `markSent` by hand, and only for the
  arguments that were copied). Trust is computed by the Outbox (provenance.ts: typed row fields — and select / status
  options the profile declares — exempt, free text and ALWAYS_FOREIGN kinds foreign; a caller's page source is read from
  the page, never its text) — never taken from a caller; a slip without sources is incomplete, never clean. Only the
  person's typing in the slip's editor (`writeText`) can make an address theirs, per address against every earlier text
  of the slip (seal.ts `personAddresses`); `replaceDraft` never does. A page made with Claude's or someone else's text is
  created with `createPage({ contentOrigin })` ('ai', 'share' …). A text counts as seen only once shown unclipped (Payload). The draft request has no MCP and no tools
  (`completeStructured({ mcp: false })`); route args are built as values (template.ts `fillArgs`, `{sentAt}` kept as a
  token until the press), hashed with `canonicalJson` (coding/protocol.ts) + SHA-256. CHANGED per mirror = the row's
  baseline roles (comments / lastCommentAt / srcStatus / changedAt; dates as stored stamps) against the row now (watch.ts),
  the person's own sends explained away; the baseline is read when the draft request is built (draft.ts), not when it returns. Row patches (`after`) and Reset row write with `setRowProperty` inside
  `aiWrite(fn, { reason: 'outbox', by })` — one version, a value changed since staging is skipped / kept. ONE count:
  `outboxCounts()` (held wins over foreign) for sidebar badge, tree chip, readout, dock, #/outbox and status bar. Routes
  are database commands (`send:<profileId>:<routeId>`, group 'outbox', `needsRow`). Dock: a 420 px column portalled into
  `.app .stage` at ≥ 1200 px (open state per device `one.outbox.dock`), else a sheet (full screen ≤ 600 px, above floating
  keys). e2e seam `window.__oneOutbox` under `?e2e` only; fixtures tests/fixtures/mock-mcp.mjs (+ fake-net.mjs).
- Preflight (features/preflight): lamps count what waits on the person for 0 tokens — a source's `read()` is O(k), never a
  Claude call, never a page-map walk (rows from store/rowIndex.ts, fed by pageChanges; content-only changes reported
  apart); reads run in idle (shimmed where requestIdleCallback is missing) and the UI reads only `usePreflight`. Other
  areas add lamps only with `registerLampSource` imported from `features/preflight/registry` (dependency-free; the
  Outbox's is features/outbox/lamp.ts); queue item ids are exactly the reading's ids. Every card key calls the source's
  own entry point from queue/calls.ts (applyRun / discardRun / undoChangeEach · applyStaged(…, { quiet }) / discardStaged /
  undiscardStaged · saveProposal / saveRunMemory · planTaskAction → applyTaskAction (never `confirm: true`; only "Version
  bestätigen" → confirmTaskVersion(id, hash) of the version its card rendered) · markRead / archiveItems · openSlip /
  withdrawSlip) and reports what really happened (an action that changed nothing is not done). Writers (store/writer.ts):
  each key writes as its source does — applyRun = the agent run (`agent:<id>:<run>#<change>`), applyStaged = the
  terminal's batch, memory saves `you~memory`, every Z `you~undo`, sync's own `you~ui` — and applyTaskAction gets
  `you~preflight:<task id>` (calls.ts `applyTask`); Preflight's own state never touches the store. VON HAND (starts the
  worker, goes to Claude Code, sends, version confirm / sign-in / text / editor, tokens) confirms only with ↵ / click on
  its confirm key and is never in ⇧A or a swipe; ⇧A applies only clean cards shown in full in this tab — their body
  rendered, at the content revision they have now (`QueueSourceDef.rev`; a change merged in place is unseen again) — a
  bulk sheet shows the rest first and its key applies only what was seen (arrivals wait), never on "Alle". A batch's Undo
  answers per card (`Done.undo` → { itemId: 'undone' | 'kept' | 'final' }, `Done.finals` for cards without one); only
  'undone' cards come back, a 'kept' one stays done. Device state per member (`local:local` | `cloud:<ws>:u:<account>`):
  localStorage `one.preflight.{ack,today,last,hidden}:<scope>`, prefs `one.preflight.prefs` (device-wide), IndexedDB
  `one-preflight` (log + opened set: ids, kinds, times, outcomes — labels resolved live, never text), 30 days, never
  synced / exported / backed up, wiped with the device copy and the local reset. Keys only with focus in the plate or
  the queue; Esc is preventDefault-ed; Enter on a button is left to its click.
- Patchbay (features/patchbay, docs/PATCHBAY.md; help `patchbay`): the model is pure and never stored — `buildModel(input)`
  over a `ModelInput` that inputs.ts (the only store reader) builds through source.ts and memoises by the wiring
  signature: config fields only (automations without `last*`, autofill without `fills`, repeating without `lastRunAt`,
  agents sanitized with Unreadable fields kept), referenced pages by id through the row index — no page-map walk on the
  hot path, typing rebuilds nothing, the ledger is never read for the LED (only on the route: today's money). ONE
  publisher (state.ts `refreshModel`, after first paint in idle — compute.ts — or on the route) writes the counts and the
  hints, so sidebar LED = Preflight lamp `fuses` (`master: false`) = status cell = readout. Expensive readings (script /
  kit scans, server-agent runtime, team hooks, the capture Inbox, the button index) only when `#/patchbay` opens; the
  fuse-relevant ones go to the lazy cache (IndexedDB `one-patchbay` `<scope>|lazy`, ids and hosts only) so the LED
  agrees after a reload — a reading the cache lacks is an UNKNOWN part (never counted, never safe). Fuse = a decider
  (custom agents whatever `enabled` says, autofill `auto`, mail organise, the bridge in 'apply') ∧ content from outside
  (mail-class rows, MCP reads, a server agent's webhook body, team hooks / tokens, GitHub pick-ups, Clippings, + the
  taint fixpoint) ∧ private data relative to the exit ∧ an unattended way out (automation webhook after a direct write,
  MCP write tools — fail closed for an attached server without an allow-list or a tested list —, autofill's `scope:
  'all'` servers, this device's GitHub auto-push, an unattended git stage), with full reachability (chains.ts walks the
  flow, rules.ts = the engines' rules); gates and closed reasons make near misses. Keys write only through
  `upsertAgent` (the STORED agent spread) / `setHandOnly` / `setAutofillAuto` / `patchServer` / `setMcpMode` /
  `setOrganise` (the mail organise switch), as `you~patchbay` (`YouVia 'patchbay'`), each Undo `you~undo` (≤ 20 per tab
  session, refused "changed since" over config fields). `Workspace.fuseSignoffs` (path key → { sig, parts, at,
  updatedBy }) is read only through `sanitizeFuseSignoffs` and written only with `signOffFuse` / `withdrawSignoff` /
  `restoreSignoff` (store/fuseSignoffs.ts; local: the person; team: owners / admins on a server with `supports ∋
  'signoffs'` — meta map `fuseSignoffs`, server guard collab/fuse-signoffs.ts stamps `updatedBy`); a changed sig part =
  lapsed; no `stampGen`, no schema gate; full backups carry it, a restore NEVER takes it. Patching (P4, switch per device,
  off by default) writes only through `upsertAgent` / `saveDbCommands` / `saveAutomations` / `upsertIntegration` (patch.ts
  plans purely, the editors' save checks first — agents/saveChecks.ts; never a new way out; the preview's "+Fn" asks).
  Device stores — IndexedDB `one-patchbay` (lazy cache, `<scope>|runs|<day>` tally, `<scope>|setup`), localStorage
  `one.patchbay.*` (seen, patch, order:<scope>), sessionStorage `one.patchbay.return` — never synced / exported / backed
  up, wiped with the device copy (`wipePatchbay`) and the local reset. `features/patchbay/hint.ts` (FuseHintLine,
  PatchbayAgentLink) is the one dependency-free module other areas may import directly (agent editor, its MCP tool list,
  AutomationsModal), like preflight/registry. Words: §1.1 of the plan (no "Vertrauen" / "Prüfschritt" / "abnehmen" /
  "fremd" / "Trigger" in German, "Ausgang" only for the Outbox module) — patchbay-names.spec guards them.
- Agent runs are written per change under a lock: applyRun / discardRun / undoChange / undoRunAll / supersedeOlder run
  inside `withRunLock(agentId)` (agents/runs.ts; a Web Lock), re-read the stored run, act only on `pending | failed`
  changes and write with `patchRun` (never `putRun` of a stale copy); both Undos settle through review.ts `settleUndo`
  (what went back is pending again, a kept change stays applied; an undone browser 'apply' run is 'staged' again, a
  server run keeps its status). The run-level Undo's batch lives in agents/undos.ts (exec.ts and review.ts never import
  each other). Superseded proposals (features/agents/supersede.ts, leader tab, browser runs, `update_row` whose props
  the newer change covers, never a card the person opened — the guard Preflight registers): status 'superseded' (never
  'discarded'), no card, counted nowhere; `stateBack` stops at a run holding one.
- Server proposals for Preflight come from `GET /:id/agent-runs/open` (own server agents, staged runs, no summaries /
  steps), polled only while the document is visible. applyRun / discardRun of a server run read it again from the server
  inside the run lock (`freshServerRun`) — never a tab-local copy; no answer → nothing done.
- The AI terminal's "applied alone" rules and its staged-id map live in ai/agent/staged.ts (startsWorker / goesToWorker /
  appliesAlone / resolveStaged) — the session and Preflight read the same ones. Coding task states written in a tab are
  announced on BroadcastChannel "one-coding-tasks"; a state held only from `loadTasks` (a snapshot) never wins over the
  stored one (coding/local.ts `newerTask`).
- Code areas (ui/code): use `CodeArea` for any code or instruction field, never a plain textarea (the integrations JSON
  editor keeps its own windowed `JsonCodeArea`, same palette). Syntax colours only from tokens.css `--syn-*` (≥ 4.5:1 on
  bg / surface / surface-2 / surface-3, Paper + Carbon) via `.syn-<class>` or `.hljs-*` inside `.hljs` / `.syn-hl`
  (ui/code/syntax.css) — no area keeps its own palette. The textarea and the drawn lines share every metric; a
  `renderToken` drawing keeps the raw text inside, invisible, and draws over it. First Esc releases Tab only. Per device
  localStorage `one.code.<storageKey>` = { wrap, h }. Code blocks (editor/views/CodeBlockView.tsx + extensions/codeLines.ts):
  line numbers, current line and bracket pair are view-only decorations; per block + device in `one.code.blocks`; the
  stored node stays { language } (+ id); Backspace at a line start goes through `deleteBreakBefore` (never the browser);
  languages are a registry (`registerCodeLanguage`, editor/lib/codeLanguages.ts; One Script = 'onescript'). Agent
  instructions: `PLACEHOLDER_PATTERN` (typographic quotes allowed) is counted and "Run now" asks first; a mirror recipe's
  own placeholders (`placeholdersIn`, mirror.ts) refuse a run and switching on; highlighted tools = `instructionTools()`
  (narrowed by `mcpTools`).
- MCP overview (features/ai/mcp-servers/McpOverview.tsx + overview.ts, pure): Settings → AI → MCP servers opens
  with a table per server — codeword, One's Claude (free · all · off), browser agents attaching it (a tool list of [] leaves
  it out), integration profiles it activates (`matchingServers`), and Claude Code in the worker (repo / no-repo names from
  `WorkerInfo.mcp`, matched by name or codeword, case-insensitive; only when the worker names 'mcp-list'). A Claude Code
  name One does not know gets its own row. Cards below a 460 px container.
- History compare (features/history): Changes compares a version with the one before (default) or until now — per device
  localStorage `one.history.compare` ('prev' | 'now') and `one.history.markNew`, only through history/prefs.ts. 'prev' opens
  on the newest version; the oldest counts as all added in Changes and shows plain in Version; "Now" with 'prev' = newest
  snapshot → the page. Two versions compare properties with `diffPropsBetween` (props.ts); restore notes only in 'now'.
  Version marks what was new with docDiff `withoutRemovals` + DocDiff `context={Infinity}` (`foldRows` never folds).
- Flight recorder (features/recorder): every store write runs under a writer — store/writer.ts `withWriter(w, fn)` is
  SYNC ONLY (a frame never spans an await; async flows carry the `Writer` as a value: `ApplyOpts.writer`, `Host.writer`,
  `PickupInput.writer`, `opts.writer` …); innermost frame wins; editor flushes always name themselves; editor-applied AI
  results go through `editAs(editor, writer, fn)` (editor/index.ts). Derived writers (automation, autofill, kit, synced)
  keep the `cause` (`causeKey()`) read in their subscriber. Bookkeeping / binding follow-ups / repairs / cross-tab replays /
  the memory log run under `SYSTEM(why)`. New write paths need a writer: in DEV / `?e2e` a write without one is a
  console.error (`[recorder] write without a writer`), so any spec that reaches it fails; the test hook's store writes as
  `you~ui:e2e`. Seam `window.__oneRecorder` (DEV / `?e2e` only: flush, settle, step, seedBulk, wipe …).
- The journal (IndexedDB `one-recorder`, per device, keys `<scope>|…`, team scope `cloud:<ws>:u:<account>`, 30 days, one
  device-wide budget ≤ 250 MB incl. pins; the workspace's save always wins) holds ids, kinds, times, counts and HMAC
  digests (per-scope non-extractable key) — NEVER page text or property values; text only in schema events / daily
  checkpoints (property / option / view names). Never synced, never in backups / exports; wiped with the device copy
  (cloud/device.ts) and the local reset; Workspace → Data "Erase the tape" wipes this scope only. Before-images are pins in
  the version store `one-history` (`pin:<scope>|m|…` meta + `pin:<scope>|b|<page>|<digest>` content,
  features/history/pins.ts) taken from the listener's frozen prev object at every segment start; a place without one is
  "partial" — never guessed. Delete forever by the person drops that page's pins. The recorder starts right after
  startHistory and opens its database lazily (a reset / wipe is never blocked). A run that goes on in another tab or after
  a reload: its stored record (`runs`) is merged in before this tab first writes it (journal/runs.ts `RunBook.adopt`:
  Vorgänge and words add up, places = the union of its stored events' and this tab's, the meta stays).
- The deck (features/recorder/ui, lazy chunk; `RecorderHost` in ModalHost portals it into `.app-main`): UI state only in
  its own store `useRecorderUI` (never `useWorkspace`); prefs per device in localStorage `one.recorder.ui` = { zoom, loupe,
  filter, height }; open with `openRecorder()` / `toggleRecorder()` — Mod+Alt+Z (`REWIND_SHORTCUT`; shell/lib/global.ts
  before the AltGr bail-out: pc tests `e.key === 'z'`, mac `e.key` 'z' or 'Ω' — never `e.code`: German QWERTZ has Z on
  KeyY, on a Mac too; AltGraph never), the status bar's Rewind key, ⌘K `rewind`, the page / sidebar / phone menus,
  Workspace → Data. One dock at a time with the AI terminal and, below 1200 px, the Outbox sheet (`closeOutboxSheet` /
  `onOutboxSheetOpen`, outbox/index.ts): opening one closes the other; work keeps running. Closing gives focus back to the
  opener (the key a menu / ⌘K handed over, else what had focus — `takeOpener`), else near it, else the main region. The
  deck publishes its height as `--deck-dock` on <html> (toasts and floating keys sit above it); other tabs ping on
  BroadcastChannel `one-recorder` (debounced re-read); the first read is exactly the visible span's ops (the room on either
  side follows the first paint; < 150 ms with 40k events). This tab's flushes merge in by key and never widen the loaded
  window; only new Vorgänge (`Flushed.fresh`) count into the strip and the minute bars; synced-block copies (`F.COPY`) are
  drawn dimmed, never counted. The head sheds whole parts until it fits (measured, `data-head`), its keys never shrink; the
  status bar sheds low-priority parts the same way (StatusBar `data-shed-1…6`). Orange on the deck = playhead + selected window + held
  marks + EJECT only (+ the shared REC `<Led>`); colours are the `--tp-*` mixes of recorder.css, kept AA under every look by lib/look/derive.ts
  `deckPlate` / `deckText` (look-engine.spec reads both). The deck only reads — only the eject writes the workspace.
- Window reading (features/recorder/window): read-only — `loadWindow` flushes (never settles, never flushes editors),
  `verdicts` (model/hold.ts) is the one held check for the plate, the read dialog and the eject; rows compare over the
  property keys present at the writer's end and now (rowkeys.ts; absent `p:` = empty at flush; `bhr` explains chain
  breaks after a property add); NEW lefts carry parts; the incident report holds titles, schema names, writer labels,
  counts and times — never values or text, generated on demand, never stored.
- Eject (features/recorder/eject; local workspaces only — `canEject()`: scope `local:local` + `rewindAllowed()`, the cloud
  sets `setRewindGuard(() => false)`): the EJECT key opens the dialog, never writes; the plan (`planEject`, model/plan.ts
  core) is ONE source for key counts, dialog and commit. Rows go back whole, pages per block, new things to the trash,
  held = changed since (`verdicts`), partial = no exact pin, never guessed; never ejected: view order, commands,
  templates, automations, the pipeline fields (FREE_ROLES only), record types / sub-items / dependencies, kit
  properties, list options, memories, an eject (lane `undo`). `applyRewind` is called ONLY from eject/commit.ts and
  eject/undo.ts: lock `one-recorder-eject:<scope>` → the agent's run lock → busy refusal → forced versions "Vor dem
  Auswurf" (`SnapshotReason 'eject'`; one that cannot be written refuses: `versionFailed`) → write-ahead record
  'committing' → sync re-check (flips / removals in use / `staleFacts`: a page joined below one going into the trash, a
  new row linked, a parent going back that no longer fits → aborted, the dialog replans) → ONE store update under `{ kind: 'eject', id, of }` → settle (marks first) → 'done';
  a crashed commit is finished by `finishEjects` at boot from its part-digest targets. Undo: ONE update as `you~undo:<id>`
  (instant from memory, else through the planner), unsettle, record `undone`. settled.ts (`markSettled` / `isSettled`,
  BroadcastChannel) + `isEjectWriter(currentWriter())`: automations, row-triggered agents, autofill, the coding trust watch
  and the attribution keeper skip an eject and its Undo. Units `<runKey>#<change>` (agent / terminal), the run key (MCP,
  script); a page's edits / task changes written in ONE write carry every change written (`…#c2+c3`, `writerOfChanges`,
  store/writer.ts; writeItems `writerOf` names only the edits that changed the page; a group longer than a key holds is
  `#*` → its places held 'batch'): each is a unit on the same places — ejected, held or brought back together (apply.ts
  keeps that part's Undo whole once any of it is settled). AI: an eject and its Undo send no request and write no
  ledger entry; the receipts of what they settle (an agent run's usage, the terminal's meter) stay as they were. Trust:
  an eject writes, voids and re-grants no verdict; `settleEjected` ends the "edited" watches of what it took back
  (review.ts `endWatches`); ejected rows have no keys (RunHistory `undoOf`), held ones keep theirs. A discarded
  proposal that is or builds on an ejected change (`onEjected`, ai/agent/types.ts) never opens again through a
  discard's Undo (review.ts `discardUndo`, its row key gone) or the terminal's undiscardStaged / restoreStaged.
  Preflight: ejected proposals become `discarded` + `ejected`, held ones stay applied + `held`, pending ones
  are discarded except those opened in Preflight; superseded never touched. Task block:
  writes only through applyRewind, never mints an itemId; a task living elsewhere or looping is held, and a task W made
  stays while a live task the plan leaves links it (Blocked by / Related → 'taskLinked', ItemLookup `linkersOf`). Outbox: a row marked as sent is held; slips of discarded
  send proposals are withdrawn (`'origin'`) and stay withdrawn after an Undo; other slips are never touched. Coding: fields
  that move a task are never ejected; an agent's text back → the task waits for Confirm. Prune keeps the pins of live
  ejects (`protectedSegs`). Toast: glyph 'eject', Mod+Z only while it shows and nothing else owns the keys; an Undo from
  the after-plate takes it away. Dialog: ↵ confirms only a fresh press (never a repeat) ≥ 300 ms after it opened and its
  key became ready; the key is `aria-disabled`, never `disabled`; nothing closes it while the eject writes.
- Mirror recipe setup (features/agents/mirror.ts, MirrorSetup.tsx, MirrorDiscard.tsx): `createMirror` shows no toast — a step
  that opens a dialog right away keeps its Undo inside the dialog (AgentEditor intro Undo = `undoMirror`, only what the setup
  created), never a toast over the dialog's footer. Closing an unsaved mirror draft asks (keep editing · keep both · both to
  the trash via `trashMirror` / `restoreMirror`). A setup never makes a second live database of the same folded name
  (`sameNamedDb`); "Use …" → `reuseMirror` only when that database holds the recipe's key property. German strings name the
  settings tab "KI" (shell.settings.tab.ai), never "AI". A database's mirror (`mirrorAgentOf`): the agent
  marked `CustomAgent.mirrorOf` = it (set by `mirrorDraft`, kept by sanitizeAgent) while it reaches it — its scope names
  it, or (local workspace only) its scope is "everything" — whatever its switch, write mode or servers; an unmarked one
  only by write ≠ none + a server of this device matching the profile (on or off; not one whose `mcpTools` entry is []);
  never one marked for another database; team: only the member's own (`createdBy`). No live database of that name but one
  in the trash that a saved agent (team: own) is marked for → the setup names both (Restore · Open, Create waits); in the
  trash only because a page above it is → that page is named and its key restores it (`SameNamed.trashed.parent`, worded
  like gone.ts); after Restore focus goes to the Open key (else the name field). While only Open (and Restore) is offered
  the spec plate shows what is there — that agent, its report page ("—": none), its database. "Use"
  takes back the newest report page this device's setups made for the database (mirrorMemory.ts, localStorage
  `one.mirror.reports:<kind>:<id>` = { dbId: [reportId, …] } newest first, ≤ 5 per database, ≤ 100 databases, never synced /
  backed up, wiped with the copy and the local reset; the tab's own copy is merged into every read, so a refused write
  still counts) that is live and that no saved agent holds — none that uses it or a page below it, none that may write
  (write ≠ none) and names it or a page above it in its scope or as its report page; "everything" holds none (then
  `created` = []: no Undo, no prompt, no toast). Titles: ONE function, `mirrorTitles()`, for the spec plate, `createMirror`
  and `reuseMirror` — the plate shows exactly what the offered action makes ("Use": the kept page or the new title, the
  recipe in the database's language, the agent's name too). Distinct (`distinctTitle`: " (<db>)", then " (2)" …) among
  the other live pages — never the mirror's own database (report '{db}' → page 'Delta' next to database 'Delta') — and
  the agent's name among the agents; within the limit (agent 80, report 200) the counter and the closing parenthesis stay
  whole: the title is cut first ("…", down to 24 characters), then the database's name inside the parentheses ("…");
  never a taken title (the counter goes on). The source list follows this device's settings live (a server switched off
  or no longer matching drops out; the picked one — followed by its id through a rename — stays marked and its field
  says what happened: switched off · no longer matching the profile (address / tools / name, `matchMiss`) · deleted, also
  with the list empty; Create waits). Mirror toasts go through `mirrorToast()`; every
  agent dialog (gallery, setup, any AgentEditor) calls `useDismissMirrorToasts()`. The editor never saves against a
  trashed / effectively trashed (the page in the trash named) or deleted scope page, trigger database or report page; the
  note's Undo asks (MirrorUndoAsk) when the draft changed. The budget field is text in the UI's language
  (format.ts `parseAmount` / `fmtAmount`: "1,5" and "1.5" in German, only "1.5" in English; grouped thousands — German
  "1.000" / "1.000,5" (a dot + exactly three digits, the first group 1–9), English "1,000" — read as thousands and refused
  by the range, never saved as 1; anything else refused). The editor names a ticked MCP server of a browser agent that is
  switched off on this device or not set up here (a hint; saving stays) — its runs leave such a server out (exec.ts, a
  note step).
- Custom agents: `Workspace.agents` (`CustomAgent`, store/types.ts; `createdBy` / `updatedBy` = account ids in a team,
  null locally — `upsertAgent` stamps `updatedBy` with the saver; a team browser agent runs only while `updatedBy` is its
  creator, otherwise it waits for the creator to confirm, features/agents/confirm.ts; on the team server `updatedBy` is
  stamped and `createdBy` kept by the server, server/src/collab/agent-authors.ts) — write only with `upsertAgent` / `deleteAgent`;
  every reader sanitizes (store/agents.ts); team: meta map `agents`. Runs are per device (IndexedDB `one-agents`, last
  100 per agent), never synced; server runs come from `GET agent-runs`. Browser agents (features/agents/runner.ts) run in
  one leader tab per workspace (Web Lock), in team workspaces only in their creator's browser; one run per agent at a
  time. A browser run that staged or applied changes keeps the agent state it replaced (`AgentRun.stateBefore`, per
  device with the run): every change discarded (an 'apply' run's undone first), none applied → it goes back (review.ts
  `stateBack`), only while the saved state is still that run's — and on through runs whose every change is discarded too
  (any order ends at the newest run with applied work, or before them all). None of an agent's run toasts (finished,
  failed, proposals) while its page is the current view. Pages it works with in the trash or gone (gone.ts `lostPages`):
  named on its page with Restore (focus then: the next Restore key, else the notice's heading, else the page's h1); a
  browser run does not start while nothing in its scope or its report page is usable
  (`runBlock` → an 'error' run with the reason + a toast). ONE proposal applied shows its result and Undo in its row (no
  toast); focus after a key that goes goes to the next proposal or the review heading. Money and numbers read in the UI's
  language: `fmtUsd(usd, lang)` (lib/money.ts: "$3.00" · "3,00 $"), also the mail cost line and the coding log's Claude
  Code cost (coding/lines.ts formats the worker's number). Agent writes are stamped `agent:<agentId>` (team: `writeAsAgent()`, cloud/index.ts) and never trigger agents;
  render `agent:` ids with `agentLabel()` ("Agent · <name>"). Routes `#/agents`, `#/agents/<id>`. Team workspaces: a
  browser agent's "everything" scope is the shared pages; private pages only when named in its scope. Anything an
  agent writes turns web images into links (features/agents/images.ts) — no auto-loading pixels from injected text.
  `AgentDialogsHost` (a lazy wrapper mounted once in ModalHost — never a static import of AgentEditor / MirrorSetup) opens
  MirrorSetup / AgentEditor as dialogs over any route through `openMirrorSetup` / `openAgentEditor` (agents/dialogs.ts;
  the Patchbay's setup lamps use them).
- Per-field trust (features/agents/trust): verdicts only from the person's decision on ONE proposal seen in full
  (run review row keys, Preflight A / D / 1–4 on one card shown at its current revision; a body the preview cuts
  (`previewCut`, ai/agent/previewCut.ts) only once opened whole — `whole`) and only once it holds (a server run's
  server refused it → none, the discard did not happen) — never from Apply all / Discard all / ⇧A / X / 'apply' runs;
  "edited" = the person's own value edit (`you` via none / 'ui' / 'agenda', `editor`, a person event) — never the
  Outbox's row patch, buttons, commands, templates …; an Undo kept for an edited field voids the verdicts of the fields
  it reverted (ApplyResult.undo → `reverted`; a task-field change ('workItem') writes no trust key, so records none —
  the help says so); review bodies draw `[!TODO]` quotes as tasks only where apply makes them (types.ts `makesTasks`:
  staged ids, never a server run) — a verdict is about what was written;
  "needs #n" = the first of `depsOf` (dependsOn, then needs) not applied; a row's discard Undo (`discardRun({ row: true })`) holds ids only, never
  the run, and a bulk discard keeps no row Undo; ONE key map on both surfaces (`reasonKeys`: 1 = wrong (+ F de / W en),
  2 not now, 3 duplicate, 4 handled; A apply, D discard, Z undo; trust/runKeys.ts on the agent page); book per device +
  member in IndexedDB `one-agents` (`trust|<scope>|<agentId>` head + one shard per key, `local:local` |
  `cloud:<ws>:u:<account>`), never synced / exported / backed up / sent to Claude (a lesson sends only its 3 items),
  wiped with the device copy and the local reset; written only through trust/book.ts (seam `window.__oneAgentTrust`,
  DEV / `?e2e`). Rules are pure in trust/rules.ts (20 in a row, 14 days, ≤ 2 reasonless, 10-min edited by the person
  only). Run-review keys act only where the buttons would (read-only, running, needs #n — said in a live region),
  never while typing (`ui/keys.ts typing()`); focus after a decision goes to the next open proposal's row (D15), a
  discard keeps its Undo in its row. The plate (trust/ui/TrustPlate.tsx) is read only in S1 (`GRANTS = false`: every
  lamp PRÜFUNG, no switch); meter fills are its LED mixed with ink (trust/meter.ts `METER_MIX` = trust.css, checked
  for every look by look-engine.spec), every detail a cut-out.
- Team-cloud agents (server/src/agents): agents with `runner: 'server'` run on the server (scheduler, row triggers,
  webhooks) with a per-workspace Claude key + MCP tokens encrypted at rest; their writes carry `agent:<agentId>` as
  createdBy / updatedBy; `AGENTS=off` disables them; the server needs outbound HTTPS to api.anthropic.com.
- MCP safety (B0, bridge + team server): a template id is not found by any MCP tool (features/mcp/values.ts `live`; the
  agent tools run under MCP's tool scope, stage.ts). One's own databases (`Database.system`: memory, Mails, mail
  directories, pipelines, test cases) are read-only over MCP — rows, pages below rows, schema, views, moves, trash
  (`system_database`; features/mcp/system.ts `systemOf` / `systemGuard`, wrapped around agent/coding.ts
  `guardPipelineRows` in stage.ts `mcpStageTool`; server/src/mcp/system.ts, MCP-only — server agents keep their rules);
  that includes a two-way relation into one (its reverse property; schema.ts `propertySpec`, server writes.ts
  `definition`) and, on S, a row value whose two-way partner lives in one (the server syncs partners —
  `assertNoSystemPartner`).
  MCP writes never carry coding trust (coding/trust.ts); locally a task whose version an MCP write moved is
  `mcpTouched` (IndexedDB `one-coding` `<scope>|mcpTouched|<taskId>`) and waits for Confirm. claudeDoc, for every caller:
  raw HTML only as the file form writes it (features/ai/claudeFiles.ts `claudeHtml`; any other tag stays as written, as
  text — no node, no mention, no link), `data:` sources become text, a
  `onefile:` ref stays only when it is this workspace's (`StoredFile.ws`, lib/files.ts), a live page the caller may read
  uses it and it is not private while the target is shared (MCP refuses that: `private_scope`). A files property's web
  image never loads by itself on a card (database/views/cards.tsx link chip; file chips show no web thumbnail). The team
  server over MCP refuses a locked page's content, a lossy replace (`lossyIn` pre-filter) and files values other than
  `onefile:`, checks before it writes and puts the content back from the call's pre-image after a failed meta check.
- MCP contract (train T-a, bridge 1.12.0; docs/MCP.md): ONE tool set for the bridge (B) and the team server (S), pure
  in `src/shared/mcp/` (tables.ts, contract.ts — features/mcp/contract.ts re-exports it —, errors.ts, refs.ts,
  pageRead.ts, duplicates.ts, sha256.ts; the bridge bundles them, the server imports them). S serves `MCP_TOOLS` −
  `MCP_LOCAL_ONLY` and answers `local_only` for `MCP_LOCAL_ONLY_ARGS`; server/test/mcp-parity.test.ts keeps S = shared
  (names, arguments, required, enums, description + ≤ 1 side-note line), tests/e2e/mcp-contract.spec.ts one meaning
  per argument name and the budget (tools/list ≤ 55,000, instructions ≤ 3,500 chars). `MCP_ARGS_V1` is frozen. A new
  tool or argument = contract.ts + `TOOL_SUMMARIES` (mcp/src/mcpb.ts) + the tab's planner + S (or MCP_LOCAL_ONLY*) +
  the next mcp/package.json minor (shared with one-worker) = `MCP_BRIDGE_CURRENT` + rebuilt bundles. Refusals only
  through `mcpError` / `withRemedy` (`<code>: <path>: <what>. Nothing was changed. <next step>`); a batch names every
  row that does not fit in one refusal (plan.ts `eachEntry`). Strict arguments: the bridge refuses undeclared ones
  (`bad_argument`) and what the tab's hello `tools` did not announce (`app_outdated`; no `tools` = contract 1), the tab
  refuses undeclared ones again, and S makes every tool schema a strict object (tools.ts `strictArguments`: tools/list
  `additionalProperties: false`, undeclared or misfit arguments answered `bad_argument: <path>: …` before the tool
  runs). Creating calls are joined while waiting and answered once within 2 min (`duplicateOf`; B per MCP session in
  the tab, S the idempotency store); `MCP_JOIN_ONLY_TOOLS` (one_upsert_rows) only join; a call taken back (B: its Undo or
  an eject; S: a Restore) is forgotten, so its repeat makes the thing again. Results compact, lists
  `urlBase`. Reads: `one_get_page` parts ≤ `MCP_LIMITS.part` serialized, head once, cursor bound to `rev`
  (`page_changed`; S `rev` / pre-image hashes = state vector + delete set, pageRead.ts `docStateHash` — a pure
  deletion moves them too), `format: 'blocks'` (block data: features/mcp/pageRead.ts, server/src/mcp/pageRead.ts — S flattens
  task blocks, sheet values null); refs are stateless (`#<id prefix>~<hash>` / `@<path>~<hash>`, refs.ts — ids never
  hashed), every MCP Markdown write strips ref labels (`stripRefLabels`, B + S), a ref with a hash must still fit
  (`stale_ref`; a ref of a nested block where a top-level one is needed is `bad_argument` naming its top-level ref —
  shared pageRead.ts `nestedTopLevel`); context marks limit MCP reads (`limited`) — `one_search` too (only readable
  text is searched and snippeted) — and writes: a replace of a marked page is refused (a script's `replace()` too —
  ScriptError 'limited_replace'), settle runs under `withReadLimit(mcpReadLimit)` (every row text: create_database,
  upsert), a block ref of an unreadable block is refused without its ref now (limits.ts
  `mcpReadableTop`), a chart reads its live source only where the client may read it (limits.ts `mcpChartSource` /
  `withMcpCharts` → charts `withChartSourceGate`: no template's sheet, no sheet outside the marks), backlinks only from
  readable blocks (`linksReadably`); `class` on single reads. Comments over MCP: B per device
  (`McpSettings.comments`, localStorage `one.mcp`, default off), S per token (`api_tokens.mcp_comments`); off →
  `comments_off`. Batches: one call = ONE card (pages ≤ 50 with `$<index>` parents, rows / upsert ≤ 50,
  `one_create_database` views / inline / rows; the card is capped at the viewport, its lines scroll); MCP's Undo of what
  it made = trash (`undoCreated: 'trash'`: kept once its text, title, icon, cover, comments, values or place changed —
  what the call itself set off, a derived writer whose cause names it (automation, autofill, kit), is no change; ONE
  baseline for every such Undo — features/ai/agent/follow.ts `madeAs` / `changedSince` / `followCall`, also one_move_row's
  and a script run's (`undoRun(run, { keep })` leaves fields changed since); agents and the
  terminal keep delete; a failed apply's own rollback deletes — `ApplyResult.rollback`; one_create_database's Undo first
  decides whether the database stays — a row of others, a row changed since or the database page itself changed
  (title, icon, cover, schema, views — `databaseMark`) keeps it and everything else as it is;
  in a host page written in since only the call's own block / link goes — features/mcp/undoNodes.ts; create_property
  keeps a column someone filled — rows in the trash too; a unique_id column's own numbers are no filling and its counter
  goes back —, restore_page a page changed since); a page locked while the card waited is checked again at apply
  (append, replace, linkInParent, upsert text, a script's text — ScriptError 'locked_content'); ≥
  `MCP_LIMITS.rowsAsk` rows per CALL (new + changed, every database; a rename counts as a title change) that start paid
  AI work or send out are `alwaysAsk` (features/mcp/rows.ts `sideEffects` + `sideHold`); files values over MCP only reachable `onefile:` refs (`withFilesWritable` —
  agents keep files read-only). S checks every row and page before the first write, takes back a batch that fails
  mid-way, trashes a database whose block or rows failed, and keeps a pre-image for what it makes and for row fields /
  page text it changes (server/src/mcp/preimages.ts, `mcp_preimages`, sealed, 14 days; an upsert's row body too — no
  property, view, move or trash call and no plain append keeps one: every surface says so; Restore keeps what a member
  changed or moved since; S bodies ≤ 256 KB read / 512 KB write, a bigger tools/call answers `too_large`; `GET …/mcp-calls`, `POST …/mcp-calls/:callId/restore`, Workspace →
  Automation → API § 07). Client text naming a tool that does not exist yet is a bug (T-b brings `one_attach_file`,
  `one_edit_blocks`, files, `one_comment`, templates).
- MCP tidy-up tools (trash / restore ≤ 50 ids, move page / row, update database / property, delete property, view
  create / update / delete) live in `features/mcp/{tidy,structure}.ts` and `server/src/mcp/{tidy,structure}.ts` with
  the same rules: never delete for good, locked databases refuse structure changes, no page ⇄ entry or Private ⇄ shared
  moves; keep `MCP_TYPE_CHANGES` / `MCP_VIEW_TYPES` (contract.ts) in step with the server's `TYPE_CHANGES` /
  `VIEW_TYPES`. The codeword `one:` (instructions line) and the prompt `one` are served by the bridge and by `/mcp`.
- MCP addresses workspaces by id (`local:<hash>` / `team:<id>`, features/mcp/identity.ts; per-browser localStorage
  `one.mcp.device`); every bridge call is bound to that id and refused on a mismatch — never act in another workspace.
- MCP task tools (local bridge only until server parity, bridge ≥ 1.8.0): `one_list_work_items` (read, JSON) and
  `one_update_work_item` (features/mcp/workItems.ts, built on the agent tool through `callStage`); a task change that
  holds (names a person, a reminder, an assigned task, a blocker, a removal) sets `WritePlan.alwaysAsk` — asked even in
  Apply directly; the `one_update_page` replace settles at plan time and refuses at apply when `contentRev` moved.
  Neither the team server's MCP nor its agents learn the `[!TODO]` form before P4 (source guard).
- MCP refusals: every one starts with a code (`McpToolError` and the tab's `fail()` run shared/mcp/errors.ts
  `withCode`; prefer `mcpError(code, path, what)`); arguments are strict at every depth (shared/mcp/args.ts
  `undeclaredIn` on the tab, `z.strictObject` on the server — mcp-parity.test compares nested schemas). Reads through
  MCP (one_get_page, run_query / run_script text, list / update_work_item) honour context marks (features/mcp/limits.ts
  `mcpReadLimit` / `mcpPageText`); a run started over MCP never writes One's own databases (script host `writeGuard`)
  and its writes count as MCP-caused for coding trust (store/writer.ts `mcpCaused`). Markdown parts join by
  `continues` (shared/mcp/pageRead.ts `wholeMarkdown`); a bridge < MCP_BRIDGE_CURRENT gets the whole page (≤ 60k).
  The default schema / status options are `MCP_DEFAULT_PROPERTIES` / `MCP_DEFAULT_STATUS` (English, both sides). The
  app shows team-server MCP features only when `/api/config` `supports ∋ MCP_SERVER_SUPPORTS`.

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
[{ t: ms offset, text }], recordedBy; never nested; runtime + Claude in features/ai/meeting), `workItem` (the task block,
UI "Task" / "Aufgabe"; content `paragraph block*` = the title line + notes; attrs: id, itemId 'wi_' + 10, status 'todo' |
'in_progress' | 'done', due 'yyyy-MM-dd[THH:mm]', reminder (null without due), people ≤ 12 ids, blockedBy / related ≤ 20 itemIds,
doneAt (done only), frozen = { people names, blockedBy n, related n } only in docs that left the workspace — read ONLY through
`itemAttrs()`; never nested, never in a table (moved out whole, after it); Markdown `> [!TODO] Title {#wi_… done=<ISO>}` +
field line (a hard break in the title = `\` + the next quoted line), the reader off (`WORK_ITEMS_FROM_MARKDOWN`);
`stripPrivate()` → `freezeWorkItems()`: no ids, names frozen; parses from HTML only with the clip key; P1: created only by
the editor and by copies, see Data rules), `button` (attrs: label, variant 'signal'|'ink'|'ghost', actions = JSON
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
- Shape: radius 2px controls / 4px menus+cards / 8px modals. Hairline 1px rules (`--rule`). Pills only for LEDs.
  Switches are glass rockers in a screwed, brushed-steel bezel (design 3a "Glas-Wippe"): `Switch` (size 'md' 52×28 |
  'sm' 40×22 for dense rows — both × `--text-scale`; `seed` = a stable id for the 4 screw angles, `describedBy`),
  `SwitchFace` for non-interactive rows (aria-hidden); the art is hidden spans (`.switch__half--o` 0 = off,
  `.switch__half--i` I = on; the rocker tilts toward the pressed side, an LED under the glass lights it). LED colour =
  `--switch-led` (tokens.css `var(--switch-led-pick, var(--signal))`: the signal colour unless this device picked one in
  Settings → Appearance / Workspace → Overview → Display; lib/switchLed.ts, localStorage `one.switchLed`, applied before
  first paint as `--switch-led-pick` + `data-switch-led` on <html>, never synced); every lit tone is a color-mix of it.
  `Screws` + `.screw-plate` for screwed plates (ui/controls.tsx, ui/screws.ts). Hardware colours are color-mix tokens
  in tokens.css (--plate*, --screw-*, --toggle-*), never raw colours.
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
