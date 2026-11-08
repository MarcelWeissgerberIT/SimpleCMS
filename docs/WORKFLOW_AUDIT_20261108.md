# One workflow audit — 2026-11-08

Scope: Atlas evidence → staged code analysis → linked findings and mock feedback → revised mock → human adoption, plus navigation, recovery and collaboration. Browser journeys use the real One UI and isolated data. Model and Atlas responses are controlled fixtures; no real model/Atlas calls or user workspace writes are needed.

## Confirmed defect and correction

The work overview counted every saved result but rendered only `completed.slice(0, 12)`. The thirteenth and older results had no navigation control. A browser regression reproduced the missing button before the fix.

Saved results now have a separate title/source/status search and progressive groups of twelve. Clearing the search resets the visible group. Opening a result retains the original page, block and accepted revision. It does not approve a proposal or create another page. Search state is local to the mounted overview and does not alter saved content.

## Verification

- 27 existing workflow, connected-evidence, recovery and active-terminal checks: page switching, exact finding/note links, interrupted runs, retained checkpoint context, individually accepted changes and source-selected document workflows.
- 33 analysis/mock/overview checks: four analysis phases, acceptance, snapshot conflicts, revoked evidence, budgets, source changes during an asynchronous phase, multi-element and free-area notes, version previews, read-only behavior, concrete before/after comparisons, and the new result-search regression.
- 14 isolated cloud checks with two people: collaborative edits, offline reconnect, comments, role/member removal, concurrent analysis and mock feedback, both reconnect orders and Undo.
- 11 targeted Atlas/mock checks: fresh source reads, changed packages, access failures, proposal comparison and acceptance, unchanged proposals, multiple targets, free rectangles and separate Markdown decisions.
- TypeScript check; production builds; changelog checks and real screenshot. The result search was visually checked at 1440 and 390 pixels in Paper and Carbon.

Native-backup import exercises the shipped UI in an isolated local workspace without test hooks. It checks all thirteen saved results, source and result search, clearing an empty search, exact accepted-block navigation and reload. Runtime release hashes and final production evidence are recorded in `RUNTIME_RELEASES.md`.

## Limits

These checks establish client/server workflow behavior under controlled provider responses; they do not assess a live model's analysis quality or write to Atlas. Existing unsaved mock note text is still component-local; save it before leaving/removing the block. The overview's documented 50,000-node scan boundary remains in place and is disclosed in the UI. This correction removes the separate twelve-result navigation cutoff within that inventory.
