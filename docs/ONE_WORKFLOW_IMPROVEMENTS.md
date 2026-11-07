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
