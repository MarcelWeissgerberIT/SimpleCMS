# Outbox — Claude drafts, you send

The Outbox (`src/app/features/outbox`, public API `outbox/index.ts`) is the one place in One where a call to another
tool's **writing** MCP tool is prepared. Every such call is a **slip**: one reviewed tool call, shown exactly as it would
go out, kept on this device only. Slice 1 (this build) sends **by hand**; slice 2 adds sending through the coding worker
with a pre-read and a read-back, slice 3 more creators and batches. Parts of later slices are named below only where
the data model already carries them.

```
 profile.sends ──▶ route (database command) ──▶ draft popover ──▶ slip (IndexedDB one-outbox) ──▶ dock / #/outbox
   (contract)        ⌘ on a row, toolbar, ⌘K      Claude, NO tools      seal · inputs · after · baseline     │
                                                  or "Write it myself"                                        ▼
                                                                        Copy & open → "Sent in X?" → Mark as sent
                                                                        → row patch (one version) · inbox archived · receipt
```

## 1. The contract: send routes

A route lives in an integration profile (`IntegrationProfile.sends`, `store/types.ts`; checked by `checkSends()` in
`store/integrations.ts`, server twin `server/src/agents/integrations.ts`):

```json
"sends": [{
  "id": "reply", "role": "reply",
  "label": { "en": "Reply in the ticket tool", "de": "Im Ticket-Tool antworten" },
  "tool": "add_comment",
  "args": { "ref": "{key}", "visibility": "team", "body": "{draft}" },
  "params": [{ "name": "draft", "type": "text", "max": 4000, "style": { "de": "Kurz, freundlich, du-Form" } }],
  "check": { "tool": "get_item", "args": { "ref": "{key}" }, "fields": ["status", "comments.length"], "latest": "comments.-1", "identity": "ref" },
  "confirm": { "tool": "list_comments", "args": { "ref": "{key}" }, "find": "items", "match": [{ "path": "body", "equals": "{draft}" }], "capture": { "id": "id" } },
  "after": [{ "property": "waiting", "value": false }],
  "via": ["worker", "hand"]
}]
```

- **Needs**: the unlocks `sends` and `keys`; `match.name` or `match.host` (`sendsNeedsName` — the team server matches
  only by these, the sanitizer drops `sends` otherwise). `reads` (optional) lists the read-only tools; check / confirm
  tools must be in it, send tools must not.
- **Params**: `text` (at most one; `draft` = the text Claude may write; `max` ≤ 20 000, default 4 000; `style`),
  `number`, `minutes` (`max`, `round` — rounded to the step), `option` (`values`, ≤ 30).
- **Templates** (`template.ts` `fillArgs`, pure): values are **built**, never JSON-concatenated. `{draft}`, `{minutes}`
  and every `{<param>}` only as a whole string value. `{key}` may sit inside a string (`"LDG-{key}"`); `"{key|number}"`
  casts (digits only). `{sentAt}` = the ISO time of the press — kept as a token on the slip and filled when the
  person presses. `{result.<path>}` only in `confirm`; `{check.*}` nowhere (nothing filled after review).
- **Paths** (fields, latest, identity, find, match, capture): `ROUTE_PATH` — names, `-N` from the end, `length`; own
  properties only (`fields.ts` `pickPath`, never a prototype). **Keys**: `ROUTE_KEY`.
- **Limits** `SEND_LIMITS`: ≤ 20 routes, args ≤ 4 KB as JSON, depth ≤ 4, ≤ 8 params, ≤ 8 `after`.

## 2. The lock (slice 1a)

Every `sends[].tool` of a profile is **OUT** on every server the profile matches by name / host (`outToolsOf`,
independent of unlocks, the server's switch and tested tool lists). A route the sanitizer has to leave out (args too
big, a label this version cannot read …) keeps its tool locked through the profile's `outTools` — the browser never
locks less than the team server, which reads every `sends[].tool` and `outTools`. Every toolset One builds — `toolsetFor` (app) and
`toolsetOf` (server runner) — switches them off; `forced`, codewords, a picked tool and allow-lists never lift it; the
system prompt names them. `ChangeKind 'send'` is never applied by `applyChanges`. Details: CLAUDE.md "Outbox lock".

## 3. The slip

`types.ts` (`Slip`, `SlipView` = a frozen copy):

