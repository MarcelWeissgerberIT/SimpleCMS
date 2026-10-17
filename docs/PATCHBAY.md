# Patchbay — what runs by itself, and where it could leak

The Patchbay (UI: EN **Patchbay**, DE **Schaltplan**; code `src/app/features/patchbay`, public API
`patchbay/index.ts`, route `#/patchbay?m=<module>&f=<path key>&setup=<profile>`) draws everything that runs by itself as
a rack — sources (§ 01), processing (§ 02), targets (§ 03) — and marks with a **fuse** every path on which content
from outside, private data and an unattended way out meet. It reads settings only: nothing it shows is a guard while a
run is going on.

```
 stores ──▶ inputs.ts ──▶ source.ts (pure: ModelInput + memo = the wiring signature)
                              │
                              ▼
            model.ts (modules, jacks, cables, flow) ─▶ chains.ts (taint, walk, gates, loops) ─▶ reach.ts (lamps)
                              │                                                                  │
                              ▼                                                                  ▼
                 layout.ts / render.ts (rack, cables, SVG)                     fuses.ts (fuse · near miss · unknown, keys)
                                                                                                 │
                         state.ts refreshModel ── the ONE publisher ──▶ counts.ts (LED = lamp = readout) · hint.ts
```

## 1. Model inputs and the memo

- `inputs.ts` is the only module that reads stores. It gathers an `InputSource` (the workspace's wiring, this device's
  facts, the lazy readings) and hands it with the areas' readers to the pure core `source.ts` (`toModelInput`), so Node
  specs build the very same `ModelInput` from plain data (`tests/fixtures/patchbay.ts`).
- What it reads: agents (sanitized — Unreadable fields kept), scripts (+ scans), the live databases (not trashed, not
  below a trashed page, not in a template) with **config fields only** — automations without `lastRunAt` / `lastStatus`
  / `lastMessage`, own commands, repeating templates without `lastRunAt`, properties `{ id, name, type, agentReadOnly,
  custom, autofill }` with autofill without `fills` —, form hooks, Outbox routes, the referenced pages' facts (id,
  title, kind, trashed, template, private, parent / database), the kit's value properties, this device's MCP servers,
  profiles, mail, memory, AI rules, pipelines, the worker, sync, the bridge, sign-offs and the lazy readings.
- **The memo** (`createInputMemo`) returns the same `ModelInput` object while nothing it reads changed: by reference
  (agents, scripts, integrations, kit, ai, governor, fuseSignoffs, `settings.mcpServers` / `mail` / `memory` / `ai`, the
  lazy readings), by value (this device's facts), per database by a config signature cached per object, and the
  referenced pages through the row index (`structure`, or a changed id whose facts' fields changed — `sameFacts`; keep
  it in step with `factsOf`). Typing in a page, an automation's bookkeeping, an autofill `fills` record or a repeating
  template's `lastRunAt` rebuild nothing, and nothing walks the page map on the hot path.
- `buildModel(input)` is pure and never stored. `state.ts` builds it after first paint, in idle (`compute.ts`, its own
  chunk, started by `startCounts` → `startPatchbay` in main.tsx) and when the page opens; every model it builds publishes
  the counts (sidebar LED, Preflight lamp `fuses`, status cell, readout) and the hints — one publisher, so they agree by
  construction. The ledger is never read for the LED.

## 2. The lazy cache and the device stores

Expensive readings happen only when `#/patchbay` opens (`openInputs()`, counted release): the script scan (One Script's
engine chunk), the kit value codes' scan, the server-agent runtime (team), team incoming hooks and API tokens (owners /
admins), the capture Inbox lookup, the button index (idle slices ≤ 8 ms, then kept current per page from
`onRowsChanged`; while nobody holds the inputs it only notes changed ids).

The fuse-relevant ones are written to the **lazy cache** — IndexedDB `one-patchbay` / `kv`, key `<scope>|lazy`, ids and
hosts only, never text — and read first by the background count, so the LED and Preflight know what an earlier visit read.
A reading the cache lacks is an **unknown part**, never a clean "none".

| Store | Key | What |
|---|---|---|
| IndexedDB `one-patchbay` | `<scope>\|lazy` | lazy cache (`LazyCache`) |
| | `<scope>\|runs\|<day>` | run tally — runs today on this device (`update`, atomic across tabs) |
| | `<scope>\|setup` | setup band record `{ profileId, recipeId?, closed?, firstWriteAt? }` |
| localStorage | `one.patchbay.seen` · `one.patchbay.patch` · `one.patchbay.order:<scope>` | NEW tag · Patching switch · stable row order (module keys, ≤ 200) |
| sessionStorage | `one.patchbay.return` | the return chip `{ profileId, recipeId?, next }` |

