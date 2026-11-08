# One workflow improvements — 2026-11-07

Scope: eight approved improvements, extending the existing terminal, document pipeline,
code analysis, mock review and private compiled-program library. Source-reference subpages
remain an explicit user action. Opening an overview must not run a model or read Atlas.

- [x] Recovery: durable checkpoints, progress and cost receipts; no replay of writes.
- [x] Repair: actionable source/budget/connection errors; resume the current stage.
- [x] Review: unified entry to individual staged diffs and mock proposals.
- [x] Activity: readable One operations and observed waiting/elapsed state.
- [x] Traceability: findings, evidence, requirements and mock sources; explicit gaps.
- [x] Overview: open notes, approvals, failed runs and pending Markdown work.
- [x] Costs: known scope before starting; actual per-run costs including failures.
- [x] Recipes: successful analysis to an editable private reusable program.

Validation: typecheck, targeted browser regressions, build, PR review, deployment and
isolated public-browser checks. Preserve workspace boundaries and historical provenance.

Implemented by extending existing review/resume paths rather than creating parallel approval
or storage systems. The overview uses saved page content only, excludes trash/templates,
paginates long lists, and closes on access-scope changes. Code cards load explicitly.
Recipes are editable compiled programs with exact current read-tool schemas, replaceable
source inputs and a fresh scope decision; they never replay a previous tool trace.

Validation before release: 27 browser checks passed (work overview, complete recipe save/run,
fresh source reads, explicit single-edit acceptance, document pipeline retry/stop/budget/source
conflicts, interrupted-stage cost settlement, code analysis version/evidence controls).
Desktop/mobile light/dark screenshots inspected. TypeScript and production build checked.
Live deployment and its exact source/manifest are recorded in RUNTIME_RELEASES.md.

## Team working copies — 2026-11-08

Code-change form drafts live in a private, tab-local memory store (maximum 50 entries,
no silent eviction), scoped to workspace, identity, access and role. Navigation preserves
the selected proposal, instruction and edits. The overview exposes open/download/discard.
They are deliberately not synchronized or written to browser storage. A before-unload
warning asks the user to save/download first. Access-context changes and removed/trashed
pages clear copies; a shared block revision change preserves a detached, downloadable
copy and prevents stale replacement. An instruction-only draft also counts as unsaved.

The four JSON-backed code-block controls (code-change, code-analysis, atlas-code,
ui-instructions) replace the complete Y element under the normal writer frame and undo
origin. Character-level merging of these JSON strings could corrupt both values. Concurrent
replacements instead retain two complete blocks; normal prose/source editing stays on its
existing CRDT path. No document schema migration or dependency patch is involved. Code
proposals with the same proposal identity on a page surface their parallel copies and
prevent model generation, acceptance and Atlas delivery until the person resolves them.
This is not a global repository lock: copies on separate pages and external write paths
are outside this local review guard. Other structured block types are not migrated here.

Editor editability changes notify reactive node views without a content write or undo
step. Source-reference save failures retain the form and report the conflict. Socket
reconnect intent is set before connect(), including role refresh, because the provider can
still report Connected while its previous socket is closing. That late close must retry.