| Field | Meaning |
|---|---|
| `id` | `out_` + 10 base62 (`SLIP_ID`) |
| `scope` | `local:local` or `cloud:<workspaceId>:u:<accountId>` — a member's own slips; another member on the same browser never sees them |
| `target` | database, row, key, the server (id, name, url) |
| `route` | profile + route id, role, tool, label, a **snapshot** of the route and its signature (`routeSigOf`) |
| `params`, `args`, `argsHash` | the typed values; EXACTLY the tool's arguments (`fillArgs`); SHA-256 of `canonicalJson(args)` |
| `draft` | `{ rev, by: claude · person · code · caller, claudeText?, seenRev }` — null for typed-only routes |
| `after` | the row patch with before / after values (`refused`: only by hand · unknown · type) |
| `answers` | inbox items archived after the send (the mirror agent's notes on this row) |
| `baseline`, `lastCheck` | the row's source fields at draft time, and what changed since (CHANGED per mirror) |
| `sources`, `seal` | what was read, with trust computed by the Outbox; the seal (foreign count, addresses, hidden code points, clean) |
| `receipt` | path, tool, argsHash, row patch applied / skipped / reset, archived ids, read-back state |
| `log` | ≤ 30 lines, codes + values only |

### States (`machine.ts`, pure)

```
missing ──write──▶ ready ──hold──▶ held ──release──▶ ready
   │                 │ └──markSent (by hand)──▶ sent ──readMatch──▶ confirmed
   └──withdraw──▶ withdrawn ◀──withdraw── ready / held / failed     └──readMismatch──▶ unconfirmed
                     ready / failed ──press──▶ sending ──ok──▶ sent          (slice 2)
                                                      ──failBefore──▶ failed
                                                      ──failAfter / boot──▶ unclear ──settle──▶ sent | ready
```

Every writer asks `next(state, event)` and refuses a null. Nothing reaches `sent` from `ready` except the person's
**Mark as sent**; a wire send (slice 2) goes through `sending` first (write-ahead) and a failure after the call left
is `unclear`, never `failed`. CHANGED is a lamp, not a state. A sent slip cannot be withdrawn (`'too-late'`).

## 4. Invariants

1. **Nothing sends by itself.** No Claude request carries an OUT tool (§2). In slice 1 no code path calls an OUT tool
   at all; the person posts the text. `fire` / `Arm` / `ui/Guard` do not exist yet (static guard in
   `outbox-engine.spec.ts`).
2. **The draft has no tools.** `draft.ts` asks `completeStructured({ mcp: false })` — no MCP servers, no tools. It sends
   the instruction, the row as `<untrusted>` text, `@`-mentioned own pages through `readableContent()` (context marks
   apply), and the memory block. The guard spec checks the source for `attachMcp` / `toolsetFor` / `tokenFor` /
   `getMcpToken` / `mcpParams`.
3. **What you saw is what goes out.** `args` are rebuilt on every edit and hashed; the inputs table shows them as
   values; the text is shown raw (no HTML, no image loads), hidden code points as `⟦U+202E⟧`, Markdown link targets in
   full — in the text, a flagged address, the inputs, the cards and every tooltip. A text counts as seen only once it is
   shown unclipped in the slip (a short one when it renders, a longer one by "Show full text"); an edit or a redraft
   resets it. `#/outbox` cards are clipped, so ⌘↵ there opens the slip in its dock instead of copying.
4. **Trust is computed, never taken.** `provenance.ts`: typed row fields (number, date, checkbox, person, and a
   select / status option the profile itself declares — `recipeOptionNames`) are exempt; free text and options a
   mirror made from the source are foreign; kinds `record`, `mcp`, `mail`, `file`, `web`, `image`, `transcript`,
   `coding`, `agent` are always foreign; a page is foreign when its last writer was not the person (`contentOrigin`
   'ai' / 'sync' / 'import' / 'share' / 'mcp' / 'agent' / 'split' / 'editor-move' / 'history' / 'template' …,
   `agent:` / `api:` / `hook:` actors; pages made with Claude's or someone else's text say so through
   `createPage({ contentOrigin })`). A caller's page source never brings its own text: the Outbox reads the page. A
   slip without sources is incomplete — never clean; the popover's typed values and "Write it myself" stage with
   sources the Outbox judged itself (complete).
5. **Addresses need a tick.** `seal.ts` scans the outgoing text (URLs of any scheme, hosts, IPv4 / IPv6 literals,
   e-mail addresses, Markdown link targets): an address found only in foreign text, in no source, or pointing into
   One is flagged with its reason and must be ticked. The person's own words count as theirs: the instruction, and
   an address they typed in the slip's editor — decided per address (`personAddresses`): in no earlier text of the
   slip (the previous revision, Claude's draft), not grown out of one there. A caller's text (`replaceDraft`) never
   makes an address the person's. The row's link that "Copy & open" opens is checked too: off the server's host (and
   its link base) it is shown, flagged and needs a tick.
6. **CHANGED per mirror is honest.** The baseline holds the row's roles `comments`, `lastCommentAt`, `srcStatus`,
   `changedAt` (dates as stored stamps) and the newest comment — read when the draft request is built, so a comment
   arriving while Claude writes lights CHANGED; `watch.ts` compares on every row change. A change the
   person's own send explains does not count. The band quotes `latest` marked FOREIGN; **Send anyway** sets `ack`.
7. **The row patch is one version.** `after.ts` writes with `setRowProperty` inside `aiWrite(fn, { reason: 'outbox',
   by: <route label> })`; a value changed since staging is skipped and named; "Only by hand" properties are refused at
   staging. **Reset row** writes back only fields still holding the written value (`aiWrite`, by "Reset row").
8. **One count.** `outboxCounts()` (held wins over foreign) feeds the sidebar badge, tree chip, readout, dock,
   `#/outbox` and the status bar.

## 5. Storage

- IndexedDB `one-outbox`, store `kv`, key `<scope>|slip|<id>`; writes are compare-and-set (`idb-keyval` `update`), a
  `BroadcastChannel('one-outbox')` tells the other tabs (≤ 1 s). Per device: never synced, exported, backed up or sent
  to Claude; `cloud/device.ts` wipes the workspace's keys with its copy.
- **Fail closed**: `probeStorage()` at start; when IndexedDB is refused nothing is staged (`'storage'`) and the dock
  says why.
- `OUTBOX_LIMITS`: 500 open slips per workspace; args ≤ 64 KB; result text ≤ 2 048; withdrawn kept 30 days; sent
  kept 365 days, ≤ 2 000; log ≤ 30 lines; ≤ 10 rows per draft request.
- The dock's open state: localStorage `one.outbox.dock` (per device).

## 6. API for other features (`outbox/index.ts`, the only door)

| Call | What it does |
|---|---|
| `routesFor(dbId)`, `routeByRole(dbId, role)`, `routeById(ref)`, `listRoutes()` | resolved routes (`ResolvedRoute`: label, tool, server, params, usable path + reasons) |
| `stageSlip(input)` | one slip; `{ slip }` or `{ refused: noRoute · inactive · noKey · badKey · rowGone · param · tooLong · limit · storage }` |
| `stageGroup(group, items)` | all or nothing; a refusal withdraws what this call staged and names the index |
| `draftSlip(input)` | Claude drafts (no tools) and stages |
| `replaceDraft(id, text, by)`, `setIncluded(id, on)` | change an unsent slip |
| `withdrawSlip(id, by)`, `withdrawGroup(groupId, by)` | `'withdrawn'` · `'too-late'` · `'gone'` |
| `useSlip`, `useSlips`, `getSlips`, `onSlipsChanged`, `outboxReady` | read |
| `outboxCounts`, `useOutboxCounts`, `groupState`, `useGroupState` | counts |
| `ownSends(rowId, since)` | what this device sent for a row (role, tool, values, ids) — for loops that must recognise their own writes |
| `readTarget(route, rowId)` | slice 2 (a live pre-read); slice 1 answers `{ refused: 'noWorker' }` |
| `openOutbox(q)`, `openSlip(id)`, `outboxCommands(dbId)` | navigation, database commands |
| `OutboxDockSlot`, `OutboxDbFoot`, `OutboxRoute`, `OutboxHost`, `OutboxNavBadge`, `OutboxStatusCell`, `OutboxTreeCount`, `OutboxReadout`, `RowSlips` | shell parts (lazy where heavy) |

Callers never pass trust: `SourceInput` has no `trusted` field; `typed` is only honoured for row fields the Outbox
can check.

## 7. Tests

- `tests/e2e/outbox-engine.spec.ts` — the contract and lock (1a); templates, typed params, `canonicalJson` + SHA-256
  vectors (the worker hashes the same bytes), paths, the state machine, the seal, counts; a static import guard.
- `tests/e2e/outbox.spec.ts` — commands in the sidebar / toolbar / ⌘K; drafting without tools (exact inputs, the cost
  in the UI language); foreign addresses; hidden characters and long texts; the hand path end to end (row patch, one
  version, inbox note archived, receipt, Reset row and what it keeps); CHANGED per mirror and its keys; J / K / H / E;
  persistence, scope and a second tab; counts in all places; blocked storage; the API; the 500 limit.
- `tests/fixtures/mock-mcp.mjs` — a real MCP SDK server on `127.0.0.1` with fictional tools (`get_item`,
  `list_comments`, `add_comment`, `update_item`, `log_work`), a call recorder (token only as SHA-256) and fault
  controls (`/__delay`, `/__error`, `/__drop`, `/__elicit`, `/__mutate`); `fake-net.mjs` points the fictional
  `tracker.example.com` at it. Used by `mcp/test/outbox-fixtures.test.ts` now and by the slice-2 worker specs.
