# Atlas mock blocks

The editor slash menu `/mock` inserts `designMock`, with an editable paragraph title (also the fallback older editors retain) and a `spec` containing the source URL, requirement record, request and optional static preview. The regular AI terminal `/mock` flow is prepared only on a press, without autorun. Generated results from the same workspace can be explicitly adopted; mounting, reading, reloading and importing the block never invokes AI or attaches files. Request text and source metadata survive Markdown export; native page JSON and HTML copy/paste preserve the preview. The preview is a snapshot, not a live Atlas subscription. PNG/HTML export and Atlas attachment remain in the existing terminal card.

Stored preview HTML is bounded, sanitised, prefixed with an independent restrictive CSP and rendered without script permission. Read-only/locked pages show the snapshot without request-edit or adopt controls. Results are tagged with their run's workspace epoch to prevent cross-workspace adoption.

## Compatibility and rollout

This is document generation 2 (`NODE_GENERATIONS.designMock = 2`). Local persistence uses the existing generation shadow/restore machinery; drop and unwrap regression checks retain the mock and older tabs’ edits. **Ship the generation-2 reader frontend first.** Cloud creation/editing stays disabled while `schema_min < 2` or unknown. In a subsequent release, raise `server/src/collab/schema-gate.ts`'s `MIN_CLIENT_SCHEMA` to 2, using the existing server deployment procedure. Older tabs then become read-only and must reload before editing; the generation-2 frontend can create mock blocks. Do not enable creation on an old server or deploy both phases in the opposite order. This change deliberately leaves the server minimum at 1.

## Verification

- App and server TypeScript checks; production frontend E2E build and server bundle.
- Unit coverage: bounded parsing, no token query storage, prepared command, metadata export and cloud generation gate; existing source-grounded mock contract tests.
- Browser: keyboard `/mock` insertion, editable request, no autorun, persistence and HTML clipboard round-trip; generated Atlas/model-fixture artifact adoption and reload; static iframe, no malicious resource/script execution, fullscreen, locked page.
- A pre-existing `design-mocks.spec.ts` Atlas-attachment integration case fails MCP discovery in both the clean base commit and this branch. The block generation/adoption checks pass; this change does not alter the existing attachment transport.
