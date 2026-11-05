# Atlas mock blocks

The editor slash menu `/mock` inserts `designMock`, with an editable paragraph title (also the fallback older editors retain) and a `spec` containing the source URL, requirement record, request and optional static preview. The regular AI terminal `/mock` flow is prepared only on a press, without autorun. Generated results from the same workspace can be explicitly adopted; mounting, reading, reloading and importing the block never invokes AI or attaches files. Request text and source metadata survive Markdown export; native page JSON and HTML copy/paste preserve the preview. The preview is a snapshot, not a live Atlas subscription. PNG/HTML export and Atlas attachment remain in the existing terminal card.

Stored preview HTML is bounded, sanitised, prefixed with an independent restrictive CSP and rendered without script permission. Read-only/locked pages show the snapshot without request-edit or adopt controls. Results are tagged with their run's workspace epoch to prevent cross-workspace adoption.

## Compatibility and rollout

This is document generation 2 (`NODE_GENERATIONS.designMock = 2`). Local persistence uses the existing generation shadow/restore machinery; drop and unwrap regression checks retain the mock and older tabs’ edits. **Ship the generation-2 reader frontend first.** Cloud creation/editing stays disabled while `schema_min < 2` or unknown. In a subsequent release, raise `server/src/collab/schema-gate.ts`'s `MIN_CLIENT_SCHEMA` to 2, using the existing server deployment procedure. Older tabs then become read-only and must reload before editing; the generation-2 frontend can create mock blocks. Do not enable creation on an old server or deploy both phases in the opposite order. The reader was published as `mock-reader-760122f` and verified at the public URL with `schema_min=1` before the follow-up server release raised the minimum to 2.

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

MCP reads refused by rate limiting can wait and retry up to three times, with at most three minutes of total waiting and cancellation support. Writes are never blindly repeated. The source cache retains up to 64 results within the unchanged 24 MB total bound. Long native Claude tool responses are excerpted before the next model request, preserving call/result pairs, signed thinking, source handles and observed write receipts. This does not remove provider, source-size, permission or task-budget limits.

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
