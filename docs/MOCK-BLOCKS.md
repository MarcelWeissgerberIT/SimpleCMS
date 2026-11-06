# Atlas mock blocks

The editor slash menu `/mock` inserts `designMock`, with an editable paragraph title (also the fallback older editors retain) and a `spec` containing the source URL, requirement record, request and optional static preview. The regular AI terminal `/mock` flow is prepared only on a press, without autorun. Generated results from the same workspace can be explicitly adopted; mounting, reading, reloading and importing the block never invokes AI or attaches files. Request text and source metadata survive Markdown export; native page JSON and HTML copy/paste preserve the preview. The preview is a snapshot, not a live Atlas subscription. PNG/HTML export and Atlas attachment remain in the existing terminal card.

Stored preview HTML is bounded, sanitised, prefixed with an independent restrictive CSP and rendered without script permission. Read-only/locked pages show the snapshot without request-edit or adopt controls. Results are tagged with their run's workspace epoch to prevent cross-workspace adoption.

## Compatibility and rollout

The current mock journal uses document generation 3 (`NODE_GENERATIONS.designMock = 3`); the deployed server must support generation 3 for writes. The original reader rollout below describes generation 2. Local persistence uses the existing generation shadow/restore machinery; drop and unwrap regression checks retain the mock and older tabs’ edits. **Ship the generation-2 reader frontend first.** Cloud creation/editing stays disabled while `schema_min < 2` or unknown. In a subsequent release, raise `server/src/collab/schema-gate.ts`'s `MIN_CLIENT_SCHEMA` to 2, using the existing server deployment procedure. Older tabs then become read-only and must reload before editing; the generation-2 frontend can create mock blocks. Do not enable creation on an old server or deploy both phases in the opposite order. The reader was published as `mock-reader-760122f` and verified at the public URL with `schema_min=1` before the follow-up server release raised the minimum to 2.

## Verification

- App and server TypeScript checks; production frontend E2E build and server bundle.
- Unit coverage: bounded parsing, no token query storage, prepared command, metadata export and cloud generation gate; existing source-grounded mock contract tests.
- Browser: keyboard `/mock` insertion, editable request, no autorun, persistence and HTML clipboard round-trip; generated Atlas/model-fixture artifact adoption and reload; static iframe, no malicious resource/script execution, fullscreen, locked page.
- The subsequent One/Atlas stability work verifies the attachment flow, including partial success, account/workspace changes, current-source checks and retry without blind duplicate uploads. The large-source journey uses the 3.48 MB reference Markdown with synthetic Atlas/model replies; this verifies transport and source handling, not a real model’s visual design quality.


## Design package Epics and new use cases

Use the editor's `/mock` block. Paste a Component Studio design-package Epic URL into the design source field, describe the new dialog/list/screen, and optionally enable **Mock automatisch als neuen Record im Design-Epic speichern**. Requirements remain optional. A terminal equivalent is:

```text
/mock Erstelle einen Dialog zur Auswahl eines CyBio-Kopfs. Zeige verfügbare Köpfe, Auswahl und Bestätigung; Beispieldaten als solche kennzeichnen.
Atlas design epic: https://aj-atlas.com/r/38972
Atlas mock delivery: epic
```

The Epic must expose Component Studio's `ui-collection-members` index and `ui-package:*` tag. ONE reads the index, selects up to eight relevant components/patterns/screens and adds shared foundations (at most twenty source parts). Each child's project, parent and package tag must match. Full bodies stay in a bounded run-local cache; the draft receives bounded exact excerpts. An arbitrary Epic without that package index is not automatically expanded. The result remains a static proposal requiring visual and functional review.

Explicit Epic delivery creates a new `doc` child with the shared package tag, a per-mock identity tag, the use case and source links. HTML, browser-rendered PNG and provenance JSON become attachments. A partial upload retains the confirmed destination; retry searches/reuses the same artifact identity and uses stable filenames. The card links both the design Epic and saved mock. A supplied requirement is cited but does not replace the Epic child destination for this delivery option. Preview-only instructions suppress automatic delivery.