Scope = `local:local` | `cloud:<ws>:u:<account>` (scope.ts). Never synced, exported or backed up; `wipePatchbay(scope |
null)` runs from `cloud/device.ts` (a `cloud:<ws>` wipe takes every member scope of it) and the local reset.

## 3. The graph

- **Modules** (`ModuleKind`): § 01 `server` · `clock` · `rowTrigger` · `button` · `command` · `incoming` · `sync` ·
  `clippings`; § 02 `agent` · `automation` · `script` · `autofill` · `organise` · `pipeline` · `bridge` · `kit` ·
  `planner` (Orders B10, §4.1); § 03 `database` · `page` · `inbox` · `everything` · `outbound` (exit types `webhook` ·
  `git` · `exec` · `http` · `mail` · `mcp` · `sync`) · `outbox`. Keys are `kind:part:part` (ref.ts `moduleKey` — the only spelling, also for `?m=`).
- **Edges** (`EdgeKind`): `starts` (clock / trigger / incoming / command / button → a processor's START), `reads` (a
  server's READ jack → a processor's TOOLS; database / page reads are net tags, no cable), `writes`, `out` (a way out),
  `outsideIn` (hatched: an outside source to its first consumer), `relay` (a kit value relay's start), `chain` (a
  pipeline handing a task on to the next — §4.1). `can` (dashed) =
  the AI decides at run time. Cables count drawn edges, bundled ones included.
- **Net flags**: a write into a field someone listens to becomes a flag pair `net:<db>:<prop | * | +row>` — no cable
  across the rack. An everything-scope writer gets one dashed cable to "Whole workspace · n databases"; cables from one
  jack to one column bundle from the 7th on into a "+n" bus chip.
- **Server tool groups** (tools.ts): OUT (profiles' `sends` + `outTools` matching by name / host — never a decider's
  way out) → READ (`isReadTool`, plus profile `reads` that carry no write / send word) → WRITE? (the rest; a write-named
  "declared read" stays here, marked). Residual: READ tools named fetch / url / http / web / browse / search are listed
  as "still connected", never a fuse.
- **Engine rules** (rules.ts, shared by the drawing and the walk): automations fire only in the writing tab, never on a
  remote write, never while paused; `set_property` and a script inside `run_script` start no automation; agents never
  start agents directly (through an automation they do); autofill never starts autofill; a server agent's write starts
  only kit relays; `agentReadOnly` ("Only by hand") stops agents and the bridge only; mail organise starts only from the
  sync's new rows; a pipeline's git stage is gated by the task's approvals (`skipsGate`).

## 4. The fuse rule

`fuse = decider ∧ ¬gate ∧ outside ∧ private (relative to the exit) ∧ an unattended way out`, with complete
reachability (chains.ts walks the model's flow, not the drawn cables; only the drawing folds past 3 steps).

- **Deciders** (reach.ts `deciderOf`): custom agents whatever `enabled` says (a switched-off one runs by hand — its fact
  says so, it sorts last), AI autofill with `auto` — and without it while a fill started by hand can take a path (an
  "All AI calls" server, or "Apply without review"): "runs only by hand", sorted last, its fills proposals unless
  "Apply without review" —, mail "Organise with Claude", the bridge in `'apply'`. Route-blocked agents are not
  deciders; Unreadable fields make an unknown part. Key 1 on autofill ("by hand only") is offered only where the review
  then stops the path: refused on its own MCP way out (a fill by hand carries the server — key 2 takes it off) and
  with "Apply without review".
- **Outside**: mail-class rows (`classOfPage`), MCP read results (an untested server counts whole), a server agent's
  webhook body, team hooks / API-token rows, GitHub pick-ups, Clippings — plus **taint**: a fixpoint marks every place
  written by a processor that reads an outside place (each place flips once, the mark keeps writer and origin). Not
  outside in v1: imports, folder sync, the person's typing, forms.
- **Private, relative to the exit**: anything beyond the one row that brought the content and the decider's own
  report page — everything / other named places, other rows of the outside database, related rows' titles, another
  server's reads, memory — minus what the exit carries anyway (this device's GitHub push: every page of a local
  workspace; in a team without `includePrivate` the shared pages).
- **Data rules**: `classAllowedOn(route, cls, { ws, device })` over every routable pin of the rule that wins for the
  decider's feature class; device rules only for deciders running here. `'mcp'` withheld = no MCP source and no MCP exit.
