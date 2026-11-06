# Small code changes in One

A code-analysis finding with supporting references can create a `code-change` block. The person selects up to three non-overlapping ranges of one pinned Atlas snapshot and explicitly saves the code excerpts in the One page. This persistence is disclosed before loading.

The block supports manual replacements, a tool-free One-model proposal, a line diff, ten retained versions and explicit source-reverified acceptance. Model calls use the existing route, data-rule and budget checks. Changes to the page, source, access or block during a request reject late output. A per-block browser lock excludes simultaneous operations; the editor applies writes against the expected original text.

Acceptance is local to One. Native Atlas storage uses `atlas_code_change_save`; `get` refreshes the receipt. Publication uses a separate human-only authenticated server route, `/api/workspaces/:id/atlas-code-change-publish`, and the `atlas_code_change_publish` tool. Model and generic MCP calls cannot opt into it. Both package and displayed GitLab destination hashes are bound to the click. Build and tests have not run, and no code is executed in One.

Atlas must deploy the matching code-change API, migration and per-repository GitLab configuration described in its `docs/CODE-CHANGES.md`. With no destination, storage/export remain available. Publication creates a branch and draft merge request; it does not merge or update imported snapshots. An optional existing-record attachment retains compatibility with Atlas deployments without the native API, but does not apply code.

Verification: `tests/code-change.test.ts`, `server/test/atlas-mcp.test.ts`, and `tests/e2e/code-change.spec.ts`. Browser tests stub model/Atlas responses; live release checks must be recorded separately.