MCP reads explicitly refused by rate limiting can wait and retry up to eight times, with at most ten minutes total waiting, two minutes per wait and cancellation support. Writes are never blindly repeated. Conversation source memory retains up to 2,048 results within 128 MiB, with at most 8 MiB per result. These are transport/retention bounds, not the model context window. Long native Claude tool responses are excerpted before the next model request, preserving call/result pairs, signed thinking, source handles and observed write receipts. This does not remove provider, source-size, permission or task-budget limits.

The isolated browser regression lives at `tests/manual/epic-mock.html`. Start Vite with `ONE_SERVER=http://127.0.0.1:9` so the server-aware client path is enabled; the fixture intercepts its Atlas API calls and uses synthetic credentials and records only. Check “Einmal PNG-Upload ablehnen”, save, then resume: the status must show one created child and three confirmed attachments on the resumed attempt. Unit tests also exercise the actual SDK continuation with mocked HTTP to ensure completed tools are not replayed during context fitting.

## Claude draft request compatibility

The draft schema builds independent citation branches, so restricting the selected design Epic cannot be overwritten by the child-source enum. A free request uses a plain null target; a supplied requirement uses its exact string source ID. The Anthropic wire adapter partitions union enums into scalar branches (the live API rejected `type: ["string", "null"], enum: [null]`). Local validation retains all original source and requirement restrictions.

Exact source excerpts appear once in the draft request; the task contract carries source IDs. Draft/repair output budgets are 12,288 tokens for an Epic and 8,192 for a single catalogue, still subject to the configured governor. The previous 4,096-token cap truncated the real table mock after the schema correction. Centrally managed structured calls preserve the transport's zero-retry policy instead of overriding it with the personal-client retry count. Central failures offer a direct link to the workspace access/log view.

Draft schema failures (including truncated JSON) now carry the failed draft into
exactly one correction, just like HTML/provenance failures. Provider errors are
propagated without another model attempt. Correction feedback includes all check
messages (bounded to 8,000 characters) and up to 64,000 characters of the failed
draft, rather than cutting off its CSS and citations after the first 3,000.

Static controls may inherit an explicit cited `data-ds-component` from their
nearest component wrapper (for example Search → input or DataTable → table).
Uncited component names and controls outside any mapped component remain blocked.
The inert document allows the inert `name` attribute; scripts, submission and
external resources remain forbidden. `inset` is accepted as box-shadow syntax,
while nonzero dimensions and colours still require cited token variables.


## MCP context and recovery (2026-11-06)

MCP discovery retains the server's exact schema and supplements descriptions with host guidance: known refs use `atlas_get`, search results lead to selected body reads, and mutations require the existing task and review gates. `one_mcp_call` supports `fresh: true`. Identical successful reads can otherwise be reused for 30 seconds within the task, with an explicit historical-read marker. Identity, access, constraints and mutable job/status checks bypass this cache. A write attempt, catalogue refresh or changed workspace/access scope invalidates reuse. All actual source responses, including small responses, remain searchable through the conversation source index; reaching capacity fails explicitly rather than forgetting previous sources.

Mock source bodies can be saved locally in IndexedDB (`one-mcp-work`). A later run first performs a permitted fresh metadata read. Reuse requires a service-owned unchanged revision plus matching source identity/lifecycle metadata and an intact saved hash. Missing revision, changed content metadata or invalid cache causes a full body read. A denied metadata read stops the operation and does not fall back to a saved body. Full original bodies stay outside the model prompt; bounded exact excerpts are sent. The selected Epic index and chosen child records retain their existing relationship validation.

The terminal shows a collapsed **Saved work / Gesicherter Arbeitsstand** shelf. Checkpoints contain the historical task, source/effect references, staged IDs and bounded draft context. They do not serialize executable operations, complete staged proposals or unsaved mock HTML. Reloading never starts inference or repeats external writes. **Resume analysis** starts a fresh host-enforced read-only task, checks current provider/data access and carries the historical source-page reference. Saving a result to a page remains the durable workflow; the local checkpoint is a recovery aid, not a complete backup.