- **Ways out** (§1.4 of the plan): an automation webhook after a direct write; a decider's MCP write tools (fail
  closed: attached without an allow-list and no tested tool list = every tool); autofill's `scope: 'all'` servers; this
  device's GitHub auto-push; a pipeline's push / pr / comment / merge when no gate stops it. By hand, never a fuse: Outbox
  routes, button / command webhooks, script `http.post` / `mail.send` (asked).
- **Gates**: `'proposals'` (a stage agent — its MCP tools are NOT gated), `'asks'` (script effects, the bridge in
  `'ask'`), `'confirm'` (a coding task waiting for Confirm — coding/trust.ts), `'afterApproval'` (approvals ≠ none),
  `'byHand'`. A hand START is never a gate.
- **Near misses** (≤ 12 shown, never counted): a decider and a way out with one closing reason — a gate, a data rule, no
  private data, or a way out closed on this device. **Unknown parts** (never counted, never safe): another member's
  browser agent, Unreadable fields, a runtime the viewer cannot read, team hooks for a member, a lazy reading the cache
  lacks, a script naming places by name, a server not set up here, and (chains.ts `workerUnknown`) a pipeline whose
  task rows hold content from outside that leaves a task trusted while a Claude Code stage runs before an outbound git
  step with nobody in between (rules.ts `claudeBeforeGit`) — Claude Code is no decider of One's, but it chooses what
  the push sends.
- **Mitigations** are facts, never a clearance: Jev's write gate, `directSplit`, OUT locks, web images → links (and the
  identity hooks `effectiveWrite` / `directProps`, part of the signature so turning them on lapses allowances).

### 4.1 Work orders — the planner and the chain (Orders B10)

- **The planner** (`ModuleKind 'planner'`, one per work-orders database, `Database.system 'workorders'`): started by
  hand only — the database's "Planen" (`command:<db>:orders-plan`; the Status, ↵ and "Prüfen lassen" are the same
  cable) —, net tags for the request rows and `~linked` (the pages a work order links: always private data on its
  paths). Its **TOOLS jack is always drawn, OPTIONAL**: with no server picked it stays empty ("without a server" is a
  valid state); with the person's server (`OrderConfig.server`, by the name they gave it — never named, preset or
  detected by One) a READ cable — an untested server counts whole. Tags: `asksFirst` without this device's consent
  (its chip reads "KETTE ↵" / "CHAIN ↵", and so does its write jack's title), `direct` with it; always `thisDevice`.
  The planner's and the hand-ons' cables loop inside § 02, so they carry no cable label (it would sit on a module).
- **pipelineGate('order')**: without the consent "Ohne Bestätigung starten" (localStorage `one.orders.auto:<scope>:<db>`,
  local workspaces only — coding/orders/auto.ts) every chain waits for the person's ↵: gate `byHand` ("KETTE ↵" on the
  planner → project cables). With it: no gate (team: `confirm` on new rows — never reached, a team has no consent).
- **Decider**: the planner is one (`deciderOf`: write `apply` with the consent, `ask` without; the terminal's providers).
  Its outside sources are the server's read results and the request rows (an agent filing mails into the work orders
  taints them); its private data the linked pages.
- **Chain edges** (`EdgeKind 'chain'`, tag `next` — "nächster Schritt"): the work order's next step (its kinds in
  order; "Nach der Analyse anhalten" puts a person after a BA step: `byHand`), a done task's **Then** (`THEN_KINDS` =
  coding's FOLLOW_UPS, into the project #/coding shows) and a BA stage's **stories** (into the coding project) — after
  approval when a stopping gate stands before done / the stories stage. A chain write enters the next pipeline at its
  start, as a trusted task (never "any stage"); taint flows along it. `workerUnknown` does not count taint that reaches
  a pipeline only through hand-confirmed chain writes.
- **The exec way out** (`ExitType 'exec'`, `outbound:exec:-:code`): drawn only for pipelines a planner with this
  device's consent reaches (its projects, then along chain edges) that have an implement / test / analyze stage —
  after approval when a stopping gate stands before each (`unattendedExec`). Counted only on walks from such a planner.
- **Fuses and near misses**: confirm mode is never a fuse; near misses with their own sentence — (a) only "Kette
  starten ↵" stands between the server's content and a git step nobody else stops, (b) with the consent only an approval
  stands before the worker's AI writes code, (c) a data rule withholds `mcp`.
- **Keys**: 1 `autoOff` — drop this device's consent (`dropOrderAuto`; Undo `restoreOrderAuto` as `you~undo`, only while
  none is stored); 2 `readTools` — the planner gets the server's read tools only already: refused with why, an untested
  server's key opens its connection test ("Server testen"); 3 "Weg zulassen".
