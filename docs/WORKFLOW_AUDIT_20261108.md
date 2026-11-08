# One workflow audit — 2026-11-08

Scope: Atlas evidence → staged code analysis → linked findings and mock feedback → revised mock → human adoption, plus navigation, recovery and collaboration. Browser journeys use the real One UI and isolated data. Model and Atlas responses are controlled fixtures; no real model/Atlas calls or user workspace writes are needed.

## Confirmed defect and correction

The work overview counted every saved result but rendered only `completed.slice(0, 12)`. The thirteenth and older results had no navigation control. A browser regression reproduced the missing button before the fix.

Saved results now have a separate title/source/status search and progressive groups of twelve. Clearing the search resets the visible group. Opening a result retains the original page, block and accepted revision. It does not approve a proposal or create another page. Search state does not alter saved content. The subsequent continuity update below preserves it privately across navigation and reload.

## Verification

- 27 existing workflow, connected-evidence, recovery and active-terminal checks: page switching, exact finding/note links, interrupted runs, retained checkpoint context, individually accepted changes and source-selected document workflows.
- 33 analysis/mock/overview checks: four analysis phases, acceptance, snapshot conflicts, revoked evidence, budgets, source changes during an asynchronous phase, multi-element and free-area notes, version previews, read-only behavior, concrete before/after comparisons, and the new result-search regression.
- 14 isolated cloud checks with two people: collaborative edits, offline reconnect, comments, role/member removal, concurrent analysis and mock feedback, both reconnect orders and Undo.
- 11 targeted Atlas/mock checks: fresh source reads, changed packages, access failures, proposal comparison and acceptance, unchanged proposals, multiple targets, free rectangles and separate Markdown decisions.
- TypeScript check; production builds; changelog checks and real screenshot. The result search was visually checked at 1440 and 390 pixels in Paper and Carbon.

Native-backup import exercises the shipped UI in an isolated local workspace without test hooks. It checks all thirteen saved results, source and result search, clearing an empty search, exact accepted-block navigation and reload. Runtime release hashes and final production evidence are recorded in `RUNTIME_RELEASES.md`.

## Limits

These checks establish client/server workflow behavior under controlled provider responses; they do not assess a live model's analysis quality or write to Atlas. Mock drafts now use private tab storage as described below; save the note for durable shared storage. The overview's documented 50,000-node scan boundary remains in place and is disclosed in the UI. This correction removes the separate twelve-result navigation cutoff within that inventory.


## Work continuity update

- Pending mock notes preserve text, intent, scope, grouped targets and free rectangles in private session storage, scoped to account/workspace/access context and expiring after 24 hours. Navigation and reload retain the draft. Closing the tab may remove it. Storage failures show a warning; secret-like input is not persisted. A changed preview retains text but requires a new target selection.
- Overview searches, filters, expansion and scroll position are restored privately in the same tab. Work paths group saved source references, outstanding steps and results by actual page/block and link to the original target. They do not infer dependencies from page proximity.
- Source links expose recorded changed-snapshot checks and affected findings/requirements, including requirements without an open gap. Exact server, repository, file, snapshot and commit identities remain separate. A changed snapshot alone is not a verified code diff.
- Findings can create/reopen a native review-task page with assignment, due date, comments, countercheck, decision and rationale. A backlink pins the original finding/revision. Private source tasks remain private. Task completion does not adopt the analysis or decide the finding automatically.
- Budget before start displays the central owner's monthly budget, spent and held amounts, and available balance. Members cannot read owner-only totals. Local governor usage remains separate. Existing request estimates remain estimates for known context, not total-run quotes.

Validation: 40 workflow/mock/regression browser checks and six disposable two-person server checks pass, including permission revocation during a model response and the owner/member budget boundary. Desktop/mobile Paper/Carbon work paths and the real changelog screenshot were inspected. The overview's existing disclosed 50,000-node inventory bound remains.