Local recovery and mock source snapshots share a 24 MiB / 160-entry bound and a 24-hour validity period. Old/oversized entries may be evicted; expired data is ignored and pruned on the next write. The shelf exposes discard and clear actions. Connection credentials are excluded; the workspace/account/access/data-flow scope is stored only as a digest. Storage failures produce a non-blocking notice and leave the current run usable in memory.

Accepted mock feedback records the version that incorporated it, while human review and pending Markdown changes remain independent. Accepted notes are excluded from another revision until explicitly reopened. The Notes tab shows **Included in Vn / Berücksichtigt in Vn**; MD changes remain queued even after mock completion or restoration of an earlier preview.

`/mock` uses a dedicated read/preview instruction set instead of unrelated database, coding and automation instructions. Model-facing receipts keep references, effects and verification status; complete cryptographic checks remain in the host audit. Context fitting preserves tool arguments, source handles, write receipts and cache freshness markers. Advertised model output limits determine output reservation. Provider context windows, user cost/data rules and the existing 1,000-call task budget still apply.

## Mock evolution and design feedback (2026-11-06)

The page block now retains up to eight pending AI revisions. They survive reloads and keep the current preview active until **Adopt version**. **Before / after** opens both snapshots and highlights changed component groups; **Discard** removes a proposal from the pending shelf. Adoption still checks the original preview and note hashes. A newer edit is never silently overwritten. All prior accepted snapshots remain in the Versions tab, within its explicit 30-version limit.

A marked component revision sends its smallest shared component region to the model when possible. The host merges the validated fragment into the original document, scopes replacement styles, retains untouched siblings and merges source receipts. Missing or changed annotation targets fail explicitly. Multi-region/body changes and legacy previews use the existing bounded full-draft path. Global CSS rules that cannot be isolated are rejected. Focused revisions support base documents up to 160,000 characters; full drafts retain their smaller prompt bound. These limits protect source/preview integrity rather than silently trimming the saved mock.

The Components tab shows catalogue quotations and tokens from the same sources. **Find catalogue alternative** prepares a marked revision task without starting it. Device preview offers original, desktop (1440), tablet (768) and mobile (390) widths. Empty/loading/error/success controls prepare a new state proposal; the existing mock stays active until acceptance. These are reviewed static variants, not fabricated application runtime behavior.

The Atlas tab can explicitly re-read all saved source receipts and show changed sources. **Queue update** creates component feedback for the changed definitions. Checking does not regenerate a mock or update Atlas. Read results shown in this panel are temporary; saved source receipts and queued feedback remain on the page.

Pending design-system feedback can prepare a concrete Markdown proposal. A dedicated, tool-free structured model request selects an actually read design source and an exact, uniquely matching passage. The host produces a complete before/after body, preserving unrelated content. Preparation writes only the One note. **Approve and save Markdown change** checks the current source, constraints and discovered update schema before one write, then reads back the complete body. Where advertised, `expectedBodyHash` is sent; otherwise the pre-write check does not provide atomic compare-and-swap protection against a simultaneous external writer. An uncertain write is checkpointed before dispatch; its follow-up action only re-reads and never replays the mutation. A mismatch requires a freshly prepared proposal. Requirements are not silently rewritten. Proposals remain bound to the note hash, workspace and original Atlas connection.

Mock journal generation 4 adds pending revisions and Markdown receipts. Deploy the generation-4 frontend before raising the server minimum to 4. Older clients then enter read-only mode rather than rewriting pages with parsers that drop these fields. Existing generation-3 journals are retained by the compatibility transformation.

Validation uses synthetic Atlas and model replies, including conflict detection, an ambiguous successful write followed by read-only verification, source changes, reload/adoption, marked region replacement, device widths and preservation of unrelated content. It does not claim a live model's visual quality or a real Atlas mutation was tested.