- **Sig parts**: `d` = the planner (database, consent sig, kinds, checkpoint, server name + address digest + tested
  tools + matching profiles); the server's own part `s…`; `x` for git and exec carries Approvals.
- **Setup band "§ PRÜFAUFTRÄGE"** (setup/orders.ts, ui/OrdersBand.tsx): 01 CODING · 02 WORKER · 03 PROJEKTE · 04
  DATENBANK · 05 KONTEXT (OPTIONAL: dim, green without a server, never red) · 06 ERSTE KETTE — shown while a
  work-orders database exists or when Settings › Coding worker opens `#/patchbay?orders=1`. Openers:
  `openCodingSettings()`, #/coding, `ensureOrderDb()` (as `you~patchbay`), `openMcpConnections({ server, focus: 'test' })`
  / Settings › AI, the work orders' page (a chain starts by hand on its plate, never from the band).
- **Live**: a planning run posts `noteRun` / `endRun` with writer `order:<row>:<run>` (the planner's LED blinks, its
  window counts runs today or "n Ketten laufen"); a chain's step moved on (`#a<n>`, never its creation `#c<n>` or a
  Status write `#s`) draws a leg on the chain cable from the step before (records.ts `chainLegOf`) — the first step's
  from the planner; `onShipRecord` lights GIT as before.
- **Patching**: server READ → planner TOOLS writes `Database.orders.server` through `saveOrderConfig` (one server at a
  time; unplugging leaves none). The picker lists this device's servers by the names the person gave them and
  preselects none; a server switched off here (`patch.serverOff`) or a tested one without read tools is refused.

**Migration note (B10).** Racks drawn before B10 had no cable between pipelines. From B10 on, Then and stories hand-ons
are drawn as `chain` edges between projects — also in workspaces without work orders — and taint now flows along them:
a BA project whose tasks carry content from outside makes its follow-up Coding / QA tasks carry it too. A path through
such a hand-on is a new path: an allowance ("Weg zulassen") given before B10 does not cover it (its path key differs),
and the fuse list may show a near miss or fuse it did not show before. Nothing is written by the upgrade.

## 5. Signatures and allowances

- `pathKey = sha256(canon(['pb1', chain.key]))` — the identity of a path (ids along it). `canon` is the Patchbay's own
  (sorted keys, refuses non-finite numbers, cycles, functions); SHA-256 is synchronous plain JS (equal to WebCrypto,
  pinned by a spec) so a fuse's F-label and allowed state exist in the same pass.
- `sig = sha256(canon({ v: 'pb1', parts }))`, parts (first 16 hex each, ≤ 24, `[a-z]\d{0,2}`): `d` decider · `a…`
  automations (a webhook's full URL and headers as digests) · `k…` kit relays · `f…` fields · `p…` other processors ·
  `s…` servers (READ / WRITE? / OUT, matching profiles) · `o` the outside sources · `x` the way out. A changed part lapses
  the allowance and names the modules ("No longer allowed: Inbox helper changed").
- **Store**: `Workspace.fuseSignoffs: Record<pathKey, { sig, parts, at, updatedBy }>`, read only through
  `sanitizeFuseSignoffs` (store/fuseSignoffs.ts: ≤ 500 newest, unknown fields ≤ 1 KB kept, same input = same reference),
  written only with `signOffFuse` / `withdrawSignoff` (and `restoreSignoff` for the Undo). Local: the person; team:
  owners / admins on a server with `supports ∋ 'signoffs'` (`setSignoffGuard`, cloud/workspace.ts), meta map
  `fuseSignoffs`, guarded by `server/src/collab/fuse-signoffs.ts` (stamps `updatedBy`) — see [CLOUD.md](CLOUD.md#meta-document-schema).
  Full backups carry it; no restore ever takes it. No `stampGen`, no schema gate; an older build that drops it fails safe.

## 6. Keys, setup, live, patching

- **Fuse keys** (keys.ts, `you~patchbay`; Undo `you~undo`, ≤ 20 per tab session, refused when a config field changed
  since): 1 `upsertAgent({ ...stored, write: 'stage' })` · `setAutofillAuto(db, prop, false)` · `setOrganise({ enabled:
  false })` · `setMcpMode('ask')`; 2 `setHandOnly(db, prop, true)` (no profile unlock — owner decision Q1) · the stored
  agent's `mcpTools[server]` = its READ tools · `patchServer(id, { scope: 'free' })` (this device); 3 `signOffFuse` /
  `withdrawSignoff`. Not offered for MCP-exit fuses: key 1 (proposals do not stop MCP tools).
- **Setup lamps** (setup/lamps.ts, pure over facts): 00 key · 01 server · 02 test · 03 profile · per recipe 04 database ·
  05 agent · 06 first run. Openers: `openAISetup({ reason: 'patchbay' })`, `openAISettings({ section: 'mcp' })`,
  `openMcpConnections({ server, focus: 'test' })`, `openIntegrations(id)`, `openMirrorSetup` / `openAgentEditor` (agents
  `AgentDialogsHost`, a lazy wrapper over any route), `runAgentNow`. A step that leaves the route sets the return chip.
  The drop (setup/drop.ts) saves with `upsertIntegration`; its Undo lasts until the first lamp write of its visit.
- **Live** (only while the route is open): one run bus — `onRunNote` → the tally (once per writer kind + run id) and
  `live.ts`, which feeds the pure state machine `live/core.ts` from run notes, writes under a run writer
  (`currentWriter()` + `pageChanges`, O(changed)), `onAutomationAction`, `onShipRecord`, other tabs' `onRunsChanged`
  (LED and window only) and server agents' status. Legs 600 ms each, queued; LED blinks ≤ 5 s, off at `endRun` or 10 s
  idle; red only for an error, never for a run the Regler held; reduced motion = no dot, no blink, thicker cables.
  Money: today's ledger on open + `registerMeter`, grouped by `live/costs.ts` (never `consumerOf`).
  A module's window shows its runs today, a live reading (RUNNING, FIRED, FAILED, BUDGET, HELD, "+n FOR REVIEW") or the
  worker's word. Readings on targets the mock draws as plain chips ("+1" rows written today, "06:58" a webhook's last
  send, "!41" a merge request, "2" in the inbox, a script's next start) are not drawn: they need a tally per target the
  run bus does not keep — an accepted deviation (plan §3.13, fix ui-words).
- **Patching** (patch.ts, pure: `plan(patch, ctx) → { writes, inverse, preview, asks?, opens? } | { refused }`; the app's
  sink patchApply.ts): a cable means only what `upsertAgent`, `saveDbCommands`, `saveAutomations` or `upsertIntegration`
  can write — clock → agent trigger · row trigger / net flag → agent or automation trigger · database rows → an own
  command · server READ / WRITE? → agent tools · agent → database scope · agent → report page · automation → `run_script`
  · server tool → Outbox (`outTools`, owners / admins). A cable to a way out is never made (only unplugged). The preview
  runs the same core on the patched input ("+F2" asks first). Editors' save checks run first (agents/saveChecks.ts).
  The switch is per device and off by default; no patching for viewers or on the phone.

## 7. The one other-area import and the writers

- `features/patchbay/hint.ts` is the one dependency-free module other areas may import directly (agent editor,
  its MCP tool list, AutomationsModal: `FuseHintLine`, `PatchbayAgentLink`).
- Every write the page makes runs under the person's writer `YouVia 'patchbay'` (`you~patchbay`), every Undo `you~undo`;
  automations are written only through `saveAutomations` (locked database: off and removals only — owner decision Q2).

## 8. Performance budgets (tests/e2e/patchbay-perf.spec.ts, ~13k pages + `bigPatchbay(60)`)

Model build median ≤ 10 ms · first rack paint ≤ 250 ms after the chunk (median of three cold opens, `pb-first-rack`) ·
relayout median ≤ 16 ms · button index slices ≤ 50 ms (8 ms by design) · typing 200 chars anywhere: 0 model builds, 0
input builds, 0 page rechecks · `one-patchbay` never opened before first paint, the ledger never opened for the LED.

## 9. Tests

Node: `patchbay-model` · `-chains` · `-fuses` · `-layout` · `-live-core` · `-patch` · `-setup-model` · `-model-fixes` ·
`-names` (the words of the plan's §1.1). Browser: `patchbay` · `-keys` · `-signoff-store` · `-setup` · `-setup-dialogs` ·
`-live` · `-patch-ui` · `-review-ui` · `-review-patch` · `-perf` · `-shots`; cloud: `tests/e2e-cloud/patchbay*.spec.ts`.
Fixtures: `tests/fixtures/patchbay.ts` (`mock1`, `mock2`, `bigPatchbay`, `wideScope`, `relays`, `exits`,
`ordersWorld` — Orders B10) — fictional names, `*.example` hosts only. Work orders: `patchbay-orders` (Node model cases
+ one UI case); `patchbay-perf`'s world carries the work orders and three projects (chain edges, Then) under the same
budgets.
